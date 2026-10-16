// Gestão de acessos de CONSULTOR por quem está acima deles (admin e gestores):
// criar, listar, bloquear/reativar e redefinir senha.
//
// Tudo aqui roda com a chave de serviço do Supabase, então a autorização é
// 100% daqui — o navegador só pede, nunca decide:
//  - só os perfis de PERFIS_QUE_GERENCIAM entram;
//  - perfil não-admin precisa ter escopo definido (gestor/equipes), com UMA
//    exceção explícita e deliberada: gestor_macro2 sem gestores_ref (Laura e
//    Maria) gerencia consultores de toda a empresa — igual à visão que já têm;
//  - o consultor escolhido tem que existir DENTRO da visão de quem pede (a
//    lista de candidatos vem do /api/sheets, que já devolve a base filtrada
//    pelo escopo de quem chama);
//  - a conta criada é SEMPRE perfil 'consultor' (nunca vem do corpo da
//    requisição) e só vê o que o consultor_ref dela libera.
import { randomBytes } from 'crypto';
import { requireAuth, getUsuarioDashboard } from './_lib/auth.js';
import { getEscopoTravado, linhaDentroDoEscopo, normalizarNomeEquipe, EQUIPES_GESTORES } from './_lib/escopo.js';

const SUPA_URL = 'https://kzlchetrpsfefwybaaoy.supabase.co';
// Origem fixa de propósito: o /api/sheets é consultado com o token de quem
// chamou, e a resposta decide quem é "candidato". Não pode vir de header da
// requisição (Host/X-Forwarded-Host), senão dava pra apontar pra outro servidor.
const ORIGEM_DASH = 'https://vst-dashboard.vercel.app';

// Admin e gestores. Supervisão NÃO gerencia acesso (decisão do negócio) — e
// isso vale mesmo que alguém receba 'acessos' em acesso_extra_abas: a aba pode
// até aparecer, mas o servidor recusa.
const PERFIS_QUE_GERENCIAM = new Set([
  'admin', 'admin_beta',
  'gestor_macro', 'gestor_macro2', 'gestor_macro3', 'gestor', 'gestor_beta',
]);
const PERFIS_ADMIN = new Set(['admin', 'admin_beta']);

class ErroHttp extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

function senhaTemporaria() {
  return randomBytes(12).toString('base64url').slice(0, 14);
}

function chaveServico() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new ErroHttp(500, 'SUPABASE_SERVICE_ROLE_KEY não configurado no servidor');
  return k;
}

