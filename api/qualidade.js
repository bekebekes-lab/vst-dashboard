// Aba "Qualidade" (estorno): acompanha as 9 parcelas (270 dias) de cada
// contratação, contadas a partir da DATA REF.
//
// Regra do negócio: o cliente precisa estar adimplente e ativo por 9 meses
// (270 dias) após a DATA REF. Cada contratação ganha 9 parcelas, vencendo a
// cada 30 dias contados da DATA REF (parcela 9 = dia 270). O admin marca cada
// parcela como pago / atrasado / cancelado; sem marcação = pendente.
//
// Grão: contratação = (NUMERO PEDIDO, DATA REF). O mesmo CNPJ com vários
// pedidos gera várias jornadas, e itens de um mesmo pedido com DATA REF
// diferentes viram jornadas separadas (cada uma na sua data).
//
// Universo: pedidos em ATIVO/CONECTADO nas abas "BaseCRM" (atual) e
// "BaseCRM MMAAAA" (meses fechados). Um pedido ativo aparece quase sempre em
// UMA só aba; se aparecer em mais de uma, vale a aba mais recente onde ele
// está ativo.
//
// Segurança: perfil 'admin' ou concessão individual 'qualidade' em acesso_extra_abas (leitura e escrita). As marcações ficam em
// tabelas com RLS sem policy — só esta função (chave de serviço) acessa.
import { requireAuth, getUsuarioDashboard } from './_lib/auth.js';
import { listarAbas, lerColunas, normalizarCabecalho } from './_lib/gsheets.js';
import { EQUIPES_GESTORES, normalizarNomeEquipe } from './_lib/escopo.js';

const SUPA_URL = 'https://kzlchetrpsfefwybaaoy.supabase.co';
const TTL_BASE_MS = 5 * 60 * 1000;
const N_PARCELAS = 9;
const DIAS_POR_PARCELA = 30;
const STATUS_VALIDOS = new Set(['pago', 'atrasado', 'cancelado']);
const POR_PAGINA = 50;

class ErroHttp extends Error {
  constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; }
}

