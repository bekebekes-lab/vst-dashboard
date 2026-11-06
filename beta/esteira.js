// Visão "Esteira" do Beta2 = o Gerencial atual: um cartão por categoria com as
// filas (agrupadas por etapa), clique na fila abre os pedidos, e o detalhamento
// por consultor. Reproduz render()/drillFila() do index.html (~4254-4620 e ~4660+).

import { CATS, getGrupoKey, receitaLinha, subgrupoDaFila, ORDEM_SUBGRUPOS_FILA, parseDataBR } from './nucleo.js';
import { esc, icone, fmtInt, fmtDec, fmtMoeda, fmtPct } from './ui.js';
import { criarMultivisao } from './multivisao.js';
import { abrirDetalheRegistro } from './detalhe.js';

const APROVADO = ['Ativo', 'Esteira de ativação'];
const ROTULO_CAT = { GERAL: 'Geral', GROSS: 'Gross', 'RENOVAÇÃO': 'Renovação', BL: 'BL', TITULARIDADE: 'Titularidade', 'SERV. DIGITAIS': 'Serv. Digitais' };
const LIMITE_DRILL = 100;

const fmtData = v => {
  if (!v) return '—';
  const m = String(v).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  const d = parseDataBR(v);
  return d ? d.toLocaleDateString('pt-BR') : String(v).split(' ')[0];
};

