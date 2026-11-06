// Dados e regras da Carteira (planilha separada) — usados pela visão Carteira e (futuro) pelo Churn.
// Regras COPIADAS de index.html (ABA CARTEIRA, ~13548-13680 e ~14060-14300). Manter em sincronia.

import { authHeaders } from './sessao.js';
import { MAPEAMENTO_TAGS } from './regras.js';

export const LIMIAR_TM = { CG: 16, CB: 16, CF: 16, CD: 16, CC: 18, CE: 18, MI: 18, CA: 24 };
export const CAMPOS_IGNORADOS = new Set(['YAB', 'ERECHIM', 'BRS', 'EMERSONPR', 'GLOBECOM', 'JANETE', 'TELECT', 'PELOTAS', 'JULIANO BASTOS', 'LAURA LIS SANTOS', 'MARIA']);
export const TM_VAZIO = '(Vazias)';
export const CNAE_VAZIO = '(Sem CNAE)';
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export const FAIXAS_TM = [
  { label: '0 a 5 meses', min: 0, max: 5 }, { label: '6 a 12 meses', min: 6, max: 12 }, { label: '13 a 16 meses', min: 13, max: 16 },
  { label: '17 a 24 meses', min: 17, max: 24 }, { label: '25 a 30 meses', min: 25, max: 30 }, { label: '31+ meses', min: 31, max: Infinity },
];
export const FAIXAS_LINHAS = [
  { label: '1 a 5 linhas', min: 1, max: 5 }, { label: '6 a 10 linhas', min: 6, max: 10 }, { label: '11 a 20 linhas', min: 11, max: 20 },
  { label: '21 a 50 linhas', min: 21, max: 50 }, { label: '51+ linhas', min: 51, max: Infinity },
];
export const faixaDe = (valor, faixas) => faixas.find(f => valor >= f.min && valor <= f.max)?.label || null;

async function getJSON(url) {
  const res = await fetch(url, { headers: await authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || ('Erro ' + res.status));
  return json;
}

// "CARTEIRA 082026 2" = ago/2026 v2 (index.html carteiraParseNomeBase)
export function parseNomeBase(titulo) {
  const m = titulo.match(/(\d{2})(\d{4})(?:\D+(\d+))?\s*$/);
  if (!m) return null;
  const mes = parseInt(m[1], 10), ano = parseInt(m[2], 10);
  if (mes < 1 || mes > 12) return null;
  return { titulo, mes, ano, versao: m[3] ? parseInt(m[3], 10) : 1 };
}
let _bases = null;
export async function listarBases() {
  if (_bases) return _bases;
  const j = await getJSON('/api/sheets?action=list&planilha=carteira');
  _bases = (j.sheets || []).map(s => s.properties?.title).filter(Boolean).map(parseNomeBase).filter(Boolean)
    .sort((a, b) => b.ano - a.ano || b.mes - a.mes || b.versao - a.versao);
  return _bases;
}
export function escolherBasePadrao(bases) {
  const agora = new Date(), mes = agora.getMonth() + 1, ano = agora.getFullYear();
  return bases.find(b => b.mes === mes && b.ano === ano) || bases[0] || null;
}
export function rotuloBase(base, bases) {
  const outra = bases.some(b => b !== base && b.mes === base.mes && b.ano === base.ano);
  return `${MESES[base.mes - 1] || base.mes}/${base.ano}${outra ? ` (v${base.versao})` : ''}`;
}
const _cache = {};
export async function baixarBase(chave) {
  resetCampos();
  if (_cache[chave]) return _cache[chave];
  const j = await getJSON('/api/sheets?action=values&sheet=' + encodeURIComponent(chave) + '&planilha=carteira');
  const rows = j.values || [];
  if (rows.length < 2) throw new Error('Planilha sem dados.');
  const headers = rows[0];
  _cache[chave] = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { if (obj[h] === undefined) obj[h] = (r[i] || '').toString().trim(); });   // cabeçalho duplicado: vale o primeiro
    return obj;
  });
  return _cache[chave];
}
export function limparCache() { Object.keys(_cache).forEach(k => delete _cache[k]); _bases = null; }

// ── helpers de linha ────────────────────────────────────────────────────────
export function valor(v) { const s = (v || '').toString().trim(); return (s && s !== '-' && s !== '#N/A' && s !== '#N/D' && s !== '#NOME?') ? s : ''; }
export function num(v) {
  const s = (v || '').toString().trim();
  if (!s || s === '-' || s === '#N/A' || s === '#N/D' || s === '#NOME?') return 0;
  const n = parseInt(s.replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}
// cabeçalhos mudam de caixa entre abas (ex.: "Quantidade de Linhas (Voz)"): acesso case-insensitive
let _mapaCampos = null;                      // índice minúsculo -> nome real, montado uma vez por base
export function resetCampos() { _mapaCampos = null; }
export function campo(r, nome) {
  if (r[nome] !== undefined) return r[nome];
  if (!_mapaCampos) { _mapaCampos = {}; Object.keys(r).forEach(k => { _mapaCampos[k.toLowerCase()] = k; }); }
  const real = _mapaCampos[nome.toLowerCase()];
  return real !== undefined ? r[real] : undefined;
}
export const linhas = r => num(campo(r, 'Quantidade de linhas (Voz)'));
export const tm = r => num(campo(r, 'Tempo de contrato (Voz)'));
export const linhasBL = r => num(campo(r, 'Quantidade de linhas (Banda Larga)'));
export const tmBL = r => num(campo(r, 'Tempo de contrato (Banda Larga)'));
export const temAtividade = r => linhas(r) > 0 || linhasBL(r) > 0;
export function unidade(r) {
  const texto = (r['Território'] || '').trim(); if (!texto) return '—';
  const partes = texto.split('-').map(s => s.trim()).filter(Boolean), codigo = partes[partes.length - 1];
  if (!codigo) return '—';
  return MAPEAMENTO_TAGS['#' + codigo.toUpperCase()] || codigo;
}
export function associada(r) { for (const col of CAMPOS_IGNORADOS) if (valor(r[col])) return col; return null; }
export function aptoBase(t, classe, visao12) { if (visao12) return t >= 12; const l = LIMIAR_TM[(classe || '').trim().toUpperCase()]; return l !== undefined && t >= l; }
export const cnaeCodigo = r => { const d = String(campo(r, 'CNAE') ?? '').replace(/\D/g, ''); return d ? d.padStart(7, '0') : ''; };
export const cnaeDescricao = r => String(campo(r, 'Descrição CNAE') ?? '').trim();
export const cnaeFormatado = cod => (cod && cod.length === 7 ? `${cod.slice(0, 4)}-${cod[4]}/${cod.slice(5)}` : (cod || ''));
export function cnaeChave(r) { const cod = cnaeCodigo(r); if (!cod) return CNAE_VAZIO; const d = cnaeDescricao(r); return cnaeFormatado(cod) + (d ? ' · ' + d : ''); }
export const ufDe = r => (r['UF'] || '').trim().toUpperCase();
