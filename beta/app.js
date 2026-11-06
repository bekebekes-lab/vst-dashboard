// Dash Beta2 — casca nova + aba Gerencial (fase 1).
// Estrutura:  config.js (nome/menu)  ·  sessao.js (porteiro/Supabase)
//             dados.js (/api/sheets)  ·  nucleo.js (regras do Gerencial)
//             multivisao.js / graficos.js / ui.js (componentes)

import { NOME_SISTEMA, MENU, MESES_EVOLUCAO } from './config.js';
import { exigirAdminBeta, sair } from './sessao.js';
import { carregarAba, limparCache, listarAbasHistorico, statusDaBase } from './dados.js';
import {
  filtrosVazios, filtrar, opcoesDosFiltros, agregar, calcularKPIs, variacaoPct, totaisPorSubgrupo,
  detectarMonitorDuplicado, soAtivo, getEscopoTravado, parseDataBR, diasNoMes, mesAnterior,
  MESES_ABREV, receitaLinha,
} from './nucleo.js';
import { esc, icone, iniciais, fmtInt, fmtDec, fmtMoeda, fmtMoedaCurta, fmtPct, criarMultiSelect, prefs } from './ui.js';
import { criarMultivisao } from './multivisao.js';
import { criarEsteira } from './esteira.js';
import { montarResponsivo, barrasVerticais } from './graficos.js';

const $ = (s, r = document) => r.querySelector(s);

// Visões do Gerencial (mesma barra de filtros, mesmos dados). Novas visões entram aqui.
const VISOES = [
  { id: 'resumo', rotulo: 'Resumo', dica: 'KPIs, evolução, esteira por etapa, performance e comparativo' },
  { id: 'esteira', rotulo: 'Esteira', dica: 'Cartões por categoria com as filas, pedidos e detalhamento por consultor (como o Gerencial atual)' },
];

