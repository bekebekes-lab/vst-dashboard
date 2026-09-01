// Vercel Serverless Function — dispara o NeoSales Bot no GitHub Actions
// Token fica seguro em GITHUB_ACTIONS_TOKEN (env var do Vercel)

import { requireAuth } from './_lib/auth.js';

export default async function handler(req, res) {
  // Só aceita POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAuth(req, res))) return;

  const token = process.env.GITHUB_ACTIONS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Token não configurado' });
  }

  // Repassa o período selecionado no Dash pro bot — "BaseCRM" (Atual/Live)
  // vira input vazio (mês corrente, comportamento de sempre); uma aba
  // histórica "BaseCRM MMYYYY" vira o input "MMYYYY", que o bot.py usa pra
  // extrair o mês inteiro e gravar na aba correspondente, sem tocar na live.
  const periodoSelecionado = (req.body?.periodo || 'BaseCRM').toString().trim();
  const matchHistorico = periodoSelecionado.match(/^BaseCRM\s+(\d{2})(\d{4})$/);
  const periodoInput = matchHistorico ? `${matchHistorico[1]}${matchHistorico[2]}` : '';

  try {
    const response = await fetch(
      'https://api.github.com/repos/bekebekes-lab/vst-dashboard/actions/workflows/bot.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { periodo: periodoInput } }),
      }
    );

    // GitHub retorna 204 No Content em caso de sucesso
    if (response.status === 204) {
      return res.status(200).json({ ok: true, message: 'Bot disparado com sucesso' });
    }

    const errorBody = await response.text();
    return res.status(response.status).json({ error: errorBody });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
