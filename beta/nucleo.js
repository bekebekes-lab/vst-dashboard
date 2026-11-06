// Núcleo de cálculo do Gerencial do Beta2 (sem DOM).
//
// Estas regras REPRODUZEM as do index.html (função render() e auxiliares do
// Gerencial) para que os números batam com o Dash atual. Onde foi copiado:
//   getGrupoKey / ehProdutoSolucaoDigital ... index.html ~3650-3722
//   receitaLinha (gerReceitaLinha) ........... index.html ~4208
//   getEscopoTravado / linhaDentroDoEscopo ... index.html ~4133-4165 (e api/_lib/escopo.js)
//   linhaBateBusca / filtro de Cadastro ...... index.html ~4049-4185
//   laço de agregação (render) ............... index.html ~4291-4342
// A base já chega filtrada pelo servidor (api/sheets.js); o filtro de escopo
// aqui é defesa em profundidade, igual ao Dash atual.

import { EQUIPES_ESTADOS, EQUIPES_GESTORES } from './equipes.js';
import { PRODUTOS_SOLUCAO_DIGITAL, PRODUTOS_SD_CONTEM, SUBGRUPOS_FILA, ORDEM_SUBGRUPOS_FILA } from './regras.js';

export const CATS = ['GERAL', 'GROSS', 'RENOVAÇÃO', 'BL', 'TITULARIDADE', 'SERV. DIGITAIS'];
export const FILA_ATIVO = 'Ativo/Instalado';

// ── normalização ────────────────────────────────────────────────────────────
export function normalizarNomeEquipe(s) {
  return (s || '').toString().trim()
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ');
}

// values = resposta crua do Sheets (matriz). Devolve array de objetos.
export function parseLinhas(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = h === 'EQUIPE' ? normalizarNomeEquipe(r[i]) : (r[i] || '').toString().trim(); });
    return o;
  });
}

// ── classificação ───────────────────────────────────────────────────────────
const _produtosSDSet = new Set(PRODUTOS_SOLUCAO_DIGITAL.map(p => p.toUpperCase()));
export function ehProdutoSolucaoDigital(produto) {
  const norm = (produto || '').trim().toUpperCase();
  if (_produtosSDSet.has(norm)) return true;
  return PRODUTOS_SD_CONTEM.some(t => norm.includes(t));
}

// O Dash atual mantém MONITOR_SD_DUPLICADO como global por período carregado.
// Aqui é calculado por conjunto de linhas e passado explicitamente.
export function detectarMonitorDuplicado(rows) {
  return rows.some(r => {
    if ((r['PRODUTO'] || '').trim().toUpperCase() !== 'CLARO MONITOR') return false;
    const gu = (r['GRUPO'] || '').trim().toUpperCase();
    return gu !== 'SVA MOVEL' && gu !== 'SVA MÓVEL';
  });
}

export function getGrupoKey(g, produto, solicitacao, monitorDup) {
  const gu = (g || '').trim().toUpperCase().replace(/[‐-―]/g, '-');
  const produtoNorm = (produto || '').trim().toUpperCase();
  const claroMonitorDuplicadoSvaMovel = monitorDup && produtoNorm === 'CLARO MONITOR' && (gu === 'SVA MOVEL' || gu === 'SVA MÓVEL');
  if (!claroMonitorDuplicadoSvaMovel && ehProdutoSolucaoDigital(produto)) return 'SERV. DIGITAIS';
  if (gu === 'GROSS') return 'GROSS';
  if (gu === 'VOZ - RENOVAÇÃO') return 'RENOVAÇÃO';
  if (gu === 'NET PJ - VIRTUA') return 'BL';
  if (gu === 'VOZ - TRANF. TITULARIDADE' || gu === 'VOZ - TRANSF. TITULARIDADE') {
    if ((solicitacao || '').trim().toUpperCase() === 'TRANSF. TITULAR PJ / PJ') return null;
    return 'TITULARIDADE';
  }
  return null;
}

