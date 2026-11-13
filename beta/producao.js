// Visão "Produção" do Beta2 = a aba Produção do Dash atual: produção por Unidade
// (tag), Gestor ou Equipe × status de fila, com UF BL, UF Cliente, DDD, Grupo de
// Produto e comparativos MOM / TRI / Comparar meses.
//
// Regras copiadas de index.html (renderProducao ~7496, contarStatusPorTag ~6728,
// calcularComparativos ~6772, formatVariacao ~6840, apenasAtivoSelecionado ~6905).
// Diferenças deliberadas:
//  - o Status vem da barra global (não há chips próprios);
//  - UF BL lista TODAS as UFs da base + grupos RPS (PR+SC) e SUL (PR+RS+SC);
//  - Convergência NÃO foi migrada (decisão do Raphael); segue só no Dash atual.
// "Grupo de Produto: Geral" = 100% das linhas (sem a classificação do Gerencial).

import {
  filtrar, filasPermitidas, parseDataBR, diasNoMes, mesAnterior, nomeAba, MESES_ABREV,
  GRUPOS_UF, ufBlBate, subgrupoDaFila, ORDEM_SUBGRUPOS_FILA, receitaLinha, FILA_ATIVO,
} from './nucleo.js';
import { EQUIPES_ESTADOS, EQUIPES_GESTORES } from './equipes.js';
import { MAPEAMENTO_TAGS } from './regras.js';
import { esc, icone, fmtInt, fmtDec, fmtMoeda, criarMultiSelect, prefs } from './ui.js';
import { barrasHorizontais } from './graficos.js';

const GRUPO_VIRTUA = 'NET PJ - VIRTUA';
const STATUS_ELEGIVEIS = ['Ativo/Instalado', 'Aguardando Instalação'];
const SEM_TAG = 'Sem Tag';
const DIMS = [['unidade', 'Unidade'], ['gestor', 'Gestor'], ['equipe', 'Equipe']];

// ── campos de uma linha ─────────────────────────────────────────────────────
const ufBlDe = r => (r['UF'] || '').trim().toUpperCase();
const ufClienteDe = r => (r['Estado'] || r['ESTADO'] || '').trim().toUpperCase();
const dddDe = r => { const n = (r['NUMERO'] || r['Numero'] || r['NÚMERO'] || '').toString().replace(/\D/g, ''); return n.length >= 2 ? n.substring(0, 2) : ''; };
// Cidade de INSTALAÇÃO: coluna achada pelo NOME do cabeçalho (sem acento/caixa/pontuação). Mantenha igual
// a COLUNAS_CIDADE_INSTALACAO / cidadeInstalacaoDe do index.html.
const COLUNAS_CIDADE_INSTALACAO = ['CIDADE INSTALACAO', 'CIDADE DE INSTALACAO', 'MUNICIPIO INSTALACAO'];
const normCab = k => String(k).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
let colCidadeInstalacao = null;
export function cidadeInstalacaoDe(r) {
  if (!r) return '';
  if (!colCidadeInstalacao || !(colCidadeInstalacao in r)) {
    const achada = Object.keys(r).find(k => COLUNAS_CIDADE_INSTALACAO.includes(normCab(k)));
    if (!achada) return '';
    colCidadeInstalacao = achada;
  }
  return String(r[colCidadeInstalacao] || '').trim().toUpperCase();
}
const tagDe = r => { const t = r['TAGS ATIVIDADE'] || ''; return MAPEAMENTO_TAGS[t] ? t : SEM_TAG; };
const chaveDe = (r, dim) => dim === 'gestor' ? (EQUIPES_GESTORES[r['EQUIPE'] || ''] || 'Sem Gestor') : dim === 'equipe' ? (r['EQUIPE'] || 'Sem Equipe') : tagDe(r);
const nomeDe = (chave, dim) => dim === 'unidade' ? (MAPEAMENTO_TAGS[chave] || SEM_TAG) : chave;

