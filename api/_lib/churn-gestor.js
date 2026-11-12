// Aviso de PORT-OUT (churn) pra gestor e supervisão, que NÃO têm a aba Churn.
//
// Atendido por /api/acessos?recurso=churn (o projeto está no limite de funções da Vercel, então
// não ganha arquivo próprio em /api).
//
//  GET                  -> alertas que caem na visão de quem pede (+ quais já foram tratados)
//  POST ?action=tratar  -> { id, resposta }: marca o alerta como tratado
//
// Tudo roda com a chave de serviço do Supabase, então a autorização é daqui:
//  - só perfis de gestor/supervisão COM escopo definido; sem escopo, nada (falha fechada — ao
//    contrário de outras telas, aqui "sem trava" não pode virar "todos os churns da empresa");
//  - o dono do cliente vem da aba 'baseneo' (pedido ATIVO mais recente, senão o mais recente);
//  - o alerta só entra na visão se a EQUIPE desse dono estiver no escopo (mesma regra do resto do app);
//  - tratar um alerta fora da visão é recusado no servidor.
import { requireAuth, getUsuarioDashboard } from './auth.js';
import { getEscopoTravado, linhaDentroDoEscopo, normalizarNomeEquipe } from './escopo.js';
import { lerColunas } from './gsheets.js';

const SUPA_URL = 'https://kzlchetrpsfefwybaaoy.supabase.co';
const PERFIS_AVISO = new Set([
  'gestor_macro', 'gestor_macro2', 'gestor_macro3', 'gestor', 'gestor_beta', 'supervisao', 'supervisao_beta',
]);
const DIA = 24 * 3600 * 1000;
const CAMPOS = 'id,nome_cliente,cnpj,qtd_linhas,receptora,municipio_cliente,uf_cliente,data_janela,recebido_em,'
  + 'multa_estimada,oferta_retencao_mkt,oferta_pos,promocao_atual,'
  + 'tratado_gestor,tratado_gestor_nome,tratado_gestor_em,resposta_gestor';

