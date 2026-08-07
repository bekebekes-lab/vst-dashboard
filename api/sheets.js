// Vercel Serverless Function — proxy para a Google Sheets API
// A API key e o ID da planilha ficam seguros em GOOGLE_SHEETS_API_KEY e
// GOOGLE_SHEETS_ID (env vars do Vercel), nunca expostos no client.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!apiKey || !sheetId) {
    return res.status(500).json({ error: 'GOOGLE_SHEETS_API_KEY ou GOOGLE_SHEETS_ID não configurados no servidor' });
  }

  const { action, sheet } = req.query;

  let url;
  if (action === 'list') {
    url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${apiKey}&fields=sheets.properties.title`;
  } else if (action === 'values') {
    if (!sheet) return res.status(400).json({ error: 'Parâmetro "sheet" é obrigatório para action=values' });
    url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheet)}?key=${apiKey}`;
  } else {
    return res.status(400).json({ error: 'Parâmetro "action" inválido (use "list" ou "values")' });
  }

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