// api = { receita(): bool, setReceita(bool), filtrarConsultor(nome), filtrarEquipe(nome) }
export function criarEsteira(host, api) {
  host.innerHTML = `
    <div class="est-topo">
      <div class="est-stats" id="est-stats"></div>
      <div class="seg" role="group" aria-label="Medida">
        <button type="button" class="seg-btn" data-med="qtd"><span>Qtd</span></button>
        <button type="button" class="seg-btn" data-med="rec"><span>Receita</span></button>
      </div>
    </div>
    <div id="est-cartoes"></div>
    <div id="est-drill"></div>
    <div id="est-consultores"></div>`;
  const $ = s => host.querySelector(s);

  const cons = criarMultivisao({
    id: 'consultores', titulo: 'Detalhamento por consultor', subtitulo: 'Clique no consultor ou na equipe para filtrar.',
    nome: l => l.nome,
    colunas: () => {
      const rec = api.receita();
      const num = (rotulo, k) => ({ k, rotulo, num: true, valor: l => l[k + (rec ? '_REC' : '')] || 0, fmt: v => (rec ? fmtMoeda(v) : fmtInt(v)) });
      return [
        { k: 'nome', rotulo: 'Consultor', valor: l => l.nome, html: (v, l) => `<button type="button" class="lnk" data-cons="${esc(l.nome)}">${esc(l.nome)}</button>` },
        { k: 'equipe', rotulo: 'Equipe', valor: l => l.equipe || '', html: (v, l) => `<button type="button" class="lnk lnk-sec" data-equipe="${esc(l.equipe || '')}">${esc(l.equipe || '—')}</button>` },
        num('Gross', 'GROSS'), num('Renov.', 'RENOVAÇÃO'), num('BL', 'BL'), num('Titular.', 'TITULARIDADE'), num('Ativo/Inst.', 'ATIVO'), num('Total', 'GERAL'),
        { k: 'tag', rotulo: 'Tag', valor: l => l.tag || '', html: (v) => (v ? `<span class="tag">${esc(v)}</span>` : '—') },
      ];
    },
    metricas: () => { const rec = api.receita(); return ['GROSS', 'RENOVAÇÃO', 'BL', 'TITULARIDADE', 'ATIVO', 'GERAL'].map(k => ({ k, rotulo: { GROSS: 'Gross', 'RENOVAÇÃO': 'Renovação', BL: 'BL', TITULARIDADE: 'Titularidade', ATIVO: 'Ativo/Instalado', GERAL: 'Total' }[k] + (rec ? ' (receita)' : '') })); },
    ordemInicial: 'GERAL', metricaInicial: 'GERAL', destaque: 'GERAL', limite: 30,
  });
  $('#est-consultores').append(cons.el);
  cons.el.addEventListener('click', e => {
    const c = e.target.closest('[data-cons]'); if (c) return api.filtrarConsultor(c.dataset.cons);
    const q = e.target.closest('[data-equipe]'); if (q && q.dataset.equipe) api.filtrarEquipe(q.dataset.equipe);
  });

  let ultimo = null;                 // { agg, filtradas, totalBase, monitorDup }
  let drill = null;                  // { cat, fila }
  const dr = { col: 'qtd', asc: false, todas: false, linhas: [] };

  // ── cartões por categoria ────────────────────────────────────────────────
  function htmlCartoes() {
    const { agg } = ultimo, rec = api.receita(), nc = agg.nConsultores || 1;
    const fmt = v => (rec ? fmtMoeda(v) : fmtInt(v));
    const sub = (c, { grupo, itens }) => `
      <div class="fila-sub"><span>${esc(grupo)}</span><b>${fmt(itens.reduce((s, [, v]) => s + v, 0))}</b></div>
      ${itens.map(([fn, fv]) => `<button type="button" class="fila" data-cat="${esc(c)}" data-fila="${esc(fn)}" title="Ver os pedidos desta fila"><span>${esc(fn)}</span><b>${fmt(fv)}</b></button>`).join('')}`;
    return `<div class="est-grade">${CATS.map((c, i) => {
      const d = agg.cats[c];
      const filas = Object.entries(rec ? d.filasRec : d.filas).sort((a, b) => b[1] - a[1]);
      const porGrupo = {};
      filas.forEach(([fn, fv]) => { (porGrupo[subgrupoDaFila(fn)] || (porGrupo[subgrupoDaFila(fn)] = [])).push([fn, fv]); });
      const grupos = ORDEM_SUBGRUPOS_FILA.filter(g => porGrupo[g]).map(g => ({ grupo: g, itens: porGrupo[g] }));
      const aprov = grupos.filter(g => APROVADO.includes(g.grupo)), outros = grupos.filter(g => !APROVADO.includes(g.grupo));
      const totAprov = aprov.reduce((s, g) => s + g.itens.reduce((s2, [, v]) => s2 + v, 0), 0);
      const total = rec ? d.totalRec : d.total;
      return `<article class="cat${i === 0 ? ' cat-destaque' : ''}">
        <div class="cat-rot">${esc(ROTULO_CAT[c])}</div>
        <div class="cat-val">${fmt(total)}</div>
        <div class="cat-media">Média/consultor: ${rec ? fmtMoeda(total / nc) : fmtDec(total / nc, 1)}</div>
        <div class="cat-filas">
          ${aprov.length ? `<div class="aprovado-tit"><span>Aprovado</span><b>${fmt(totAprov)}</b></div><div class="aprovado-box">${aprov.map(g => sub(c, g)).join('')}</div>` : ''}
          ${outros.map(g => sub(c, g)).join('')}
          ${filas.length ? '' : '<div class="vazio vazio-p">Sem pedidos</div>'}
        </div>
      </article>`;
    }).join('')}</div>`;
  }

  // ── pedidos de uma fila ──────────────────────────────────────────────────
  function linhasDoDrill() {
    const { filtradas, monitorDup } = ultimo;
    return filtradas.filter(r => {
      const key = getGrupoKey(r['GRUPO'], r['PRODUTO'], r['SOLICITACAO'], monitorDup);
      if (!key) return false;
      if (drill.cat === 'GERAL' ? key === 'SERV. DIGITAIS' : key !== drill.cat) return false;
      return (r['FILA'] || 'Sem Status') === drill.fila;
    });
  }
  const COLS_DRILL = [
    { k: 'grupo', r: 'Grupo', v: r => r['GRUPO'] || '' },
    { k: 'vinc', r: 'Vinculado', v: r => r['VINCULADO'] || '' },
    { k: 'cli', r: 'Cliente', v: r => r['NOME CLIENTE'] || '' },
    { k: 'prop', r: 'Proprietário', v: r => r['PROPRIETÁRIO DO PEDIDO'] || '' },
    { k: 'eq', r: 'Equipe', v: r => r['EQUIPE'] || '' },
    { k: 'cad', r: 'Cadastro', v: r => (parseDataBR(r['CADASTRO']) || 0).valueOf() || 0, f: r => fmtData(r['CADASTRO']) },
    { k: 'atu', r: 'Atualização', v: r => (parseDataBR(r['ATUALIZACAO']) || 0).valueOf() || 0, f: r => fmtData(r['ATUALIZACAO']) },
    { k: 'qtd', r: 'Qtd', num: true, v: r => (api.receita() ? receitaLinha(r) : (parseInt(r['QUANTIDADE']) || 1)), f: r => (api.receita() ? fmtMoeda(receitaLinha(r)) : fmtInt(parseInt(r['QUANTIDADE']) || 1)) },
  ];
  function desenharDrill() {
    const el = $('#est-drill');
    if (!drill) { el.innerHTML = ''; $('#est-consultores').hidden = false; return; }
    $('#est-consultores').hidden = true;
    const rec = api.receita();
    const linhas = linhasDoDrill();
    const col = COLS_DRILL.find(c => c.k === dr.col) || COLS_DRILL[COLS_DRILL.length - 1];
    const dir = dr.asc ? 1 : -1;
    const ord = linhas.slice().sort((a, b) => { const va = col.v(a), vb = col.v(b); return (typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : va - vb) * dir; });
    dr.linhas = ord;
    const vis = dr.todas ? ord : ord.slice(0, LIMITE_DRILL);
    const total = linhas.reduce((s, r) => s + (rec ? receitaLinha(r) : (parseInt(r['QUANTIDADE']) || 1)), 0);
    el.innerHTML = `<section class="painel">
      <header class="painel-cab">
        <div class="painel-tit"><h2>${esc(ROTULO_CAT[drill.cat])} › ${esc(drill.fila)}</h2>
          <p>${fmtInt(linhas.length)} registro${linhas.length === 1 ? '' : 's'} · total ${rec ? fmtMoeda(total) : fmtInt(total)}</p></div>
        <div class="painel-ctl"><button type="button" class="btn btn-fantasma" data-fechar-drill>${icone('back', 16)}<span>Voltar</span></button></div>
      </header>
      <div class="painel-corpo">${linhas.length ? `<div class="tab-wrap"><table class="tab">
        <thead><tr>${COLS_DRILL.map(c => `<th class="${c.num ? 'num' : ''}"><button type="button" class="th-ord${dr.col === c.k ? ' ativo' : ''}" data-dord="${c.k}">${esc(c.k === 'qtd' && rec ? 'Receita' : c.r)}<span class="seta">${dr.col === c.k ? (dr.asc ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}</tr></thead>
        <tbody>${vis.map((r, i) => `<tr>${COLS_DRILL.map(c => {
          const txt = c.f ? c.f(r) : (c.v(r) || '—');
          if (c.k === 'cli') return `<td><button type="button" class="lnk" data-detalhe="${i}" title="Ver todos os dados do registro">${esc(txt)}</button></td>`;
          return `<td class="${c.num ? 'num' : ''}">${esc(txt)}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>
        ${ord.length > LIMITE_DRILL ? `<button type="button" class="btn-mais" data-mais-drill>${dr.todas ? 'Mostrar menos' : `Mostrar todos (${fmtInt(ord.length)})`}</button>` : ''}`
        : '<div class="vazio">Nenhum pedido nesta fila para os filtros atuais.</div>'}</div></section>`;
  }

  host.addEventListener('click', e => {
    const f = e.target.closest('[data-fila]');
    if (f) { drill = { cat: f.dataset.cat, fila: f.dataset.fila }; dr.col = 'qtd'; dr.asc = false; dr.todas = false; desenharDrill(); $('#est-drill').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (e.target.closest('[data-fechar-drill]')) { drill = null; desenharDrill(); return; }
    const o = e.target.closest('[data-dord]');
    if (o) { const k = o.dataset.dord; dr.asc = dr.col === k ? !dr.asc : COLS_DRILL.find(c => c.k === k).num !== true && !['cad', 'atu'].includes(k); dr.col = k; desenharDrill(); return; }
    if (e.target.closest('[data-mais-drill]')) { dr.todas = !dr.todas; desenharDrill(); return; }
    const d = e.target.closest('[data-detalhe]');
    if (d) { abrirDetalheRegistro(dr.linhas[+d.dataset.detalhe]); return; }
    const m = e.target.closest('.est-topo [data-med]');
    if (m) api.setReceita(m.dataset.med === 'rec');
  });

  function marcarMedida() {
    host.querySelectorAll('.est-topo [data-med]').forEach(b => { const on = (b.dataset.med === 'rec') === api.receita(); b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
  }

  return {
    render(dados) {
      ultimo = dados;
      const { agg, totalBase } = dados, rec = api.receita(), nc = agg.nConsultores || 1, g = agg.cats.GERAL;
      marcarMedida();
      $('#est-stats').innerHTML = [
        [fmtInt(totalBase), 'registros na base'], [fmtInt(agg.nLinhas), 'registros filtrados'], [fmtInt(agg.nConsultores), 'consultores'],
        [agg.nConsultores ? (rec ? fmtMoeda(g.totalRec / nc) : fmtDec(g.total / nc, 1)) : '0', 'média geral/consultor'],
      ].map(([v, t]) => `<span class="stat"><b>${v}</b> ${t}</span>`).join('');
      $('#est-cartoes').innerHTML = htmlCartoes();
      cons.render(agg.porConsultor);
      desenharDrill();
    },
    carregando() { $('#est-cartoes').innerHTML = '<div class="vazio"><span class="spinner"></span> Carregando…</div>'; cons.carregando(); },
  };
}