class ErroHttp extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function supa(path, { method = 'GET', body, prefer } = {}) {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new ErroHttp(500, 'SUPABASE_SERVICE_ROLE_KEY não configurado no servidor');
  const res = await fetch(`${SUPA_URL}${path}`, {
    method,
    headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { ok: res.ok, status: res.status, json };
}

// ── baseneo: CNPJ -> dono do cliente ─────────────────────────────────────────
// Mesma regra do Churn no dash: vale o pedido ATIVO ou CONECTADO mais recente (data ÚLTIMA); pedido novo de outro
// consultor que não ativou não tira o cliente de quem já ativou. Sem nenhum ativo, o mais recente.
const ETAPAS_ATIVAS = new Set(['ATIVO', 'CONECTADO']);
let _base = null; // { mapa, em }
const TTL_BASE = 10 * 60 * 1000;

function tsData(s) {
  const m = (s || '').toString().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : 0;
}

async function baseNeo() {
  if (_base && Date.now() - _base.em < TTL_BASE) return _base.mapa;
  const id = process.env.GOOGLE_SHEETS_CARTEIRA_ID;
  if (!id) throw new ErroHttp(500, 'Planilha da Carteira não configurada no servidor');
  const c = await lerColunas(id, 'baseneo', ['CPF-CNPJ', 'ETAPA', 'ULTIMA', 'USUARIO', 'EQUIPE']);
  const mapa = new Map();
  const n = c['CPF-CNPJ'].length;
  for (let i = 0; i < n; i++) {
    const cnpj = (c['CPF-CNPJ'][i] || '').replace(/\D/g, '');
    const consultor = (c['USUARIO'][i] || '').trim();
    const equipe = (c['EQUIPE'][i] || '').trim();
    if (!cnpj || (!consultor && !equipe)) continue;
    const etapa = (c['ETAPA'][i] || '').trim().toUpperCase();
    const reg = { consultor, equipe, ts: tsData(c['ULTIMA'][i]) };
    const ativo = ETAPAS_ATIVAS.has(etapa);
    let e = mapa.get(cnpj);
    if (!e) { e = { ativo: null, qualquer: null, pedidos: [] }; mapa.set(cnpj, e); }
    e.pedidos.push({ consultor, equipe, etapa, ts: reg.ts });
    if (ativo && (!e.ativo || reg.ts >= e.ativo.ts)) e.ativo = reg;
    if (!e.qualquer || reg.ts >= e.qualquer.ts) e.qualquer = reg;
  }
  _base = { mapa, em: Date.now() };
  return mapa;
}

function donoDoCliente(mapa, cnpj) {
  const e = mapa.get((cnpj || '').replace(/\D/g, ''));
  return e ? (e.ativo || e.qualquer) : null;
}

function alertaNaVisao(alerta, mapa, escopo) {
  const dono = donoDoCliente(mapa, alerta.cnpj);
  if (!dono || !dono.equipe) return null;
  const equipe = normalizarNomeEquipe(dono.equipe).toUpperCase();
  return linhaDentroDoEscopo(equipe, dono.consultor, escopo) ? dono : null;
}

async function contexto(req, res) {
  const authUser = await requireAuth(req, res);
  if (!authUser) return null;
  const perfilRow = await getUsuarioDashboard(req, authUser.id);
  if (!perfilRow || perfilRow.ativo === false) throw new ErroHttp(403, 'Acesso desativado');
  if (!PERFIS_AVISO.has(perfilRow.perfil)) throw new ErroHttp(403, 'Seu perfil não recebe esse aviso');
  const escopo = getEscopoTravado(perfilRow.perfil, perfilRow);
  return { authUser, perfilRow, escopo };
}

// ── GET ?action=donos: consultor/equipe dos clientes da aba Churn ────────────
// Quem tem a aba Churn mas NÃO lê as planilhas (ex.: perfil 'suporte' com acesso_extra_abas 'churn')
// não consegue montar consultor/equipe no navegador: a aba 'baseneo' fica na planilha da Carteira,
// fechada pra esse perfil. Este endpoint devolve SÓ o histórico de pedidos (consultor, equipe, etapa,
// data) dos CNPJs que existem em churn_alertas — nada além do que a tela de Churn precisa mostrar.
const PERFIS_CHURN_COMPLETO = new Set(['admin', 'admin_gestao', 'admin_beta']);

async function donosHandler(req, res) {
  try {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const perfilRow = await getUsuarioDashboard(req, authUser.id);
    if (!perfilRow || perfilRow.ativo === false) throw new ErroHttp(403, 'Acesso desativado');
    const extras = perfilRow.acesso_extra_abas || [];
    if (!PERFIS_CHURN_COMPLETO.has(perfilRow.perfil) && !extras.includes('churn')) throw new ErroHttp(403, 'Sem acesso à aba Churn');

    const [mapa, r] = await Promise.all([baseNeo(), supa('/rest/v1/churn_alertas?select=cnpj&limit=10000')]);
    if (!r.ok) throw new ErroHttp(502, 'Falha ao ler os alertas de churn');
    const historico = {};
    for (const a of r.json || []) {
      const cnpj = (a.cnpj || '').replace(/\D/g, '');
      if (!cnpj || historico[cnpj]) continue;
      const e = mapa.get(cnpj);
      if (e) historico[cnpj] = e.pedidos;
    }
    return res.status(200).json({ historico });
  } catch (e) {
    if (e instanceof ErroHttp) return res.status(e.status).json({ error: e.message });
    console.error('churn-donos:', e);
    return res.status(500).json({ error: 'Erro interno' });
  }
}

export default async function churnGestorHandler(req, res) {
  if (req.method === 'GET' && req.query.action === 'donos') return donosHandler(req, res);
  try {
    const ctx = await contexto(req, res);
    if (!ctx) return; // 401 já respondido
    const { authUser, perfilRow, escopo } = ctx;

    // Sem equipe/gestor definido no perfil não há "visão dele": nada a mostrar.
    if (!escopo) return res.status(200).json({ alertas: [], semEscopo: true });

    // ── GET: alertas da minha visão ──
    if (req.method === 'GET') {
      const desde = new Date(Date.now() - 60 * DIA).toISOString();
      const [mapa, r] = await Promise.all([
        baseNeo(),
        supa(`/rest/v1/churn_alertas?select=${CAMPOS}&recebido_em=gte.${desde}&order=recebido_em.desc&limit=3000`),
      ]);
      if (!r.ok) throw new ErroHttp(502, 'Falha ao ler os alertas de churn');

      // Só o que ainda importa: janela de portabilidade de ontem em diante (ou, sem data de janela,
      // recebido na última semana). Evita despejar o histórico inteiro de alertas no primeiro acesso.
      const agoraBRT = new Date(Date.now() - 3 * 3600 * 1000);
      const hoje = Date.UTC(agoraBRT.getUTCFullYear(), agoraBRT.getUTCMonth(), agoraBRT.getUTCDate());
      const alertas = [];
      for (const a of r.json || []) {
        const jan = tsData(a.data_janela);
        const recente = jan ? jan >= hoje - DIA : Date.now() - new Date(a.recebido_em).getTime() <= 7 * DIA;
        if (!recente) continue;
        const dono = alertaNaVisao(a, mapa, escopo);
        if (!dono) continue;
        alertas.push({ ...a, consultor: dono.consultor, equipe: dono.equipe, janela_ts: jan });
      }
      // Pendentes primeiro (janela mais próxima no topo); tratados depois.
      alertas.sort((x, y) => (x.tratado_gestor === y.tratado_gestor)
        ? ((x.janela_ts || Infinity) - (y.janela_ts || Infinity))
        : (x.tratado_gestor ? 1 : -1));
      return res.status(200).json({ alertas });
    }

    // ── POST tratar ──
    if (req.method === 'POST' && req.query.action === 'tratar') {
      const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const id = parseInt(corpo.id, 10);
      const resposta = (corpo.resposta || '').toString().trim();
      if (!Number.isInteger(id)) throw new ErroHttp(400, 'Alerta inválido');
      if (resposta.length < 3 || resposta.length > 1500) throw new ErroHttp(400, 'Escreva a tratativa (3 a 1500 caracteres)');

      const [mapa, r] = await Promise.all([baseNeo(), supa(`/rest/v1/churn_alertas?id=eq.${id}&select=${CAMPOS}`)]);
      const alerta = r.ok ? r.json?.[0] : null;
      // Mesma resposta pra "não existe" e "não é da sua visão": não revela alerta de outra equipe.
      if (!alerta || !alertaNaVisao(alerta, mapa, escopo)) throw new ErroHttp(404, 'Alerta não encontrado na sua visão');
      if (alerta.tratado_gestor) throw new ErroHttp(409, `Já tratado por ${alerta.tratado_gestor_nome || 'outro gestor'}`);

      const nome = perfilRow.nome || (authUser.email || '').split('@')[0] || 'gestor';
      const up = await supa(`/rest/v1/churn_alertas?id=eq.${id}&tratado_gestor=eq.false`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: {
          tratado_gestor: true,
          tratado_gestor_por: authUser.id,
          tratado_gestor_nome: nome,
          tratado_gestor_em: new Date().toISOString(),
          resposta_gestor: resposta,
        },
      });
      if (!up.ok) throw new ErroHttp(502, 'Não consegui gravar a tratativa');
      if (!up.json?.length) throw new ErroHttp(409, 'Esse alerta acabou de ser tratado por outra pessoa');
      const dono = alertaNaVisao(alerta, mapa, escopo);
      return res.status(200).json({ alerta: { ...pick(up.json[0]), consultor: dono.consultor, equipe: dono.equipe } });
    }

    return res.status(400).json({ error: 'Ação inválida' });
  } catch (e) {
    if (e instanceof ErroHttp) return res.status(e.status).json({ error: e.message });
    console.error('churn-gestor:', e);
    return res.status(500).json({ error: 'Erro interno' });
  }
}

function pick(a) {
  const out = {};
  CAMPOS.split(',').forEach(k => { out[k] = a[k]; });
  out.janela_ts = tsData(a.data_janela);
  return out;
}
