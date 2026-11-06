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

// Rosca (SVG) + legenda. itens: [{rotulo, valor, cor, nota?}]; centro: {t1, t2}
export function rosca({ itens, centro, fmt }) {
  const positivos = itens.filter(i => i.valor > 0);
  const soma = positivos.reduce((s, i) => s + i.valor, 0);
  if (!soma) return '<div class="vazio">Sem dados para exibir.</div>';
  const R = 70, C = 2 * Math.PI * R;
  let acum = 0;
  const arcos = positivos.map(i => {
    const len = (i.valor / soma) * C;
    const el = `<circle r="${R}" cx="100" cy="100" fill="none" stroke="${i.cor}" stroke-width="30" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-acum).toFixed(2)}" transform="rotate(-90 100 100)"><title>${esc(i.rotulo)}: ${esc(fmt(i.valor))}</title></circle>`;
    acum += len; return el;
  }).join('');
  return `<div class="rosca">
    <svg viewBox="0 0 200 200" class="rosca-svg" role="img" aria-label="Gráfico de rosca">${arcos}
      <text x="100" y="97" text-anchor="middle" class="rosca-t1">${esc(centro.t1)}</text><text x="100" y="116" text-anchor="middle" class="rosca-t2">${esc(centro.t2)}</text></svg>
    <div class="rosca-leg">${itens.map(i => `<div class="rosca-item"><span class="ponto" style="background:${i.cor}"></span><span class="rosca-nome">${esc(i.rotulo)}</span>
      <span class="rosca-val">${esc(fmt(i.valor))}${i.valor > 0 && !i.fora ? ` <small>(${((i.valor / soma) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)</small>` : ''}</span></div>`).join('')}</div>
  </div>`;
}

// Linhas por mês (várias séries). meses: [{label, mm, yyyy}]; series: [{k, rotulo, cor, valores, destaque?}]
export function linhasMensais({ meses, series, largura, fmt, fmtEixo, altura = 260 }) {
  if (!meses.length) return '<div class="vazio">Carregando meses…</div>';
  const W = Math.max(320, largura), H = altura, ml = 58, mr = 18, mt = 28, mb = 46, pad = 28;
  const max = Math.max(1, ...series.flatMap(s => s.valores));
  const bruto = max / 4, pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map(x => x * pot).find(p => p >= bruto) || pot * 10, topo = passo * 4;
  const n = meses.length;
  const x = i => ml + pad + (n === 1 ? (W - ml - mr - 2 * pad) / 2 : (i * (W - ml - mr - 2 * pad)) / (n - 1));
  const y = v => mt + (H - mt - mb) * (1 - v / topo);
  let grade = '';
  for (let t = 0; t <= 4; t++) { const v = passo * t; grade += `<line class="gr-grade" x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}"/><text class="gr-eixo" x="${ml - 8}" y="${y(v) + 4}" text-anchor="end">${esc((fmtEixo || fmt)(v))}</text>`; }
  const ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  let eixo = '', anos = [];
  meses.forEach((m, i) => {
    eixo += `<text class="gr-eixo" x="${x(i)}" y="${H - mb + 15}" text-anchor="middle">${ABREV[parseInt(m.mm, 10) - 1]}</text>`;
    const u = anos[anos.length - 1]; if (u && u.ano === m.yyyy) u.fim = i; else anos.push({ ano: m.yyyy, ini: i, fim: i });
  });
  anos.forEach((a, j) => {
    eixo += `<text class="gr-eixo gr-ano" x="${(x(a.ini) + x(a.fim)) / 2}" y="${H - 6}" text-anchor="middle">${a.ano}</text>`;
    if (j > 0) { const xs = (x(a.ini) + x(a.ini - 1)) / 2; eixo += `<line class="gr-sep" x1="${xs}" x2="${xs}" y1="${mt}" y2="${H - mb + 20}"/>`; }
  });
  let linhas = '', rotulos = '';
  [...series.filter(s => !s.destaque), ...series.filter(s => s.destaque)].forEach(s => {
    const pts = s.valores.map((v, i) => [x(i), y(v), v]);
    linhas += `<polyline fill="none" stroke="${s.cor}" stroke-width="${s.destaque ? 3 : 2}" stroke-linejoin="round" points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`;
    pts.forEach(([px, py, v], i) => {
      linhas += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${s.destaque ? 4 : 3}" fill="${s.cor}"><title>${esc(meses[i].label)} · ${esc(s.rotulo)}: ${esc(fmt(v))}</title></circle>`;
      if (n <= 14 && W / n >= 46) {
        if (!s.destaque) rotulos += `<text class="gr-valor gr-valor-s" x="${px.toFixed(1)}" y="${(py - 6).toFixed(1)}" text-anchor="middle">${esc(fmt(v))}</text>`;
        else { const t = fmt(v), w = t.length * 6.2 + 12; rotulos += `<g><rect x="${(px - w / 2).toFixed(1)}" y="${(py - 25).toFixed(1)}" width="${w.toFixed(1)}" height="17" rx="4" fill="${s.cor}"/><text class="gr-valor-t" x="${px.toFixed(1)}" y="${(py - 12.7).toFixed(1)}" text-anchor="middle">${esc(t)}</text></g>`; }
      }
    });
  });
  return `<svg class="gr-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de linhas por mês">${grade}${eixo}${linhas}${rotulos}</svg>`;
}
