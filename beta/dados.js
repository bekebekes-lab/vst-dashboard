// Acesso aos dados do Gerencial: mesmas rotas /api/sheets do Dash atual
// (que já filtram por escopo/perfil no servidor). Cache em memória por aba.

import { authHeaders } from './sessao.js';
import { parseLinhas, parseAba } from './nucleo.js';

const _cache = new Map();   // nome da aba -> Promise<linhas[]>

async function getJSON(url) {
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const j = await res.json(); msg = j.error?.message || j.error || msg; } catch (e) { /* mantém */ }
    throw new Error(msg);
  }
  return res.json();
}

export function limparCache(nomeAba) {
  if (nomeAba) _cache.delete(nomeAba); else _cache.clear();
}

// Linhas de uma aba da planilha (já como objetos).
export function carregarAba(nome, { forcar = false } = {}) {
  if (forcar) _cache.delete(nome);
  if (!_cache.has(nome)) {
    const p = getJSON(`/api/sheets?action=values&sheet=${encodeURIComponent(nome)}`)
      .then(j => parseLinhas(j.values || []))
      .catch(e => { _cache.delete(nome); throw e; });
    _cache.set(nome, p);
  }
  return _cache.get(nome);
}

// Para históricos longos (Painel Analítico): busca sem guardar as linhas cruas em memória.
export function buscarAbaSemCache(nome) {
  return getJSON(`/api/sheets?action=values&sheet=${encodeURIComponent(nome)}`).then(j => parseLinhas(j.values || []));
}
// Promessa da aba se ela já está em cache (senão undefined)
export function abaEmCache(nome) { return _cache.get(nome); }

// Abas históricas "BaseCRM MMYYYY", da mais recente para a mais antiga.
export async function listarAbasHistorico() {
  const j = await getJSON('/api/sheets?action=list');
  const abas = (j.sheets || []).map(s => s.properties.title).map(parseAba).filter(Boolean);
  return abas.sort((a, b) => (b.yyyy + b.mm).localeCompare(a.yyyy + a.mm));
}

// "Base atualizada em ..." — horário em que o robô confirmou a gravação (aba StatusBot).
export async function statusDaBase(nomeAba) {
  try {
    const j = await getJSON('/api/sheets?action=values&sheet=StatusBot');
    const linha = (j.values || []).slice(1).find(l => l[0] === nomeAba);
    const m = linha && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/.exec(linha[1] || '');
    return m ? `${m[3]}/${m[2]}/${m[1]} às ${m[4]}` : null;
  } catch (e) { return null; }
}
