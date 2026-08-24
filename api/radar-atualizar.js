// Chama o radar_bot.py agora (via GitHub Actions) pra revisitar as
// consultas de EV já em andamento, sem esperar o próximo agendamento
// (a cada 15min) — não grava nem altera nada, só antecipa o disparo.
import { requireAuth } from './_lib/auth.js';
import { dispatchRadarBot } from './_lib/radar-dispatch.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const githubToken = process.env.GITHUB_ACTIONS_TOKEN;
  if (!githubToken) {
    return res.status(500).json({ error: 'Configuração do servidor incompleta (token do GitHub ausente)' });
  }

  const ok = await dispatchRadarBot(githubToken);
  if (!ok) {
    return res.status(502).json({ error: 'Falha ao chamar o robô — tente de novo em alguns segundos.' });
  }

  res.status(200).json({ ok: true });
}