// Filtros próprios da Produção (fp) sobre uma linha; `ignorar` = 'ufbl' | 'ufcliente' | 'ddd' | 'cidade' | 'grupo'
function passaProd(r, fp, ignorar) {
  if (ignorar !== 'ufbl' && !ufBlBate(fp.ufBl, ufBlDe(r))) return false;
  if (ignorar !== 'ufcliente' && fp.ufCliente.length && !fp.ufCliente.includes(ufClienteDe(r))) return false;
  if (ignorar !== 'ddd' && fp.ddd.length && !fp.ddd.includes(dddDe(r))) return false;
  if (ignorar !== 'cidade' && fp.cidade.length && !fp.cidade.includes(cidadeInstalacaoDe(r))) return false;
  if (ignorar !== 'grupo' && fp.grupo !== 'Geral' && (r['GRUPO'] || '') !== fp.grupo) return false;
  return true;
}

// MOM/TRI/meses só quando a seleção de status é um subconjunto de {Ativo/Instalado, Aguardando
// Instalação}; com Aguardando, só para o grupo NET PJ - VIRTUA (regra do Dash atual).
export function elegivelComparativo(f, grupo) {
  const s = filasPermitidas(f);
  if (!s || !s.size) return false;
  for (const x of s) if (!STATUS_ELEGIVEIS.includes(x)) return false;
  if (s.has('Aguardando Instalação') && grupo !== GRUPO_VIRTUA) return false;
  return true;
}

export function formatVariacao(atual, anterior) {
  if (!anterior) return { texto: '—', classe: 'var-nd' };
  const pct = ((atual - anterior) / anterior) * 100;
  if (Math.abs(pct) < 0.05) return { texto: '▬ 0,0%', classe: 'var-neu' };
  return { texto: `${pct > 0 ? '▲ +' : '▼ '}${fmtDec(pct, 1)}%`, classe: pct > 0 ? 'var-pos' : 'var-neg' };
}

