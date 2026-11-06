// Dash Beta2 — casca nova. Cada visão é um item do menu lateral (Gerencial, Produção, ...).
// Estrutura:  config.js (nome/menu)  ·  sessao.js (porteiro/Supabase)
//             dados.js (/api/sheets)  ·  nucleo.js (regras do Gerencial)
//             multivisao.js / graficos.js / ui.js (componentes)

import { NOME_SISTEMA, MENU } from './config.js';
import { exigirAdminBeta, sair, supa } from './sessao.js';
import { carregarAba, limparCache, listarAbasHistorico, statusDaBase } from './dados.js';
import {
  filtrosVazios, filtrar, opcoesDosFiltros, agregar, calcularKPIs, variacaoPct,
  detectarMonitorDuplicado, soAtivo, getEscopoTravado, parseDataBR, diasNoMes, mesAnterior,
  MESES_ABREV, receitaLinha,
} from './nucleo.js';
import { esc, icone, iniciais, fmtInt, fmtDec, fmtMoeda, fmtPct, criarMultiSelect, prefs } from './ui.js';
import { criarEsteira } from './esteira.js';
import { criarProducao } from './producao.js';
import { criarPainel } from './painel.js';
import { criarFinanceiro } from './financeiro.js';
import { criarAcessos } from './acessos.js';

const $ = (s, r = document) => r.querySelector(s);

// Visões do Beta2: cada uma é um item do menu lateral (config.js, `beta: true`) e usa a mesma
// barra de filtros e os mesmos dados. Novas visões entram aqui e no MENU.
const VISOES = [
  { id: 'gerencial', rotulo: 'Gerencial', dica: 'KPIs, cartões por categoria com as filas, pedidos e detalhamento por consultor (como o Gerencial atual)' },
  { id: 'painel', rotulo: 'Painel Analítico', dica: 'Histórico mês a mês, mix por grupo e cortes por Estado, DDD, Cidade, Equipe e Vendedor (como a aba Painel Analítico)' },
  { id: 'gerfin', rotulo: 'Gerencial Financeiro', dica: 'Gerencial com Gross separado em Voz Novo + Portabilidade e comissão estimada pelos fatores do Simulador 2.0 (piloto)' },
  { id: 'acessos', rotulo: 'Acessos', dica: 'Criar, bloquear e redefinir acessos de consultores; status online/offline (admin)', semFiltros: true },
  { id: 'producao', rotulo: 'Produção', dica: 'Produção por unidade, gestor ou equipe × status, com UF BL, TRI, MOM e comparar meses (como a aba Produção)' },
];
// hashes antigos (abas Resumo/Esteira) levam ao Gerencial
const ALIAS_VISAO = { resumo: 'gerencial', esteira: 'gerencial' };

const S = {
  acesso: null, escopo: null,
  abas: [],                 // abas históricas [{mm,yyyy,nome}]
  periodo: 'BaseCRM',       // 'BaseCRM' (live) ou nome da aba
  rows: [], monitorDup: false,
  filtros: filtrosVazios(),
  meses: new Map(),         // nome da aba -> linhas (mês anterior, p/ a variação dos KPIs)
  mesesCarregando: false,
  req: 0,
  receita: prefs.get('receita', '0') === '1',
  visao: 'gerencial',
  statusBase: null,
};

// ── período ─────────────────────────────────────────────────────────────────
function mesReferencia() {
  if (S.periodo === 'BaseCRM') { const h = new Date(); return { mm: String(h.getMonth() + 1).padStart(2, '0'), yyyy: String(h.getFullYear()) }; }
  const a = S.abas.find(x => x.nome === S.periodo);
  return a ? { mm: a.mm, yyyy: a.yyyy } : { mm: '01', yyyy: String(new Date().getFullYear()) };
}
const rotuloMes = (mm, yyyy) => `${MESES_ABREV[parseInt(mm) - 1]}/${yyyy}`;
const ehLive = () => S.periodo === 'BaseCRM';
const abaDoMes = (mm, yyyy) => S.abas.find(a => a.mm === mm && a.yyyy === yyyy);