async function supa(path, { method = 'GET', body, prefer } = {}) {
  const k = chaveServico();
  const res = await fetch(`${SUPA_URL}${path}`, {
    method,
    headers: {
      apikey: k,
      Authorization: `Bearer ${k}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { ok: res.ok, status: res.status, json };
}

// Consultores (nome do dono do pedido) que existem na visão de quem chamou.
async function candidatosDoEscopo(req) {
  const res = await fetch(`${ORIGEM_DASH}/api/sheets?action=values&sheet=BaseCRM`, {
    headers: { Authorization: req.headers.authorization },
  });
  if (!res.ok) throw new ErroHttp(502, 'Não consegui ler a base do CRM agora');
  const valores = (await res.json()).values || [];
  if (valores.length < 2) return [];

  const header = valores[0];
  const iCons = header.indexOf('PROPRIETÁRIO DO PEDIDO');
  const iEq = header.indexOf('EQUIPE');
  if (iCons === -1 || iEq === -1) throw new ErroHttp(502, 'Base do CRM sem as colunas esperadas');

  const mapa = new Map();
  for (const row of valores.slice(1)) {
    const nome = (row[iCons] || '').toString().trim();
    if (!nome) continue;
    const chave = nome.toUpperCase();
    const eq = normalizarNomeEquipe(row[iEq]);
    let c = mapa.get(chave);
    if (!c) { c = { nome, upper: chave, equipes: new Map(), linhas: 0 }; mapa.set(chave, c); }
    c.linhas++;
    if (eq) c.equipes.set(eq, (c.equipes.get(eq) || 0) + 1);
  }
  return [...mapa.values()].map(c => {
    const equipe = [...c.equipes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return { nome: c.nome, upper: c.upper, equipe, gestor: equipe ? (EQUIPES_GESTORES[equipe] || null) : null, linhas: c.linhas };
  });
}

// Quem está chamando + o que ele pode gerenciar. Lança ErroHttp se não pode.
async function contextoDoChamador(req, res) {
  const authUser = await requireAuth(req, res);
  if (!authUser) return null;
  const perfilRow = await getUsuarioDashboard(req, authUser.id);
  const perfil = perfilRow?.perfil;
  if (!perfilRow || perfilRow.ativo === false) throw new ErroHttp(403, 'Acesso desativado');
  if (!PERFIS_QUE_GERENCIAM.has(perfil)) throw new ErroHttp(403, 'Seu perfil não gerencia acessos');
  const escopo = getEscopoTravado(perfil, perfilRow);
  // ehAdmin: pode desfazer bloqueio feito por admin. veTudo: enxerga (e pode
  // gerenciar) consultores de toda a empresa. Admin é os dois; gestor_macro2
  // SEM gestores_ref (hoje Laura e Maria, que já enxergam a base inteira) é só
  // veTudo — nunca ganha o poder de admin sobre bloqueios. Se alguém preencher
  // o gestores_ref delas, o escopo volta a valer e a visão encolhe junto.
  const ehAdmin = PERFIS_ADMIN.has(perfil);
  const veTudo = ehAdmin || (perfil === 'gestor_macro2' && !escopo);
  if (!veTudo && !escopo) throw new ErroHttp(403, 'Seu perfil não tem uma equipe/gestor definido — peça ao admin');
  return { authUser, perfilRow, perfil, escopo, veTudo, ehAdmin };
}

// A conta de consultor está "abaixo" de quem chamou?
function contaVisivel(ctx, conta, candidatosUpper) {
  if (ctx.veTudo) return true;
  if (conta.equipe_ref && linhaDentroDoEscopo(conta.equipe_ref, conta.consultor_ref, ctx.escopo)) return true;
  if (conta.gestor_ref && ctx.escopo.gestores?.has(conta.gestor_ref)) return true;
  return candidatosUpper.has((conta.consultor_ref || '').toUpperCase());
}

async function contasDeConsultor() {
  const r = await supa('/rest/v1/usuarios_dashboard?perfil=eq.consultor&select=id,email,nome,consultor_ref,equipe_ref,gestor_ref,ativo,criado_em&order=nome');
  if (!r.ok) throw new ErroHttp(502, 'Falha ao ler as contas');
  return r.json;
}

// Último login e dados do bloqueio de cada login do Auth. O "quem bloqueou"
// fica em app_metadata.bloqueio (só a chave de serviço escreve ali — o próprio
// usuário e o navegador não conseguem alterar).
async function infoAuthDeTodos() {
  const r = await supa('/auth/v1/admin/users?page=1&per_page=1000');
  const mapa = new Map();
  (r.json?.users || []).forEach(u => mapa.set(u.id, {
    ultimo_acesso: u.last_sign_in_at || null,
    bloqueio: u.app_metadata?.bloqueio || null,
    criado_por: u.app_metadata?.criado_por || null,
  }));
  return mapa;
}

// Nível do bloqueio de uma conta: null se não está bloqueada; 'admin' ou
// 'gestor'. Conta desativada SEM registro de quem bloqueou (ex.: bloqueada
// fora desta tela) conta como bloqueio de admin — falha protegida: só admin
// reativa.
function nivelDoBloqueio(ativo, bloqueio) {
  if (ativo !== false) return null;
  return bloqueio?.nivel === 'gestor' ? 'gestor' : 'admin';
}

// Pode reativar? Bloqueio feito por admin só admin desfaz.
function podeReativar(ctx, nivel) {
  return nivel !== 'admin' || ctx.ehAdmin;
}

function auditar(ctx, acao, alvo) {
  console.log(JSON.stringify({ evento: 'acessos', acao, por: ctx.authUser.email, perfil: ctx.perfil, alvo }));
}

async function carregarAlvo(ctx, req, id) {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new ErroHttp(400, 'id inválido');
  const r = await supa(`/rest/v1/usuarios_dashboard?id=eq.${id}&select=id,email,nome,perfil,consultor_ref,equipe_ref,gestor_ref,ativo`);
  const alvo = r.json?.[0];
  if (!alvo) throw new ErroHttp(404, 'Conta não encontrada');
  // Só gerencia conta de CONSULTOR — nunca de outro gestor/admin.
  if (alvo.perfil !== 'consultor') throw new ErroHttp(403, 'Só dá pra gerenciar acesso de consultor');
  let cands = new Set();
  if (!ctx.veTudo) cands = new Set((await candidatosDoEscopo(req)).map(c => c.upper));
  if (!contaVisivel(ctx, alvo, cands)) throw new ErroHttp(403, 'Esse consultor está fora da sua visão');
  const au = await supa(`/auth/v1/admin/users/${id}`);
  alvo.bloqueio = au.json?.app_metadata?.bloqueio || null;
  alvo.nivel_bloqueio = nivelDoBloqueio(alvo.ativo, alvo.bloqueio);
  return alvo;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const ctx = await contextoDoChamador(req, res);
    if (!ctx) return; // requireAuth já respondeu 401
    const action = req.query.action;

    // ── GET candidatos: consultores da minha visão que ainda não têm conta ──
    if (req.method === 'GET' && action === 'candidatos') {
      const [cands, contas] = await Promise.all([candidatosDoEscopo(req), contasDeConsultor()]);
      const comConta = new Set(contas.map(c => (c.consultor_ref || '').toUpperCase()));
      const livres = cands.filter(c => !comConta.has(c.upper))
        .map(({ nome, equipe, gestor, linhas }) => ({ nome, equipe, gestor, linhas }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      return res.status(200).json({ candidatos: livres });
    }

    // ── GET listar: contas de consultor abaixo de mim ──
    if (req.method === 'GET' && action === 'listar') {
      const contas = await contasDeConsultor();
      const cands = ctx.veTudo ? new Set() : new Set((await candidatosDoEscopo(req)).map(c => c.upper));
      const infoAuth = await infoAuthDeTodos();
      const lista = contas.filter(c => contaVisivel(ctx, c, cands)).map(c => {
        const info = infoAuth.get(c.id) || {};
        const nivel = nivelDoBloqueio(c.ativo, info.bloqueio);
        return {
          id: c.id, nome: c.nome, email: c.email, consultor_ref: c.consultor_ref,
          equipe: c.equipe_ref, ativo: c.ativo !== false, ultimo_acesso: info.ultimo_acesso || null,
          criado_por: info.criado_por ? (info.criado_por.nome || info.criado_por.email || null) : null, // null = conta anterior ao registro
          criado_por_email: info.criado_por?.email || null,
          criado_em: info.criado_por?.em || c.criado_em || null,
          bloqueado_por: nivel, // null | 'admin' | 'gestor'
          pode_reativar: nivel ? podeReativar(ctx, nivel) : false,
          pode_excluir: ctx.perfil === 'admin', // só 'admin' exclui o login (admin_beta não)
        };
      });
      return res.status(200).json({ contas: lista });
    }

    if (req.method !== 'POST') return res.status(400).json({ error: 'Ação inválida' });
    const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    // ── POST criar ──
    if (action === 'criar') {
      const email = (corpo.email || '').toString().trim().toLowerCase();
      const nome = (corpo.nome || '').toString().trim().replace(/\s+/g, ' ');
      const consultorRef = (corpo.consultor_ref || '').toString().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw new ErroHttp(400, 'E-mail inválido');
      if (nome.length < 2 || nome.length > 80) throw new ErroHttp(400, 'Informe o nome (2 a 80 caracteres)');
      if (!consultorRef) throw new ErroHttp(400, 'Escolha o consultor');

      const cands = await candidatosDoEscopo(req);
      const cand = cands.find(c => c.upper === consultorRef.toUpperCase());
      if (!cand) throw new ErroHttp(403, 'Esse consultor não está na sua visão');

      const contas = await contasDeConsultor();
      if (contas.some(c => (c.consultor_ref || '').toUpperCase() === cand.upper)) throw new ErroHttp(409, 'Esse consultor já tem acesso');
      if (contas.some(c => (c.email || '').toLowerCase() === email)) throw new ErroHttp(409, 'Já existe uma conta com esse e-mail');

      const senha = senhaTemporaria();
      const criado = await supa('/auth/v1/admin/users', { method: 'POST', body: {
        email, password: senha, email_confirm: true,
        // Quem criou o acesso: só a chave de serviço escreve em app_metadata.
        app_metadata: { criado_por: { nome: ctx.perfilRow?.nome || ctx.authUser.email, email: ctx.authUser.email, em: new Date().toISOString() } },
      } });
      if (!criado.ok) {
        const msg = (criado.json?.msg || criado.json?.message || '').toString();
        if (/already|registered|exists/i.test(msg)) throw new ErroHttp(409, 'Já existe uma conta com esse e-mail');
        throw new ErroHttp(502, 'Não consegui criar o login');
      }
      const uid = criado.json.id;
      const ins = await supa('/rest/v1/usuarios_dashboard', {
        method: 'POST', prefer: 'return=minimal',
        body: { id: uid, email, nome, perfil: 'consultor', consultor_ref: cand.nome, equipe_ref: cand.equipe, gestor_ref: cand.gestor, ativo: true },
      });
      if (!ins.ok) {
        await supa(`/auth/v1/admin/users/${uid}`, { method: 'DELETE' }); // desfaz o login órfão
        throw new ErroHttp(502, 'Não consegui salvar o perfil — nada foi criado');
      }
      auditar(ctx, 'criar', { email, consultor_ref: cand.nome });
      return res.status(200).json({ ok: true, conta: { id: uid, email, nome, consultor_ref: cand.nome, equipe: cand.equipe }, senha_temporaria: senha });
    }

    // ── POST excluir: remove o login de vez (só perfil 'admin' — admin_beta não) ──
    if (action === 'excluir') {
      if (ctx.perfil !== 'admin') throw new ErroHttp(403, 'Só um administrador pode excluir um login');
      const alvo = await carregarAlvo(ctx, req, corpo.id); // só conta de consultor
      // Ordem importa: primeiro o login. Se falhar, nada mudou. Apagar o perfil
      // antes deixaria um login vivo sem perfil (o app trata como "sem trava").
      const del = await supa(`/auth/v1/admin/users/${alvo.id}`, { method: 'DELETE' });
      if (!del.ok) throw new ErroHttp(502, 'Não consegui excluir o login — nada foi alterado');
      const delPerfil = await supa(`/rest/v1/usuarios_dashboard?id=eq.${alvo.id}`, { method: 'DELETE', prefer: 'return=minimal' });
      auditar(ctx, 'excluir', { email: alvo.email, consultor_ref: alvo.consultor_ref });
      if (!delPerfil.ok) return res.status(200).json({ ok: true, aviso: 'Login excluído, mas o registro de perfil não saiu — avise o suporte técnico' });
      return res.status(200).json({ ok: true });
    }

    // ── POST bloquear / reativar / redefinir_senha ──
    if (action === 'bloquear' || action === 'reativar' || action === 'redefinir_senha') {
      const alvo = await carregarAlvo(ctx, req, corpo.id);

      if (action === 'redefinir_senha') {
        const senha = senhaTemporaria();
        const r = await supa(`/auth/v1/admin/users/${alvo.id}`, { method: 'PUT', body: { password: senha } });
        if (!r.ok) throw new ErroHttp(502, 'Não consegui redefinir a senha');
        auditar(ctx, 'redefinir_senha', { email: alvo.email });
        return res.status(200).json({ ok: true, senha_temporaria: senha });
      }

      const bloquear = action === 'bloquear';

      if (!bloquear && !podeReativar(ctx, alvo.nivel_bloqueio)) {
        throw new ErroHttp(403, 'Esse acesso foi bloqueado por um administrador — só um admin pode reativar');
      }
      // Quem não é admin não pode "rebaixar" um bloqueio de admin re-bloqueando
      // por cima (isso trocaria o nível e liberaria a reativação por gestor).
      if (bloquear && alvo.nivel_bloqueio === 'admin' && !ctx.ehAdmin) {
        throw new ErroHttp(403, 'Esse acesso já está bloqueado por um administrador');
      }

      const corpoAuth = bloquear
        ? { ban_duration: '876000h', app_metadata: { bloqueio: { nivel: ctx.ehAdmin ? 'admin' : 'gestor', por: ctx.authUser.email, em: new Date().toISOString() } } }
        : { ban_duration: 'none', app_metadata: { bloqueio: null } };
      const r = await supa(`/auth/v1/admin/users/${alvo.id}`, { method: 'PUT', body: corpoAuth });
      if (!r.ok) throw new ErroHttp(502, 'Não consegui alterar o bloqueio');
      const up = await supa(`/rest/v1/usuarios_dashboard?id=eq.${alvo.id}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { ativo: !bloquear, atualizado_em: new Date().toISOString() },
      });
      if (!up.ok) throw new ErroHttp(502, 'Bloqueio aplicado no login, mas falhou ao registrar — avise o admin');
      auditar(ctx, action, { email: alvo.email });
      return res.status(200).json({ ok: true, ativo: !bloquear });
    }

    return res.status(400).json({ error: 'Ação inválida' });
  } catch (e) {
    const status = e instanceof ErroHttp ? e.status : 500;
    if (status === 500) console.error('acessos:', e);
    return res.status(status).json({ error: status === 500 ? 'Erro interno' : e.message });
  }
}
