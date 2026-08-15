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

  const params = new URLSearchParams({
    select: 'data_registro,duracao,telefonia,ddd_telefone,documento,lead_nome,usuario_nome,grupo_nome,fila_nome',
    data_registro: `gte.${desde}T00:00:00`,
    order: 'data_registro.desc',
  });
  // segundo filtro de data (lte) precisa de uma segunda entrada — URLSearchParams
  // não deixa duas chaves iguais com set(), então montamos a query manualmente
  const url = `${SUPA_URL}/rest/v1/discadora_ligacoes?${params.toString()}&data_registro=lte.${ate}T23:59:59${grupoTravado ? `&grupo_nome=eq.${encodeURIComponent(grupoTravado)}` : ''}`;

  try {
    // PostgREST devolve no máximo 1000 linhas por requisição (db-max-rows),
    // não importa o que a gente peça — pagina via header Range até acabar.
    const PAGE_SIZE = 1000;
    const MAX_PAGINAS = 500; // trava de segurança (500 mil linhas)
    let rows = [];
    let offset = 0;
    while (offset / PAGE_SIZE < MAX_PAGINAS) {
      const response = await fetch(url, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        },
      });
      if (!response.ok && response.status !== 206) {
        const err = await response.text();
        return res.status(response.status).json({ error: err });
      }
      const pagina = await response.json();
      rows = rows.concat(pagina);
      if (pagina.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
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