// Dia de corte para comparar com o mês anterior: hoje (mês corrente) ou o último dia (mês fechado).
function diaCorte() { const r = mesReferencia(); return ehLive() ? new Date().getDate() : diasNoMes(r.mm, r.yyyy); }

// ── casca ───────────────────────────────────────────────────────────────────
function montarCasca() {
  document.title = NOME_SISTEMA;
  const nome = S.acesso.perfil.nome || S.acesso.user.email.split('@')[0];
  $('#app').innerHTML = `
    <aside class="lateral" id="lateral" aria-label="Menu principal">
      <div class="lat-marca">
        <a class="lat-logo" href="#gerencial" aria-label="VST Group"><img src="/beta/logo-vst.png" alt="VST Group"></a>
        <button class="btn-icone lat-fechar" type="button" data-fechar-menu aria-label="Fechar menu">${icone('close')}</button>
      </div>
      <nav class="lat-nav">
        ${MENU.map(g => `
          <div class="lat-grupo">
            <div class="lat-grupo-tit">${esc(g.grupo)}</div>
            ${g.itens.map(i => i.beta
              ? `<a class="lat-item" href="#${i.id}" data-visao-id="${i.id}">${icone(i.icone)}<span>${esc(i.rotulo)}</span></a>`
              : `<a class="lat-item" href="/#aba=${esc(i.id)}" title="Abre no Dash atual">${icone(i.icone)}<span>${esc(i.rotulo)}</span><em class="lat-ext" aria-hidden="true">↗</em></a>`).join('')}
          </div>`).join('')}
      </nav>
      <a class="lat-voltar" href="/">${icone('back', 16)}<span>Voltar ao Dash atual</span></a>
    </aside>
    <div class="lat-fundo" id="lat-fundo" data-fechar-menu></div>

    <div class="principal">
      <header class="topo">
        <button class="btn-icone topo-menu" type="button" id="btn-menu" aria-label="Abrir menu">${icone('menu')}</button>
        <div class="topo-tit">
          <h1 id="titulo-visao">Gerencial</h1>
          <span class="selo" id="selo-base">BaseCRM Live</span>
        </div>
        <div class="topo-acoes">
          <label class="mes" title="Período">
            ${icone('calendar', 16)}
            <select id="sel-mes" aria-label="Período"></select>
          </label>
          <button class="btn btn-marca" type="button" id="btn-atualizar">${icone('refresh', 16)}<span>Atualizar</span></button>
          <div class="usuario">
            <button class="avatar" type="button" id="btn-usuario" aria-haspopup="menu" aria-expanded="false" title="${esc(nome)}">${esc(iniciais(nome))}</button>
            <div class="menu-usuario" id="menu-usuario" hidden role="menu">
              <div class="mu-info"><b>${esc(nome)}</b><span>${esc(S.acesso.user.email)}</span><span class="mu-perfil">${esc(S.acesso.perfil.perfil)}</span></div>
              <a href="/" role="menuitem">${icone('back', 16)}Dash atual</a>
              <button type="button" id="btn-sair" role="menuitem">${icone('out', 16)}Sair</button>
            </div>
          </div>
        </div>
      </header>

      <main class="conteudo" id="conteudo">
        <section class="filtros" id="filtros" aria-label="Filtros"></section>
        <div id="aviso"></div>
        <div id="slot-busca"></div>
        <div id="visao-gerencial" hidden>
          <section class="kpis" id="kpis" aria-label="Indicadores"></section>
          <div id="visao-esteira"></div>
        </div>
        <div id="visao-producao" hidden></div>
        <div id="visao-painel" hidden></div>
        <div id="visao-gerfin" hidden></div>
        <div id="visao-acessos" hidden></div>
        <footer class="rodape" id="rodape"></footer>
      </main>
    </div>`;
}

