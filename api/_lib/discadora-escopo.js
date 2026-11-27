// Quem pode ver o quê na Discadora — decidido AQUI, no servidor (a trava da tela é só conforto).
//
//   tudo   → admin, admin_gestao, gestor_macro, gestor_macro2 (veem todos os grupos)
//   grupo  → gestor, supervisao e as versões _beta com a aba liberada: SÓ o grupo de usuarios_dashboard.grupo_ref
//            (nome exato do grupo na Discadora, ex.: 'MARINGA 2', 'Cascavel'). Sem grupo_ref → negado (falha fechada).
//   negado → todo o resto (consultor, suporte, gestor_macro3, admin_beta... sem a aba) e contas desativadas.
//
// "Tem a aba" = o perfil já traz Discadora (ABAS_PERMITIDAS_POR_PERFIL em index.html) OU a concessão
// 'discadora' em acesso_extra_abas.

const VE_TUDO = ['admin', 'admin_gestao', 'gestor_macro', 'gestor_macro2'];
const TRAVA_POR_GRUPO = ['gestor', 'supervisao', 'gestor_beta', 'supervisao_beta'];
const TEM_ABA_POR_PERFIL = ['gestor', 'supervisao'];

export function escopoDiscadora(row) {
  if (!row || row.ativo === false) return { tipo: 'negado' };
  const perfil = row.perfil || 'consultor';
  const extras = Array.isArray(row.acesso_extra_abas) ? row.acesso_extra_abas : [];
  if (VE_TUDO.includes(perfil)) return { tipo: 'tudo' };
  const temAba = TEM_ABA_POR_PERFIL.includes(perfil) || extras.includes('discadora');
  if (!temAba || !TRAVA_POR_GRUPO.includes(perfil)) return { tipo: 'negado' };
  const grupo = (row.grupo_ref || '').toString().trim();
  return grupo ? { tipo: 'grupo', grupo } : { tipo: 'negado' };
}

export function normGrupo(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Consulta GraphQL da busca ao vivo permitida a quem tem escopo de grupo: UM campo só na raiz, e só
// listar_historico_contato ou listar_usuarios (sem alias, sem mutation, sem outro campo ao lado).
// Devolve o nome do campo, ou null se a consulta não for aceita.
export function consultaPermitida(query) {
  if (typeof query !== 'string' || query.length > 4000) return null;
  const q = query.trim();
  const m = q.match(/^\{\s*(listar_historico_contato|listar_usuarios)\s*\(/);
  if (!m) return null;
  // anda pelo texto respeitando aspas: fecha os argumentos "( )", depois o bloco do campo "{ }", e o "}" da raiz
  let i = m[0].length, prof = 1, str = false;
  for (; i < q.length && prof > 0; i++) {            // argumentos
    const c = q[i];
    if (str) { if (c === '\\') i++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === '(') prof++; else if (c === ')') prof--;
  }
  if (prof !== 0) return null;
  while (/\s/.test(q[i] || '')) i++;
  if (q[i] !== '{') return null;                      // bloco de campos do próprio campo
  prof = 0;
  for (; i < q.length; i++) {
    const c = q[i];
    if (str) { if (c === '\\') i++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === '{') prof++; else if (c === '}') { prof--; if (prof === 0) { i++; break; } }
  }
  if (prof !== 0) return null;
  if (q.slice(i).trim() !== '}') return null;          // nada além do "}" que fecha a raiz
  return m[1];
}

// Garante que cada ligação venha com o grupo (para filtrar no servidor) e devolve a consulta alterada.
export function comGrupoNaConsulta(query) {
  if (/grupo\s*\{/.test(query)) return query;
  return query.replace(/(listar_historico_contato\s*\([^)]*\)\s*\{)/, '$1 grupo { nome } ');
}