const S = {
  acesso: null, escopo: null,
  abas: [],                 // abas históricas [{mm,yyyy,nome}]
  periodo: 'BaseCRM',       // 'BaseCRM' (live) ou nome da aba
  rows: [], monitorDup: false,
  filtros: filtrosVazios(),
  meses: new Map(),         // nome da aba -> linhas (meses anteriores, p/ MoM e evolução)
  mesesCarregando: false,
  req: 0,
  receita: prefs.get('receita', '0') === '1',
  visao: 'resumo',
  dimensao: prefs.get('dimensao', 'gestor'),
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
        <span class="lat-logo"><img src="/icon-192.png" alt="VST Group"></span>
        <span class="lat-nome">${esc(NOME_SISTEMA)}</span>
        <button class="btn-icone lat-fechar" type="button" data-fechar-menu aria-label="Fechar menu">${icone('close')}</button>
      </div>
      <nav class="lat-nav">
        ${MENU.map(g => `
          <div class="lat-grupo">
            <div class="lat-grupo-tit">${esc(g.grupo)}</div>
            ${g.itens.map(i => i.beta
              ? `<a class="lat-item ativo" href="#${i.id}" aria-current="page">${icone(i.icone)}<span>${esc(i.rotulo)}</span></a>`
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
          <h1>Gerencial</h1>
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
        <nav class="abas-visao" id="abas-visao" role="tablist" aria-label="Visões do Gerencial">
          ${VISOES.map(v => `<button type="button" role="tab" class="aba-visao" data-visao-id="${v.id}" title="${esc(v.dica)}">${esc(v.rotulo)}</button>`).join('')}
        </nav>
        <div id="aviso"></div>
        <div id="slot-busca"></div>
        <div id="visao-esteira" hidden></div>
        <div id="visao-resumo">
        <section class="kpis" id="kpis" aria-label="Indicadores"></section>
        <div class="grade-2">
          <section class="painel" id="painel-evolucao">
            <header class="painel-cab"><div class="painel-tit"><h2>Evolução mensal</h2><p id="evolucao-sub"></p></div>
              <div class="painel-ctl"><div class="seg" role="group" aria-label="Medida da evolução">
                <button type="button" class="seg-btn" data-evo="qtd"><span>Pedidos</span></button>
                <button type="button" class="seg-btn" data-evo="rec"><span>Receita</span></button></div></div></header>
            <div class="painel-corpo"><div id="evolucao-graf" class="graf-host"></div></div>
          </section>
          <div id="slot-esteira"></div>
        </div>
        <div id="slot-performance"></div>
        <div id="slot-comparativo"></div>
        <section class="painel painel-futuro" aria-label="Metas × realizado">
          <header class="painel-cab"><div class="painel-tit"><h2>Metas × realizado</h2>
            <p>Em breve — depende de definir de onde vêm as metas de venda por equipe/consultor.</p></div></header>
        </section>
        </div>
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
  $('#sel-mes').addEventListener('change', e => { S.periodo = e.target.value; S.filtros = filtrosVazios(); carregarPeriodo(); });
  $('#btn-atualizar').addEventListener('click', () => { limparCache(); S.meses.clear(); carregarPeriodo({ forcar: true }); });
  $('#abas-visao').addEventListener('click', e => { const b = e.target.closest('[data-visao-id]'); if (b) mudarVisao(b.dataset.visaoId); });
  window.addEventListener('hashchange', () => mudarVisao(location.hash.replace(/^#/, ''), false));
  $('#painel-evolucao').addEventListener('click', e => {
    const b = e.target.closest('[data-evo]'); if (!b) return;
    prefs.set('evo', b.dataset.evo); desenharEvolucao();
  });
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
  PAINEIS.performance.carregando(); PAINEIS.esteira.carregando(); PAINEIS.comparativo.carregando();
  if (ESTEIRA) ESTEIRA.carregando();
  $('#evolucao-graf').innerHTML = '<div class="vazio"><span class="spinner"></span> Carregando…</div>';
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

// Meses anteriores em segundo plano (MoM + evolução). Mesmas rotas/escopo.
async function carregarMesesAnteriores(req) {
  S.mesesCarregando = true; desenharEvolucao();
  const ref = mesReferencia();
  const alvos = [];
  for (let k = 1; k <= MESES_EVOLUCAO; k++) { const m = mesAnterior(ref.mm, ref.yyyy, k); const a = abaDoMes(m.mm, m.yyyy); if (a) alvos.push(a); }
  await Promise.allSettled(alvos.map(async a => {
    if (S.meses.has(a.nome)) return;
    try { S.meses.set(a.nome, await carregarAba(a.nome)); } catch (e) { /* mês indisponível: segue sem ele */ }
  }));
  if (req !== S.req) return;
  S.mesesCarregando = false;
  recalcularComparativos();
}

// ── cálculo + desenho ───────────────────────────────────────────────────────
let AGG = null, KPI = null, ANT = null, ESTEIRA = null;

function aoMudarFiltro() { atualizarOpcoesFiltro(); recalcular(); }

function recalcular() {
  const filtradas = filtrar(S.rows, S.filtros, S.escopo);
  AGG = agregar(filtradas, S.monitorDup);
  KPI = calcularKPIs(AGG);
  S.filtradas = filtradas;
  recalcularComparativos();
  desenharBusca();
  desenharPerformance();
  desenharEsteira();
  desenharVisaoEsteira();
  desenharRodape();
}

function desenharVisaoEsteira() {
  if (!AGG || !ESTEIRA) return;
  ESTEIRA.render({ agg: AGG, filtradas: S.filtradas, totalBase: S.rows.length, monitorDup: S.monitorDup });
}

// Quantidade × Receita vale para todos os painéis e visões.
function aplicarReceita(b) {
  S.receita = b; prefs.set('receita', b ? '1' : '0');
  desenharPerformance(); desenharEsteira(); desenharVisaoEsteira();
}

function mudarVisao(id, atualizarHash = true) {
  if (!VISOES.some(v => v.id === id)) id = prefs.get('visao', 'resumo');
  if (!VISOES.some(v => v.id === id)) id = 'resumo';
  S.visao = id; prefs.set('visao', id);
  $('#visao-resumo').hidden = id !== 'resumo';
  $('#visao-esteira').hidden = id !== 'esteira';
  document.querySelectorAll('[data-visao-id]').forEach(b => { const on = b.dataset.visaoId === id; b.classList.toggle('ativo', on); b.setAttribute('aria-selected', String(on)); });
  if (atualizarHash && location.hash.replace(/^#/, '') !== id) history.replaceState(null, '', '#' + id);
  if (id === 'resumo') desenharEvolucao();   // gráfico mede a largura: redesenha ao reaparecer
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
  desenharComparativo();
  desenharEvolucao();
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

// ── evolução mensal ─────────────────────────────────────────────────────────
let _desmontaEvo = null;
function desenharEvolucao() {
  const host = $('#evolucao-graf'); if (!host || !S.rows.length) return;
  const modo = prefs.get('evo', 'qtd');
  document.querySelectorAll('[data-evo]').forEach(b => { const on = b.dataset.evo === modo; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
  const ref = mesReferencia();
  const pontos = [];
  for (let k = MESES_EVOLUCAO; k >= 0; k--) {
    const m = mesAnterior(ref.mm, ref.yyyy, k);
    let rows, parcial = false;
    if (k === 0) { rows = S.rows; parcial = ehLive(); }
    else { const a = abaDoMes(m.mm, m.yyyy); rows = a && S.meses.get(a.nome); }
    if (!rows) continue;
    const ag = agregar(filtrar(rows, S.filtros, S.escopo, ['data', 'busca']), detectarMonitorDuplicado(rows));
    pontos.push({ rotulo: MESES_ABREV[+m.mm - 1], valor: modo === 'rec' ? ag.cats.GERAL.totalRec : ag.cats.GERAL.total, parcial });
  }
  $('#evolucao-sub').textContent = (S.mesesCarregando ? 'Carregando meses anteriores… · ' : '') +
    (modo === 'rec' ? 'Receita estimada (Geral)' : 'Pedidos (Geral)') + ' por mês, com os filtros atuais' + (ehLive() ? ' · mês corrente em andamento' : '');
  if (_desmontaEvo) _desmontaEvo();
  const fmt = modo === 'rec' ? fmtMoedaCurta : fmtInt;
  _desmontaEvo = montarResponsivo(host, w => barrasVerticais({ pontos, largura: w, fmt, fmtEixo: modo === 'rec' ? fmtMoedaCurta : fmtInt, altura: w < 420 ? 220 : 260 }));
}

// ── painéis multivisão ──────────────────────────────────────────────────────
const PAINEIS = {};
function criarPaineis() {
  const num = (rotulo, k) => ({ k, rotulo, num: true,
    valor: l => l[k + (S.receita ? '_REC' : '')] || 0,
    fmt: v => (S.receita ? fmtMoeda(v) : fmtInt(v)) });

  // Performance por Gestor / Equipe / Consultor
  PAINEIS.performance = criarMultivisao({
    id: 'performance', titulo: 'Performance por Gestor / Equipe', subtitulo: 'Mesmos números do Detalhamento por consultor do Gerencial atual.',
    nome: l => l.nome,
    sub: l => S.dimensao === 'consultor' ? l.equipe : S.dimensao === 'equipe' ? `${l.gestor}${l.uf ? ' · ' + l.uf : ''}` : '',
    colunas: () => [
      { k: 'nome', rotulo: { gestor: 'Gestor', equipe: 'Equipe', consultor: 'Consultor' }[S.dimensao], valor: l => l.nome },
      num('Gross', 'GROSS'), num('Renov.', 'RENOVAÇÃO'), num('BL', 'BL'), num('Titular.', 'TITULARIDADE'),
      num('Ativo/Inst.', 'ATIVO'), num('Total', 'GERAL'),
      { k: 'taxa', rotulo: 'Taxa ativ.', num: true, valor: l => (l.GERAL ? (l.ATIVO / l.GERAL) * 100 : 0), fmt: v => fmtPct(v),
        html: (v) => `<span class="taxa"><i style="width:${Math.min(100, v)}%"></i></span><b>${fmtPct(v)}</b>` },
    ],
    ordemInicial: 'GERAL', metricaInicial: 'GERAL', destaque: 'GERAL', limite: 25,
  });
  const seg = document.createElement('div'); seg.className = 'seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Agrupar por');
  seg.innerHTML = [['gestor', 'Gestor'], ['equipe', 'Equipe'], ['consultor', 'Consultor']].map(([k, r]) => `<button type="button" class="seg-btn" data-dim="${k}"><span>${r}</span></button>`).join('');
  const segMed = document.createElement('div'); segMed.className = 'seg'; segMed.setAttribute('role', 'group'); segMed.setAttribute('aria-label', 'Medida');
  segMed.innerHTML = `<button type="button" class="seg-btn" data-med="qtd"><span>Qtd</span></button><button type="button" class="seg-btn" data-med="rec"><span>Receita</span></button>`;
  PAINEIS.performance.slotExtra.append(seg, segMed);
  PAINEIS.performance.slotExtra.addEventListener('click', e => {
    const d = e.target.closest('[data-dim]'), m = e.target.closest('[data-med]');
    if (d) { S.dimensao = d.dataset.dim; prefs.set('dimensao', S.dimensao); desenharPerformance(); }
    if (m) aplicarReceita(m.dataset.med === 'rec');
  });
  $('#slot-performance').append(PAINEIS.performance.el);

  // Esteira por etapa (funil de processo)
  PAINEIS.esteira = criarMultivisao({
    id: 'esteira', titulo: 'Esteira por etapa', subtitulo: 'Onde estão os pedidos do Geral, na ordem do processo (escritório → operadora → ativação → ativo).',
    nome: l => l.nome,
    colunas: () => [
      { k: 'nome', rotulo: 'Etapa', valor: l => l.nome },
      { k: 'v', rotulo: S.receita ? 'Receita' : 'Pedidos', num: true, valor: l => l.v, fmt: v => S.receita ? fmtMoeda(v) : fmtInt(v) },
      { k: 'pct', rotulo: '% do total', num: true, valor: l => l.pct, fmt: v => fmtPct(v) },
    ],
    ordemInicial: null, graficoOrdemOriginal: true, metricaInicial: 'v', destaque: 'v', limite: 12,
    classeBarra: l => l.classe,
  });
  $('#slot-esteira').append(PAINEIS.esteira.el);

  // Comparativo com o mês anterior, por equipe
  PAINEIS.comparativo = criarMultivisao({
    id: 'comparativo', titulo: 'Comparativo de equipes × mês anterior', subtitulo: '',
    nome: l => l.nome, sub: l => `${l.gestor}${l.uf ? ' · ' + l.uf : ''}`,
    colunas: () => [
      { k: 'nome', rotulo: 'Equipe', valor: l => l.nome },
      { k: 'atual', rotulo: 'Atual', num: true, valor: l => l.atual, fmt: v => fmtInt(v) },
      { k: 'ant', rotulo: 'Mês anterior', num: true, valor: l => l.ant, fmt: v => fmtInt(v) },
      { k: 'dif', rotulo: 'Diferença', num: true, valor: l => l.dif, fmt: v => (v > 0 ? '+' : '') + fmtInt(v) },
      { k: 'pct', rotulo: 'Variação', num: true, valor: l => (l.pct === null ? -Infinity : l.pct), fmt: v => (v === -Infinity ? 'novo' : (v > 0 ? '+' : '') + fmtDec(v, 1) + '%'),
        html: (v, l) => l.pct === null ? '<span class="var var-nd">novo</span>' : chipVar(l.pct) },
    ],
    ordemInicial: 'dif', metricas: () => [{ k: 'dif', rotulo: 'Diferença (pedidos)' }, { k: 'atual', rotulo: 'Atual' }, { k: 'ant', rotulo: 'Mês anterior' }],
    metricaInicial: 'dif', destaque: 'atual',
    classeBarra: (l, k) => (k === 'dif' && l.dif < 0 ? 'hb-neg' : ''), limite: 20,
  });
  $('#slot-comparativo').append(PAINEIS.comparativo.el);
}

function marcarSegmentos() {
  PAINEIS.performance.slotExtra.querySelectorAll('[data-dim]').forEach(b => { const on = b.dataset.dim === S.dimensao; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
  PAINEIS.performance.slotExtra.querySelectorAll('[data-med]').forEach(b => { const on = (b.dataset.med === 'rec') === S.receita; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
}

function desenharPerformance() {
  if (!AGG) return;
  marcarSegmentos();
  PAINEIS.performance.render({ gestor: AGG.porGestor, equipe: AGG.porEquipe, consultor: AGG.porConsultor }[S.dimensao]);
}

const CLASSE_ETAPA = { 'Ativo': 'hb-ok', 'Esteira de ativação (correção)': 'hb-aviso', 'Outros': 'hb-cinza' };
function desenharEsteira() {
  if (!AGG) return;
  const g = AGG.cats.GERAL, sub = totaisPorSubgrupo(g, S.receita);
  const total = S.receita ? g.totalRec : g.total;
  // ordem do processo (a lista do Dash atual começa por Ativo; aqui invertemos para ler como funil)
  const ordem = ['Esteira escritório', 'Esteira operadora', 'Esteira de ativação', 'Esteira de ativação (correção)', 'Ativo', 'Outros'];
  const linhas = ordem.filter(k => sub[k]).map(k => ({ nome: k, v: sub[k], pct: total ? (sub[k] / total) * 100 : 0, classe: CLASSE_ETAPA[k] || '' }));
  PAINEIS.esteira.render(linhas);
}

function desenharComparativo() {
  const p = PAINEIS.comparativo; if (!AGG || !p) return;
  const sub = p.el.querySelector('.painel-tit');
  let p2 = sub.querySelector('p'); if (!p2) { p2 = document.createElement('p'); sub.append(p2); }
  if (!ANT || !ANT.agg) {
    p2.textContent = ANT ? ANT.indisponivel : '';
    p.render([]);
    return;
  }
  const ref = mesReferencia();
  p2.textContent = `Pedidos do Geral por equipe: ${rotuloMes(ref.mm, ref.yyyy)} × ${ANT.rotulo} até o dia ${ANT.ate} (por data de ${ANT.porData}).`;
  const mapAnt = new Map(ANT.agg.porEquipe.map(e => [e.nome, e.GERAL]));
  const nomes = new Set([...AGG.porEquipe.map(e => e.nome), ...mapAnt.keys()]);
  const mapAtual = new Map(AGG.porEquipe.map(e => [e.nome, e]));
  const linhas = [...nomes].map(nome => {
    const at = mapAtual.get(nome), atual = at ? at.GERAL : 0, ant = mapAnt.get(nome) || 0;
    const info = at || ANT.agg.porEquipe.find(e => e.nome === nome);
    return { nome, gestor: info.gestor, uf: info.uf, atual, ant, dif: atual - ant, pct: ant ? ((atual - ant) / ant) * 100 : null };
  });
  p.render(linhas);
}

// Resultados da busca por CNPJ/razão social (como no Gerencial atual)
function desenharBusca() {
  const slot = $('#slot-busca');
  const q = (S.filtros.busca || '').trim();
  if (!q) { slot.innerHTML = ''; return; }
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
  partes.push(`${NOME_SISTEMA} · fase 1 (Gerencial). As demais abas abrem o Dash atual.`);
  el.textContent = partes.join('  ·  ');
}

// ── início ──────────────────────────────────────────────────────────────────
async function iniciar() {
  const acesso = await exigirAdminBeta();
  if (!acesso) return;                     // já redirecionou para o Dash atual
  S.acesso = acesso;
  S.escopo = getEscopoTravado(acesso.perfil);
  montarCasca(); ligarCasca(); montarFiltros(); criarPaineis();
  ESTEIRA = criarEsteira($('#visao-esteira'), {
    receita: () => S.receita, setReceita: aplicarReceita,
    filtrarConsultor: nome => { S.filtros.consultores = [nome]; aoMudarFiltro(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    filtrarEquipe: eq => { S.filtros.equipes = [eq]; S.filtros.consultores = []; aoMudarFiltro(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  });
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