function ligarCasca() {
  const lateral = $('#lateral'), fundo = $('#lat-fundo');
  const abrir = on => { lateral.classList.toggle('aberta', on); fundo.classList.toggle('aberto', on); };
  $('#btn-menu').addEventListener('click', () => abrir(true));
  document.querySelectorAll('[data-fechar-menu]').forEach(b => b.addEventListener('click', () => abrir(false)));
  const mu = $('#menu-usuario'), bu = $('#btn-usuario');
  bu.addEventListener('click', e => { e.stopPropagation(); mu.hidden = !mu.hidden; bu.setAttribute('aria-expanded', String(!mu.hidden)); });
  document.addEventListener('click', e => { if (!mu.hidden && !mu.contains(e.target)) { mu.hidden = true; bu.setAttribute('aria-expanded', 'false'); } });
  $('#btn-sair').addEventListener('click', sair);
  $('#sel-mes').addEventListener('change', e => { S.periodo = e.target.value; S.filtros = filtrosVazios(); if (PRODUCAO) PRODUCAO.reiniciar(); if (FINANCEIRO) FINANCEIRO.reiniciar(); carregarPeriodo(); });
  $('#btn-atualizar').addEventListener('click', () => { limparCache(); S.meses.clear(); if (PAINEL && S.visao === 'painel') PAINEL.recarregar(); carregarPeriodo({ forcar: true }); });
  // item do menu = visão do Beta2: o hash muda, a visão troca e (no celular) o menu fecha
  document.querySelectorAll('.lat-item[data-visao-id]').forEach(a => a.addEventListener('click', () => abrir(false)));
  window.addEventListener('hashchange', () => mudarVisao(location.hash.replace(/^#/, ''), false));
}

function popularMeses() {
  const hoje = new Date();
  const atual = rotuloMes(String(hoje.getMonth() + 1).padStart(2, '0'), String(hoje.getFullYear()));
  $('#sel-mes').innerHTML = `<option value="BaseCRM">Live · ${atual}</option>` +
    S.abas.map(a => `<option value="${esc(a.nome)}">${rotuloMes(a.mm, a.yyyy)}</option>`).join('');
  $('#sel-mes').value = S.periodo;
}

// ── filtros ─────────────────────────────────────────────────────────────────
const FILTROS_UI = {};
function montarFiltros() {
  const host = $('#filtros');
  host.innerHTML = `
    <div class="filtros-linha">
      <div class="seg seg-status" role="group" aria-label="Status">
        <button type="button" class="seg-btn" data-status="todos" title="Todas as filas"><span>Todos</span></button>
        <button type="button" class="seg-btn" data-status="aprovado" title="Ativo/Instalado + Esteira de ativação"><span>Aprovado</span></button>
        <button type="button" class="seg-btn" data-status="ativo" title="Somente Ativo/Instalado"><span>Somente ativo</span></button>
      </div>
      <div id="f-status"></div>
      <label class="chip chip-sel"><span>UF</span><select id="f-uf" aria-label="UF"></select></label>
      <div id="f-gestor"></div><div id="f-equipe"></div><div id="f-consultor"></div>
      <label class="chip chip-sel"><span>Tag/Unidade</span><select id="f-tag" aria-label="Tag ou unidade"></select></label>
      <label class="chip chip-data" title="Filtra pela data de CADASTRO do pedido">${icone('calendar', 15)}
        <input type="date" id="f-de" aria-label="Cadastro a partir de"><span class="ate">até</span><input type="date" id="f-ate" aria-label="Cadastro até"></label>
      <label class="busca">${icone('search', 16)}<input type="search" id="f-busca" placeholder="Buscar CNPJ ou razão social" aria-label="Buscar CNPJ ou razão social" autocomplete="off"></label>
      <button type="button" class="btn btn-fantasma" id="f-limpar">Limpar filtros</button>
    </div>
    <div class="filtros-ativos" id="filtros-ativos"></div>`;
  const ms = (id, chave, rotulo) => {
    const c = criarMultiSelect({ rotulo, onChange: v => { S.filtros[chave] = v; aoMudarFiltro(); } });
    $('#' + id).replaceWith(c.el); c.el.id = id; FILTROS_UI[chave] = c;
  };
  {
    const c = criarMultiSelect({ rotulo: 'Status', onChange: v => { S.filtros.status = v; S.filtros.statusModo = v.length ? 'custom' : 'todos'; aoMudarFiltro(); } });
    $('#f-status').replaceWith(c.el); c.el.id = 'f-status'; FILTROS_UI.status = c;
  }
  $('.seg-status').addEventListener('click', e => {
    const b = e.target.closest('[data-status]'); if (!b) return;
    S.filtros.statusModo = b.dataset.status; S.filtros.status = []; aoMudarFiltro();
  });
  ms('f-gestor', 'gestores', 'Gestor'); ms('f-equipe', 'equipes', 'Equipe'); ms('f-consultor', 'consultores', 'Consultor');
  $('#f-uf').addEventListener('change', e => { S.filtros.uf = e.target.value; aoMudarFiltro(); });
  $('#f-tag').addEventListener('change', e => { S.filtros.tag = e.target.value; aoMudarFiltro(); });
  const dataLocal = (raw, fim) => { if (!raw) return null; const [y, m, d] = raw.split('-').map(Number); return fim ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d); };
  $('#f-de').addEventListener('change', e => { S.filtros.de = dataLocal(e.target.value, false); aoMudarFiltro(); });
  $('#f-ate').addEventListener('change', e => { S.filtros.ate = dataLocal(e.target.value, true); aoMudarFiltro(); });
  let t;
  $('#f-busca').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { S.filtros.busca = e.target.value; aoMudarFiltro(); }, 300); });
  $('#f-limpar').addEventListener('click', () => { S.filtros = filtrosVazios(); sincronizarCamposFiltro(); aoMudarFiltro(); });
}

