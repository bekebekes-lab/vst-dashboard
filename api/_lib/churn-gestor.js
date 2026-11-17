// Tratativa de PORT-OUT (churn) como conversa, por gestor/supervisão e pelo responsável (aba Churn completa).
//
// Atendido por /api/acessos?recurso=churn (o projeto está no limite de funções da Vercel, então
// não ganha arquivo próprio em /api).
//
//  GET                     -> (gestor/supervisão) alertas atribuídos a quem pede + a conversa de cada um
//  POST ?action=tratar     -> { id, motivo, status, resposta }: o gestor responde. Motivo + Status obrigatórios
//                             (Motivo dispensado só com Status SEM CONTATO). Vale também na réplica de uma devolução
//  GET  ?action=painel     -> (responsável) pra cada alerta: quem recebe (automático por equipe ou manual) e o estado
//                             de cada um (pendente / tratado / devolvido), + a lista de pessoas que podem receber
//  POST ?action=devolver   -> { id, destinatario_id, texto }: o responsável devolve a UM gestor com uma pergunta;
//                             a pendência volta só pra ele
//  POST ?action=atribuir   -> { id, usuarios: [uuid...] }: o responsável escolhe quem recebe (vale no lugar da regra
//                             automática; lista vazia = volta ao automático). Serve pra atribuir e pra mover
//  POST ?action=editar     -> { tratativa_id, texto }: o responsável corrige a PRÓPRIA mensagem (lápis).
//                             O texto de um gestor nunca muda
//
// A CONVERSA É UMA SÓ por alerta (churn_tratativas): todos os envolvidos veem o mesmo histórico, sem cópias.
// Só a PENDÊNCIA é individual: o estado de cada gestor sai das mensagens dele (a última dele = tratado; a última
// devolução a ele = devolvido; nenhuma = pendente). Um gestor responder não fecha a pendência do outro.
//
// Tudo roda com a chave de serviço do Supabase, então a autorização é daqui:
//  - gestor/supervisão só vê alerta atribuído a ele: por atribuição manual, ou (sem atribuição manual) porque a EQUIPE
//    do dono do cliente (aba 'baseneo') está no escopo do perfil. Sem escopo e sem atribuição: nada (falha fechada);
//  - tratar um alerta que não é seu é recusado no servidor;
//  - devolver, atribuir e editar: só quem tem a aba Churn completa.
import { requireAuth, getUsuarioDashboard } from './auth.js';
import { getEscopoTravado, linhaDentroDoEscopo, normalizarNomeEquipe } from './escopo.js';
import { lerColunas } from './gsheets.js';

const SUPA_URL = 'https://kzlchetrpsfefwybaaoy.supabase.co';
// Quem pode receber churn (nunca consultor).
const PERFIS_AVISO = new Set([
  'gestor_macro', 'gestor_macro2', 'gestor_macro3', 'gestor', 'gestor_beta', 'supervisao', 'supervisao_beta',
]);
const DIA = 24 * 3600 * 1000;
const EPOCH = '1970-01-01T00:00:00.000Z';
const CAMPOS = 'id,nome_cliente,cnpj,qtd_linhas,receptora,municipio_cliente,uf_cliente,data_janela,recebido_em,'
  + 'multa_estimada,oferta_retencao_mkt,oferta_pos,promocao_atual,'
  + 'tratado_gestor,tratado_gestor_nome,tratado_gestor_em,resposta_gestor';
const CAMPOS_MSG = 'id,alerta_id,tipo,autor_id,autor_nome,destinatario_id,destinatario_nome,motivo,status,texto,criado_em,editado_em';

// Listas da tabulação (as mesmas da planilha de tratativa). SEM CONTATO não exige Motivo.
const MOTIVOS = ['OFERTA', 'COBERTURA', 'ATENDIMENTO'];
const STATUS_TRAT = ['SEM CONTATO', 'RETORNAR', 'AGUARDANDO CONSULTOR', 'REVERTIDO', 'PORTADO'];
const STATUS_SEM_MOTIVO = 'SEM CONTATO';

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

