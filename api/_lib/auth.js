// Helper compartilhado pelas funções em /api — valida que quem chamou está
// logado no dashboard (via Supabase Auth) antes de dar acesso a proxies pra
// sistemas de terceiros (Google Sheets, discadora, GitHub Actions).
//
// Pasta prefixada com "_" não vira rota própria no Vercel.

const SUPA_URL = 'https://kzlchetrpsfefwybaaoy.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6bGNoZXRycHNmZWZ3eWJhYW95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNTM4NDIsImV4cCI6MjA5NDYyOTg0Mn0.4euWpZZadXe9ayg6ITY5SNueEhU094ajJv379gC9YrU';

// Retorna o usuário autenticado ou null. Não lança — cabe ao chamador
// decidir o que fazer (normalmente responder 401).
export async function getAuthenticatedUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  try {
    const res = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function requireAuth(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Não autenticado' });
    return null;
  }
  return user;
}

// Busca a linha de perfil do usuário (usuarios_dashboard, com fallback pra
// usuarios legado) usando o MESMO token do usuário — respeita a RLS existente
// (auth.uid() = id), igual ao que o cliente já faz em carregarPerfil(). Nunca
// lança; retorna null se não achar linha em nenhuma das duas tabelas (chamador
// decide o que fazer — hoje: nega por padrão).
export async function getUsuarioDashboard(req, userId) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  const headers = { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${token}` };

  try {
    const resDash = await fetch(`${SUPA_URL}/rest/v1/usuarios_dashboard?id=eq.${userId}&select=*`, { headers });
    if (resDash.ok) {
      const rows = await resDash.json();
      if (rows[0]) return rows[0];
    }
    const resLeg = await fetch(`${SUPA_URL}/rest/v1/usuarios?id=eq.${userId}&select=*`, { headers });
    if (resLeg.ok) {
      const rows = await resLeg.json();
      if (rows[0]) return rows[0];
    }
    return null;
  } catch {
    return null;
  }
}
