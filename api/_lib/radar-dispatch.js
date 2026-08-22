// Dispara o radar_bot.py (GitHub Actions) fora do agendamento normal (a
// cada 15min) — usado tanto ao enfileirar uma consulta nova quanto pelo
// botão "Atualizar" (só pra revisitar consultas já em andamento mais cedo).
// Falha aqui nunca deve travar quem chamou: o próximo agendamento processa
// mesmo se esse disparo imediato falhar.
export async function dispatchRadarBot(githubToken) {
  try {
    const resp = await fetch(
      'https://api.github.com/repos/bekebekes-lab/vst-dashboard/actions/workflows/radar_bot.yml/dispatches',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );
    if (resp.status !== 204) {
      console.error('Falha ao disparar o Radar Bot:', await resp.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('Falha ao disparar o Radar Bot:', e.message);
    return false;
  }
}
