// Painel com alternador Tabela | Cartões | Gráfico sobre os MESMOS dados.
// A escolha de visão é lembrada por painel (preferência do visitante).
//
// cfg = {
//   id, titulo, subtitulo?,
//   colunas: [{ k, rotulo, valor(linha)->number|string, fmt?(v, linha)->string, num?:true }],
//   nome(linha)->string, sub?(linha)->string,
//   metricas?: [{k, rotulo}]  // quais colunas numéricas podem virar gráfico (padrão: todas num)
//   classeBarra?(linha, metricaK)->string
//   limite?: número de linhas antes de "mostrar todas"
// }

import { esc, icone, prefs } from './ui.js';
import { barrasHorizontais } from './graficos.js';

const VISOES = [
  { id: 'tabela', rotulo: 'Tabela', icone: 'table' },
  { id: 'cartoes', rotulo: 'Cartões', icone: 'cards' },
  { id: 'grafico', rotulo: 'Gráfico', icone: 'chart' },
];

export function criarMultivisao(cfg) {
  const el = document.createElement('section');
  el.className = 'painel';
  el.id = 'painel-' + cfg.id;
  el.innerHTML = `
    <header class="painel-cab">
      <div class="painel-tit"><h2>${esc(cfg.titulo)}</h2>${cfg.subtitulo ? `<p>${esc(cfg.subtitulo)}</p>` : ''}</div>
      <div class="painel-ctl">
        <div class="slot-extra"></div>
        <div class="seg" role="group" aria-label="Forma de exibição">
          ${VISOES.map(v => `<button type="button" class="seg-btn" data-visao="${v.id}" title="${v.rotulo}" aria-label="${v.rotulo}">${icone(v.icone, 16)}<span>${v.rotulo}</span></button>`).join('')}
        </div>
      </div>
    </header>
    <div class="painel-corpo"></div>`;
  const corpo = el.querySelector('.painel-corpo');
  // colunas pode ser uma função (ex.: troca Quantidade/Receita) — reavaliada a cada desenho
  let colunas = [], numericas = [], metricas = [];
  function recalcColunas() {
    colunas = typeof cfg.colunas === 'function' ? cfg.colunas() : cfg.colunas;
    numericas = colunas.filter(c => c.num);
    metricas = typeof cfg.metricas === 'function' ? cfg.metricas() : (cfg.metricas || numericas);
  }
  recalcColunas();

  const estado = {
    visao: prefs.get('visao_' + cfg.id, window.matchMedia('(max-width: 640px)').matches ? 'cartoes' : 'tabela'),
    ordK: cfg.ordemInicial === null ? null : (cfg.ordemInicial || (numericas[0] && numericas[0].k)),
    asc: false,
    metrica: cfg.metricaInicial || (metricas[0] && metricas[0].k),
    todas: false,
  };
  if (!VISOES.some(v => v.id === estado.visao)) estado.visao = 'tabela';
  let linhas = [];

  const col = k => colunas.find(c => c.k === k);
  const valorDe = (c, l) => c.valor(l);
  const texto = (c, l) => { const v = valorDe(c, l); return c.fmt ? c.fmt(v, l) : String(v ?? '—'); };

  function ordenadas() {
    const c = col(estado.ordK);
    if (!c) return linhas.slice();   // sem coluna de ordem: mantém a ordem original
    const dir = estado.asc ? 1 : -1;
    return linhas.slice().sort((a, b) => {
      const va = valorDe(c, a), vb = valorDe(c, b);
      return (typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : (va - vb)) * dir;
    });
  }

  function htmlTabela(ls) {
    const th = c => {
      const ativo = estado.ordK === c.k;
      return `<th class="${c.num ? 'num' : ''}"><button type="button" class="th-ord${ativo ? ' ativo' : ''}" data-ord="${esc(c.k)}">${esc(c.rotulo)}<span class="seta">${ativo ? (estado.asc ? '↑' : '↓') : '↕'}</span></button></th>`;
    };
    return `<div class="tab-wrap"><table class="tab">
      <thead><tr>${colunas.map(th).join('')}</tr></thead>
      <tbody>${ls.map(l => `<tr>${colunas.map((c, i) => `<td class="${c.num ? 'num' : ''}">${i === 0 && cfg.sub ? `<div class="cel-nome">${esc(texto(c, l))}<small>${esc(cfg.sub(l))}</small></div>` : (c.html ? c.html(valorDe(c, l), l) : esc(texto(c, l)))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  function htmlCartoes(ls) {
    const [primeira, ...resto] = colunas;
    const destaque = numericas.find(c => c.k === cfg.destaque) || numericas[0];
    return `<div class="cartoes">${ls.map(l => `
      <article class="cartao">
        <div class="cartao-topo"><div class="cartao-nome">${esc(texto(primeira, l))}${cfg.sub ? `<small>${esc(cfg.sub(l))}</small>` : ''}</div>
          ${destaque ? `<div class="cartao-destaque"><b>${esc(texto(destaque, l))}</b><small>${esc(destaque.rotulo)}</small></div>` : ''}</div>
        <dl class="cartao-campos">${resto.filter(c => c !== destaque).map(c =>
          `<div><dt>${esc(c.rotulo)}</dt><dd>${c.html ? c.html(valorDe(c, l), l) : esc(texto(c, l))}</dd></div>`).join('')}</dl>
      </article>`).join('')}</div>`;
  }

  function htmlGrafico(ls) {
    const m = metricas.find(x => x.k === estado.metrica) || metricas[0];
    const c = col(m.k);
    const base = cfg.graficoOrdemOriginal ? linhas.slice() : ls.slice().sort((a, b) => valorDe(c, b) - valorDe(c, a));
    const ord = base.slice(0, cfg.graficoOrdemOriginal ? base.length : (estado.todas ? 60 : 15));
    const itens = ord.map(l => ({ rotulo: cfg.nome(l), sub: cfg.sub ? cfg.sub(l) : '', valor: valorDe(c, l), classe: cfg.classeBarra ? cfg.classeBarra(l, m.k) : '' }));
    return `<div class="graf-ctl"><label>Medida
        <select class="sel" data-metrica>${metricas.map(x => `<option value="${esc(x.k)}" ${x.k === m.k ? 'selected' : ''}>${esc(x.rotulo)}</option>`).join('')}</select></label>
        <span class="graf-info">${ord.length} de ${ls.length}</span></div>
      ${barrasHorizontais({ itens, fmt: v => c.fmt ? c.fmt(v, null) : String(v) })}`;
  }

  function desenhar() {
    recalcColunas();
    if (estado.ordK && !col(estado.ordK)) estado.ordK = numericas[0] ? numericas[0].k : null;
    if (!metricas.some(m => m.k === estado.metrica)) estado.metrica = metricas[0] && metricas[0].k;
    el.querySelectorAll('.seg-btn[data-visao]').forEach(b => {
      const on = b.dataset.visao === estado.visao;
      b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on));
    });
    if (!linhas.length) { corpo.innerHTML = `<div class="vazio">${esc(cfg.vazio || 'Nenhum dado para os filtros selecionados.')}</div>`; return; }
    const limite = cfg.limite || 40;
    const ls = ordenadas();
    const vis = estado.visao === 'grafico' ? ls : (estado.todas ? ls : ls.slice(0, limite));
    let html = estado.visao === 'tabela' ? htmlTabela(vis) : estado.visao === 'cartoes' ? htmlCartoes(vis) : htmlGrafico(ls);
    if (estado.visao !== 'grafico' && ls.length > limite) {
      html += `<button type="button" class="btn-mais" data-mais>${estado.todas ? 'Mostrar menos' : `Mostrar todas (${ls.length})`}</button>`;
    }
    corpo.innerHTML = html;
  }

  el.addEventListener('click', e => {
    const bv = e.target.closest('[data-visao]');
    if (bv) { estado.visao = bv.dataset.visao; prefs.set('visao_' + cfg.id, estado.visao); desenhar(); return; }
    const bo = e.target.closest('[data-ord]');
    if (bo) { const k = bo.dataset.ord; estado.asc = estado.ordK === k ? !estado.asc : (col(k) && !col(k).num); estado.ordK = k; desenhar(); return; }
    if (e.target.closest('[data-mais]')) { estado.todas = !estado.todas; desenhar(); }
  });
  el.addEventListener('change', e => {
    if (e.target.matches('[data-metrica]')) { estado.metrica = e.target.value; desenhar(); }
  });

  return {
    el,
    slotExtra: el.querySelector('.slot-extra'),
    render(novasLinhas) { linhas = novasLinhas || []; desenhar(); },
    redesenhar: () => desenhar(),
    carregando() { corpo.innerHTML = '<div class="vazio"><span class="spinner"></span> Carregando…</div>'; },
  };
}
