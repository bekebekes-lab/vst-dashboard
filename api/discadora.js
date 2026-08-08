import { requireAuth } from './_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAuth(req, res))) return;

  const apiKey = process.env.MAKESYSTEM_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'MAKESYSTEM_API_KEY não configurado no servidor' });

  try {
    const response = await fetch('https://legacyapi.makesystem.com.br/historic/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'key': apiKey
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
