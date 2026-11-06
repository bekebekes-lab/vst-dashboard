// Visão "Gerencial Financeiro" do Beta2 = a aba Gerencial Financeiro (piloto) do Dash atual: o
// desenho do Gerencial com o Gross separado em Voz Novo + Portabilidade e, opcionalmente, a
// comissão estimada (receita × fatores do Simulador 2.0). Reproduz renderGerFin/gfDrill do
// index.html (~5300-5560) com as regras de beta/politica.js (CÓPIA — manter em sincronia).
//
// Diferenças deliberadas:
//  - Status, busca e data de cadastro da barra global também valem aqui (no Dash atual não há filtro de status);
//  - o escopo do atingimento de meta (filas do Realizado) é um seletor aqui (no Dash atual segue a aba
//    Simulador 2.0, padrão "Ativo");
//  - sem a fórmula nova: nada de comissão foi alterado, só copiado.

import { filtrar, parseDataBR, subgrupoDaFila, ORDEM_SUBGRUPOS_FILA, receitaLinha } from './nucleo.js';
import {
  GF_CATS, GF_FORA_DO_GERAL, GF_FATOR_POR_CAT, GF_CATS_SEM_FATOR, FILAS_POR_VISAO, PLUGIN_PORTABILIDADE_VOZ,
  gfKey, criarColunas, gfComissaoLinha, gfMontarCfg, gfRealizadoDe, gfFatoresDe,
} from './politica.js';
import { esc, icone, fmtInt, fmtDec, fmtMoeda, prefs } from './ui.js';
import { abrirDetalheRegistro } from './detalhe.js';