// ── agregação atual ─────────────────────────────────────────────────────────
export function agregarProducao(rows, f, fp, dim, escopo) {
  const permitidas = filasPermitidas(f);
  const base = filtrar(rows, f, escopo).filter(r => (r['FILA'] || '') && passaProd(r, fp));
  const mapa = new Map();        // chave -> { fila -> {qtd, rec} }
  if (dim === 'unidade') {
    const tags = f.tag !== 'Todas' ? [tagDeRaw(f.tag)] : [...Object.keys(MAPEAMENTO_TAGS), SEM_TAG];
    tags.forEach(t => mapa.set(t, {}));
  }
  const filasPresentes = new Set();
  for (const r of base) {
    const fila = r['FILA'];
    const qtd = parseInt(r['QUANTIDADE']) || 1, rec = receitaLinha(r);
    const k = chaveDe(r, dim);
    let m = mapa.get(k); if (!m) { m = {}; mapa.set(k, m); }
    const c = m[fila] || (m[fila] = { qtd: 0, rec: 0 });
    c.qtd += qtd; c.rec += rec; filasPresentes.add(fila);
  }
  // colunas: filas selecionadas (ou todas as presentes) que têm dado, na ordem do processo
  const ordemSub = g => { const i = ORDEM_SUBGRUPOS_FILA.indexOf(g); return i < 0 ? 99 : i; };
  const selecionadas = permitidas ? [...permitidas] : [...filasPresentes];
  let cols = selecionadas.filter(s => [...mapa.values()].some(m => (m[s]?.qtd || 0) > 0));
  if (!cols.length) cols = selecionadas;
  cols.sort((a, b) => ordemSub(subgrupoDaFila(a)) - ordemSub(subgrupoDaFila(b)) || a.localeCompare(b, 'pt-BR'));

  const linhas = [...mapa.entries()].map(([chave, m]) => {
    const cells = cols.map(s => m[s] || { qtd: 0, rec: 0 });
    return { chave, nome: nomeDe(chave, dim), cells, totalQtd: cells.reduce((s, c) => s + c.qtd, 0), totalRec: cells.reduce((s, c) => s + c.rec, 0) };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return {
    cols, linhas, base,
    totaisCol: cols.map((_, i) => ({ qtd: linhas.reduce((s, l) => s + l.cells[i].qtd, 0), rec: linhas.reduce((s, l) => s + l.cells[i].rec, 0) })),
    totalQtd: linhas.reduce((s, l) => s + l.totalQtd, 0), totalRec: linhas.reduce((s, l) => s + l.totalRec, 0),
  };
}
// o filtro global de Tag guarda o código cru ('#6OV1'); a chave de unidade é o mesmo código (ou Sem Tag)
const tagDeRaw = raw => (MAPEAMENTO_TAGS[raw] ? raw : SEM_TAG);

// ── contagem de um mês anterior (MOM/TRI/Comparar meses) ────────────────────
// Aguardando Instalação na seleção → conta TODAS as linhas por CADASTRO ≤ corte (as abas antigas
// já evoluíram de status); só Ativo → fila Ativo/Instalado por DATA REF ≤ corte.
export function contarComparativo(rows, f, fp, statusSet, corte, dim, escopo) {
  const usarAguardando = statusSet.has('Aguardando Instalação');
  const base = filtrar(rows, f, escopo, ['status', 'data', 'busca']);
  const out = {};
  for (const r of base) {
    if (!passaProd(r, fp)) continue;
    const qtd = parseInt(r['QUANTIDADE']) || 1;
    const k = chaveDe(r, dim);
    if (usarAguardando) {
      const d = parseDataBR(r['CADASTRO']);
      if (d && d.getTime() <= corte.getTime()) out[k] = (out[k] || 0) + qtd;
    } else if ((r['FILA'] || '') === FILA_ATIVO) {
      const d = parseDataBR(r['DATA REF']);
      if (d && d.getTime() <= corte.getTime()) out[k] = (out[k] || 0) + qtd;
    }
  }
  return out;
}

// ── componente ──────────────────────────────────────────────────────────────
// ctx() => { rows, f, escopo, receita, ref:{mm,yyyy}, live, diaCorte, abas:[{mm,yyyy,nome}], carregarMes(nome) }
export function criarProducao(host, ctx) {
  const fp = { ufBl: 'Geral', ufCliente: [], ddd: [], cidade: [], grupo: 'Geral' };
  const st = {
    dim: prefs.get('prod_dim', 'unidade'), visao: prefs.get('prod_visao', window.matchMedia('(max-width: 640px)').matches ? 'cartoes' : 'tabela'),
    mom: false, tri: false, meses: new Set(), req: 0,
  };
  if (!DIMS.some(d => d[0] === st.dim)) st.dim = 'unidade';

  host.innerHTML = `
    <section class="painel prod-ctl-painel">
      <div class="prod-ctl">
        <div class="seg" role="group" aria-label="Agrupar por">${DIMS.map(([k, r]) => `<button type="button" class="seg-btn" data-pdim="${k}"><span>${r}</span></button>`).join('')}</div>
        <label class="chip chip-sel"><span>UF BL</span><select id="p-ufbl" aria-label="UF BL"></select></label>
        <div id="p-ufcli"></div><div id="p-ddd"></div><div id="p-cidade"></div>
        <label class="chip chip-sel"><span>Grupo de produto</span><select id="p-grupo" aria-label="Grupo de produto"></select></label>
      </div>
      <div class="prod-comp" id="p-comp"></div>
    </section>
    <div id="p-avisos"></div>
    <section class="painel">
      <header class="painel-cab"><div class="painel-tit"><h2 id="p-tit"></h2><p id="p-sub"></p></div>
        <div class="painel-ctl"><div class="seg" role="group" aria-label="Forma de exibição">
          <button type="button" class="seg-btn" data-pvis="tabela" title="Tabela" aria-label="Tabela">${icone('table', 16)}<span>Tabela</span></button>
          <button type="button" class="seg-btn" data-pvis="cartoes" title="Cartões" aria-label="Cartões">${icone('cards', 16)}<span>Cartões</span></button>
          <button type="button" class="seg-btn" data-pvis="grafico" title="Gráfico" aria-label="Gráfico">${icone('chart', 16)}<span>Gráfico</span></button></div></div></header>
      <div class="painel-corpo" id="p-corpo"></div>
    </section>`;
  const $ = s => host.querySelector(s);
  const msUfCli = criarMultiSelect({ rotulo: 'UF Cliente', onChange: v => { fp.ufCliente = v; render(); } });
  const msDdd = criarMultiSelect({ rotulo: 'DDD', onChange: v => { fp.ddd = v; render(); } });
  $('#p-ufcli').replaceWith(msUfCli.el); msUfCli.el.id = 'p-ufcli';
  $('#p-ddd').replaceWith(msDdd.el); msDdd.el.id = 'p-ddd';
  const msCidade = criarMultiSelect({ rotulo: 'Cidade', onChange: v => { fp.cidade = v; render(); } });
  $('#p-cidade').replaceWith(msCidade.el); msCidade.el.id = 'p-cidade';
  $('#p-ufbl').addEventListener('change', e => { fp.ufBl = e.target.value; render(); });
  $('#p-grupo').addEventListener('change', e => { fp.grupo = e.target.value; render(); });

  host.addEventListener('click', e => {
    const d = e.target.closest('[data-pdim]'); if (d) { st.dim = d.dataset.pdim; prefs.set('prod_dim', st.dim); return render(); }
    const v = e.target.closest('[data-pvis]'); if (v) { st.visao = v.dataset.pvis; prefs.set('prod_visao', st.visao); return render(); }
    const t = e.target.closest('[data-ptog]');
    if (t) { if (t.dataset.ptog === 'mom') st.mom = !st.mom; else st.tri = !st.tri; return render(); }
    const m = e.target.closest('[data-pmes]');
    if (m) { const k = m.dataset.pmes; st.meses.has(k) ? st.meses.delete(k) : st.meses.add(k); return render(); }
    if (e.target.closest('[data-pmes-todos]')) { ctx().abas.filter(a => !(a.mm === ctx().ref.mm && a.yyyy === ctx().ref.yyyy)).forEach(a => st.meses.add(`${a.mm}/${a.yyyy}`)); return render(); }
    if (e.target.closest('[data-pmes-limpar]')) { st.meses.clear(); render(); }
  });

  // opções dos filtros próprios, em cascata com os globais e entre si
  function atualizarOpcoes() {
    const { rows, f, escopo } = ctx();
    const base = filtrar(rows, f, escopo).filter(r => r['FILA']);
    const de = (ign, fn) => { const c = new Map(); base.filter(r => passaProd(r, fp, ign)).forEach(r => { const v = fn(r); if (v) c.set(v, (c.get(v) || 0) + 1); }); return c; };
    const ufbl = de('ufbl', ufBlDe), cli = de('ufcliente', ufClienteDe), ddd = de('ddd', dddDe), cid = de('cidade', cidadeInstalacaoDe), grp = de('grupo', r => r['GRUPO'] || '');
    const ufs = [...ufbl.keys()].sort();
    const itens = [['Geral', 'Geral']];
    Object.entries(GRUPOS_UF).forEach(([g, membros]) => { if (membros.filter(u => ufbl.has(u)).length >= 2) itens.push([g, `${g} (${membros.join(' + ')})`]); });
    ufs.forEach(u => itens.push([u, u]));
    if (!itens.some(([v]) => v === fp.ufBl)) itens.push([fp.ufBl, `${fp.ufBl} (sem registro)`]);
    $('#p-ufbl').innerHTML = itens.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    $('#p-ufbl').value = fp.ufBl;
    const gr = ['Geral', ...[...grp.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'))];
    if (!gr.includes(fp.grupo)) gr.push(fp.grupo);
    $('#p-grupo').innerHTML = gr.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    $('#p-grupo').value = fp.grupo;
    msUfCli.atualizar([...cli.keys()].sort(), fp.ufCliente);
    msDdd.atualizar([...ddd.keys()].sort(), fp.ddd);
    // sem coluna de cidade na base: esconde o filtro em vez de mostrar uma lista vazia
    msCidade.el.style.display = base.some(r => cidadeInstalacaoDe(r)) || fp.cidade.length ? '' : 'none';
    msCidade.atualizar([...cid.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR')), fp.cidade);
  }

  const rotuloMes = (mm, yyyy) => `${MESES_ABREV[+mm - 1]}/${yyyy}`;
  const corteDe = (mm, yyyy, dia) => new Date(+yyyy, +mm - 1, Math.min(dia, diasNoMes(mm, yyyy)), 23, 59, 59, 999);

  async function comparativos(c, agg, req) {
    const out = { mom: null, tri: null, triMeses: 0, meses: {}, avisos: [] };
    const f = c.f, statusSet = filasPermitidas(f);
    const abaDe = (mm, yyyy) => c.abas.find(a => a.mm === mm && a.yyyy === yyyy);
    const contar = async (mm, yyyy) => { const rows = await c.carregarMes(nomeAba(mm, yyyy)); return contarComparativo(rows, f, fp, statusSet, corteDe(mm, yyyy, c.diaCorte), st.dim, c.escopo); };
    if (st.mom) {
      const a = mesAnterior(c.ref.mm, c.ref.yyyy, 1);
      if (!abaDe(a.mm, a.yyyy)) out.avisos.push(`MOM: aba de ${a.mm}/${a.yyyy} não encontrada na planilha`);
      else try { out.mom = await contar(a.mm, a.yyyy); } catch (e) { out.avisos.push('MOM: erro ao buscar o mês anterior'); }
    }
    if (st.tri) {
      const soma = {}; let n = 0;
      for (let d = 1; d <= 3; d++) {
        const a = mesAnterior(c.ref.mm, c.ref.yyyy, d); if (!abaDe(a.mm, a.yyyy)) continue;
        try { const mp = await contar(a.mm, a.yyyy); Object.keys(mp).forEach(k => { soma[k] = (soma[k] || 0) + mp[k]; }); n++; } catch (e) { /* ignora o mês */ }
      }
      if (!n) out.avisos.push('TRI: nenhum mês do trimestre disponível na planilha');
      else { out.tri = Object.fromEntries(Object.keys(soma).map(k => [k, soma[k] / n])); out.triMeses = n; if (n < 3) out.avisos.push(`TRI: média calculada com ${n} de 3 meses disponíveis`); }
    }
    for (const chave of [...st.meses].sort((a, b) => { const [ma, ya] = a.split('/'), [mb, yb] = b.split('/'); return (ya + ma).localeCompare(yb + mb); })) {
      const [mm, yyyy] = chave.split('/');
      if (!abaDe(mm, yyyy)) { out.meses[chave] = { erro: `aba de ${mm}/${yyyy} não encontrada na planilha` }; out.avisos.push(out.meses[chave].erro); continue; }
      try { out.meses[chave] = { mapa: await contar(mm, yyyy) }; } catch (e) { out.meses[chave] = { erro: `erro ao buscar dados de ${mm}/${yyyy}` }; out.avisos.push(out.meses[chave].erro); }
    }
    return req === st.req ? out : null;
  }

  function desenharControles(c, elegivel) {
    host.querySelectorAll('[data-pdim]').forEach(b => { const on = b.dataset.pdim === st.dim; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
    host.querySelectorAll('[data-pvis]').forEach(b => { const on = b.dataset.pvis === st.visao; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
    const comp = $('#p-comp');
    if (!elegivel) {
      comp.innerHTML = `<span class="prod-dica">MOM, TRI e Comparar meses ficam disponíveis com Status = <b>Somente ativo</b> (ou Ativo + Aguardando Instalação, com o grupo NET PJ - VIRTUA).</span>`;
      return;
    }
    const outros = c.abas.filter(a => !(a.mm === c.ref.mm && a.yyyy === c.ref.yyyy));
    comp.innerHTML = `
      <span class="prod-comp-tit">Comparativo</span>
      <div class="seg" role="group" aria-label="Comparativo"><button type="button" class="seg-btn${st.mom ? ' ativo' : ''}" data-ptog="mom" aria-pressed="${st.mom}" title="Mês anterior, até o mesmo dia"><span>MOM</span></button>
        <button type="button" class="seg-btn${st.tri ? ' ativo' : ''}" data-ptog="tri" aria-pressed="${st.tri}" title="Média dos 3 meses anteriores, até o mesmo dia"><span>TRI</span></button></div>
      <details class="prod-meses"${st.meses.size ? ' open' : ''}><summary>Comparar meses${st.meses.size ? ` (${st.meses.size})` : ''}</summary>
        <div class="prod-meses-chips">${outros.map(a => { const k = `${a.mm}/${a.yyyy}`; return `<button type="button" class="chip-mes${st.meses.has(k) ? ' ativo' : ''}" data-pmes="${k}" aria-pressed="${st.meses.has(k)}">${rotuloMes(a.mm, a.yyyy)}</button>`; }).join('')}
          <button type="button" class="lnk lnk-sec" data-pmes-todos>Todos</button><button type="button" class="lnk lnk-sec" data-pmes-limpar>Limpar</button></div></details>`;
  }

  async function render() {
    const c = ctx(); if (!c.rows.length) return;
    const req = ++st.req;
    atualizarOpcoes();
    const elegivel = elegivelComparativo(c.f, fp.grupo);
    if (!elegivel) { st.mom = false; st.tri = false; st.meses.clear(); }
    if (c.f.de || c.f.ate) { /* comparativos ignoram a data de cadastro: aviso abaixo */ }
    desenharControles(c, elegivel);
    const agg = agregarProducao(c.rows, c.f, fp, st.dim, c.escopo);
    const querComp = elegivel && (st.mom || st.tri || st.meses.size);
    let comp = null;
    if (querComp) { $('#p-corpo').innerHTML = '<div class="vazio"><span class="spinner"></span> Calculando comparativo…</div>'; comp = await comparativos(c, agg, req); if (!comp) return; }
    desenharCorpo(c, agg, comp);
  }

  function desenharCorpo(c, agg, comp) {
    const rec = c.receita, dimNome = { unidade: 'Unidade', gestor: 'Gestor', equipe: 'Equipe' }[st.dim];
    $('#p-tit').textContent = `Produção por ${dimNome}`;
    const partes = [];
    if (comp) { if (st.mom) partes.push('mês anterior'); if (st.tri) partes.push(`média do trimestre (${comp.triMeses} meses)`); if (st.meses.size) partes.push(`${st.meses.size} mês(es) selecionado(s)`); }
    $('#p-sub').textContent = `${agg.cols.length} status · ${fmtInt(agg.totalQtd)} registros${partes.length ? ' · comparando contra ' + partes.join(' e ') : ''}`;
    $('#p-avisos').innerHTML = (comp && comp.avisos.length ? `<div class="alerta alerta-erro">${comp.avisos.map(esc).join(' · ')}</div>` : '') +
      (comp && (c.f.de || c.f.ate) ? '<div class="alerta alerta-info">Os comparativos ignoram o filtro de data de cadastro.</div>' : '');
    if (!agg.cols.length || !agg.linhas.length) { $('#p-corpo').innerHTML = '<div class="vazio">Nenhum dado para os filtros selecionados.</div>'; return; }

    const fmtCel = (cel) => cel.qtd === 0 ? '<span class="zero">—</span>' : `<b>${fmtInt(cel.qtd)}</b>${rec ? `<small>${fmtMoeda(cel.rec)}</small>` : ''}`;
    // colunas de comparação: [{rotulo, valorDe(chave)}]
    const compCols = [];
    if (comp && st.mom) compCols.push({ rotulo: 'MOM', tit: 'Mês anterior', mapa: comp.mom, erro: !comp.mom });
    if (comp && st.tri) compCols.push({ rotulo: 'TRI', tit: 'Média dos 3 meses anteriores', mapa: comp.tri, erro: !comp.tri, dec: true });
    if (comp) Object.keys(comp.meses).forEach(k => compCols.push({ rotulo: rotuloMes(...k.split('/')), tit: k, mapa: comp.meses[k].mapa, erro: !comp.meses[k].mapa }));
    const celComp = (cc, chave, atual) => {
      if (cc.erro) return '<span class="zero">—</span>';
      const ant = cc.mapa[chave] || 0, v = formatVariacao(atual, ant);
      return `<b>${ant.toLocaleString('pt-BR', { maximumFractionDigits: cc.dec ? 1 : 0 })}</b><small class="var ${v.classe}">${v.texto}</small>`;
    };
    const somaAnt = cc => agg.linhas.reduce((s, l) => s + (cc.mapa?.[l.chave] || 0), 0);

    if (st.visao === 'tabela') {
      $('#p-corpo').innerHTML = `<div class="tab-wrap"><table class="tab tab-prod">
        <thead><tr><th>${dimNome}</th>${agg.cols.map(s => `<th class="num">${esc(s)}</th>`).join('')}${compCols.map(cc => `<th class="num cmp" title="${esc(cc.tit)}">${esc(cc.rotulo)}</th>`).join('')}<th class="num tot">Total</th></tr></thead>
        <tbody>${agg.linhas.map(l => `<tr><td class="cel-nome">${esc(l.nome)}</td>${l.cells.map(cel => `<td class="num">${fmtCel(cel)}</td>`).join('')}${compCols.map(cc => `<td class="num cmp">${celComp(cc, l.chave, l.totalQtd)}</td>`).join('')}<td class="num tot">${fmtCel({ qtd: l.totalQtd, rec: l.totalRec })}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>TOTAL GERAL</td>${agg.totaisCol.map(cel => `<td class="num">${fmtCel(cel)}</td>`).join('')}${compCols.map(cc => { if (cc.erro) return '<td class="num cmp"><span class="zero">—</span></td>'; const ant = somaAnt(cc), v = formatVariacao(agg.totalQtd, ant); return `<td class="num cmp"><b>${ant.toLocaleString('pt-BR', { maximumFractionDigits: cc.dec ? 1 : 0 })}</b><small class="var ${v.classe}">${v.texto}</small></td>`; }).join('')}<td class="num tot">${fmtCel({ qtd: agg.totalQtd, rec: agg.totalRec })}</td></tr></tfoot>
      </table></div>`;
    } else if (st.visao === 'cartoes') {
      const ord = agg.linhas.slice().sort((a, b) => b.totalQtd - a.totalQtd);
      $('#p-corpo').innerHTML = `<div class="cartoes">${ord.map(l => `
        <article class="cartao">
          <div class="cartao-topo"><div class="cartao-nome">${esc(l.nome)}</div>
            <div class="cartao-destaque"><b>${fmtInt(l.totalQtd)}</b><small>${rec ? esc(fmtMoeda(l.totalRec)) : 'total'}</small></div></div>
          <dl class="cartao-campos">${agg.cols.map((s, i) => l.cells[i].qtd ? `<div><dt>${esc(s)}</dt><dd>${fmtInt(l.cells[i].qtd)}${rec ? `<small class="sub">${esc(fmtMoeda(l.cells[i].rec))}</small>` : ''}</dd></div>` : '').join('')}
            ${compCols.map(cc => `<div><dt>${esc(cc.rotulo)}</dt><dd>${celComp(cc, l.chave, l.totalQtd)}</dd></div>`).join('')}</dl>
        </article>`).join('')}</div>`;
    } else {
      const itens = agg.linhas.slice().sort((a, b) => (rec ? b.totalRec - a.totalRec : b.totalQtd - a.totalQtd)).slice(0, 25)
        .map(l => ({ rotulo: l.nome, valor: rec ? l.totalRec : l.totalQtd, sub: compCols.length ? `${compCols[0].rotulo}: ${compCols[0].erro ? '—' : formatVariacao(l.totalQtd, compCols[0].mapa[l.chave] || 0).texto}` : '' }));
      $('#p-corpo').innerHTML = barrasHorizontais({ itens, fmt: v => (rec ? fmtMoeda(v) : fmtInt(v)) });
    }
  }

  return {
    render,
    carregando() { $('#p-corpo').innerHTML = '<div class="vazio"><span class="spinner"></span> Carregando…</div>'; },
    // zera filtros próprios (ao trocar de período)
    reiniciar() { fp.ufBl = 'Geral'; fp.ufCliente = []; fp.ddd = []; fp.cidade = []; fp.grupo = 'Geral'; st.mom = false; st.tri = false; st.meses.clear(); },
  };
}