export function receitaLinha(r) {
  const qtd = parseInt(r['QUANTIDADE']) || 1;
  const valor = parseFloat((r['VALOR UNIT'] || '0').toString().replace(',', '.')) || 0;
  return (r['GRUPO'] || '') === 'NET PJ - VIRTUA' ? qtd * valor : valor;
}

export function subgrupoDaFila(fila) { return SUBGRUPOS_FILA[fila] || 'Outros'; }
export { ORDEM_SUBGRUPOS_FILA };

// ── datas ───────────────────────────────────────────────────────────────────
export function parseDataBR(val) {
  if (!val) return null;
  const s = val.toString().trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
export function diasNoMes(mm, yyyy) { return new Date(parseInt(yyyy), parseInt(mm), 0).getDate(); }

// ── escopo (perfil) ─────────────────────────────────────────────────────────
export function getEscopoTravado(u) {
  const p = u?.perfil;
  if (!p || p === 'admin') return null;
  if (p === 'gestor_macro2') { const g = u.gestores_ref || []; return g.length ? { gestores: new Set(g) } : null; }
  if (['gestor_macro', 'gestor_macro3', 'gestor', 'gestor_beta'].includes(p)) {
    const g = (u.gestores_ref || []).length ? u.gestores_ref : (u.gestor_ref ? [u.gestor_ref] : []);
    return g.length ? { gestores: new Set(g) } : null;
  }
  if (p === 'supervisao' || p === 'supervisao_beta') { const e = u.equipes_ref || []; return e.length ? { equipes: new Set(e) } : null; }
  if (p === 'consultor') return u.consultor_ref ? { consultorRef: u.consultor_ref.toUpperCase() } : null;
  return null;
}
export function linhaDentroDoEscopo(r, escopo) {
  if (!escopo) return true;
  const eq = r['EQUIPE'] || '';
  if (escopo.gestores && !escopo.gestores.has(EQUIPES_GESTORES[eq])) return false;
  if (escopo.equipes && !escopo.equipes.has(eq)) return false;
  if (escopo.consultorRef && (r['PROPRIETÁRIO DO PEDIDO'] || '').toUpperCase() !== escopo.consultorRef) return false;
  return true;
}

// ── filtros ─────────────────────────────────────────────────────────────────
// statusModo: 'todos' | 'aprovado' | 'ativo' | 'custom' (lista em `status`)
export function filtrosVazios() {
  return { uf: 'Todos', gestores: [], equipes: [], consultores: [], tag: 'Todas', busca: '', de: null, ate: null, statusModo: 'todos', status: [] };
}

// "Aprovado" = Ativo + Esteira de ativação (mesma definição do bloco "Aprovado" do Gerencial atual).
const SUBGRUPOS_APROVADO = ['Ativo', 'Esteira de ativação'];
const FILAS_APROVADO = new Set(Object.keys(SUBGRUPOS_FILA).filter(k => SUBGRUPOS_APROVADO.includes(SUBGRUPOS_FILA[k])));
// Conjunto de filas permitido pelo filtro de status; null = todas.
export function filasPermitidas(f) {
  if (f.statusModo === 'ativo') return new Set([FILA_ATIVO]);
  if (f.statusModo === 'aprovado') return FILAS_APROVADO;
  if (f.statusModo === 'custom' && f.status.length) return new Set(f.status);
  return null;
}
// Só Ativo/Instalado (preset ou seleção única)? Muda a data de corte do comparativo (DATA REF, como a Produção).
export function soAtivo(f) {
  return f.statusModo === 'ativo' || (f.statusModo === 'custom' && f.status.length === 1 && f.status[0] === FILA_ATIVO);
}

function bateBusca(r, lower, digits) {
  if (!lower) return true;
  if ((r['NOME CLIENTE'] || '').toLowerCase().includes(lower)) return true;
  if ((r['VINCULADO'] || '').toLowerCase().includes(lower)) return true;
  if (digits) {
    if ((r['CPF/CNPJ'] || '').replace(/\D/g, '').includes(digits)) return true;
    const numero = (r['NUMERO'] || r['Numero'] || r['NÚMERO'] || '').toString().replace(/\D/g, '');
    if (numero.includes(digits)) return true;
    if ((r['NUMERO PEDIDO'] || '').toString().replace(/\D/g, '').includes(digits)) return true;
    if ((r['TELEFONE CEDENTE'] || '').toString().replace(/\D/g, '').includes(digits)) return true;
  }
  return false;
}

// Aplica os filtros. `ignorar` = nomes de filtros a pular (usado pela cascata
// das opções e pela série mensal, que ignora data/busca).
export function filtrar(rows, f, escopo, ignorar = []) {
  const ig = new Set(ignorar);
  const lower = ig.has('busca') ? '' : (f.busca || '').trim().toLowerCase();
  const digits = lower.replace(/\D/g, '');
  const filas = ig.has('status') ? null : filasPermitidas(f);
  const de = ig.has('data') ? null : f.de;
  const ate = ig.has('data') ? null : f.ate;
  return rows.filter(r => {
    const eq = r['EQUIPE'];
    if (!linhaDentroDoEscopo(r, escopo)) return false;
    if (!ig.has('uf') && f.uf !== 'Todos' && (EQUIPES_ESTADOS[eq] || '') !== f.uf) return false;
    if (!ig.has('gestor') && f.gestores.length && !f.gestores.includes(EQUIPES_GESTORES[eq] || '')) return false;
    if (!ig.has('equipe') && f.equipes.length && !f.equipes.includes(eq)) return false;
    if (!ig.has('consultor') && f.consultores.length) {
      const cons = (r['PROPRIETÁRIO DO PEDIDO'] || 'Sem Consultor').toUpperCase();
      if (!f.consultores.some(c => c.toUpperCase() === cons)) return false;
    }
    if (!ig.has('tag') && f.tag !== 'Todas' && (r['TAGS ATIVIDADE'] || '') !== f.tag) return false;
    if (filas && !filas.has(r['FILA'] || 'Sem Status')) return false;
    if (!bateBusca(r, lower, digits)) return false;
    if (de || ate) {
      const d = parseDataBR(r['CADASTRO']);
      if (!d) return false;
      if (de && d < de) return false;
      if (ate && d > ate) return false;
    }
    return true;
  });
}

// Opções de cada filtro, restringidas pelos OUTROS filtros (cascata nos dois
// sentidos, como atualizarCascataGerencial() no Dash atual).
export function opcoesDosFiltros(rows, f, escopo) {
  const facetas = {
    uf:        r => EQUIPES_ESTADOS[r['EQUIPE']] || null,
    gestor:    r => EQUIPES_GESTORES[r['EQUIPE']] || null,
    equipe:    r => r['EQUIPE'] || null,
    consultor: r => r['PROPRIETÁRIO DO PEDIDO'] || null,
    tag:       r => r['TAGS ATIVIDADE'] || null,
    status:    r => r['FILA'] || 'Sem Status',
  };
  const out = {};
  for (const k of Object.keys(facetas)) {
    const base = filtrar(rows, f, escopo, [k, 'busca', 'data']);
    out[k] = [...new Set(base.map(facetas[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  return out;
}

// ── agregação ───────────────────────────────────────────────────────────────
const CAMPOS = ['GROSS', 'RENOVAÇÃO', 'BL', 'TITULARIDADE', 'SERV. DIGITAIS', 'GERAL', 'ATIVO'];
function novaEntidade(extra) {
  const e = { ...extra, n: 0 };
  CAMPOS.forEach(c => { e[c] = 0; e[c + '_REC'] = 0; });
  return e;
}
function somar(e, key, qtd, rec, ativo) {
  e[key] += qtd; e[key + '_REC'] += rec;
  if (key !== 'SERV. DIGITAIS') {
    e.GERAL += qtd; e.GERAL_REC += rec;
    if (ativo) { e.ATIVO += qtd; e.ATIVO_REC += rec; }
  }
}

// rows = linhas JÁ filtradas. Replica o laço de render() do Dash atual.
export function agregar(rows, monitorDup) {
  const cats = {};
  CATS.forEach(c => { cats[c] = { total: 0, totalRec: 0, filas: {}, filasRec: {} }; });
  const porConsultor = new Map(), porEquipe = new Map(), porGestor = new Map();
  const consultoresSet = new Set();

  for (const r of rows) {
    const eq = r['EQUIPE'];
    const ges = EQUIPES_GESTORES[eq] || 'Sem gestor';
    const cons = r['PROPRIETÁRIO DO PEDIDO'] || 'Sem Consultor';
    consultoresSet.add(cons);
    const key = getGrupoKey(r['GRUPO'], r['PRODUTO'], r['SOLICITACAO'], monitorDup);
    if (!key) continue;
    const qtd = parseInt(r['QUANTIDADE']) || 1;
    const rec = receitaLinha(r);
    const fila = r['FILA'] || 'Sem Status';
    const ativo = fila === FILA_ATIVO;

    const addCat = c => {
      cats[c].total += qtd; cats[c].totalRec += rec;
      cats[c].filas[fila] = (cats[c].filas[fila] || 0) + qtd;
      cats[c].filasRec[fila] = (cats[c].filasRec[fila] || 0) + rec;
    };
    addCat(key);
    if (key !== 'SERV. DIGITAIS') addCat('GERAL');

    const get = (map, k, extra) => { let e = map.get(k); if (!e) { e = novaEntidade(extra); map.set(k, e); } return e; };
    somar(get(porConsultor, cons, { nome: cons, equipe: eq, gestor: ges, tag: r['TAGS ATIVIDADE'] || '' }), key, qtd, rec, ativo);
    somar(get(porEquipe, eq || 'Sem equipe', { nome: eq || 'Sem equipe', gestor: ges, uf: EQUIPES_ESTADOS[eq] || '' }), key, qtd, rec, ativo);
    somar(get(porGestor, ges, { nome: ges }), key, qtd, rec, ativo);
  }
  const nCons = consultoresSet.size;
  return {
    cats, nLinhas: rows.length, nConsultores: nCons,
    porConsultor: [...porConsultor.values()],
    porEquipe: [...porEquipe.values()],
    porGestor: [...porGestor.values()],
  };
}

// Soma as filas do card GERAL por subgrupo (Ativo, Esteira de ativação, ...)
export function totaisPorSubgrupo(cat, usarReceita) {
  const filas = usarReceita ? cat.filasRec : cat.filas;
  const out = {};
  for (const [fila, v] of Object.entries(filas)) {
    const g = subgrupoDaFila(fila);
    out[g] = (out[g] || 0) + v;
  }
  return out;
}

// KPIs do topo. Mesma base (GERAL) que o card "GERAL" do Dash atual.
export function calcularKPIs(agg) {
  const g = agg.cats['GERAL'];
  const sub = totaisPorSubgrupo(g, false);
  const total = g.total;
  const ativos = g.filas[FILA_ATIVO] || 0;
  return {
    pedidos: total,
    receita: g.totalRec,
    pendentes: sub['Esteira de ativação'] || 0,
    correcao: sub['Esteira de ativação (correção)'] || 0,
    ativos,
    taxaAtivacao: total ? (ativos / total) * 100 : 0,
  };
}

// Variação percentual; null quando não há base de comparação.
export function variacaoPct(atual, anterior) {
  if (anterior === null || anterior === undefined) return null;
  if (!anterior) return atual ? null : 0;
  return ((atual - anterior) / anterior) * 100;
}

// ── meses ───────────────────────────────────────────────────────────────────
export const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export function parseAba(nome) {
  const m = (nome || '').match(/^BaseCRM\s+(\d{2})(\d{4})$/);
  return m ? { mm: m[1], yyyy: m[2], nome } : null;
}
export function nomeAba(mm, yyyy) { return `BaseCRM ${mm}${yyyy}`; }
export function mesAnterior(mm, yyyy, delta = 1) {
  let m = parseInt(mm) - delta, y = parseInt(yyyy);
  while (m <= 0) { m += 12; y -= 1; }
  return { mm: String(m).padStart(2, '0'), yyyy: String(y) };
}
