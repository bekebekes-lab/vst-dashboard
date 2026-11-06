// Modal com todos os dados de um registro da base (usado pelas visões com lista de pedidos).
import { esc, icone } from './ui.js';

export function abrirDetalheRegistro(r) {
  const ov = document.createElement('div');
  ov.className = 'modal-fundo';
  const campos = Object.entries(r).filter(([, v]) => v !== '' && v != null);
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Dados do registro">
    <header><h3>${esc(r['NOME CLIENTE'] || 'Registro')}</h3><button type="button" class="btn-icone" data-x aria-label="Fechar">${icone('close')}</button></header>
    <dl>${campos.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>`;
  const fechar = () => { ov.remove(); document.removeEventListener('keydown', tecla); };
  const tecla = e => { if (e.key === 'Escape') fechar(); };
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) fechar(); });
  document.addEventListener('keydown', tecla);
  document.body.append(ov);
  ov.querySelector('[data-x]').focus();
}