// ── datas (tudo em dias inteiros, UTC, sem fuso) ────────────────────────────
function hojeBrasilia() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function diasDe(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function isoDeDias(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}
function parseData(s) {
  const t = (s || '').toString().trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
function parseValor(s) {
  const t = (s || '').toString().trim();
  if (!t) return 0;
  // "1.234,56" (pt-BR) ou "950" / "950.5"
  const limpo = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return parseFloat(limpo) || 0;
}

// ── Supabase (chave de serviço) ─────────────────────────────────────────────
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
      apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { ok: res.ok, status: res.status, json };
}
function erroTabela(r) {
  // tabela ainda não criada (migration não rodou)
  const msg = JSON.stringify(r.json || '');
  if (r.status === 404 || /PGRST205|does not exist|schema cache/i.test(msg)) {
    return new ErroHttp(503, 'As tabelas da aba Qualidade ainda não foram criadas no Supabase', { setup: true });
  }
  return null;
}

async function carregarMarcacoes() {
  const mapa = new Map(); // "pedido|data_ref" -> { [parcela]: linha }
  const TAM = 50000;
  for (let pagina = 0; pagina < 30; pagina++) {
    const r = await supa(`/rest/v1/qualidade_parcelas?select=pedido,data_ref,parcela,status,marcado_por,marcado_em,observacao&order=pedido,data_ref,parcela&limit=${TAM}&offset=${pagina * TAM}`);
    if (!r.ok) throw erroTabela(r) || new ErroHttp(502, 'Não consegui ler as marcações');
    for (const l of r.json) {
      const k = `${l.pedido}|${l.data_ref}`;
      if (!mapa.has(k)) mapa.set(k, {});
      mapa.get(k)[l.parcela] = l;
    }
    if (r.json.length < TAM) break;
  }
  return mapa;
}

// SD › faturas pagas (1ª–5ª) por pedido. Falha na leitura (tabela ainda não criada) não derruba a lista.
async function carregarPagamentosSD() {
  const mapa = new Map();   // pedido -> [faturas pagas]
  const TAM = 50000;
  for (let pagina = 0; pagina < 20; pagina++) {
    const r = await supa(`/rest/v1/sd_pagamentos?select=pedido,fatura&order=pedido,fatura&limit=${TAM}&offset=${pagina * TAM}`);
    if (!r.ok) return { ok: false, mapa: new Map() };
    for (const l of r.json) { if (!mapa.has(l.pedido)) mapa.set(l.pedido, []); mapa.get(l.pedido).push(l.fatura); }
    if (r.json.length < TAM) break;
  }
  return { ok: true, mapa };
}

// ── universo de contratações (vem das planilhas, com cache em memória) ──────
let _cache = null;      // { em, jornadas, equipes, abas }
let _emAndamento = null;

const COLS = ['NUMERO PEDIDO', 'NOME CLIENTE', 'CPF/CNPJ', 'PROPRIETARIO DO PEDIDO', 'PROPRIETARIO DA ATIVIDADE', 'EQUIPE',
  'ETAPA PEDIDO', 'TIPO NEGOCIACAO', 'PRODUTO', 'NUMERO', 'VALOR UNIT', 'DATA REF', 'QUANTIDADE'];

function ordemDaAba(titulo) {
  const m = titulo.match(/^BaseCRM(?: (\d{2})(\d{4}))?$/);
  if (!m) return null;
  return m[1] ? Number(m[2]) * 100 + Number(m[1]) : 999999; // "BaseCRM" puro = mês corrente
}
// Mês (AAAA-MM) a que a aba pertence: "BaseCRM MMAAAA" = o mês fechado; "BaseCRM" puro = mês corrente.
function mesDaAba(titulo) {
  const m = titulo.match(/^BaseCRM (\d{2})(\d{4})$/);
  return m ? `${m[2]}-${m[1]}` : hojeBrasilia().slice(0, 7);
}
// SD › Blip GO: o produto vem com nomes variados ("Blip GO - Básico", "BLIP GO - INTERMEDIARIO"...) — casa por "contém".
const ehBlip = produto => normalizarCabecalho(produto).includes('BLIP');
function ehAtivo(etapa) {
  const e = normalizarCabecalho(etapa);
  return e.startsWith('ATIVO') || e.startsWith('CONECTADO');
}

async function montarUniverso() {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetId) throw new ErroHttp(500, 'GOOGLE_SHEETS_ID não configurado no servidor');
  const titulos = (await listarAbas(sheetId))
    .map(t => ({ t, ordem: ordemDaAba(t) })).filter(x => x.ordem !== null)
    .sort((a, b) => a.ordem - b.ordem);

  const lidas = await Promise.all(titulos.map(async x => ({ ...x, cols: await lerColunas(sheetId, x.t, COLS) })));

  const porPedido = new Map();     // pedido -> Map(data_ref -> jornada) da aba mais recente em que está ativo
  const etapaAtual = new Map();    // pedido -> etapa na aba mais recente em que aparece
  const blipLinhas = [];           // SD: todas as linhas de Blip GO de todas as abas (decide-se depois quais valem)
  for (const aba of lidas) {
    const c = aba.cols;
    const n = c['NUMERO PEDIDO'].length;
    const local = new Map();
    for (let i = 0; i < n; i++) {
      const pedido = (c['NUMERO PEDIDO'][i] || '').toString().trim();
      if (!pedido) continue;
      const etapa = (c['ETAPA PEDIDO'][i] || '').toString().trim();
      etapaAtual.set(pedido, etapa);
      if (ehBlip(c['PRODUTO'][i])) {
        blipLinhas.push({
          pedido, ordem: aba.ordem, mes: mesDaAba(aba.t), ativa: ehAtivo(etapa),
          cnpj: (c['CPF/CNPJ'][i] || '').toString().trim(),
          cliente: (c['NOME CLIENTE'][i] || '').toString().trim(),
          consultor: (c['PROPRIETARIO DO PEDIDO'][i] || c['PROPRIETARIO DA ATIVIDADE'][i] || '').toString().trim(),
          equipe: normalizarNomeEquipe(c['EQUIPE'][i]),
          produto: (c['PRODUTO'][i] || '').toString().trim(),
          numero: (c['NUMERO'][i] || '').toString().trim(),
          qtd: parseInt(c['QUANTIDADE'][i], 10) || 1,
          valor: parseValor(c['VALOR UNIT'][i]),
          data_ref: parseData(c['DATA REF'][i]),
        });
      }
      if (!ehAtivo(etapa)) continue;
      const dataRef = parseData(c['DATA REF'][i]);
      if (!dataRef) continue;
      let porData = local.get(pedido);
      if (!porData) { porData = new Map(); local.set(pedido, porData); }
      let j = porData.get(dataRef);
      if (!j) {
        const equipe = normalizarNomeEquipe(c['EQUIPE'][i]);
        j = {
          pedido, data_ref: dataRef,
          cnpj: (c['CPF/CNPJ'][i] || '').toString().trim(),
          cliente: (c['NOME CLIENTE'][i] || '').toString().trim(),
          proprietario: (c['PROPRIETARIO DO PEDIDO'][i] || c['PROPRIETARIO DA ATIVIDADE'][i] || '').toString().trim(),
          equipe, gestor: EQUIPES_GESTORES[equipe] || '',
          tipo: (c['TIPO NEGOCIACAO'][i] || '').toString().trim().toUpperCase(),
          valor: 0, itens: [], aba: aba.t,
        };
        porData.set(dataRef, j);
      }
      // VALOR UNIT já é a receita vendida da linha (não multiplica pela quantidade)
      const v = parseValor(c['VALOR UNIT'][i]);
      j.valor += v;
      if (j.itens.length < 15) j.itens.push({ p: (c['PRODUTO'][i] || '').toString().trim(), n: (c['NUMERO'][i] || '').toString().trim(), v });
    }
    for (const [pedido, porData] of local) porPedido.set(pedido, porData); // aba mais recente vence
  }

  const jornadas = [];
  for (const [pedido, porData] of porPedido) {
    for (const j of porData.values()) {
      j.valor = Math.round(j.valor * 100) / 100;
      j.etapa_atual = etapaAtual.get(pedido) || '';
      j.ainda_ativo = ehAtivo(j.etapa_atual);
      jornadas.push(j);
    }
  }
  jornadas.sort((a, b) => (a.data_ref < b.data_ref ? 1 : a.data_ref > b.data_ref ? -1 : a.pedido.localeCompare(b.pedido)));
  const equipes = [...new Set(jornadas.map(j => j.equipe).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return { em: Date.now(), jornadas, equipes, abas: titulos.map(x => x.t), sd: montarSD(blipLinhas, etapaAtual) };
}

// SD › Blip GO ativos, mês a mês, uma linha por cliente em cada mês. "Ativo" = o pedido está em ATIVO/CONECTADO na aba mais
// recente em que aparece; vale a aba mais recente onde ele está ativo (mesma regra do universo de Qualidade), então o mesmo
// pedido nunca conta em dois meses. Quantidade = soma de QUANTIDADE (1 se vazio); valor = soma de VALOR UNIT (receita da linha).
function montarSD(blipLinhas, etapaAtual) {
  const ordemAtiva = new Map();   // pedido -> ordem da aba mais recente em que o pedido tem Blip ativo
  for (const l of blipLinhas) if (l.ativa && l.ordem > (ordemAtiva.get(l.pedido) || 0)) ordemAtiva.set(l.pedido, l.ordem);
  const grupos = new Map();
  for (const l of blipLinhas) {
    if (!l.ativa || l.ordem !== ordemAtiva.get(l.pedido) || !ehAtivo(etapaAtual.get(l.pedido))) continue;
    const dig = l.cnpj.replace(/\D/g, '');
    const k = `${l.mes}|${dig || l.cliente.toUpperCase()}`;
    let g = grupos.get(k);
    if (!g) { g = { mes: l.mes, chave: dig || l.cliente.toUpperCase(), cnpj: l.cnpj, cliente: l.cliente, quantidade: 0, valor: 0, pedidos: [], _cons: new Map(), _eq: new Map() }; grupos.set(k, g); }
    if (!g.cliente) g.cliente = l.cliente;
    if (!g.cnpj) g.cnpj = l.cnpj;
    g.quantidade += l.qtd;
    g.valor += l.valor;
    if (l.consultor) g._cons.set(l.consultor, (g._cons.get(l.consultor) || 0) + 1);
    if (l.equipe) g._eq.set(l.equipe, (g._eq.get(l.equipe) || 0) + 1);
    g.pedidos.push({ pedido: l.pedido, produto: l.produto, numero: l.numero, qtd: l.qtd, valor: Math.round(l.valor * 100) / 100, data_ref: l.data_ref });
  }
  const maisFreq = m => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const linhas = [...grupos.values()].map(g => {
    const equipe = maisFreq(g._eq);
    const datas = g.pedidos.map(p => p.data_ref).filter(Boolean).sort();
    return {
      mes: g.mes, chave: g.chave, cnpj: g.cnpj, cliente: g.cliente, consultor: maisFreq(g._cons), equipe, gestor: EQUIPES_GESTORES[equipe] || '',
      quantidade: g.quantidade, valor: Math.round(g.valor * 100) / 100,
      data_ativacao: datas[0] || null,   // data de ativação = DATA REF (a mais antiga entre os pedidos da linha)
      pedidos: g.pedidos.sort((a, b) => a.pedido.localeCompare(b.pedido)).slice(0, 200),
    };
  });
  linhas.sort((a, b) => (a.mes < b.mes ? 1 : a.mes > b.mes ? -1 : a.cliente.localeCompare(b.cliente, 'pt-BR')));
  return linhas;
}

async function universo(forcar) {
  if (!forcar && _cache && Date.now() - _cache.em < TTL_BASE_MS) return _cache;
  if (!_emAndamento) {
    _emAndamento = montarUniverso().then(u => { _cache = u; return u; }).finally(() => { _emAndamento = null; });
  }
  return _emAndamento;
}

// ── situação de uma contratação ─────────────────────────────────────────────
function parcelasDe(j, marcas, hojeD) {
  const base = diasDe(j.data_ref);
  const out = [];
  for (let n = 1; n <= N_PARCELAS; n++) {
    const venc = base + n * DIAS_POR_PARCELA;
    const m = marcas?.[n];
    out.push({
      n, venc: isoDeDias(venc),
      status: m ? m.status : 'pendente',
      vencida: venc <= hojeD,
      por: m?.marcado_por || null, em: m?.marcado_em || null, obs: m?.observacao || null,
    });
  }
  return out;
}
function situacaoDe(parcelas) {
  if (parcelas.some(p => p.status === 'cancelado')) return 'cancelado';
  if (parcelas.every(p => p.status === 'pago')) return 'concluido';
  if (parcelas.some(p => p.status === 'atrasado' || (p.vencida && p.status === 'pendente'))) return 'atrasado';
  return 'em_dia';
}

function semAcento(s) { return normalizarCabecalho(s).toLowerCase(); }

// ── autorização ─────────────────────────────────────────────────────────────
async function exigirAdmin(req, res) {
  const authUser = await requireAuth(req, res);
  if (!authUser) return null;
  const perfilRow = await getUsuarioDashboard(req, authUser.id);
  // Admin, ou quem recebeu a aba por concessão individual ('qualidade' em
  // usuarios_dashboard.acesso_extra_abas — ex.: Laura e Maria). A concessão
  // vale por usuário e não muda o perfil nem a trava de escopo dele.
  const concedido = (perfilRow?.acesso_extra_abas || []).includes('qualidade');
  if (!perfilRow || perfilRow.ativo === false || (perfilRow.perfil !== 'admin' && !concedido)) {
    throw new ErroHttp(403, 'Acesso restrito a administradores');
  }
  return { authUser, perfilRow, quem: perfilRow.nome || authUser.email };
}

function auditar(quem, acao, dados) {
  console.log(JSON.stringify({ evento: 'qualidade', acao, por: quem, ...dados }));
}

function validarChave(pedido, dataRef) {
  if (!/^[0-9A-Za-z._-]{1,40}$/.test(pedido || '')) throw new ErroHttp(400, 'Pedido inválido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataRef || '')) throw new ErroHttp(400, 'Data de referência inválida');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const ctx = await exigirAdmin(req, res);
    if (!ctx) return; // requireAuth já respondeu 401
    const action = req.query.action;
    const hoje = hojeBrasilia();
    const hojeD = diasDe(hoje);

    // ── GET lista: contratações filtradas + resumo + página ──
    if (req.method === 'GET' && action === 'lista') {
      const q = req.query;
      const [uni, marcas] = await Promise.all([universo(q.refresh === '1'), carregarMarcacoes()]);

      const janela = q.janela || 'andamento'; // andamento (≤270d) | encerrado | todos
      const busca = semAcento(q.busca || '');
      const buscaDigitos = (q.busca || '').replace(/\D/g, '');
      const de = /^\d{4}-\d{2}-\d{2}$/.test(q.de || '') ? q.de : null;
      const ate = /^\d{4}-\d{2}-\d{2}$/.test(q.ate || '') ? q.ate : null;

      const comSituacao = [];
      // Opções dos filtros Equipe e Tipo (cascata nos dois sentidos): cada lista considera TODOS os
      // outros filtros (janela, datas, busca e o outro desses dois), mas não o próprio — assim
      // escolher uma equipe deixa só os tipos que ela tem, e escolher um tipo deixa só as equipes dele.
      const equipesDisp = new Set();
      const tiposDisp = new Set();
      for (const j of uni.jornadas) {
        const dia = hojeD - diasDe(j.data_ref);
        if (janela === 'andamento' && dia > N_PARCELAS * DIAS_POR_PARCELA) continue;
        if (janela === 'encerrado' && dia <= N_PARCELAS * DIAS_POR_PARCELA) continue;
        if (de && j.data_ref < de) continue;
        if (ate && j.data_ref > ate) continue;
        if (busca) {
          const alvo = semAcento(`${j.pedido} ${j.cliente} ${j.proprietario} ${j.cnpj}`);
          const bateTexto = alvo.includes(busca);
          const bateDigitos = buscaDigitos.length >= 4 && j.cnpj.replace(/\D/g, '').includes(buscaDigitos);
          if (!bateTexto && !bateDigitos) continue;
        }
        const passaEquipe = !q.equipe || j.equipe === q.equipe;
        const passaTipo = !q.tipo || j.tipo === q.tipo;
        if (passaTipo && j.equipe) equipesDisp.add(j.equipe);
        if (passaEquipe && j.tipo) tiposDisp.add(j.tipo);
        if (!passaEquipe || !passaTipo) continue;
        const parcelas = parcelasDe(j, marcas.get(`${j.pedido}|${j.data_ref}`), hojeD);
        comSituacao.push({ j, dia, parcelas, situacao: situacaoDe(parcelas) });
      }

      const resumo = { total: comSituacao.length, valor_total: 0, por_situacao: {}, valor_por_situacao: {} };
      for (const x of comSituacao) {
        resumo.por_situacao[x.situacao] = (resumo.por_situacao[x.situacao] || 0) + 1;
        resumo.valor_por_situacao[x.situacao] = Math.round(((resumo.valor_por_situacao[x.situacao] || 0) + x.j.valor) * 100) / 100;
        resumo.valor_total += x.j.valor;
      }
      resumo.valor_total = Math.round(resumo.valor_total * 100) / 100;
      resumo.fora_de_ativo = comSituacao.filter(x => !x.j.ainda_ativo).length;

      const filtradas = q.situacao && q.situacao !== 'todas' ? comSituacao.filter(x => x.situacao === q.situacao) : comSituacao;
      const pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
      const fatia = filtradas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map(x => ({
        pedido: x.j.pedido, data_ref: x.j.data_ref, cnpj: x.j.cnpj, cliente: x.j.cliente,
        proprietario: x.j.proprietario, equipe: x.j.equipe, gestor: x.j.gestor, tipo: x.j.tipo,
        valor: x.j.valor, itens: x.j.itens, etapa_atual: x.j.etapa_atual, ainda_ativo: x.j.ainda_ativo,
        dia: x.dia, situacao: x.situacao, parcelas: x.parcelas,
      }));
      return res.status(200).json({
        hoje, resumo, pagina, por_pagina: POR_PAGINA, total_filtrado: filtradas.length,
        contratos: fatia, base_atualizada_em: new Date(uni.em).toISOString(),
        equipes: [...equipesDisp].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        tipos: [...tiposDisp].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      });
    }

    // ── GET sd: Blip GO ativos mês a mês, uma linha por cliente (ordenação/filtros ficam na tela) ──
    if (req.method === 'GET' && action === 'sd') {
      const uni = await universo(req.query.refresh === '1');
      // faturas pagas (1ª–5ª) por pedido; se a tabela ainda não existe, a lista vem igual, só sem as caixinhas (pagamentos_ok=false)
      const pag = await carregarPagamentosSD();
      const linhas = uni.sd.map(l => ({ ...l, pedidos: l.pedidos.map(p => ({ ...p, f: pag.mapa.get(p.pedido) || [] })) }));
      return res.status(200).json({ linhas, pagamentos_ok: pag.ok, base_atualizada_em: new Date(uni.em).toISOString() });
    }

    if (req.method !== 'POST') return res.status(400).json({ error: 'Ação inválida' });
    const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    // ── POST sd_marcar: marca/desmarca a fatura N (1–5) paga em TODOS os pedidos de uma linha da SD (mês + cliente) ──
    if (action === 'sd_marcar') {
      const mes = (corpo.mes || '').toString();
      const chaveLinha = (corpo.chave || '').toString();
      const marcado = corpo.marcado === true;
      const faturas = corpo.fatura === 'todas' ? [1, 2, 3, 4, 5] : [Number(corpo.fatura)];
      if (faturas.some(n => !Number.isInteger(n) || n < 1 || n > 5)) throw new ErroHttp(400, 'Fatura inválida');
      const uni = await universo(false);
      const linha = uni.sd.find(l => l.mes === mes && l.chave === chaveLinha);
      if (!linha) throw new ErroHttp(404, 'Cliente não encontrado nessa base — atualize a SD e tente de novo');
      const pedidos = [...new Set(linha.pedidos.map(p => p.pedido))].filter(p => /^[0-9A-Za-z._-]{1,40}$/.test(p));
      if (!pedidos.length) throw new ErroHttp(400, 'Sem pedidos para marcar');
      let w;
      if (marcado) {
        const agora = new Date().toISOString();
        const novas = pedidos.flatMap(pedido => faturas.map(fatura => ({ pedido, fatura, marcado_por: ctx.quem, marcado_em: agora })));
        w = await supa('/rest/v1/sd_pagamentos?on_conflict=pedido,fatura', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: novas });
      } else {
        const lista = pedidos.map(p => encodeURIComponent(p)).join(',');
        w = await supa(`/rest/v1/sd_pagamentos?pedido=in.(${lista})&fatura=in.(${faturas.join(',')})`, { method: 'DELETE', prefer: 'return=minimal' });
      }
      if (!w.ok) throw erroTabela(w) || new ErroHttp(502, 'Não consegui salvar a marcação');
      auditar(ctx.quem, 'sd_marcar', { mes, cliente: linha.cliente, pedidos: pedidos.length, faturas, marcado });
      return res.status(200).json({ ok: true });
    }

    // ── POST marcar: uma parcela de uma contratação ──
    if (action === 'marcar') {
      const pedido = (corpo.pedido || '').toString().trim();
      const dataRef = (corpo.data_ref || '').toString().trim();
      const parcela = Number(corpo.parcela);
      const status = (corpo.status || '').toString();
      const obs = (corpo.observacao || '').toString().trim().slice(0, 300) || null;
      validarChave(pedido, dataRef);
      if (!Number.isInteger(parcela) || parcela < 1 || parcela > N_PARCELAS) throw new ErroHttp(400, 'Parcela inválida');
      if (status !== 'pendente' && !STATUS_VALIDOS.has(status)) throw new ErroHttp(400, 'Status inválido');

      const uni = await universo(false);
      if (!uni.jornadas.some(j => j.pedido === pedido && j.data_ref === dataRef)) throw new ErroHttp(404, 'Contratação não encontrada na base');

      const atual = await supa(`/rest/v1/qualidade_parcelas?pedido=eq.${encodeURIComponent(pedido)}&data_ref=eq.${dataRef}&parcela=eq.${parcela}&select=status`);
      if (!atual.ok) throw erroTabela(atual) || new ErroHttp(502, 'Não consegui ler a marcação atual');
      const anterior = atual.json?.[0]?.status || null;
      const novo = status === 'pendente' ? null : status;
      if (anterior === novo && !obs) return res.status(200).json({ ok: true, sem_mudanca: true });

      let w;
      if (novo) {
        w = await supa('/rest/v1/qualidade_parcelas?on_conflict=pedido,data_ref,parcela', {
          method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
          body: { pedido, data_ref: dataRef, parcela, status: novo, marcado_por: ctx.quem, marcado_em: new Date().toISOString(), observacao: obs },
        });
      } else {
        w = await supa(`/rest/v1/qualidade_parcelas?pedido=eq.${encodeURIComponent(pedido)}&data_ref=eq.${dataRef}&parcela=eq.${parcela}`, { method: 'DELETE', prefer: 'return=minimal' });
      }
      if (!w.ok) throw erroTabela(w) || new ErroHttp(502, 'Não consegui salvar a marcação');
      await supa('/rest/v1/qualidade_historico', {
        method: 'POST', prefer: 'return=minimal',
        body: { pedido, data_ref: dataRef, parcela, status_anterior: anterior, status_novo: novo, por: ctx.quem, observacao: obs },
      });
      auditar(ctx.quem, 'marcar', { pedido, data_ref: dataRef, parcela, de: anterior, para: novo });
      return res.status(200).json({ ok: true });
    }

    // ── POST marcar_lote: marca como X as parcelas JÁ VENCIDAS e ainda sem marcação, até a parcela k ──
    if (action === 'marcar_lote') {
      const itens = Array.isArray(corpo.itens) ? corpo.itens : [];
      const ate = Number(corpo.ate_parcela);
      const status = (corpo.status || '').toString();
      if (!itens.length || itens.length > 200) throw new ErroHttp(400, 'Selecione de 1 a 200 contratações');
      if (!Number.isInteger(ate) || ate < 1 || ate > N_PARCELAS) throw new ErroHttp(400, 'Parcela inválida');
      if (!STATUS_VALIDOS.has(status)) throw new ErroHttp(400, 'Status inválido');

      const uni = await universo(false);
      const existentes = new Set(uni.jornadas.map(j => `${j.pedido}|${j.data_ref}`));
      const marcas = await carregarMarcacoes();
      const novas = [], hist = [];
      for (const it of itens) {
        const pedido = (it.pedido || '').toString().trim();
        const dataRef = (it.data_ref || '').toString().trim();
        validarChave(pedido, dataRef);
        if (!existentes.has(`${pedido}|${dataRef}`)) continue;
        const base = diasDe(dataRef);
        const ja = marcas.get(`${pedido}|${dataRef}`) || {};
        for (let n = 1; n <= ate; n++) {
          if (ja[n]) continue;                              // nunca sobrescreve marcação existente
          if (base + n * DIAS_POR_PARCELA > hojeD) continue; // só parcelas já vencidas
          novas.push({ pedido, data_ref: dataRef, parcela: n, status, marcado_por: ctx.quem, marcado_em: new Date().toISOString(), observacao: 'Marcação em lote' });
          hist.push({ pedido, data_ref: dataRef, parcela: n, status_anterior: null, status_novo: status, por: ctx.quem, observacao: 'Marcação em lote' });
        }
      }
      if (novas.length) {
        for (let i = 0; i < novas.length; i += 1000) {
          const w = await supa('/rest/v1/qualidade_parcelas?on_conflict=pedido,data_ref,parcela', {
            method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: novas.slice(i, i + 1000),
          });
          if (!w.ok) throw erroTabela(w) || new ErroHttp(502, 'Não consegui salvar as marcações');
        }
        for (let i = 0; i < hist.length; i += 1000) {
          await supa('/rest/v1/qualidade_historico', { method: 'POST', prefer: 'return=minimal', body: hist.slice(i, i + 1000) });
        }
      }
      auditar(ctx.quem, 'marcar_lote', { contratacoes: itens.length, parcelas_marcadas: novas.length, ate_parcela: ate, status });
      return res.status(200).json({ ok: true, parcelas_marcadas: novas.length });
    }

    return res.status(400).json({ error: 'Ação inválida' });
  } catch (e) {
    const status = e instanceof ErroHttp ? e.status : 500;
    if (status === 500) console.error('qualidade:', e);
    return res.status(status).json({ error: status === 500 ? 'Erro interno' : e.message, ...(e.extra || {}) });
  }
}
