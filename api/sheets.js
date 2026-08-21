// Vercel Serverless Function — proxy para a Google Sheets API
//
// Autentica como Service Account (mesma credencial que o bot.py já usa pra
// ESCREVER na planilha, em GOOGLE_CREDENTIALS) em vez de usar uma API key
// pública. Isso permite que a planilha fique com compartilhamento restrito
// (só a service account precisa ter acesso) em vez de "Qualquer pessoa com
// o link pode visualizar".
//
// Sem dependências externas — usa apenas o módulo "crypto" nativo do Node
// pra assinar o JWT do fluxo OAuth2 de service account do Google.

import { createSign } from 'crypto';
import { requireAuth, getUsuarioDashboard } from './_lib/auth.js';
import { getEscopoTravado, linhaDentroDoEscopo, normalizarNomeEquipe } from './_lib/escopo.js';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Cache do access token em memória do módulo — sobrevive entre invocações
// enquanto o container da function ficar "quente" (comum na Vercel entre
// requisições próximas), evitando repetir a assinatura JWT + round-trip ao
// Google em toda chamada. O token dura 1h; renova com 60s de margem.
let _cachedToken = null;
let _cachedTokenExpiraEm = 0;

async function getAccessToken() {
  const agora = Math.floor(Date.now() / 1000);
  if (_cachedToken && agora < _cachedTokenExpiraEm - 60) return _cachedToken;

  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) throw new Error('GOOGLE_CREDENTIALS não configurado no servidor');

  const creds = JSON.parse(raw);
  const privateKey = creds.private_key.replace(/\\n/g, '\n');

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Falha ao obter access token');

  _cachedToken = data.access_token;
  _cachedTokenExpiraEm = agora + 3600;
  return _cachedToken;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  // "planilha" seleciona qual spreadsheet consultar — mesma conta de
  // serviço, arquivos diferentes. Omitir o parâmetro mantém o
  // comportamento de sempre (BaseCRM), pra não afetar nenhuma chamada
  // já existente no cliente.
  const PLANILHAS = {
    basecrm: process.env.GOOGLE_SHEETS_ID,
    carteira: process.env.GOOGLE_SHEETS_CARTEIRA_ID,
  };
  const { action, sheet, planilha } = req.query;
  const sheetId = PLANILHAS[planilha] || PLANILHAS.basecrm;
  if (!sheetId) return res.status(500).json({ error: `Planilha "${planilha || 'basecrm'}" não configurada no servidor` });

  // Carteira é admin-only na UI (aba só aparece pra perfil='admin') — trava
  // aqui também, explícito, em vez de confiar no efeito colateral de escopo
  // nulo (que também vale pra perfil sem escopo configurado, não só admin).
  // Exceção: usuários com 'carteira' em acesso_extra_abas (concessão pontual
  // por usuário, sem mudar o perfil nem a trava de escopo dele).
  if (planilha === 'carteira') {
    const perfilRowCarteira = await getUsuarioDashboard(req, authUser.id);
    const temAcessoExtra = (perfilRowCarteira?.acesso_extra_abas || []).includes('carteira');
    if ((perfilRowCarteira?.perfil || 'consultor') !== 'admin' && !temAcessoExtra) {
      return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }
  }

  let url;
  if (action === 'list') {
    url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`;
  } else if (action === 'values') {
    if (!sheet) return res.status(400).json({ error: 'Parâmetro "sheet" é obrigatório para action=values' });
    url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheet)}`;
  } else {
    return res.status(400).json({ error: 'Parâmetro "action" inválido (use "list" ou "values")' });
  }

  try {
    const accessToken = await getAccessToken();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await response.json();

    // Filtra as linhas pelo escopo travado do usuário ANTES de devolver —
    // hoje o navegador recebia a base inteira e filtrava na tela; qualquer
    // um com F12 conseguia ler os dados de todo mundo em ALL_DATA. Admin
    // (escopo null) continua recebendo exatamente o que sempre recebeu,
    // sem passar por nenhuma linha de código nova abaixo.
    if (action === 'values' && response.ok && Array.isArray(data.values) && data.values.length > 0) {
      const perfilRow = await getUsuarioDashboard(req, authUser.id);
      const perfil = perfilRow?.perfil || 'consultor';
      const escopo = getEscopoTravado(perfil, perfilRow);

      if (escopo) {
        const header = data.values[0];
        const idxEquipe = header.indexOf('EQUIPE');
        const idxProprietario = header.indexOf('PROPRIETÁRIO DO PEDIDO');

        if (idxEquipe === -1 || idxProprietario === -1) {
          // Aba sem essas colunas — não dá pra filtrar com segurança, então
          // devolve só o cabeçalho (nenhuma linha de dado) em vez de vazar
          // tudo sem filtro.
          data.values = [header];
        } else {
          const linhas = data.values.slice(1).filter(row => {
            const equipeNorm = normalizarNomeEquipe(row[idxEquipe]);
            return linhaDentroDoEscopo(equipeNorm, row[idxProprietario], escopo);
          });
          data.values = [header, ...linhas];
        }
      }
    }

    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
