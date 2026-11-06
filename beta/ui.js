// Utilidades de interface do Beta2: escape, formatação, ícones, multi-seleção.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const fmtInt = v => Math.round(v || 0).toLocaleString('pt-BR');
export const fmtDec = (v, d = 1) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtMoeda = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtMoedaCurta = v => {
  v = v || 0;
  if (Math.abs(v) >= 1e6) return 'R$ ' + fmtDec(v / 1e6, 1) + ' mi';
  if (Math.abs(v) >= 1e3) return 'R$ ' + fmtDec(v / 1e3, 0) + ' mil';
  return 'R$ ' + fmtDec(v, 0);
};
export const fmtPct = v => fmtDec(v, 1) + '%';

export function iniciais(nome) {
  return (nome || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

// Ícones de traço (24x24), um conjunto pequeno e consistente.
const P = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r="1"/>',
  bars: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9.5 4.5 4.5 0 0 1 17.5 18z"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2"/>',
  file: '<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16 10"/>',
  signal: '<path d="M5 18v-2M10 18v-6M15 18V9M20 18V5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-3.5M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 3.5M20 20v-4h-4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  cards: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  chart: '<path d="M4 20h16"/><rect x="6" y="11" width="3" height="9" rx=".5"/><rect x="11" y="5" width="3" height="15" rx=".5"/><rect x="16" y="14" width="3" height="6" rx=".5"/>',
  warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  out: '<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M10 8l-4 4 4 4M6 12h11"/>',
  back: '<path d="M10 6 4 12l6 6M4 12h16"/>',
};
export function icone(nome, tam = 18) {
  return `<svg class="ic" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[nome] || ''}</svg>`;
}

// ── multi-seleção com busca (Gestor / Equipe / Consultor) ───────────────────
// Devolve { el, atualizar(opcoes, selecionados) }. onChange(array) a cada mudança.
export function criarMultiSelect({ rotulo, onChange }) {
  const el = document.createElement('div');
  el.className = 'ms';
  el.innerHTML = `
    <button type="button" class="chip ms-btn" aria-haspopup="listbox" aria-expanded="false">
      <span class="ms-txt"></span>${icone('chevron', 14)}
    </button>
    <div class="ms-pop" hidden>
      <input type="search" class="ms-busca" placeholder="Buscar…" aria-label="Buscar em ${esc(rotulo)}">
      <div class="ms-acoes"><button type="button" data-a="limpar">Limpar</button></div>
      <div class="ms-lista" role="listbox" aria-multiselectable="true"></div>
    </div>`;
  const btn = el.querySelector('.ms-btn'), pop = el.querySelector('.ms-pop');
  const lista = el.querySelector('.ms-lista'), busca = el.querySelector('.ms-busca');
  let opcoes = [], sel = new Set();

  const rotuloBtn = () => {
    const t = el.querySelector('.ms-txt');
    t.textContent = sel.size === 0 ? `${rotulo}: Todos` : sel.size === 1 ? `${rotulo}: ${[...sel][0]}` : `${rotulo}: ${sel.size} selec.`;
    btn.classList.toggle('chip-ativo', sel.size > 0);
  };
  const desenhar = () => {
    const q = busca.value.trim().toLowerCase();
    const todas = [...new Set([...opcoes, ...sel])];   // mantém selecionados que sumiram da cascata
    lista.innerHTML = todas.filter(o => !q || o.toLowerCase().includes(q)).map(o =>
      `<label class="ms-item"><input type="checkbox" value="${esc(o)}" ${sel.has(o) ? 'checked' : ''}><span>${esc(o)}</span></label>`
    ).join('') || '<div class="ms-vazio">Nenhuma opção</div>';
  };
  const abrir = abrirFlag => {
    pop.hidden = !abrirFlag;
    btn.setAttribute('aria-expanded', String(abrirFlag));
    if (abrirFlag) { busca.value = ''; desenhar(); busca.focus({ preventScroll: true }); }
  };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelectorAll('.ms-pop').forEach(p => { if (p !== pop) { p.hidden = true; } });
    abrir(pop.hidden);
  });
  pop.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => { if (!pop.hidden) abrir(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) abrir(false); });
  busca.addEventListener('input', desenhar);
  lista.addEventListener('change', e => {
    const cb = e.target; if (cb.type !== 'checkbox') return;
    cb.checked ? sel.add(cb.value) : sel.delete(cb.value);
    rotuloBtn(); onChange([...sel]);
  });
  pop.querySelector('[data-a="limpar"]').addEventListener('click', () => {
    sel = new Set(); rotuloBtn(); desenhar(); onChange([]);
  });
  rotuloBtn();
  return {
    el,
    atualizar(novasOpcoes, selecionados) {
      opcoes = novasOpcoes; sel = new Set(selecionados || []); rotuloBtn();
      if (!pop.hidden) desenhar();
    },
  };
}

// armazenamento por visitante (preferências) — nunca pode quebrar a página
export const prefs = {
  get(k, padrao) { try { const v = localStorage.getItem('beta2_' + k); return v === null ? padrao : v; } catch (e) { return padrao; } },
  set(k, v) { try { localStorage.setItem('beta2_' + k, v); } catch (e) { /* ignora */ } },
};
