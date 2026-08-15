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
  const PAGE_SIZE = 50000;
  const MAX_PAGINAS = 10; // trava de segurança por pedaço (500 mil linhas)

  // Pagina por CURSOR (data_registro < último visto), não por OFFSET — com
  // centenas de milhares de linhas, OFFSET obriga o Postgres a varrer e
  // descartar tudo que veio antes a cada página, o que estourava o timeout
  // da consulta. Cursor usa o índice direto, sem esse custo por página.
  async function buscarPedaco(deIso, ateIso) {
    const filtro = `select=${selectCols}&data_registro=gte.${deIso}&data_registro=lte.${ateIso}${grupoTravado ? `&grupo_nome=eq.${encodeURIComponent(grupoTravado)}` : ''}&order=data_registro.desc`;
    let rows = [];
    let cursor = null;
    let pagina = 0;
    while (pagina < MAX_PAGINAS) {
      pagina++;
      const url = `${SUPA_URL}/rest/v1/discadora_ligacoes?${filtro}&limit=${PAGE_SIZE}` +
        (cursor ? `&data_registro=lt.${encodeURIComponent(cursor)}` : '');
      const response = await fetch(url, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const lote = await response.json();
      if (!lote.length) break;
      rows = rows.concat(lote);
      if (lote.length < PAGE_SIZE) break;
      cursor = lote[lote.length - 1].data_registro;
    }
    return rows;
  }

  try {
    // Divide o período pedido em pedaços de ~5 dias, buscados em paralelo —
    // cada pedaço tem seu próprio cursor independente, então não precisam
    // esperar um pelo outro. Isso é o que faz um range de 1+ mês responder
    // em segundos em vez de dezenas de segundos (soma sequencial de cada
    // pedaço).
    const DIAS_POR_PEDACO = 5;
    const MAX_PEDACOS = 20;
    const inicio = new Date(`${desde}T00:00:00Z`);
    const fim = new Date(`${ate}T00:00:00Z`);
    const pedacos = [];
    let cursorDia = new Date(inicio);
    while (cursorDia <= fim && pedacos.length < MAX_PEDACOS) {
      const deIso = cursorDia.toISOString().slice(0, 10) + 'T00:00:00';
      const fimPedaco = new Date(cursorDia);
      fimPedaco.setUTCDate(fimPedaco.getUTCDate() + DIAS_POR_PEDACO - 1);
      const ateReal = fimPedaco > fim ? fim : fimPedaco;
      const ateIso = ateReal.toISOString().slice(0, 10) + 'T23:59:59';
      pedacos.push([deIso, ateIso]);
      cursorDia.setUTCDate(cursorDia.getUTCDate() + DIAS_POR_PEDACO);
    }

    // Paralelo, mas em grupos pequenos — todos os pedaços de uma vez (ex.:
    // 9 pra um range de 44 dias) sobrecarrega o pool de conexões do
    // Supabase e os deixa lentos o bastante pra estourar o statement
    // timeout individual. 3 por vez equilibra ganho de paralelismo sem
    // gerar contenção.
    const CONCORRENCIA = 3;
    const rows = [];
    for (let i = 0; i < pedacos.length; i += CONCORRENCIA) {
      const grupo = pedacos.slice(i, i + CONCORRENCIA);
      const parciais = await Promise.all(grupo.map(([de, a]) => buscarPedaco(de, a)));
      parciais.forEach(p => rows.push(...p));
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
