// Visão "Painel Analítico" do Beta2 = a aba Painel Analítico do Dash atual:
// histórico mês a mês (até 13 meses), mix por grupo, cortes por Estado/DDD/Cidade/
// Equipe/Vendedor e métricas Quantidade/Receita/CNPJs/Ticket. Extração em CSV.
//
// Regras copiadas de index.html (PAINEL ANALÍTICO ~5513-6050): pnCompactar (registro
// enxuto por linha), pnAgregar, pnPassa, pnRenderBarras/Rosca/Linhas, pnExportarCsv.
// Recorte (decisão de 06/11): fica só o que NÃO existe no resto do Beta2 — evolução mês a mês e
// cortes geográficos (Estado, DDD, Cidade). "Quantidade por Grupo" e cortes por Equipe/Vendedor
// foram retirados por repetirem o Gerencial (cartões e consultores) e a Produção (equipe).
// Diferenças deliberadas:
//  - filtros globais da barra (Status, UF, Gestor, Equipe, Consultor, Tag) valem aqui; o
//    filtro de data de cadastro e a busca não (o registro compacto não guarda esses campos);
//  - a métrica COMISSÃO ainda não foi migrada (depende dos fatores do Simulador 2.0; vem
//    junto com o Gerencial Financeiro);
//  - Claro Monitor duplicado é detectado por mês (o Dash atual usa um valor global).
// Os meses são lidos aba a aba, reduzidos a registros compactos e as linhas cruas são
// descartadas (o histórico em memória fica leve).

import {
  filasPermitidas, getGrupoKey, detectarMonitorDuplicado, receitaLinha, subgrupoDaFila, MESES_ABREV,
} from './nucleo.js';
import { EQUIPES_ESTADOS, EQUIPES_GESTORES } from './equipes.js';
import { MAPEAMENTO_TAGS } from './regras.js';
import { esc, icone, fmtInt, fmtMoeda, fmtMoedaCurta, criarMultiSelect, prefs } from './ui.js';
import { criarMultivisao } from './multivisao.js';
import { montarResponsivo, linhasMensais } from './graficos.js';
import { MAPA_VIEWBOX, MAPA_UF } from './mapa-uf.js';
import { abaEmCache, buscarAbaSemCache } from './dados.js';

const MESES_INICIAIS = 13;   // mês corrente + 12 anteriores; o resto sob demanda
const GRUPOS = ['GROSS', 'RENOVAÇÃO', 'BL', 'TITULARIDADE', 'SERV. DIGITAIS'];
const ROTULO = { GROSS: 'Gross', 'RENOVAÇÃO': 'Renovação', BL: 'BL (Fixa Básica)', TITULARIDADE: 'Titularidade', 'SERV. DIGITAIS': 'Serv. Digitais', TOTAL: 'Total' };
const FORA_DO_TOTAL = ['SERV. DIGITAIS'];       // Serv. Digitais não soma no total (como no Gerencial)
const COR = { TOTAL: '#C0281C', GROSS: '#111111', 'RENOVAÇÃO': '#8E1B12', BL: '#D6D6D6', TITULARIDADE: '#E2B100', 'SERV. DIGITAIS': '#7C4DCC' };
const METRICAS = [['quantidade', 'Quantidade'], ['receita', 'Receita'], ['cnpjs', 'CNPJs'], ['ticket', 'Ticket médio']];
const DIMS = [['estado', 'Estado'], ['ddd', 'DDD'], ['cidade', 'Cidade']];
// Contorno das UFs: beta/mapa-uf.js (malha do IBGE, gerado por script).
const NOME_UF = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
// o que o mapa mostra: campo do registro, rótulo e a "contraparte" (para ver origem × cliente)
const MODOS_MAPA = {
  origem: { campo: 'uf', rotulo: 'Origem da venda', dica: 'UF da operação (onde fica a equipe que vendeu)', contra: 'es', contraRotulo: 'Onde estão os clientes' },
  instalacao: { campo: 'ub', rotulo: 'Instalação (BL)', dica: 'UF BL: coluna UF da base (UF de instalação)', contra: 'uf', contraRotulo: 'De onde saiu a venda' },
  cliente: { campo: 'es', rotulo: 'Cliente', dica: 'UF do cliente (coluna Estado da base)', contra: 'uf', contraRotulo: 'De onde saiu a venda' },
};
const COLUNAS_CIDADE = ['CIDADE', 'MUNICIPIO', 'MUNICÍPIO', 'DSC_MUNICIPIO', 'CIDADE CLIENTE'];

