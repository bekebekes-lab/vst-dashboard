// Sessão do Beta2: mesmo cliente Supabase (mesma chave de storage => mesma
// sessão do Dash atual) e o "porteiro" da página.
//
// IMPORTANTE: o porteiro é só conveniência de navegação. A segurança de verdade
// continua no RLS do Supabase e nas rotas /api (api/_lib/auth.js + escopo.js),
// que são as mesmas do Dash atual e conferem o token em toda chamada.

import { SUPA_URL, SUPA_KEY, emailLiberadoBeta } from './config.js';

export const supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);

function voltarAoDash() {
  location.replace('/');
}

// Devolve { user, perfil } se o e-mail está liberado (config.js) e a conta está ativa; senão manda pro Dash atual.
// Quais abas/dados cada pessoa vê vem do perfil dela (permissoes.js + escopo), como no Dash atual.
export async function exigirAcessoBeta() {
  let session = null;
  try {
    ({ data: { session } } = await supa.auth.getSession());
  } catch (e) { /* trata como sem sessão */ }
  const user = session?.user;
  if (!user) return voltarAoDash();
  if (!emailLiberadoBeta(user.email)) return voltarAoDash();

  // Mesma busca de carregarPerfil() em index.html: usuarios_dashboard, com
  // fallback para a tabela legada "usuarios".
  let perfil = null;
  const r1 = await supa.from('usuarios_dashboard').select('*').eq('id', user.id).maybeSingle();
  perfil = r1.data;
  if (!perfil) {
    const r2 = await supa.from('usuarios').select('*').eq('id', user.id).maybeSingle();
    perfil = r2.data;
  }
  if (!perfil || perfil.ativo === false) return voltarAoDash();
  perfil.email = perfil.email || user.email;
  return { user, perfil };
}

// Header para chamadas autenticadas em /api/* (igual authHeaders() do index.html)
export async function authHeaders() {
  const { data: { session } } = await supa.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export async function sair() {
  try { await supa.auth.signOut(); } catch (e) { /* segue */ }
  location.replace('/');
}
