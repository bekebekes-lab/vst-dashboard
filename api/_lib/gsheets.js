// Leitura da Google Sheets API por colunas, pra endpoints que precisam varrer
// várias abas grandes (ex.: api/qualidade.js) sem baixar as 63 colunas.
//
// Mesma credencial de serviço do api/sheets.js (GOOGLE_CREDENTIALS). A lógica
// de token é uma cópia de propósito: api/sheets.js é o caminho crítico do app
// inteiro e não deve ser mexido por causa de um endpoint novo.
import { createSign } from 'crypto';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let _token = null;
let _tokenExpira = 0;

async function getAccessToken() {
  const agora = Math.floor(Date.now() / 1000);
  if (_token && agora < _tokenExpira - 60) return _token;
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) throw new Error('GOOGLE_CREDENTIALS não configurado no servidor');
  const creds = JSON.parse(raw);
  const privateKey = creds.private_key.replace(/\\n/g, '\n');
  const claim = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600,
  };
  const entrada = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claim))}`;
  const assinatura = createSign('RSA-SHA256').update(entrada).sign(privateKey, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${entrada}.${assinatura}`,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Falha ao obter access token do Google');
  _token = data.access_token;
  _tokenExpira = agora + 3600;
  return _token;
}

async function gget(url) {
  const token = await getAccessToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Google Sheets respondeu ${res.status}`);
  return data;
}

export function normalizarCabecalho(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
}

export function letraDaColuna(i) { // 0 -> A, 26 -> AA
  let n = i + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export async function listarAbas(sheetId) {
  const d = await gget(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`);
  return (d.sheets || []).map(s => s.properties.title);
}

// Devolve { NOME_NORMALIZADO: [valores da coluna, a partir da linha 2] } só
// das colunas pedidas (em "nomes", já normalizados). Coluna ausente vem [].
export async function lerColunas(sheetId, titulo, nomes) {
  const q = `'${titulo.replace(/'/g, "''")}'`;
  const cab = await gget(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(q + '!1:1')}`);
  const header = (cab.values?.[0] || []).map(normalizarCabecalho);
  const achadas = nomes.map(n => ({ nome: n, idx: header.indexOf(n) }));
  const presentes = achadas.filter(a => a.idx >= 0);
  const out = Object.fromEntries(nomes.map(n => [n, []]));
  if (!presentes.length) return out;
  const ranges = presentes.map(a => `ranges=${encodeURIComponent(`${q}!${letraDaColuna(a.idx)}:${letraDaColuna(a.idx)}`)}`).join('&');
  const d = await gget(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?majorDimension=COLUMNS&${ranges}`);
  (d.valueRanges || []).forEach((vr, i) => {
    out[presentes[i].nome] = (vr.values?.[0] || []).slice(1); // tira o cabeçalho
  });
  return out;
}
