// Serve o histórico de ligações (dias já fechados) direto do Supabase, em vez
// de paginar a API da discadora ao vivo — é isso que torna consultar datas
// antigas rápido. "Hoje" continua vindo ao vivo de /api/discadora (ver
// discadoraCarregar() em index.html).
import { requireAuth, getUsuarioDashboard } from './_lib/auth.js';

const SUPA_URL = 'https://kzlchetrpsfefwybaaoy.supabase.co';

// Espelha getGrupoDiscadoraTravado() em index.html — só gestor/supervisao
// têm a Discadora travada por grupo_ref; os demais perfis com acesso à aba
// (admin, gestor_macro, gestor_macro2) veem tudo, igual sempre foi.
function getGrupoTravado(perfil, u) {
  if ((perfil === 'gestor' || perfil === 'supervisao') && u?.grupo_ref) return u.grupo_ref;
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const { desde, ate } = req.query;
  if (!desde || !ate) return res.status(400).json({ error: 'Parâmetros "desde" e "ate" são obrigatórios (YYYY-MM-DD)' });

  const perfilRow = await getUsuarioDashboard(req, authUser.id);
  const perfil = perfilRow?.perfil || 'consultor';
  const grupoTravado = getGrupoTravado(perfil, perfilRow);

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurado no servidor' });

  const selectCols = 'data_registro,duracao,telefonia,ddd_telefone,documento,lead_nome,usuario_nome,grupo_nome,fila_nome';
  const filtroBase = `select=${selectCols}&data_registro=gte.${desde}T00:00:00&data_registro=lte.${ate}T23:59:59${grupoTravado ? `&grupo_nome=eq.${encodeURIComponent(grupoTravado)}` : ''}&order=data_registro.desc`;

  try {
    // Pagina por CURSOR (data_registro < último visto), não por OFFSET —
    // com ~300 mil linhas, OFFSET obriga o Postgres a varrer e descartar
    // tudo que veio antes a cada página, o que estourava o timeout da
    // consulta pra ranges grandes. Cursor usa o índice direto, sem esse
    // custo crescente por página.
    const PAGE_SIZE = 50000;
    const MAX_PAGINAS = 20; // trava de segurança (1 milhão de linhas)
    let rows = [];
    let cursor = null;
    let pagina = 0;
    while (pagina < MAX_PAGINAS) {
      pagina++;
      const url = `${SUPA_URL}/rest/v1/discadora_ligacoes?${filtroBase}&limit=${PAGE_SIZE}` +
        (cursor ? `&data_registro=lt.${encodeURIComponent(cursor)}` : '');
      const response = await fetch(url, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
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

    // Reformata pro mesmo shape que o cliente já espera de listar_historico_contato
    // (GraphQL aninhado), pra não precisar reescrever discadoraRender()/discDrillDown().
    const registros = rows.map(r => ({
      dataRegistro: r.data_registro,
      duracao: r.duracao,
      telefonia: r.telefonia,
      dddTelefone: r.ddd_telefone,
      documento: r.documento,
      lead: { nome: r.lead_nome },
      usuario: { nome: r.usuario_nome },
      grupo: { nome: r.grupo_nome },
      fila: { nome: r.fila_nome },
    }));

    res.status(200).json({ registros });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