const APROVADO = ['Ativo', 'Esteira de ativação'];
const LIMITE_DRILL = 100;
const ESCOPOS = [['ativo', 'Ativo'], ['ativacao', '+ Ativação'], ['aprovados', '+ Aprovados'], ['geral', 'Geral']];
const fmtData = v => { if (!v) return '—'; const m = String(v).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[1]}/${m[2]}/${m[3]}`; const d = parseDataBR(v); return d ? d.toLocaleDateString('pt-BR') : String(v).split(' ')[0]; };
const br = (n, d = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

// ctx() => { rows, f, escopo, ref:{mm,yyyy}, monitorDup, carregarConfig(periodo)->Promise<linhas config_simulador2> }
export function criarFinanceiro(host, ctx) {
  const st = { receita: prefs.get('fin_receita', '1') === '1', fatores: false, escopoFilas: prefs.get('fin_escopo', 'ativo'), cfg: null, carregandoCfg: false, drill: null, dr: { col: 'qtd', asc: false, todas: false, linhas: [] } };
  if (!FILAS_POR_VISAO[st.escopoFilas]) st.escopoFilas = 'ativo';

  host.innerHTML = `
    <section class="painel prod-ctl-painel">
      <div class="prod-ctl">
        <div class="seg" role="group" aria-label="Medida"><button type="button" class="seg-btn" data-fm="qtd"><span>Quantidade</span></button><button type="button" class="seg-btn" data-fm="rec"><span>Receita</span></button></div>
        <label class="chip chip-chk" title="Multiplica a receita pelos fatores do Simulador 2.0 (comissão estimada)"><input type="checkbox" id="fin-fatores"><span>Aplicar fatores de comissão</span></label>
        <label class="chip chip-sel" id="fin-escopo-wrap" hidden title="Filas que contam no realizado da meta trimestral"><span>Atingimento da meta</span><select id="fin-escopo" aria-label="Escopo do atingimento">${ESCOPOS.map(([k, r]) => `<option value="${k}">${r}</option>`).join('')}</select></label>
      </div>
      <div class="prod-dica">Piloto · Voz Novo e Portabilidade vêm dos grupos "VOZ - Novo" e "VOZ - Portabilidade" da base. O Gross é só referência e não entra na soma do Geral.</div>
    </section>
    <div class="est-topo"><div class="est-stats" id="fin-stats"></div></div>
    <div id="fin-fatores-barra"></div>
    <div id="fin-cartoes"></div>
    <div id="fin-drill"></div>`;
  const $ = s => host.querySelector(s);
  $('#fin-escopo').value = st.escopoFilas;

  host.addEventListener('click', e => {
    const m = e.target.closest('[data-fm]'); if (m) { st.receita = m.dataset.fm === 'rec'; if (!st.receita && st.fatores) { st.fatores = false; $('#fin-fatores').checked = false; } prefs.set('fin_receita', st.receita ? '1' : '0'); return render(); }
    const f = e.target.closest('[data-fila]');
    if (f) { st.drill = { cat: f.dataset.cat, fila: f.dataset.fila }; st.dr = { col: 'qtd', asc: false, todas: false, linhas: [] }; desenharDrill(); $('#fin-drill').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (e.target.closest('[data-fechar-drill]')) { st.drill = null; desenharDrill(); return; }
    const o = e.target.closest('[data-dord]'); if (o) { const k = o.dataset.dord; st.dr.asc = st.dr.col === k ? !st.dr.asc : !['qtd', 'cad', 'atu', 'fator'].includes(k); st.dr.col = k; desenharDrill(); return; }
    if (e.target.closest('[data-mais-drill]')) { st.dr.todas = !st.dr.todas; desenharDrill(); return; }
    const d = e.target.closest('[data-detalhe]'); if (d) abrirDetalheRegistro(st.dr.linhas[+d.dataset.detalhe]);
  });
  $('#fin-fatores').addEventListener('change', async e => {
    st.fatores = e.target.checked;
    if (st.fatores) { st.receita = true; prefs.set('fin_receita', '1'); await carregarCfg(); }
    render();
  });
  $('#fin-escopo').addEventListener('change', e => { st.escopoFilas = e.target.value; prefs.set('fin_escopo', st.escopoFilas); render(); });

  // sempre relê a configuração: pega o que foi salvo no Simulador 2.0 desde a última vez (como o Dash atual)
  async function carregarCfg() {
    const c = ctx(); st.carregandoCfg = true; render();
    const periodo = `${c.ref.yyyy}-${c.ref.mm}`;
    let data = [];
    try { data = await c.carregarConfig(periodo); } catch (e) { console.warn('Financeiro: config_simulador2 indisponível —', e.message); }
    st.cfg = gfMontarCfg(periodo, data); st.carregandoCfg = false;
  }

  function fatoresAtuais(c) {
    if (!st.cfg) return null;
    const { realMovelVoz, realFixaBl } = gfRealizadoDe(c.rows, st.escopoFilas);
    return gfFatoresDe(st.cfg, realMovelVoz, realFixaBl);
  }

  function marcar() {
    host.querySelectorAll('[data-fm]').forEach(b => { const on = (b.dataset.fm === 'rec') === st.receita; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
    $('#fin-escopo-wrap').hidden = !st.fatores;
    $('#fin-fatores').checked = st.fatores;
  }

  function linhasQuePassam(c) { return filtrar(c.rows, c.f, c.escopo); }

  function barraFatores(fat, ren) {
    const { cfg, cluster, fator } = fat;
    const faixa = i => (i >= 0 ? `Faixa ${i + 1}` : 'sem adicional');
    const avisoCfg = cfg.salva ? '' : `<div class="txt-aviso">⚠ A competência ${esc(cfg.periodo)} não tem configuração salva no Simulador 2.0 — usando Cluster ${esc(cluster)} e metas zeradas (sem adicional por meta).</div>`;
    const avisoFaixa = ren.semFaixa > 0 ? `<div class="txt-aviso">⚠ ${fmtInt(ren.semFaixa)} linha(s) de Renovação sem Faixa/% Variação na base — ficaram com fator 0.</div>` : '';
    return `<div class="fat-barra"><strong>Fatores de comissão</strong> · Simulador 2.0 · competência ${esc(cfg.periodo)} · Cluster ${esc(cluster)} ·
      Móvel Voz ${fmtInt(fat.realMovelVoz)}/${fmtInt(cfg.metaMovelVoz)} (${br(fat.pctMovelVoz, 1)}% · ${faixa(fat.idxMV)}) · Fixa BL ${fmtInt(fat.realFixaBl)}/${fmtInt(cfg.metaFixaBl)} (${br(fat.pctFixaBl, 1)}% · ${faixa(fat.idxBL)})
      <br>BL <b>×${br(fator.virtua)}</b> · Voz Novo <b>×${br(fator.vozNovo)}</b> · Portabilidade <b>×${br(fator.vozPort)}</b> (inclui plugin +${br(PLUGIN_PORTABILIDADE_VOZ)}) — fatores de tabela, antes do <b>% DESCONTO</b> de cada linha (customização: a Claro paga só esse % do fator) · Renovação <b>por linha</b> (Tabela 1 · Cluster ${esc(cluster)} · coluna FAIXA do Delta Ticket${ren.base > 0 ? ` · fator médio <b>×${br(ren.valor / ren.base)}</b>` : ''}) · Titularidade e Serv. Digitais não têm fator no Simulador e ficam fora do Geral.${avisoFaixa}${avisoCfg}</div>`;
  }

  function render() {
    const c = ctx(); if (!c.rows.length) return;
    marcar();
    if (st.fatores && (st.carregandoCfg || !st.cfg)) { $('#fin-cartoes').innerHTML = '<div class="vazio"><span class="spinner"></span> Carregando fatores do Simulador 2.0…</div>'; $('#fin-stats').innerHTML = ''; $('#fin-fatores-barra').innerHTML = ''; return; }
    const fat = st.fatores ? fatoresAtuais(c) : null;
    const col = criarColunas(c.rows[0]);
    const filtradas = linhasQuePassam(c);
    const novaM = () => ({ total: 0, filas: {}, totalRec: 0, filasRec: {} });
    const metrics = {}; GF_CATS.forEach(k => { metrics[k] = novaM(); });
    const cons = new Set(); const ren = { base: 0, valor: 0, semFaixa: 0 };
    for (const r of filtradas) {
      cons.add(r['PROPRIETÁRIO DO PEDIDO'] || 'Sem Consultor');
      const key = gfKey(r, c.monitorDup); if (!key) continue;
      if (!metrics[key]) metrics[key] = novaM();
      const qtd = parseInt(r['QUANTIDADE']) || 1, fila = r['FILA'] || 'Sem Status';
      let rec;
      if (fat) { const x = gfComissaoLinha(r, key, fat, col); rec = x.valor; if (key === 'RENOVAÇÃO') { ren.base += x.base; ren.valor += x.valor; if (x.semFaixa) ren.semFaixa++; } }
      else rec = receitaLinha(r);
      const acum = m => { m.total += qtd; m.filas[fila] = (m.filas[fila] || 0) + qtd; m.totalRec += rec; m.filasRec[fila] = (m.filasRec[fila] || 0) + rec; };
      if (fat) {
        if (key === 'GROSS') continue;                                   // espelho de Voz Novo + Portabilidade
        acum(metrics[key]);
        if (key === 'VOZ NOVO' || key === 'PORTABILIDADE') acum(metrics['GROSS']);
        if (GF_FATOR_POR_CAT[key]) acum(metrics['GERAL']);               // só o que comissiona
        continue;
      }
      acum(metrics[key]);
      if (!GF_FORA_DO_GERAL.includes(key)) acum(metrics['GERAL']);
    }
    const nc = cons.size || 1, rec = st.receita, g = metrics.GERAL;
    $('#fin-stats').innerHTML = [[fmtInt(c.rows.length), 'registros na base'], [fmtInt(filtradas.length), 'registros filtrados'], [fmtInt(cons.size), 'consultores'],
      [cons.size ? (rec ? fmtMoeda(g.totalRec / nc) : fmtDec(g.total / nc, 1)) : '0', `média geral/consultor${fat ? ' (comissão)' : ''}`]].map(([v, t]) => `<span class="stat"><b>${v}</b> ${t}</span>`).join('');
    $('#fin-fatores-barra').innerHTML = fat ? barraFatores(fat, ren) : '';

    const fmt = v => (rec ? fmtMoeda(v) : fmtInt(v));
    const sub = (k, { grupo, itens }) => `<div class="fila-sub"><span>${esc(grupo)}</span><b>${fmt(itens.reduce((s, [, v]) => s + v, 0))}</b></div>${itens.map(([fn, fv]) => `<button type="button" class="fila" data-cat="${esc(k)}" data-fila="${esc(fn)}" title="Ver os pedidos desta fila"><span>${esc(fn)}</span><b>${fmt(fv)}</b></button>`).join('')}`;
    $('#fin-cartoes').innerHTML = `<div class="est-grade">${GF_CATS.map((k, i) => {
      if (fat && GF_CATS_SEM_FATOR.includes(k)) return `<article class="cat"><div class="cat-rot">${esc(k)}</div><div class="cat-val" style="color:var(--texto-3)">—</div><div class="cat-media">Sem fator de comissão no Simulador</div></article>`;
      const m = metrics[k];
      const filas = Object.entries(rec ? m.filasRec : m.filas).sort((a, b) => b[1] - a[1]);
      const porGrupo = {}; filas.forEach(([fn, fv]) => { (porGrupo[subgrupoDaFila(fn)] || (porGrupo[subgrupoDaFila(fn)] = [])).push([fn, fv]); });
      const grupos = ORDEM_SUBGRUPOS_FILA.filter(x => porGrupo[x]).map(x => ({ grupo: x, itens: porGrupo[x] }));
      const aprov = grupos.filter(x => APROVADO.includes(x.grupo)), outros = grupos.filter(x => !APROVADO.includes(x.grupo));
      const totA = aprov.reduce((s, x) => s + x.itens.reduce((s2, [, v]) => s2 + v, 0), 0);
      const tot = rec ? m.totalRec : m.total;
      return `<article class="cat${i === 0 ? ' cat-destaque' : ''}"><div class="cat-rot">${esc(k)}</div><div class="cat-val">${fmt(tot)}</div>
        <div class="cat-media">Média/consultor: ${rec ? fmtMoeda(tot / nc) : fmtDec(tot / nc, 1)}</div>
        <div class="cat-filas">${aprov.length ? `<div class="aprovado-tit"><span>Aprovado</span><b>${fmt(totA)}</b></div><div class="aprovado-box">${aprov.map(x => sub(k, x)).join('')}</div>` : ''}${outros.map(x => sub(k, x)).join('')}${filas.length ? '' : '<div class="vazio vazio-p">Sem pedidos</div>'}</div></article>`;
    }).join('')}</div>`;
    desenharDrill();
  }

  function desenharDrill() {
    const el = $('#fin-drill'); const c = ctx();
    if (!st.drill || !c.rows.length) { el.innerHTML = ''; return; }
    const fat = st.fatores ? fatoresAtuais(c) : null, col = criarColunas(c.rows[0]), rec = st.receita;
    const { cat, fila } = st.drill;
    const linhas = linhasQuePassam(c).filter(r => {
      if ((r['FILA'] || 'Sem Status') !== fila) return false;
      const key = gfKey(r, c.monitorDup); if (!key) return false;
      if (fat) { if (cat === 'GERAL') return !!GF_FATOR_POR_CAT[key]; if (cat === 'GROSS') return key === 'VOZ NOVO' || key === 'PORTABILIDADE'; return key === cat; }
      return cat === 'GERAL' ? !GF_FORA_DO_GERAL.includes(key) : key === cat;      // Geral não soma Serv. Digitais nem Gross
    });
    const com = r => gfComissaoLinha(r, gfKey(r, c.monitorDup), fat, col);
    const recL = r => (fat ? com(r).valor : receitaLinha(r));
    const valL = r => (rec ? recL(r) : (parseInt(r['QUANTIDADE']) || 1));
    const ts = v => { const d = parseDataBR(v); return d ? d.getTime() : 0; };
    const COLS = [
      { k: 'cat', r: 'Categoria', v: r => gfKey(r, c.monitorDup) || '' }, { k: 'cli', r: 'Cliente', v: r => r['NOME CLIENTE'] || '' },
      { k: 'prop', r: 'Proprietário', v: r => r['PROPRIETÁRIO DO PEDIDO'] || '' }, { k: 'eq', r: 'Equipe', v: r => r['EQUIPE'] || '' },
      { k: 'cad', r: 'Cadastro', v: r => ts(r['CADASTRO']), f: r => fmtData(r['CADASTRO']) }, { k: 'atu', r: 'Atualização', v: r => ts(r['ATUALIZACAO']), f: r => fmtData(r['ATUALIZACAO']) },
      ...(fat ? [{ k: 'fator', r: 'Fator', num: true, v: r => com(r).fator, f: r => '×' + br(com(r).fator), tit: r => { const x = com(r); return x.pagoPct < 1 ? `Fator da faixa ×${br(x.fatorTabela)} × ${Math.round(x.pagoPct * 100)}% (% DESCONTO)` : ''; } }] : []),
      { k: 'qtd', r: rec ? (fat ? 'Comissão' : 'Receita') : 'Qtd', num: true, v: valL, f: r => (rec ? fmtMoeda(valL(r)) : fmtInt(valL(r))) },
    ];
    const cc = COLS.find(x => x.k === st.dr.col) || COLS[COLS.length - 1], dir = st.dr.asc ? 1 : -1;
    const ord = linhas.slice().sort((a, b) => { const va = cc.v(a), vb = cc.v(b); return (typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : va - vb) * dir; });
    st.dr.linhas = ord;
    const vis = st.dr.todas ? ord : ord.slice(0, LIMITE_DRILL), total = linhas.reduce((s, r) => s + valL(r), 0);
    el.innerHTML = `<section class="painel"><header class="painel-cab"><div class="painel-tit"><h2>${esc(cat)} › ${esc(fila)}</h2><p>${fmtInt(linhas.length)} registro${linhas.length === 1 ? '' : 's'} · total ${rec ? fmtMoeda(total) : fmtInt(total)}</p></div>
      <div class="painel-ctl"><button type="button" class="btn btn-fantasma" data-fechar-drill>${icone('back', 16)}<span>Voltar</span></button></div></header>
      <div class="painel-corpo">${linhas.length ? `<div class="tab-wrap"><table class="tab"><thead><tr>${COLS.map(x => `<th class="${x.num ? 'num' : ''}"><button type="button" class="th-ord${st.dr.col === x.k ? ' ativo' : ''}" data-dord="${x.k}">${esc(x.r)}<span class="seta">${st.dr.col === x.k ? (st.dr.asc ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}</tr></thead>
      <tbody>${vis.map((r, i) => `<tr>${COLS.map(x => { const t = x.f ? x.f(r) : (x.v(r) || '—'); if (x.k === 'cli') return `<td><button type="button" class="lnk" data-detalhe="${i}" title="Ver todos os dados do registro">${esc(t)}</button></td>`; return `<td class="${x.num ? 'num' : ''}"${x.tit && x.tit(r) ? ` title="${esc(x.tit(r))}"` : ''}>${esc(t)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      ${ord.length > LIMITE_DRILL ? `<button type="button" class="btn-mais" data-mais-drill>${st.dr.todas ? 'Mostrar menos' : `Mostrar todos (${fmtInt(ord.length)})`}</button>` : ''}` : '<div class="vazio">Nenhum pedido nesta fila para os filtros atuais.</div>'}</div></section>`;
  }

  return { render, carregando() { $('#fin-cartoes').innerHTML = '<div class="vazio"><span class="spinner"></span> Carregando…</div>'; }, reiniciar() { st.cfg = null; st.drill = null; if (st.fatores) carregarCfg().then(render); } };
}