// ── registro compacto de um mês ─────────────────────────────────────────────
function compactar(rows, chave) {
  const monitorDup = detectarMonitorDuplicado(rows);
  const colCidade = rows.length ? COLUNAS_CIDADE.find(c => c in rows[0]) || null : null;
  const out = [];
  for (const r of rows) {
    const g = getGrupoKey(r['GRUPO'], r['PRODUTO'], r['SOLICITACAO'], monitorDup);
    if (!g) continue;
    const eq = r['EQUIPE'] || '';
    const num = (r['NUMERO'] || r['Numero'] || r['NÚMERO'] || '').toString().replace(/\D/g, '');
    const fila = r['FILA'] || '';
    out.push({
      m: chave, eq, uf: EQUIPES_ESTADOS[eq] || '',
      es: (r['Estado'] || r['ESTADO'] || '').trim().toUpperCase(),
      ub: (r['UF'] || '').trim().toUpperCase(),
      dd: num.length >= 2 ? num.substring(0, 2) : '',
      ci: colCidade ? (r[colCidade] || '').trim() : '',
      ve: r['PROPRIETÁRIO DO PEDIDO'] || 'Sem Consultor',
      tg: MAPEAMENTO_TAGS[r['TAGS ATIVIDADE'] || ''] || 'Sem Tag',
      ge: EQUIPES_GESTORES[eq] || '',
      fl: fila, sg: subgrupoDaFila(fila),
      g, q: parseInt(r['QUANTIDADE']) || 1, r: receitaLinha(r),
      cn: (r['CPF/CNPJ'] || '').replace(/\D/g, ''),
    });
  }
  return out;
}

const acc = () => ({ q: 0, r: 0, cn: new Set() });
const soma = (a, r) => { a.q += r.q; a.r += r.r; if (r.cn) a.cn.add(r.cn); };
function valor(a, metrica) {
  if (!a) return 0;
  switch (metrica) { case 'receita': return a.r; case 'cnpjs': return a.cn.size; case 'ticket': return a.q ? a.r / a.q : 0; default: return a.q; }
}
const ehMoeda = m => m === 'receita' || m === 'ticket';
const fmtMetrica = (v, m, compacto) => (ehMoeda(m) ? (compacto ? fmtMoedaCurta(v) : fmtMoeda(v)) : fmtInt(v));
const dimValor = (r, dim) => dim === 'ddd' ? (r.dd || '—') : dim === 'cidade' ? (r.ci || '—') : (r.es || r.uf || '—');