function sincronizarCamposFiltro() {
  const f = S.filtros;
  $('#f-busca').value = f.busca || '';
  $('#f-de').value = f.de ? toISO(f.de) : ''; $('#f-ate').value = f.ate ? toISO(f.ate) : '';
}
const toISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function atualizarOpcoesFiltro() {
  const f = S.filtros;
  const op = opcoesDosFiltros(S.rows, f, S.escopo);
  const fill = (id, itens, atual, todos) => {
    const sel = $(id);
    sel.innerHTML = [todos, ...itens].map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    sel.value = [todos, ...itens].includes(atual) ? atual : todos;
  };
  fill('#f-uf', op.uf, f.uf, 'Todos'); f.uf = $('#f-uf').value;
  fill('#f-tag', op.tag, f.tag, 'Todas'); f.tag = $('#f-tag').value;
  FILTROS_UI.status.atualizar(op.status, f.status);
  document.querySelectorAll('.seg-status [data-status]').forEach(b => { const on = b.dataset.status === f.statusModo; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
  FILTROS_UI.gestores.atualizar(op.gestor, f.gestores);
  FILTROS_UI.equipes.atualizar(op.equipe, f.equipes);
  FILTROS_UI.consultores.atualizar(op.consultor, f.consultores);

  const ativos = [];
  if (f.statusModo === 'aprovado') ativos.push('Status: Aprovado (Ativo + Esteira de ativação)');
  else if (f.statusModo === 'ativo') ativos.push('Status: Somente ativo');
  else if (f.statusModo === 'custom') ativos.push(`Status: ${f.status.length > 2 ? f.status.length + ' selec.' : f.status.join(', ')}`);
  if (f.uf !== 'Todos') ativos.push(`UF: ${f.uf}`);
  if (f.tag !== 'Todas') ativos.push(`Tag: ${f.tag}`);
  [['Gestor', f.gestores], ['Equipe', f.equipes], ['Consultor', f.consultores]].forEach(([n, v]) => { if (v.length) ativos.push(`${n}: ${v.length > 2 ? v.length + ' selec.' : v.join(', ')}`); });
  if (f.de || f.ate) ativos.push(`Cadastro: ${f.de ? f.de.toLocaleDateString('pt-BR') : '…'} → ${f.ate ? f.ate.toLocaleDateString('pt-BR') : '…'}`);
  const r = mesReferencia();
  ativos.unshift(`Período: ${ehLive() ? 'Live · ' : ''}${rotuloMes(r.mm, r.yyyy)}`);
  $('#filtros-ativos').innerHTML = ativos.map(a => `<span class="tag">${esc(a)}</span>`).join('');
}

// ── carga ───────────────────────────────────────────────────────────────────
async function carregarPeriodo({ forcar = false } = {}) {
  const req = ++S.req;
  popularMeses();
  sincronizarCamposFiltro();
  $('#selo-base').textContent = ehLive() ? 'BaseCRM Live' : S.periodo;
  $('#aviso').innerHTML = '';
  $('#kpis').innerHTML = Array(4).fill('<div class="kpi kpi-esq"><span class="esq"></span></div>').join('');
  if (ESTEIRA) ESTEIRA.carregando();
  if (PRODUCAO) PRODUCAO.carregando();
  if (FINANCEIRO) FINANCEIRO.carregando();
  try {
    const rows = await carregarAba(S.periodo, { forcar: forcar || ehLive() });   // mês corrente sempre fresco
    if (req !== S.req) return;
    S.rows = rows; S.monitorDup = detectarMonitorDuplicado(rows);
    if (!rows.length) throw new Error('Planilha sem dados.');
  } catch (e) {
    if (req !== S.req) return;
    S.rows = [];
    $('#kpis').innerHTML = '';
    $('#aviso').innerHTML = `<div class="alerta alerta-erro"><b>Erro ao carregar dados</b> ${esc(e.message)}</div>`;
    return;
  }
  atualizarOpcoesFiltro();
  recalcular();
  statusDaBase(S.periodo).then(t => { if (req === S.req) { S.statusBase = t; desenharRodape(); } });
  carregarMesesAnteriores(req);
}

// Mês anterior em segundo plano (variação dos KPIs). Mesmas rotas/escopo.
async function carregarMesesAnteriores(req) {
  S.mesesCarregando = true;
  const ref = mesReferencia();
  const m = mesAnterior(ref.mm, ref.yyyy), aba = abaDoMes(m.mm, m.yyyy);
  if (aba && !S.meses.has(aba.nome)) {
    try { S.meses.set(aba.nome, await carregarAba(aba.nome)); } catch (e) { /* mês indisponível: segue sem a variação */ }
  }
  if (req !== S.req) return;
  S.mesesCarregando = false;
  recalcularComparativos();
}

// ── cálculo + desenho ───────────────────────────────────────────────────────
let AGG = null, KPI = null, ANT = null, ESTEIRA = null, PRODUCAO = null, PAINEL = null, FINANCEIRO = null, ACESSOS = null;

function aoMudarFiltro() { atualizarOpcoesFiltro(); recalcular(); }

function recalcular() {
  const filtradas = filtrar(S.rows, S.filtros, S.escopo);
  AGG = agregar(filtradas, S.monitorDup);
  KPI = calcularKPIs(AGG);
  S.filtradas = filtradas;
  recalcularComparativos();
  desenharBusca();
  desenharVisaoEsteira();
  desenharVisaoProducao();
  desenharVisaoPainel();
  desenharVisaoFin();
  desenharRodape();
}

function desenharVisaoFin() {
  if (!FINANCEIRO || S.visao !== 'gerfin' || !S.rows.length) return;
  FINANCEIRO.render();
}

function desenharVisaoPainel() {
  if (!PAINEL || S.visao !== 'painel' || !S.rows.length) return;
  PAINEL.mostrar();
}

// meses do Painel Analítico: abas históricas + o mês corrente (base viva)
function mesesDoPainel() {
  const h = new Date(), chaveHoje = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
  const mapa = {};
  S.abas.forEach(a => { mapa[`${a.yyyy}-${a.mm}`] = a.nome; });
  mapa[chaveHoje] = 'BaseCRM';
  return Object.keys(mapa).sort().map(k => ({ chave: k, sheet: mapa[k], yyyy: k.slice(0, 4), mm: k.slice(5), label: `${MESES_ABREV[parseInt(k.slice(5), 10) - 1]}/${k.slice(0, 4)}` }));
}
function registroNoEscopo(r) {
  const e = S.escopo;
  return !e || ((!e.gestores || e.gestores.has(r.ge)) && (!e.equipes || e.equipes.has(r.eq)) && (!e.consultorRef || (r.ve || '').toUpperCase() === e.consultorRef));
}

function desenharVisaoProducao() {
  if (!PRODUCAO || S.visao !== 'producao' || !S.rows.length) return;
  PRODUCAO.render();
}

function desenharVisaoEsteira() {
  if (!AGG || !ESTEIRA) return;
  ESTEIRA.render({ agg: AGG, filtradas: S.filtradas, totalBase: S.rows.length, monitorDup: S.monitorDup });
}

// Quantidade × Receita vale para todos os painéis e visões.
function aplicarReceita(b) {
  S.receita = b; prefs.set('receita', b ? '1' : '0');
  desenharVisaoEsteira(); desenharVisaoProducao(); desenharVisaoFin();
}

function mudarVisao(id, atualizarHash = true) {
  id = ALIAS_VISAO[id] || id;
  if (!VISOES.some(v => v.id === id)) id = ALIAS_VISAO[prefs.get('visao', 'gerencial')] || prefs.get('visao', 'gerencial');
  if (!VISOES.some(v => v.id === id)) id = 'gerencial';
  S.visao = id; prefs.set('visao', id);
  $('#visao-gerencial').hidden = id !== 'gerencial';
  $('#visao-producao').hidden = id !== 'producao';
  $('#visao-painel').hidden = id !== 'painel';
  $('#visao-gerfin').hidden = id !== 'gerfin';
  $('#visao-acessos').hidden = id !== 'acessos';
  document.body.dataset.tela = id;
  $('#titulo-visao').textContent = VISOES.find(v => v.id === id).rotulo;
  document.title = `${VISOES.find(v => v.id === id).rotulo} · ${NOME_SISTEMA}`;
  document.querySelectorAll('.lat-item[data-visao-id]').forEach(el => { const on = el.dataset.visaoId === id; el.classList.toggle('ativo', on); if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  if (atualizarHash && location.hash.replace(/^#/, '') !== id) history.replaceState(null, '', '#' + id);
  if (id === 'producao') desenharVisaoProducao();
  if (id === 'painel') desenharVisaoPainel();
  if (id === 'gerfin') desenharVisaoFin();
  if (id === 'acessos' && ACESSOS) ACESSOS.mostrar();
  desenharBusca();
}

// Mês anterior "até o mesmo dia" (por CADASTRO) com os mesmos filtros; sem data de cadastro entra normal.
function agregarMesAnterior() {
  const f = S.filtros;
  if (f.de || f.ate) return { indisponivel: 'Com filtro de data de cadastro a comparação com o mês anterior fica desligada.' };
  const ref = mesReferencia(), ant = mesAnterior(ref.mm, ref.yyyy);
  const aba = abaDoMes(ant.mm, ant.yyyy);
  if (!aba) return { indisponivel: `Aba de ${ant.mm}/${ant.yyyy} não encontrada na planilha.` };
  const rows = S.meses.get(aba.nome);
  if (!rows) return { indisponivel: S.mesesCarregando ? 'Carregando mês anterior…' : 'Mês anterior indisponível.' };
  const corte = new Date(+ant.yyyy, +ant.mm - 1, Math.min(diaCorte(), diasNoMes(ant.mm, ant.yyyy)), 23, 59, 59, 999);
  // Somente Ativo/Instalado: corta pela DATA REF (data da ativação), como a Produção; senão pelo CADASTRO.
  const ativo = soAtivo(f), colCorte = ativo ? 'DATA REF' : 'CADASTRO';
  const base = filtrar(rows, f, S.escopo, ['data', 'busca']).filter(r => { const d = parseDataBR(r[colCorte]); return !d || d <= corte; });
  return { agg: agregar(base, detectarMonitorDuplicado(rows)), rotulo: rotuloMes(ant.mm, ant.yyyy), ate: Math.min(diaCorte(), diasNoMes(ant.mm, ant.yyyy)), porData: ativo ? 'ativação' : 'cadastro' };
}

function recalcularComparativos() {
  ANT = agregarMesAnterior();
  desenharKPIs();
}

function chipVar(pct, { neutro = false, pp = false } = {}) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return '<span class="var var-nd" title="Sem base de comparação">—</span>';
  const cls = neutro ? 'var-neu' : (pct > 0.05 ? 'var-pos' : pct < -0.05 ? 'var-neg' : 'var-neu');
  const sinal = pct > 0 ? '+' : '';
  return `<span class="var ${cls}">${pct > 0.05 ? icone('up', 12) : pct < -0.05 ? icone('down', 12) : ''}${sinal}${fmtDec(pct, 1)}${pp ? ' p.p.' : '%'}</span>`;
}

function desenharKPIs() {
  if (!KPI) return;
  const a = ANT && ANT.agg ? calcularKPIs(ANT.agg) : null;
  const nota = ANT && ANT.agg ? `Variação vs. ${ANT.rotulo} até o dia ${ANT.ate} (por data de ${ANT.porData}).` : (ANT ? ANT.indisponivel : '');
  const cards = [
    { rot: 'Pedidos (Geral)', val: fmtInt(KPI.pedidos), v: a ? variacaoPct(KPI.pedidos, a.pedidos) : null,
      dica: 'Total do card GERAL do Gerencial atual (Gross + Renovação + BL + Titularidade; sem Serv. Digitais).' },
    { rot: 'Receita estimada', val: fmtMoeda(KPI.receita), v: a ? variacaoPct(KPI.receita, a.receita) : null,
      dica: 'Soma do valor das linhas do GERAL (BL multiplica pela quantidade, como no Gerencial atual).' },
    { rot: 'Ativações pendentes', val: fmtInt(KPI.pendentes), aviso: KPI.pendentes > 0, neutro: true, v: a ? variacaoPct(KPI.pendentes, a.pendentes) : null,
      sub: KPI.correcao ? `+ ${fmtInt(KPI.correcao)} em correção` : '',
      dica: 'Pedidos na "Esteira de ativação" (aguardando instalação/NF/portabilidade). Em correção: desconexão, falha de portabilidade, quebra.' },
    { rot: 'Taxa de ativação', val: fmtPct(KPI.taxaAtivacao), pp: true, v: a ? KPI.taxaAtivacao - a.taxaAtivacao : null,
      sub: `${fmtInt(KPI.ativos)} ativos/instalados`,
      dica: 'Ativo/Instalado ÷ Pedidos (Geral).' },
  ];
  $('#kpis').innerHTML = cards.map(c => `
    <article class="kpi" title="${esc(c.dica)}">
      <div class="kpi-rot">${esc(c.rot)}${c.aviso ? `<span class="kpi-aviso" aria-label="Atenção">${icone('warn', 15)}</span>` : ''}</div>
      <div class="kpi-val${c.aviso ? ' kpi-val-aviso' : ''}">${esc(c.val)}</div>
      <div class="kpi-pe">${chipVar(c.v, { neutro: c.neutro, pp: c.pp })}<span class="kpi-nota">${esc(c.sub || '')}</span></div>
    </article>`).join('') + (nota ? `<p class="kpis-nota">${esc(nota)}</p>` : '');
}

// Resultados da busca por CNPJ/razão social (como no Gerencial atual)
function desenharBusca() {
  const slot = $('#slot-busca');
  const q = (S.filtros.busca || '').trim();
  if (!q || S.visao !== 'gerencial') { slot.innerHTML = ''; return; }
  const ls = S.filtradas.slice(0, 200);
  slot.innerHTML = `<section class="painel"><header class="painel-cab"><div class="painel-tit"><h2>Resultados da busca</h2>
    <p>${fmtInt(S.filtradas.length)} pedido${S.filtradas.length === 1 ? '' : 's'}${S.filtradas.length > 200 ? ' (mostrando 200)' : ''}</p></div></header>
    <div class="painel-corpo">${ls.length ? `<div class="tab-wrap"><table class="tab"><thead><tr><th>Cliente</th><th>Grupo</th><th>Equipe</th><th>Proprietário</th><th>Status</th><th class="num">Qtd</th></tr></thead>
    <tbody>${ls.map(r => `<tr><td>${esc(r['NOME CLIENTE'] || '—')}<small class="sub">${esc(r['CPF/CNPJ'] || '')}</small></td><td>${esc(r['GRUPO'] || '—')}</td><td>${esc(r['EQUIPE'] || '—')}</td>
      <td>${esc(r['PROPRIETÁRIO DO PEDIDO'] || '—')}</td><td>${esc(r['FILA'] || '—')}</td><td class="num">${esc(S.receita ? fmtMoeda(receitaLinha(r)) : (parseInt(r['QUANTIDADE']) || 1))}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="vazio">Nenhum pedido encontrado para essa busca.</div>'}</div></section>`;
}

function desenharRodape() {
  const el = $('#rodape'); if (!el) return;
  const partes = [];
  if (S.statusBase) partes.push(`Base atualizada em ${S.statusBase}`);
  if (AGG) partes.push(`${fmtInt(S.rows.length)} registros na base · ${fmtInt(AGG.nLinhas)} filtrados · ${fmtInt(AGG.nConsultores)} consultores`);
  partes.push(`${NOME_SISTEMA} · itens com ↗ no menu abrem o Dash atual.`);
  el.textContent = partes.join('  ·  ');
}

// ── presença online (igual ao Dash atual: index.html presencaIniciar) ───────
const PRES_INTERVALO_MS = 60000, PRES_OCIOSO_MS = 5 * 60000;
let _presTimer = null, _presUltima = Date.now();
async function presencaEnviar() {
  if (document.visibilityState !== 'visible' || Date.now() - _presUltima >= PRES_OCIOSO_MS) return;
  try { await supa.rpc('registrar_presenca', { p_online: true }); } catch (e) { /* presença nunca atrapalha o uso */ }
}
function presencaIniciar() {
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(ev => window.addEventListener(ev, () => { _presUltima = Date.now(); }, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { _presUltima = Date.now(); presencaEnviar(); } });
  if (_presTimer) return;
  presencaEnviar(); _presTimer = setInterval(presencaEnviar, PRES_INTERVALO_MS);
}

// ── início ──────────────────────────────────────────────────────────────────
async function iniciar() {
  const acesso = await exigirAdminBeta();
  if (!acesso) return;                     // já redirecionou para o Dash atual
  S.acesso = acesso;
  S.escopo = getEscopoTravado(acesso.perfil);
  montarCasca(); ligarCasca(); montarFiltros();
  ESTEIRA = criarEsteira($('#visao-esteira'), {
    receita: () => S.receita, setReceita: aplicarReceita,
    filtrarConsultor: nome => { S.filtros.consultores = [nome]; aoMudarFiltro(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    filtrarEquipe: eq => { S.filtros.equipes = [eq]; S.filtros.consultores = []; aoMudarFiltro(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  });
  PRODUCAO = criarProducao($('#visao-producao'), () => ({
    rows: S.rows, f: S.filtros, escopo: S.escopo, receita: S.receita, ref: mesReferencia(), diaCorte: diaCorte(), abas: S.abas,
    carregarMes: nome => carregarAba(nome),
  }));
  PAINEL = criarPainel($('#visao-painel'), () => ({
    f: S.filtros, escopoOk: registroNoEscopo, meses: mesesDoPainel(),
    filtrarUf: uf => { S.filtros.uf = uf; aoMudarFiltro(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    reusar: sheet => (sheet === S.periodo && S.rows.length ? Promise.resolve(S.rows) : null),
    carregarConfigs: async () => { const r = await supa.from('config_simulador2').select('*'); if (r.error) throw new Error(r.error.message); return r.data || []; },
  }));
  FINANCEIRO = criarFinanceiro($('#visao-gerfin'), () => ({
    rows: S.rows, f: S.filtros, escopo: S.escopo, ref: mesReferencia(), monitorDup: S.monitorDup,
    carregarConfig: async periodo => { const r = await supa.from('config_simulador2').select('*').eq('periodo', periodo); if (r.error) throw new Error(r.error.message); return r.data || []; },
  }));
  ACESSOS = criarAcessos($('#visao-acessos'), () => ({ perfil: S.acesso.perfil.perfil }));
  presencaIniciar();
  mudarVisao(location.hash.replace(/^#/, ''), false);
  document.body.classList.remove('carregando');
  $('#app').hidden = false;
  try { S.abas = await listarAbasHistorico(); } catch (e) { S.abas = []; }
  await carregarPeriodo();
}
iniciar().catch(e => {
  console.error('Beta2:', e);
  const t = document.getElementById('espera-txt');
  if (t) t.textContent = 'Não foi possível iniciar. Recarregue a página.';
});
