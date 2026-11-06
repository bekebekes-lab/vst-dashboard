// Gráficos do Beta2 — SVG/HTML puros (a CSP do Vercel só permite scripts do
// próprio domínio, então nada de biblioteca de CDN). Cores vêm de classes CSS.

import { esc } from './ui.js';

// Redesenha `desenhar(largura)` dentro de `host` sempre que a largura mudar.
export function montarResponsivo(host, desenhar) {
  let ult = 0;
  const run = () => {
    const w = Math.floor(host.clientWidth);
    if (w && w !== ult) { ult = w; host.innerHTML = desenhar(w); }
  };
  run();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(run); ro.observe(host);
    return () => ro.disconnect();
  }
  window.addEventListener('resize', run);
  return () => window.removeEventListener('resize', run);
}

function escalaTopo(max) {
  if (max <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= max) return m * exp;
  return max;
}

// Barras verticais + linha de tendência (regressão linear).
// pontos: [{rotulo, valor, parcial?}]; fmt: formata o valor.
export function barrasVerticais({ pontos, largura, altura = 250, fmt, fmtEixo }) {
  if (!pontos.length) return '<div class="vazio">Sem dados para exibir.</div>';
  const m = { t: 18, r: 12, b: 28, l: Math.max(34, String(fmtEixo ? fmtEixo(1e5) : '100000').length * 6.2 + 10) };
  const w = largura, h = altura, iw = w - m.l - m.r, ih = h - m.t - m.b;
  const topo = escalaTopo(Math.max(...pontos.map(p => p.valor), 0));
  const y = v => m.t + ih - (v / topo) * ih;
  const passo = iw / pontos.length, bw = Math.min(40, passo * 0.62);
  const x = i => m.l + passo * i + passo / 2;
  const mostraValor = passo >= 44;

  const grade = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const v = topo * f, yy = y(v);
    return `<line class="gr-grade" x1="${m.l}" x2="${w - m.r}" y1="${yy}" y2="${yy}"/><text class="gr-eixo" x="${m.l - 6}" y="${yy + 3.5}" text-anchor="end">${esc((fmtEixo || fmt)(v))}</text>`;
  }).join('');

  const barras = pontos.map((p, i) => {
    const yy = y(p.valor), hh = Math.max(0, m.t + ih - yy);
    return `<g><title>${esc(p.rotulo)}: ${esc(fmt(p.valor))}${p.parcial ? ' (mês em andamento)' : ''}</title>
      <rect class="gr-barra${p.parcial ? ' gr-parcial' : ''}" x="${x(i) - bw / 2}" y="${yy}" width="${bw}" height="${hh}" rx="3"/>
      ${mostraValor ? `<text class="gr-valor" x="${x(i)}" y="${yy - 5}" text-anchor="middle">${esc(fmt(p.valor))}</text>` : ''}
      <text class="gr-eixo" x="${x(i)}" y="${h - 9}" text-anchor="middle">${esc(p.rotulo)}</text></g>`;
  }).join('');

  let tendencia = '';
  const completos = pontos.map((p, i) => ({ i, v: p.valor, parcial: p.parcial })).filter(p => !p.parcial);
  if (completos.length >= 3) {          // tendência só com meses fechados (o parcial distorceria)
    const n = completos.length, sx = completos.reduce((s, p) => s + p.i, 0), sy = completos.reduce((s, p) => s + p.v, 0);
    const sxy = completos.reduce((s, p) => s + p.i * p.v, 0), sxx = completos.reduce((s, p) => s + p.i * p.i, 0);
    const den = n * sxx - sx * sx;
    if (den) {
      const b = (n * sxy - sx * sy) / den, a = (sy - b * sx) / n;
      const i0 = completos[0].i, i1 = pontos.length - 1;
      const clamp = v => Math.min(topo, Math.max(0, v));
      tendencia = `<line class="gr-tendencia" x1="${x(i0)}" y1="${y(clamp(a + b * i0))}" x2="${x(i1)}" y2="${y(clamp(a + b * i1))}"/>`;
    }
  }
  return `<svg class="gr-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Gráfico de barras">${grade}${barras}${tendencia}</svg>`;
}

// Barras horizontais em HTML (responsivas por natureza).
// itens: [{rotulo, valor, sub?}]
export function barrasHorizontais({ itens, fmt, max }) {
  if (!itens.length) return '<div class="vazio">Sem dados para exibir.</div>';
  const mx = max || Math.max(...itens.map(i => Math.abs(i.valor)), 1);
  return `<div class="hb">${itens.map(i => `
    <div class="hb-linha" title="${esc(i.rotulo)}: ${esc(fmt(i.valor))}">
      <div class="hb-rotulo">${esc(i.rotulo)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</div>
      <div class="hb-trilho"><div class="hb-barra${i.classe ? ' ' + i.classe : ''}" style="width:${Math.max(1.5, (Math.abs(i.valor) / mx) * 100)}%"></div></div>
      <div class="hb-valor">${esc(fmt(i.valor))}</div>
    </div>`).join('')}</div>`;
}