// ctx() => { f (filtros globais), escopoFn(r)->bool, meses:[{chave,sheet,yyyy,mm,label}], reusar(sheet)->Promise<linhas>|null }
export function criarPainel(host, ctx) {
  const st = {
    dados: {},              // chave 'YYYY-MM' -> registros compactos
    erros: {}, pendentes: 0, iniciou: false, atualizadoEm: null,
    metrica: prefs.get('painel_metrica', 'quantidade'), dim: prefs.get('painel_dim', 'estado'),
    seriesOff: new Set(), visaoMes: prefs.get('painel_visao_mes', 'grafico'),
    selMeses: [], selGrupos: [], selEstados: [],
    mapaModo: prefs.get('painel_mapa', 'origem'), ufSel: null,
  };
  if (!METRICAS.some(m => m[0] === st.metrica)) st.metrica = 'quantidade';
  if (!DIMS.some(d => d[0] === st.dim)) st.dim = 'estado';
  if (!MODOS_MAPA[st.mapaModo]) st.mapaModo = 'origem';

  host.innerHTML = `
    <section class="painel prod-ctl-painel">
      <div class="prod-ctl">
        <div id="pn-meses"></div><div id="pn-grupos"></div><div id="pn-estados"></div>
        <span class="pn-prog" id="pn-prog"></span>
        <span class="pn-acoes">
          <button type="button" class="btn btn-fantasma" id="pn-csv" title="Baixa em CSV a série mês × grupo com os filtros atuais">Extração (CSV)</button>
          <button type="button" class="btn btn-fantasma" id="pn-recarregar" title="Baixa de novo todos os meses">${icone('refresh', 16)}<span>Recarregar</span></button>
        </span>
      </div>
      <div class="prod-dica" id="pn-nota"></div>
    </section>
    <section class="painel" id="pn-mapa">
      <header class="painel-cab"><div class="painel-tit"><h2>Mapa do Brasil</h2><p id="pn-mapa-sub"></p></div>
        <div class="painel-ctl">
          <div class="seg" role="group" aria-label="O que mostrar no mapa" id="pn-mapa-modo">${Object.entries(MODOS_MAPA).map(([k, m]) => `<button type="button" class="seg-btn" data-mm="${k}" title="${esc(m.dica)}"><span>${m.rotulo}</span></button>`).join('')}</div>
          <div class="seg" role="group" aria-label="Métrica do mapa">${METRICAS.map(([k, r]) => `<button type="button" class="seg-btn" data-met="${k}"><span>${r}</span></button>`).join('')}</div>
        </div></header>
      <div class="painel-corpo">
        <div class="mapa-wrap"><div class="mapa" id="pn-mapa-grade" role="group" aria-label="Mapa do Brasil por UF"></div><aside class="mapa-det" id="pn-mapa-det" aria-live="polite"></aside></div>
        <div class="mapa-leg" id="pn-mapa-leg"></div>
      </div>
    </section>
    <section class="painel" id="pn-mes">
      <header class="painel-cab"><div class="painel-tit"><h2 id="pn-mes-tit"></h2><p id="pn-mes-sub"></p></div>
        <div class="painel-ctl">
          <div class="seg" role="group" aria-label="Métrica" id="pn-metricas">${METRICAS.map(([k, r]) => `<button type="button" class="seg-btn" data-met="${k}"><span>${r}</span></button>`).join('')}</div>
          <div class="seg" role="group" aria-label="Forma de exibição" id="pn-vis-mes">
            <button type="button" class="seg-btn" data-vm="grafico" title="Gráfico" aria-label="Gráfico">${icone('chart', 16)}<span>Gráfico</span></button>
            <button type="button" class="seg-btn" data-vm="tabela" title="Tabela" aria-label="Tabela">${icone('table', 16)}<span>Tabela</span></button>
            <button type="button" class="seg-btn" data-vm="cartoes" title="Cartões" aria-label="Cartões">${icone('cards', 16)}<span>Cartões</span></button></div>
        </div></header>
      <div class="painel-corpo" id="pn-mes-corpo"></div>
    </section>
    <div id="pn-topo" class="pn-topo"></div>`;
  const $ = s => host.querySelector(s);

  // ── filtros próprios (Meses, Tipo, Estado do cliente) ──────────────────────
  const msMeses = criarMultiSelect({ rotulo: 'Mês', onChange: v => { st.selMeses = v; render(); } });
  const msGrupos = criarMultiSelect({ rotulo: 'Tipo', onChange: v => { st.selGrupos = v; render(); } });
  const msEstados = criarMultiSelect({ rotulo: 'Estado (cliente)', onChange: v => { st.selEstados = v; render(); } });
  $('#pn-meses').replaceWith(msMeses.el); $('#pn-grupos').replaceWith(msGrupos.el); $('#pn-estados').replaceWith(msEstados.el);

  // ── painéis multivisão: por dimensão e por grupo ───────────────────────────
  const cols = () => [
    { k: 'q', rotulo: 'Quantidade', num: true, valor: l => l.q, fmt: v => fmtInt(v) },
    { k: 'r', rotulo: 'Receita', num: true, valor: l => l.r, fmt: v => fmtMoeda(v) },
    { k: 'c', rotulo: 'CNPJs', num: true, valor: l => l.c, fmt: v => fmtInt(v) },
    { k: 't', rotulo: 'Ticket médio', num: true, valor: l => l.t, fmt: v => fmtMoeda(v) },
  ];
  const pDim = criarMultivisao({
    id: 'painel_dim', titulo: 'Cortes geográficos', visaoPadrao: 'grafico', nome: l => l.nome,
    colunas: () => [{ k: 'nome', rotulo: DIMS.find(d => d[0] === st.dim)[1], valor: l => l.nome }, ...cols()],
    ordemInicial: 'q', metricaInicial: 'q', destaque: 'q', limite: 40,
  });
  const segDim = document.createElement('div'); segDim.className = 'seg'; segDim.setAttribute('role', 'group'); segDim.setAttribute('aria-label', 'Cortar por');
  segDim.innerHTML = DIMS.map(([k, r]) => `<button type="button" class="seg-btn" data-dim="${k}"><span>${r}</span></button>`).join('');
  pDim.slotExtra.append(segDim);

  $('#pn-topo').append(pDim.el);

  // ── eventos ────────────────────────────────────────────────────────────────
  pDim.slotExtra.addEventListener('click', e => { const b = e.target.closest('[data-dim]'); if (b) { st.dim = b.dataset.dim; prefs.set('painel_dim', st.dim); render(); } });
  host.addEventListener('click', e => {
    const m = e.target.closest('[data-met]'); if (m) { st.metrica = m.dataset.met; prefs.set('painel_metrica', st.metrica); return render(); }
    const v = e.target.closest('[data-vm]'); if (v) { st.visaoMes = v.dataset.vm; prefs.set('painel_visao_mes', st.visaoMes); return render(); }
    const mm = e.target.closest('[data-mm]'); if (mm) { st.mapaModo = mm.dataset.mm; prefs.set('painel_mapa', st.mapaModo); st.ufSel = null; return render(); }
    const uf = e.target.closest('[data-uf]'); if (uf) { st.ufSel = st.ufSel === uf.dataset.uf ? null : uf.dataset.uf; return render(); }
    const fx = e.target.closest('[data-mapa-filtro]');
    if (fx) { const acao = fx.dataset.mapaFiltro, u = st.ufSel; if (acao === 'cliente') { st.selEstados = [u]; render(); } else if (acao === 'global') ctx().filtrarUf(u); else if (acao === 'limpar') { st.ufSel = null; render(); } return; }
    const s = e.target.closest('[data-serie]');
    if (s) { const k = s.dataset.serie; st.seriesOff.has(k) ? st.seriesOff.delete(k) : st.seriesOff.add(k); render(); }
  });
  host.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.uf-forma')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
  $('#pn-csv').addEventListener('click', exportarCsv);
  $('#pn-recarregar').addEventListener('click', () => recarregar());

  // ── carga ──────────────────────────────────────────────────────────────────
  async function carregarMes(m) {
    const emCache = abaEmCache(m.sheet) || ctx().reusar(m.sheet);
    const linhas = emCache ? await emCache : await buscarAbaSemCache(m.sheet);
    return compactar(linhas, m.chave);
  }
  async function carregarLista(lista) {
    const fila = lista.filter(m => !st.dados[m.chave]).reverse();   // mais recentes primeiro
    st.pendentes += fila.length; desenharProgresso();
    const worker = async () => {
      while (fila.length) {
        const m = fila.shift();
        try { st.dados[m.chave] = await carregarMes(m); delete st.erros[m.chave]; st.atualizadoEm = new Date(); }
        catch (e) { st.erros[m.chave] = e.message; }
        st.pendentes--; render();
      }
    };
    await Promise.all([worker(), worker()]);
    desenharProgresso();
  }
  function recarregar() {
    if (st.pendentes > 0) return;
    st.dados = {}; st.erros = {};
    carregarLista(ctx().meses.slice(-MESES_INICIAIS));
  }
  function desenharProgresso() {
    const el = $('#pn-prog'); if (!el) return;
    const meses = ctx().meses, faltam = meses.filter(m => !st.dados[m.chave]).length, erros = Object.keys(st.erros);
    el.innerHTML = st.pendentes > 0
      ? `<span class="spinner"></span> Carregando histórico… ${st.pendentes} mês(es) restante(s)`
      : (faltam > 0 ? `<button type="button" class="lnk" data-mais>Carregar ${faltam} mês(es) mais antigo(s)</button>` : '')
        + (erros.length ? ` <span class="txt-aviso">⚠ ${erros.length} mês(es) com erro: ${esc(erros.join(', '))}</span>` : '')
        + (st.atualizadoEm && !faltam && !erros.length ? `<span class="prod-dica">Atualizado: ${st.atualizadoEm.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${st.atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>` : '');
    const mais = el.querySelector('[data-mais]'); if (mais) mais.addEventListener('click', () => carregarLista(ctx().meses));
  }

  // ── filtro e agregação ─────────────────────────────────────────────────────
  function passa(r, c, f, ign) {
    if (!c.escopoOk(r)) return false;
    if (f.uf !== 'Todos' && r.uf !== f.uf) return false;
    if (f.gestores.length && !f.gestores.includes(r.ge)) return false;
    if (f.equipes.length && !f.equipes.includes(r.eq)) return false;
    if (f.consultores.length && !f.consultores.some(x => x.toUpperCase() === r.ve.toUpperCase())) return false;
    if (f.tag !== 'Todas' && r.tg !== (MAPEAMENTO_TAGS[f.tag] || 'Sem Tag')) return false;
    const permitidas = filasPermitidas(f); if (permitidas && !permitidas.has(r.fl || 'Sem Status')) return false;
    if (ign !== 'grupo' && st.selGrupos.length && !st.selGrupos.includes(ROTULO[r.g])) return false;
    if (ign !== 'estado' && st.selEstados.length && !st.selEstados.includes(r.es)) return false;
    return true;
  }
  function agregar() {
    const c = ctx(), f = c.f;
    const meses = c.meses.filter(m => st.dados[m.chave] && (!st.selMeses.length || st.selMeses.includes(m.label)));
    const porMes = {}, porGrupo = {}, porDim = new Map(), total = acc();
    meses.forEach(m => { porMes[m.chave] = { TOTAL: acc() }; GRUPOS.forEach(g => { porMes[m.chave][g] = acc(); }); });
    GRUPOS.forEach(g => { porGrupo[g] = acc(); });
    let registros = 0;
    for (const m of meses) for (const r of st.dados[m.chave]) {
      if (!passa(r, c, f)) continue;
      registros++;
      soma(porMes[m.chave][r.g], r); soma(porGrupo[r.g], r);
      if (FORA_DO_TOTAL.includes(r.g)) continue;
      soma(porMes[m.chave].TOTAL, r); soma(total, r);
      const k = dimValor(r, st.dim); let a = porDim.get(k); if (!a) { a = acc(); porDim.set(k, a); } soma(a, r);
    }
    return { meses, porMes, porGrupo, porDim, total, registros };
  }
  function opcoes() {
    const c = ctx(), f = c.f;
    const meses = new Set(), grupos = new Set(), estados = new Set();
    for (const m of c.meses) {
      if (!st.dados[m.chave]) continue;
      for (const r of st.dados[m.chave]) {
        if (passa(r, c, f, 'grupo')) grupos.add(ROTULO[r.g]);
        if (passa(r, c, f, 'estado') && r.es) estados.add(r.es);
        if (passa(r, c, f)) meses.add(m.label);
      }
    }
    const ordemMes = c.meses.slice().reverse().map(m => m.label).filter(l => meses.has(l));
    msMeses.atualizar(ordemMes, st.selMeses);
    msGrupos.atualizar(GRUPOS.map(g => ROTULO[g]).filter(l => grupos.has(l)), st.selGrupos);
    msEstados.atualizar([...estados].sort((a, b) => a.localeCompare(b, 'pt-BR')), st.selEstados);
  }

  // ── desenho ────────────────────────────────────────────────────────────────
  const linhaDe = (nome, a, extra = {}) => ({ nome, q: a.q, r: a.r, c: a.cn.size, t: a.q ? a.r / a.q : 0, ...extra });
  let desmontaLinhas = null;
  function render() {
    if (!st.iniciou) return;
    const c = ctx();
    opcoes();
    const agg = agregar();
    desenharProgresso();
    $('#pn-nota').textContent = 'Filtros da barra de cima (Status, UF, Gestor, Equipe, Consultor, Tag) valem aqui; data de cadastro e busca não. Comissão chega junto com o Gerencial Financeiro.';

    // por dimensão
    const dimNome = DIMS.find(d => d[0] === st.dim)[1];
    pDim.el.querySelector('.painel-tit h2').textContent = `Por ${dimNome}`;
    pDim.slotExtra.querySelectorAll('[data-dim]').forEach(b => { const on = b.dataset.dim === st.dim; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
    pDim.render([...agg.porDim.entries()].filter(([, a]) => a.q > 0).map(([k, a]) => linhaDe(k, a, { chave: k })));

    desenharMapa();

    // por mês
    const m = st.metrica, nomeM = METRICAS.find(x => x[0] === m)[1];
    $('#pn-mes-tit').textContent = `${nomeM} por Mês`;
    $('#pn-mes-sub').textContent = `${agg.meses.length} mês(es) · ${fmtInt(agg.registros)} registros`;
    host.querySelectorAll('[data-met]').forEach(b => { const on = b.dataset.met === m; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
    host.querySelectorAll('#pn-vis-mes [data-vm]').forEach(b => { const on = b.dataset.vm === st.visaoMes; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
    desenharMeses(agg, m, nomeM);
  }

  // ── mapa ───────────────────────────────────────────────────────────────────
  function agregarMapa(modo) {
    const c = ctx(), f = c.f, cfg = MODOS_MAPA[modo];
    const meses = c.meses.filter(m => st.dados[m.chave] && (!st.selMeses.length || st.selMeses.includes(m.label)));
    const porUf = new Map(), total = acc(), det = { eq: new Map(), loc: new Map(), contra: new Map(), total: acc() };
    const add = (mapa, k) => { let a = mapa.get(k); if (!a) { a = acc(); mapa.set(k, a); } return a; };
    for (const m of meses) for (const r of st.dados[m.chave]) {
      if (FORA_DO_TOTAL.includes(r.g) || !passa(r, c, f, 'estado')) continue;      // o filtro de Estado não esconde o mapa
      const uf = r[cfg.campo]; if (!uf) continue;
      soma(add(porUf, uf), r); soma(total, r);
      if (uf === st.ufSel) {
        soma(det.total, r);
        soma(add(det.eq, r.eq || '—'), r);
        soma(add(det.loc, st.dim === 'cidade' && r.ci ? r.ci : (r.dd ? 'DDD ' + r.dd : '—')), r);
        soma(add(det.contra, r[cfg.contra] || '—'), r);
      }
    }
    return { porUf, total, det, meses };
  }

  function desenharMapa() {
    const modo = st.mapaModo, cfg = MODOS_MAPA[modo], m = st.metrica;
    const ag = agregarMapa(modo);
    host.querySelectorAll('#pn-mapa-modo [data-mm]').forEach(b => { const on = b.dataset.mm === modo; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
    $('#pn-mapa-sub').textContent = `${cfg.dica} · ${METRICAS.find(x => x[0] === m)[1]} · ${ag.meses.length} mês(es)`;
    const valores = [...ag.porUf.entries()].map(([k, a]) => [k, valor(a, m)]);
    const max = Math.max(1, ...valores.map(([, v]) => v));
    const vmap = new Map(valores);
    const fora = valores.filter(([k, v]) => v > 0 && !MAPA_UF[k]);          // UF fora da lista (dado sujo) fica numa nota
    const [, , vw, vh] = MAPA_VIEWBOX;
    const corDe = v => (v > 0 ? 0.14 + 0.86 * (v / max) : 0);
    const ufs = Object.keys(MAPA_UF);
    const ordem = [...ufs.filter(u => u !== st.ufSel), ...ufs.filter(u => u === st.ufSel)];      // selecionada por cima
    const formas = ordem.map(uf => {
      const info = MAPA_UF[uf], v = vmap.get(uf) || 0, i = corDe(v);
      const fill = v > 0 ? `rgba(185,28,28,${i.toFixed(2)})` : 'var(--cinza-100)';
      return `<path class="uf-forma${uf === st.ufSel ? ' uf-sel' : ''}" data-uf="${uf}" d="${info.d}" style="fill:${fill}" tabindex="0" role="button" aria-pressed="${uf === st.ufSel}" aria-label="${esc(NOME_UF[uf])}: ${esc(fmtMetrica(v, m))}"><title>${esc(NOME_UF[uf])}: ${esc(fmtMetrica(v, m))}</title></path>`;
    }).join('');
    // rótulos: dentro do estado quando cabe; os pequenos do litoral saem para a direita com uma linha guia
    const LITORAL = ['RN', 'PB', 'PE', 'AL', 'SE'], FORA = ['ES', 'RJ'];
    const ne = LITORAL.map(u => ({ u, cy: MAPA_UF[u].cy, mx: MAPA_UF[u].mx, cx: MAPA_UF[u].cx })).sort((a, b) => a.cy - b.cy);
    let ult = -99; ne.forEach(o => { o.ly = Math.max(o.cy, ult + 15); ult = o.ly; });
    const colX = vw - 64;
    const txtCor = (uf) => { const v = vmap.get(uf) || 0; return corDe(v) > 0.5 ? '#fff' : 'var(--texto)'; };
    const rotDentro = ufs.filter(u => !LITORAL.includes(u) && !FORA.includes(u)).map(uf => {
      const info = MAPA_UF[uf], v = vmap.get(uf) || 0, grande = info.a >= 1500;
      return `<g class="uf-rot-g" style="fill:${txtCor(uf)}"><text class="uf-rot${info.a < 300 ? ' uf-rot-p' : ''}" x="${info.cx}" y="${info.cy + (grande && v > 0 ? -1 : 3)}" text-anchor="middle">${uf}</text>${grande && v > 0 ? `<text class="uf-val" x="${info.cx}" y="${info.cy + 10}" text-anchor="middle">${esc(fmtMetrica(v, m, true))}</text>` : ''}</g>`;
    }).join('');
    const chamada = (uf, x, y, mx, cy) => {
      const v = vmap.get(uf) || 0;
      return `<g class="uf-cham"><line x1="${mx - 2}" y1="${cy}" x2="${x - 3}" y2="${y - 3}"/><text x="${x}" y="${y}" class="uf-cham-t"><tspan class="uf-cham-u">${uf}</tspan>${v > 0 ? `<tspan class="uf-cham-v" dx="4">${esc(fmtMetrica(v, m, true))}</tspan>` : ''}</text></g>`;
    };
    const rotFora = ne.map(o => chamada(o.u, colX, o.ly + 3, o.mx, o.cy)).join('')
      + FORA.map(u => chamada(u, MAPA_UF[u].mx + 14, MAPA_UF[u].cy + 3, MAPA_UF[u].mx, MAPA_UF[u].cy)).join('');
    $('#pn-mapa-grade').innerHTML = `<svg class="mapa-svg" viewBox="0 0 ${vw} ${vh}" role="group" aria-label="Mapa do Brasil por UF">${formas}${rotDentro}${rotFora}</svg>`;
    $('#pn-mapa-leg').innerHTML = `<span>menos</span><i class="mapa-leg-barra"></i><span>mais</span>` +
      (fora.length ? `<span class="prod-dica">Sem UF reconhecida no mapa: ${fora.map(([k, v]) => `${esc(k)} (${esc(fmtMetrica(v, m, true))})`).join(', ')}</span>` : '');

    // detalhe da UF clicada
    const det = $('#pn-mapa-det');
    if (!st.ufSel) {
      const rank = valores.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
      det.innerHTML = `<div class="mapa-dica"><b>Clique numa UF</b><span>para ver o resumo, as equipes e ${esc(cfg.contraRotulo.toLowerCase())}.</span></div>`
        + (rank.length ? `<h4>Maiores UFs · ${esc(METRICAS.find(x => x[0] === m)[1])}</h4><ol class="mapa-rank">${rank.map(([k, v]) => `<li><button type="button" data-uf="${k}"><span class="rk-uf">${k}</span><span class="rk-nome">${esc(NOME_UF[k] || k)}</span><i class="rk-barra"><b style="width:${Math.max(3, (v / max) * 100).toFixed(1)}%"></b></i><span class="rk-val">${esc(fmtMetrica(v, m, true))}</span></button></li>`).join('')}</ol>` : '');
      return;
    }
    const a = ag.det.total, u = st.ufSel;
    const top = (mapa, n = 5) => [...mapa.entries()].map(([k, x]) => [k, valor(x, m)]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, n);
    const lista = itens => itens.length ? `<ul class="mapa-lista">${itens.map(([k, v]) => `<li><span>${esc(k)}</span><b>${esc(fmtMetrica(v, m, true))}</b></li>`).join('')}</ul>` : '<div class="prod-dica">Sem dados.</div>';
    det.innerHTML = `
      <div class="mapa-det-tit"><h3>${esc(NOME_UF[u] || u)} <small>${u}</small></h3><button type="button" class="btn-icone" data-mapa-filtro="limpar" aria-label="Fechar detalhe">${icone('close', 16)}</button></div>
      <div class="mapa-kpis"><div><small>Quantidade</small><b>${fmtInt(a.q)}</b></div><div><small>Receita</small><b>${esc(fmtMoedaCurta(a.r))}</b></div><div><small>CNPJs</small><b>${fmtInt(a.cn.size)}</b></div><div><small>Ticket médio</small><b>${esc(fmtMoeda(a.q ? a.r / a.q : 0))}</b></div></div>
      <h4>${esc(cfg.contraRotulo)}</h4>${lista(top(ag.det.contra, 6))}
      <h4>Principais equipes</h4>${lista(top(ag.det.eq))}
      <h4>${st.dim === 'cidade' ? 'Principais cidades' : 'Principais DDDs'}</h4>${lista(top(ag.det.loc))}
      <div class="mapa-acoes">${modo === 'cliente' ? `<button type="button" class="btn btn-marca" data-mapa-filtro="cliente">Filtrar o histórico por esta UF</button>` : `<button type="button" class="btn btn-marca" data-mapa-filtro="global">Filtrar tudo por esta UF</button>`}</div>`;
  }

  function desenharMeses(agg, m, nomeM) {
    const corpo = $('#pn-mes-corpo');
    if (desmontaLinhas) { desmontaLinhas(); desmontaLinhas = null; }
    if (!agg.meses.length) { corpo.innerHTML = `<div class="vazio">${st.pendentes ? '<span class="spinner"></span> Carregando meses…' : 'Nenhum mês para os filtros selecionados.'}</div>`; return; }
    const chaves = ['TOTAL', ...GRUPOS];
    const val = (mes, k) => valor(agg.porMes[mes.chave][k], m);
    if (st.visaoMes === 'grafico') {
      const legenda = chaves.map(k => `<button type="button" class="leg-btn${st.seriesOff.has(k) ? ' off' : ''}" data-serie="${k}"><span class="ponto" style="background:${COR[k]}"></span>${ROTULO[k]}</button>`).join('');
      corpo.innerHTML = `<div class="leg-linha">${legenda}</div><div class="graf-host" id="pn-linhas"></div>`;
      const series = chaves.filter(k => !st.seriesOff.has(k)).map(k => ({ k, rotulo: ROTULO[k], cor: COR[k], destaque: k === 'TOTAL', valores: agg.meses.map(x => val(x, k)) }));
      const fmt = v => fmtMetrica(v, m, true);
      desmontaLinhas = montarResponsivo(corpo.querySelector('#pn-linhas'), w => linhasMensais({ meses: agg.meses, series, largura: w, fmt, altura: w < 480 ? 230 : 270 }));
    } else if (st.visaoMes === 'tabela') {
      const ord = agg.meses.slice().reverse();
      corpo.innerHTML = `<div class="tab-wrap"><table class="tab"><thead><tr><th>Mês</th>${chaves.map(k => `<th class="num">${ROTULO[k]}</th>`).join('')}</tr></thead>
        <tbody>${ord.map(x => `<tr><td class="cel-nome">${esc(x.label)}</td>${chaves.map(k => `<td class="num${k === 'TOTAL' ? ' tot' : ''}">${esc(fmtMetrica(val(x, k), m))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } else {
      const ord = agg.meses.slice().reverse();
      corpo.innerHTML = `<div class="cartoes">${ord.map(x => `<article class="cartao"><div class="cartao-topo"><div class="cartao-nome">${esc(x.label)}</div>
        <div class="cartao-destaque"><b>${esc(fmtMetrica(val(x, 'TOTAL'), m, true))}</b><small>Total · ${esc(nomeM)}</small></div></div>
        <dl class="cartao-campos">${GRUPOS.map(g => `<div><dt>${ROTULO[g]}</dt><dd>${esc(fmtMetrica(val(x, g), m, true))}</dd></div>`).join('')}</dl></article>`).join('')}</div>`;
    }
  }

  function exportarCsv() {
    const agg = agregar();
    if (!agg.meses.length) { alert('Nenhum mês carregado ainda.'); return; }
    const cab = ['Mês', 'Grupo', 'Quantidade', 'Receita', 'CNPJs', 'Ticket médio'];
    const linhas = [];
    agg.meses.forEach(m => ['TOTAL', ...GRUPOS].forEach(g => {
      const a = agg.porMes[m.chave][g];
      linhas.push([m.label, g === 'TOTAL' ? 'Total (sem Serv. Digitais)' : ROTULO[g], a.q, a.r.toFixed(2), a.cn.size, (a.q ? a.r / a.q : 0).toFixed(2)]);
    }));
    const e = v => '"' + String(v).replace(/"/g, '""') + '"';
    const csv = '﻿' + [cab, ...linhas].map(l => l.map(e).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const t = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '').replace(/(\d{8})(\d{4})/, '$1_$2');
    a.download = `painel_${t}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  }

  return {
    // chamado quando a visão aparece ou os filtros globais mudam
    mostrar() {
      const c = ctx(); if (!c.meses.length) return;
      if (!st.iniciou) { st.iniciou = true; carregarLista(c.meses.slice(-MESES_INICIAIS)); }
      render();
    },
    recarregar,
    reiniciar() { st.dados = {}; st.erros = {}; st.iniciou = false; },
  };
}
