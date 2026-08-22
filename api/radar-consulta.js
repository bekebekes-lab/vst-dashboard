// Enfileira uma consulta de viabilidade no Radar (Salesforce da Embratel) —
// grava um registro "pendente" em conectividade_estudos_viabilidade e
// dispara o radar_bot.py (GitHub Actions), que faz a consulta de verdade e
// devolve o resultado pra essa mesma linha. Nunca acessa o Radar direto
// daqui — só o bot (Playwright) loga lá.
import { requireAuth, getUsuarioDashboard } from './_lib/auth.js';
import { resolverItemDeProdutoRadar } from './_lib/radar-catalogo.js';
import { dispatchRadarBot } from './_lib/radar-dispatch.js';

const SUPA_URL = 'https://kzlchetrpsfefwybaaoy.supabase.co';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  // EV - Estudo de Viabilidade ainda em teste — restrito a admin por
  // enquanto, mesma trava aplicada no front (initConectividade()).
  const perfilRowAcesso = await getUsuarioDashboard(req, authUser.id);
  if (perfilRowAcesso?.perfil !== 'admin') {
    return res.status(403).json({ error: 'Consulta de viabilidade (EV) ainda em teste — disponível só pra admin.' });
  }

  // Cada item já vem com seu PRÓPRIO cliente/CNPJ/CEP/plano — permite
  // consultar vários clientes/endereços diferentes numa mesma leva, não só
  // vários planos pro mesmo cliente. `itens` sempre tem pelo menos 1
  // elemento (o front manda o formulário avulso como um item único quando
  // não há nada no carrinho).
  const { itens } = req.body || {};

  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: 'Selecione ao menos um cliente/endereço pra consultar' });
  }

  const linhas = [];
  for (const item of itens) {
    const clienteFinal = (item?.clienteFinal || '').trim();
    const cep = (item?.cep || '').replace(/\D/g, '');
    if (!clienteFinal) {
      return res.status(400).json({ error: 'Cliente Final é obrigatório em todos os itens' });
    }
    if (!/^\d{8}$/.test(cep)) {
      return res.status(400).json({ error: `CEP inválido para "${clienteFinal}"` });
    }
    const catalogo = resolverItemDeProdutoRadar(item?.tipoOferta, item?.velocidade);
    if (!catalogo) {
      return res.status(400).json({ error: `Não há correspondência no catálogo do Radar para "${item?.tipoOferta}" / "${item?.velocidade}" — consulta de viabilidade ainda não disponível pra essa oferta.` });
    }
    linhas.push({ clienteFinal, cep, catalogo, item });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const githubToken = process.env.GITHUB_ACTIONS_TOKEN;
  if (!serviceKey || !githubToken) {
    return res.status(500).json({ error: 'Configuração do servidor incompleta (service role ou token do GitHub ausente)' });
  }

  const consultorNome = perfilRowAcesso?.nome || authUser.email?.split('@')[0] || authUser.email || 'Usuário';

  let novasLinhas;
  try {
    const respInsert = await fetch(`${SUPA_URL}/rest/v1/conectividade_estudos_viabilidade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(linhas.map(({ clienteFinal, cep, catalogo, item }) => ({
        consultor_id: authUser.id,
        consultor_nome: consultorNome,
        razao_social: (item.razaoSocial || clienteFinal || '').trim() || null,
        cnpj: (item.cnpj || '').trim() || null,
        cliente_final: clienteFinal,
        quantidade_circuitos: Number(item.quantidadeCircuitos) || 1,
        cep,
        status: 'pendente',
        produto: catalogo.produto,
        item_produto: catalogo.itemProduto,
      }))),
    });
    if (!respInsert.ok) {
      const erro = await respInsert.text();
      return res.status(500).json({ error: `Falha ao gravar a consulta: ${erro}` });
    }
    novasLinhas = await respInsert.json();
  } catch (e) {
    return res.status(500).json({ error: `Falha ao gravar a consulta: ${e.message}` });
  }

  await dispatchRadarBot(githubToken);

  res.status(200).json({ ok: true, ids: novasLinhas.map(l => l.id) });
}