// O PostgREST do Supabase devolve no máximo 1000 linhas por chamada, mesmo com limit maior: lê em páginas.
async function supaTudo(path) {
  const sep = path.includes('?') ? '&' : '?';
  const out = [];
  for (let off = 0; off < 100000; off += 1000) {
    const r = await supa(`${path}${sep}limit=1000&offset=${off}`);
    if (!r.ok) return { ok: false, status: r.status, json: null };
    const lote = Array.isArray(r.json) ? r.json : [];
    out.push(...lote);
    if (lote.length < 1000) break;
  }
  return { ok: true, status: 200, json: out };
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

// Equipe do dono dentro do escopo deste usuário? (regra AUTOMÁTICA de quem recebe)
function alertaNaVisao(alerta, mapa, escopo) {
  const dono = donoDoCliente(mapa, alerta.cnpj);
  if (!dono || !dono.equipe || !escopo) return null;
  const equipe = normalizarNomeEquipe(dono.equipe).toUpperCase();
  return linhaDentroDoEscopo(equipe, dono.consultor, escopo) ? dono : null;
}

// ── Quem pode receber / quem recebe cada alerta ──────────────────────────────
async function usuariosDestino() {
  const lista = [...PERFIS_AVISO].join(',');
  const r = await supa(`/rest/v1/usuarios_dashboard?select=id,nome,perfil,gestor_ref,gestores_ref,equipes_ref,consultor_ref&ativo=eq.true&perfil=in.(${lista})&order=nome`);
  if (!r.ok) throw new ErroHttp(502, 'Falha ao ler os usuários');
  return (r.json || []).map(u => ({
    id: u.id, nome: u.nome || '—', perfil: u.perfil,
    escopo: getEscopoTravado(u.perfil, u), // null = sem escopo definido: não recebe pela regra automática (falha fechada)
    visao: (u.equipes_ref || []).length ? u.equipes_ref.join(', ')
      : ((u.gestores_ref || []).length ? u.gestores_ref : (u.gestor_ref ? [u.gestor_ref] : [])).join(', '),
  }));
}

async function atribuicoes(alertaIds) {
  const filtro = alertaIds ? `&alerta_id=in.(${alertaIds.join(',')})` : '';
  const r = await supaTudo(`/rest/v1/churn_atribuicoes?select=alerta_id,usuario_id,atribuido_por_nome,atribuido_em,a_partir_de${filtro}`);
  if (!r.ok) throw new ErroHttp(502, 'Falha ao ler as atribuições');
  const mapa = new Map();
  for (const x of r.json || []) { if (!mapa.has(x.alerta_id)) mapa.set(x.alerta_id, []); mapa.get(x.alerta_id).push(x); }
  return mapa;
}

async function conversas(alertaIds) {
  const mapa = new Map();
  if (!alertaIds.length) return mapa;
  const r = await supaTudo(`/rest/v1/churn_tratativas?alerta_id=in.(${alertaIds.join(',')})&select=${CAMPOS_MSG}&order=criado_em.asc,id.asc`);
  if (!r.ok) throw new ErroHttp(502, 'Falha ao ler a conversa');
  for (const m of r.json || []) { if (!mapa.has(m.alerta_id)) mapa.set(m.alerta_id, []); mapa.get(m.alerta_id).push(m); }
  return mapa;
}

// Quem recebe o alerta: atribuição manual (se houver) senão a regra automática por equipe do dono.
function destinatariosDe(alerta, mapa, usuarios, manual) {
  if (manual && manual.length) {
    const ids = new Set(manual.map(x => x.usuario_id));
    return { origem: 'manual', usuarios: usuarios.filter(u => ids.has(u.id)) };
  }
  const auto = usuarios.filter(u => alertaNaVisao(alerta, mapa, u.escopo));
  return { origem: auto.length ? 'auto' : 'nenhum', usuarios: auto };
}

// Estado de UM gestor num alerta, a partir da conversa (que é única). Conta só o que é dele e do que veio
// depois de `aPartirDe` (quem entra por atribuição nova começa pendente, mesmo que já tenha falado antes).
// Alerta tratado antes da tabulação (flag antiga, sem conversa) conta como tratado.
function estadoDe(alerta, msgs, userId, aPartirDe) {
  const corte = aPartirDe ? new Date(aPartirDe).getTime() : 0;
  const dele = (msgs || []).filter(m => new Date(m.criado_em).getTime() >= corte
    && ((m.tipo === 'gestor' && m.autor_id === userId) || (m.tipo === 'devolucao' && m.destinatario_id === userId)));
  const ult = dele[dele.length - 1];
  if (!ult) {
    return (alerta.tratado_gestor && !(msgs || []).length) ? { estado: 'tratado', legado: true } : { estado: 'pendente' };
  }
  const ultGestor = [...dele].reverse().find(m => m.tipo === 'gestor') || null;
  return { estado: ult.tipo === 'devolucao' ? 'devolvido' : 'tratado', ult, ultGestor };
}

// ── Responsável (aba Churn completa) ─────────────────────────────────────────
const PERFIS_CHURN_COMPLETO = new Set(['admin', 'admin_gestao', 'admin_beta']);
const temChurnCompleto = (perfilRow) => PERFIS_CHURN_COMPLETO.has(perfilRow.perfil) || (perfilRow.acesso_extra_abas || []).includes('churn');

async function responsavelCtx(req, res) {
  const authUser = await requireAuth(req, res);
  if (!authUser) return null;
  const perfilRow = await getUsuarioDashboard(req, authUser.id);
  if (!perfilRow || perfilRow.ativo === false) throw new ErroHttp(403, 'Acesso desativado');
  if (!temChurnCompleto(perfilRow)) throw new ErroHttp(403, 'Só quem tem a aba Churn completa pode fazer isso');
  const nome = perfilRow.nome || (authUser.email || '').split('@')[0] || 'responsável';
  return { authUser, perfilRow, nome };
}

// ── GET ?action=painel: quem recebe e em que estado está cada alerta (visão do responsável) ──
async function painelHandler(req, res) {
  const ctx = await responsavelCtx(req, res);
  if (!ctx) return;
  const r = await supaTudo('/rest/v1/churn_alertas?select=id,cnpj,tratado_gestor&order=recebido_em.desc,id.desc');
  if (!r.ok) throw new ErroHttp(502, 'Falha ao ler os alertas de churn');
  const alertas = r.json || [];
  const ids = alertas.map(a => a.id);
  const [mapa, usuarios, manualMap, msgsMap] = await Promise.all([baseNeo(), usuariosDestino(), atribuicoes(), conversas(ids)]);
  const out = {};
  for (const a of alertas) {
    const manual = manualMap.get(a.id);
    const msgs = msgsMap.get(a.id) || [];
    const dest = destinatariosDe(a, mapa, usuarios, manual);
    out[a.id] = {
      o: dest.origem,
      d: dest.usuarios.map(u => {
        const e = estadoDe(a, msgs, u.id, manual?.find(x => x.usuario_id === u.id)?.a_partir_de);
        return { u: u.id, e: e.estado, s: e.ultGestor?.status || null, m: e.ultGestor?.motivo || null, l: e.legado ? 1 : 0 };
      }),
    };
  }
  return res.status(200).json({
    usuarios: usuarios.map(u => ({ id: u.id, nome: u.nome, perfil: u.perfil, visao: u.visao })),
    alertas: out,
  });
}

// ── POST devolver / atribuir / editar: só o responsável ──────────────────────
async function responsavelHandler(req, res, action) {
  const ctx = await responsavelCtx(req, res);
  if (!ctx) return;
  const { authUser, nome } = ctx;
  const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  if (action === 'atribuir') {
    const id = parseInt(corpo.id, 10);
    if (!Number.isInteger(id)) throw new ErroHttp(400, 'Alerta inválido');
    const novos = [...new Set((Array.isArray(corpo.usuarios) ? corpo.usuarios : []).map(String))];
    const a = await supa(`/rest/v1/churn_alertas?id=eq.${id}&select=id,cnpj,tratado_gestor`);
    const alerta = a.ok ? a.json?.[0] : null;
    if (!alerta) throw new ErroHttp(404, 'Alerta não encontrado');
    const [mapa, usuarios, manualMap] = await Promise.all([baseNeo(), usuariosDestino(), atribuicoes([id])]);
    const permitidos = new Set(usuarios.map(u => u.id));
    if (novos.some(u => !permitidos.has(u))) throw new ErroHttp(400, 'Só gestores e supervisores ativos podem receber o alerta');
    const manual = manualMap.get(id) || [];
    const antes = new Set(destinatariosDe(alerta, mapa, usuarios, manual).usuarios.map(u => u.id));
    const jaManual = new Map(manual.map(x => [x.usuario_id, x]));
    const agora = new Date().toISOString();

    // sai quem não está mais na lista
    const remover = manual.filter(x => !novos.includes(x.usuario_id)).map(x => x.usuario_id);
    if (remover.length) {
      const d = await supa(`/rest/v1/churn_atribuicoes?alerta_id=eq.${id}&usuario_id=in.(${remover.join(',')})`, { method: 'DELETE' });
      if (!d.ok) throw new ErroHttp(502, 'Não consegui atualizar a atribuição');
    }
    // entra quem é novo. Quem já recebia (automático ou manual) mantém o próprio histórico; quem chega agora começa pendente.
    const entrar = novos.filter(u => !jaManual.has(u)).map(u => ({
      alerta_id: id, usuario_id: u, atribuido_por: authUser.id, atribuido_por_nome: nome, atribuido_em: agora,
      a_partir_de: antes.has(u) ? EPOCH : agora,
    }));
    if (entrar.length) {
      const i = await supa('/rest/v1/churn_atribuicoes', { method: 'POST', prefer: 'resolution=merge-duplicates', body: entrar });
      if (!i.ok) throw new ErroHttp(502, 'Não consegui gravar a atribuição');
    }
    return res.status(200).json({ ok: true });
  }

  const texto = (corpo.texto || '').toString().trim();
  if (texto.length < 3 || texto.length > 1500) throw new ErroHttp(400, 'Escreva o texto (3 a 1500 caracteres)');

  if (action === 'devolver') {
    const id = parseInt(corpo.id, 10);
    const destino = (corpo.destinatario_id || '').toString();
    if (!Number.isInteger(id) || !destino) throw new ErroHttp(400, 'Informe o alerta e o gestor');
    const a = await supa(`/rest/v1/churn_alertas?id=eq.${id}&select=id,cnpj,tratado_gestor`);
    const alerta = a.ok ? a.json?.[0] : null;
    if (!alerta) throw new ErroHttp(404, 'Alerta não encontrado');
    const [mapa, usuarios, manualMap, msgsMap] = await Promise.all([baseNeo(), usuariosDestino(), atribuicoes([id]), conversas([id])]);
    const manual = manualMap.get(id);
    const dest = destinatariosDe(alerta, mapa, usuarios, manual).usuarios.find(u => u.id === destino);
    if (!dest) throw new ErroHttp(409, 'Esse gestor não está atribuído ao alerta');
    const est = estadoDe(alerta, msgsMap.get(id) || [], destino, manual?.find(x => x.usuario_id === destino)?.a_partir_de);
    // só devolve o que o gestor respondeu com a tabulação (resposta antiga, sem Motivo/Status, segue como está)
    if (est.estado !== 'tratado' || est.legado) throw new ErroHttp(409, 'Só dá pra devolver a resposta que o gestor já enviou com Motivo e Status');
    const ins = await supa('/rest/v1/churn_tratativas', {
      method: 'POST', prefer: 'return=representation',
      body: { alerta_id: id, tipo: 'devolucao', autor_id: authUser.id, autor_nome: nome, destinatario_id: destino, destinatario_nome: dest.nome, texto },
    });
    if (!ins.ok || !ins.json?.length) throw new ErroHttp(502, 'Não consegui gravar a pergunta');
    return res.status(200).json({ mensagem: ins.json[0] });
  }

  // editar: só a PRÓPRIA pergunta de devolução; texto do gestor é imutável
  const tid = parseInt(corpo.tratativa_id, 10);
  if (!Number.isInteger(tid)) throw new ErroHttp(400, 'Mensagem inválida');
  const m = await supa(`/rest/v1/churn_tratativas?id=eq.${tid}&select=${CAMPOS_MSG}`);
  const msg = m.ok ? m.json?.[0] : null;
  if (!msg) throw new ErroHttp(404, 'Mensagem não encontrada');
  if (msg.tipo !== 'devolucao') throw new ErroHttp(403, 'O texto enviado pelo gestor não pode ser alterado');
  if (msg.autor_id !== authUser.id) throw new ErroHttp(403, 'Só quem escreveu a mensagem pode editá-la');
  const up = await supa(`/rest/v1/churn_tratativas?id=eq.${tid}&autor_id=eq.${authUser.id}`, {
    method: 'PATCH', prefer: 'return=representation', body: { texto, editado_em: new Date().toISOString() },
  });
  if (!up.ok || !up.json?.length) throw new ErroHttp(502, 'Não consegui salvar a edição');
  return res.status(200).json({ mensagem: up.json[0] });
}

// ── GET ?action=donos: consultor/equipe dos clientes da aba Churn ────────────
// Quem tem a aba Churn mas NÃO lê as planilhas (ex.: perfil 'suporte' com acesso_extra_abas 'churn')
// não consegue montar consultor/equipe no navegador: a aba 'baseneo' fica na planilha da Carteira,
// fechada pra esse perfil. Este endpoint devolve SÓ o histórico de pedidos (consultor, equipe, etapa,
// data) dos CNPJs que existem em churn_alertas — nada além do que a tela de Churn precisa mostrar.
async function donosHandler(req, res) {
  try {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const perfilRow = await getUsuarioDashboard(req, authUser.id);
    if (!perfilRow || perfilRow.ativo === false) throw new ErroHttp(403, 'Acesso desativado');
    if (!temChurnCompleto(perfilRow)) throw new ErroHttp(403, 'Sem acesso à aba Churn');

    const [mapa, r] = await Promise.all([baseNeo(), supaTudo('/rest/v1/churn_alertas?select=cnpj&order=id.asc')]);
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

async function contextoGestor(req, res) {
  const authUser = await requireAuth(req, res);
  if (!authUser) return null;
  const perfilRow = await getUsuarioDashboard(req, authUser.id);
  if (!perfilRow || perfilRow.ativo === false) throw new ErroHttp(403, 'Acesso desativado');
  if (!PERFIS_AVISO.has(perfilRow.perfil)) throw new ErroHttp(403, 'Seu perfil não recebe esse aviso');
  const escopo = getEscopoTravado(perfilRow.perfil, perfilRow);
  const nome = perfilRow.nome || (authUser.email || '').split('@')[0] || 'gestor';
  return { authUser, perfilRow, escopo, nome };
}

// Alerta como o gestor logado enxerga: o dele (estado, tabulação, atribuição) + a conversa inteira (a mesma pra todos).
// Reaproveita os nomes de campo que a tela já usa (tratado_gestor / devolvido / status_gestor ...).
function visaoDoGestor(alerta, dono, msgs, userId, minhaAtrib) {
  const e = estadoDe(alerta, msgs, userId, minhaAtrib?.a_partir_de);
  const ultDev = e.estado === 'devolvido' ? e.ult : null;
  const novaAtrib = minhaAtrib && new Date(minhaAtrib.a_partir_de).getTime() > 0;
  return {
    ...pick(alerta),
    consultor: dono?.consultor || '', equipe: dono?.equipe || '',
    tratado_gestor: e.estado === 'tratado',
    devolvido: e.estado === 'devolvido',
    devolvido_em: ultDev?.criado_em || null,
    devolvido_por_nome: ultDev?.autor_nome || null,
    tratado_gestor_em: e.estado === 'tratado' ? (e.ult?.criado_em || alerta.tratado_gestor_em || null) : null,
    tratado_gestor_nome: e.estado === 'tratado' ? (e.ult?.autor_nome || alerta.tratado_gestor_nome || null) : null,
    status_gestor: e.ultGestor?.status || null,
    motivo_gestor: e.ultGestor?.motivo || null,
    atribuido_em: novaAtrib ? minhaAtrib.atribuido_em : null,
    atribuido_por_nome: novaAtrib ? minhaAtrib.atribuido_por_nome : null,
    historico: msgs,
  };
}

export default async function churnGestorHandler(req, res) {
  if (req.method === 'GET' && req.query.action === 'donos') return donosHandler(req, res);
  try {
    if (req.method === 'GET' && req.query.action === 'painel') return await painelHandler(req, res);
    if (req.method === 'POST' && ['devolver', 'atribuir', 'editar'].includes(req.query.action)) return await responsavelHandler(req, res, req.query.action);

    const ctx = await contextoGestor(req, res);
    if (!ctx) return; // 401 já respondido
    const { authUser, escopo, nome } = ctx;

    // ── GET: alertas atribuídos a mim ──
    if (req.method === 'GET') {
      const desde = new Date(Date.now() - 60 * DIA).toISOString();
      const [mapa, r, manualMap] = await Promise.all([
        baseNeo(),
        supa(`/rest/v1/churn_alertas?select=${CAMPOS}&recebido_em=gte.${desde}&order=recebido_em.desc&limit=3000`),
        atribuicoes(),
      ]);
      if (!r.ok) throw new ErroHttp(502, 'Falha ao ler os alertas de churn');

      // Só o que ainda importa: janela de portabilidade de ontem em diante (ou, sem data de janela,
      // recebido na última semana). Evita despejar o histórico inteiro de alertas no primeiro acesso.
      const agoraBRT = new Date(Date.now() - 3 * 3600 * 1000);
      const hoje = Date.UTC(agoraBRT.getUTCFullYear(), agoraBRT.getUTCMonth(), agoraBRT.getUTCDate());
      const meus = [];
      for (const a of r.json || []) {
        const jan = tsData(a.data_janela);
        const recente = jan ? jan >= hoje - DIA : Date.now() - new Date(a.recebido_em).getTime() <= 7 * DIA;
        if (!recente) continue;
        const manual = manualMap.get(a.id);
        // atribuição manual vale no lugar da regra automática por equipe
        const minha = manual ? manual.find(x => x.usuario_id === authUser.id) : null;
        const dono = donoDoCliente(mapa, a.cnpj);
        const naVisao = manual ? !!minha : !!alertaNaVisao(a, mapa, escopo);
        if (!naVisao) continue;
        meus.push({ a, dono, minha });
      }
      const msgsMap = await conversas(meus.map(x => x.a.id));
      const alertas = meus.map(({ a, dono, minha }) => ({ ...visaoDoGestor(a, dono, msgsMap.get(a.id) || [], authUser.id, minha), janela_ts: tsData(a.data_janela) }));
      // Pendentes primeiro — devolvidos e recém-atribuídos no topo (alguém espera por ele), depois pela janela mais próxima; tratados por último.
      const peso = x => (x.devolvido ? 2 : 0) + (x.atribuido_em ? 1 : 0);
      alertas.sort((x, y) => (!!x.tratado_gestor === !!y.tratado_gestor)
        ? (peso(y) - peso(x)) || ((x.janela_ts || Infinity) - (y.janela_ts || Infinity))
        : (x.tratado_gestor ? 1 : -1));
      return res.status(200).json({ alertas });
    }

    // ── POST tratar ──
    if (req.method === 'POST' && req.query.action === 'tratar') {
      const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const id = parseInt(corpo.id, 10);
      const resposta = (corpo.resposta || '').toString().trim();
      const status = (corpo.status || '').toString().trim().toUpperCase();
      const motivoInf = (corpo.motivo || '').toString().trim().toUpperCase();
      if (!Number.isInteger(id)) throw new ErroHttp(400, 'Alerta inválido');
      if (!STATUS_TRAT.includes(status)) throw new ErroHttp(400, 'Escolha o Status');
      // SEM CONTATO não tem Motivo (se vier, é descartado); os demais exigem um Motivo da lista
      if (status !== STATUS_SEM_MOTIVO && !MOTIVOS.includes(motivoInf)) throw new ErroHttp(400, 'Escolha o Motivo');
      const motivo = status === STATUS_SEM_MOTIVO ? null : motivoInf;
      if (resposta.length < 3 || resposta.length > 1500) throw new ErroHttp(400, 'Escreva a tratativa (3 a 1500 caracteres)');

      const [mapa, r, manualMap, msgsMap] = await Promise.all([baseNeo(), supa(`/rest/v1/churn_alertas?id=eq.${id}&select=${CAMPOS}`), atribuicoes([id]), conversas([id])]);
      const alerta = r.ok ? r.json?.[0] : null;
      const manual = manualMap.get(id);
      const minha = manual ? manual.find(x => x.usuario_id === authUser.id) : null;
      // Mesma resposta pra "não existe" e "não é meu": não revela alerta de outra equipe.
      if (!alerta || !(manual ? !!minha : !!alertaNaVisao(alerta, mapa, escopo))) throw new ErroHttp(404, 'Alerta não encontrado na sua visão');
      const msgs = msgsMap.get(id) || [];
      const est = estadoDe(alerta, msgs, authUser.id, minha?.a_partir_de);
      if (est.estado === 'tratado') throw new ErroHttp(409, 'Você já tratou esse alerta');

      const ins = await supa('/rest/v1/churn_tratativas', {
        method: 'POST', prefer: 'return=representation',
        body: { alerta_id: id, tipo: 'gestor', autor_id: authUser.id, autor_nome: nome, destinatario_id: authUser.id, destinatario_nome: nome, motivo, status, texto: resposta },
      });
      if (!ins.ok || !ins.json?.length) throw new ErroHttp(502, 'Não consegui gravar a tratativa');
      const todas = [...msgs, ins.json[0]];
      return res.status(200).json({ alerta: visaoDoGestor(alerta, donoDoCliente(mapa, alerta.cnpj), todas, authUser.id, minha) });
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
