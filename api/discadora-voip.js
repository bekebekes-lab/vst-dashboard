// Uso de VoIP por grupo/dia (admin) — usado pra conferir o custo de licenças
// da discadora contra o uso real. Conta quantos usuarios DISTINTOS tiveram
// ao menos uma ligacao registrada em cada dia, por grupo (proxy de "quantas
// pessoas estavam conectadas" — nao existe uma tabela de login/logout,
// entao atividade de ligacao e o melhor sinal disponivel).
//
// A agregacao acontece aqui no servidor (nao manda as linhas cruas pro
// navegador) pra manter a resposta pequena mesmo em periodos longos —
// discadora_ligacoes tem centenas de milhares de linhas.
import { requireAuth, getUsuarioDashboard } from './_lib/auth.js';

const SUPA_URL = 'https://kzlchetrpsfefwybaaoy.supabase.co';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const perfilRow = await getUsuarioDashboard(req, authUser.id);
  if ((perfilRow?.perfil || 'consultor') !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }

  const { desde, ate } = req.query;
  if (!desde || !ate) return res.status(400).json({ error: 'Parâmetros "desde" e "ate" são obrigatórios (YYYY-MM-DD)' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurado no servidor' });

  const selectCols = 'data_registro,usuario_nome,grupo_nome';
  const filtro = `select=${selectCols}&data_registro=gte.${desde}T00:00:00&data_registro=lte.${ate}T23:59:59&order=data_registro.asc`;

  try {
    // Mesmo padrão de paginação por cursor de api/discadora-historico.js —
    // OFFSET seria lento demais nessa tabela.
    const PAGE_SIZE = 50000;
    const MAX_PAGINAS = 20;
    let rows = [];
    let cursor = null;
    let pagina = 0;
    while (pagina < MAX_PAGINAS) {
      pagina++;
      const url = `${SUPA_URL}/rest/v1/discadora_ligacoes?${filtro}&limit=${PAGE_SIZE}` +
        (cursor ? `&data_registro=gt.${encodeURIComponent(cursor)}` : '');
      const response = await fetch(url, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: err });
      }
      const lote = await response.json();
      if (!lote.length) break;
      rows = rows.concat(lote);
      if (lote.length < PAGE_SIZE) break;
      cursor = lote[lote.length - 1].data_registro;
    }

    // grupo -> dia (YYYY-MM-DD) -> Set de usuarios distintos naquele dia
    const acumulado = {};
    for (const r of rows) {
      const grupo = r.grupo_nome || '(sem grupo)';
      const dia = (r.data_registro || '').slice(0, 10);
      const usuario = r.usuario_nome || '(sem usuário)';
      if (!dia) continue;
      if (!acumulado[grupo]) acumulado[grupo] = {};
      if (!acumulado[grupo][dia]) acumulado[grupo][dia] = new Set();
      acumulado[grupo][dia].add(usuario);
    }

    // Devolve a lista de usuarios (nao só a contagem) — o painel usa isso
    // pra abrir o detalhe de quem exatamente estava ativo naquele grupo/dia,
    // sem precisar de uma segunda chamada.
    const grupos = Object.entries(acumulado)
      .map(([grupo, dias]) => ({
        grupo,
        dias: Object.entries(dias)
          .map(([data, usuarios]) => ({ data, usuarios: [...usuarios].sort() }))
          .sort((a, b) => a.data.localeCompare(b.data)),
      }))
      .sort((a, b) => a.grupo.localeCompare(b.grupo));

    res.status(200).json({ grupos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
