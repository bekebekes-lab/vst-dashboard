// Enfileira uma consulta de viabilidade no Radar (Salesforce da Embratel) —
// grava um registro "pendente" em conectividade_estudos_viabilidade e
// dispara o radar_bot.py (GitHub Actions), que faz a consulta de verdade e
// devolve o resultado pra essa mesma linha. Nunca acessa o Radar direto
// daqui — só o bot (Playwright) loga lá.
import { requireAuth, getUsuarioDashboard } from './_lib/auth.js';
import { resolverItemDeProdutoRadar } from './_lib/radar-catalogo.js';

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

  const {
    clienteFinal, razaoSocial, cnpj, cep, quantidadeCircuitos, planos,
  } = req.body || {};

  if (!clienteFinal || !clienteFinal.trim()) {
    return res.status(400).json({ error: 'Cliente Final é obrigatório' });
  }
  if (!cep || !/^\d{8}$/.test(cep.replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'CEP inválido' });
  }
  if (!Array.isArray(planos) || planos.length === 0) {
    return res.status(400).json({ error: 'Selecione ao menos um plano/velocidade pra consultar' });
  }

  // Cada plano (tipoOferta+velocidade) vira sua PRÓPRIA linha na fila — o
  // bot já processa a fila item por item, então uma consulta "múltipla" é
  // só várias linhas com o mesmo cliente/CEP enfileiradas de uma vez.
  const catalogos = [];
  for (const plano of planos) {
    const catalogo = resolverItemDeProdutoRadar(plano?.tipoOferta, plano?.velocidade);
    if (!catalogo) {
      return res.status(400).json({ error: `Não há correspondência no catálogo do Radar para "${plano?.tipoOferta}" / "${plano?.velocidade}" — consulta de viabilidade ainda não disponível pra essa oferta.` });
    }
    catalogos.push(catalogo);
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const githubToken = process.env.GITHUB_ACTIONS_TOKEN;
  if (!serviceKey || !githubToken) {
    return res.status(500).json({ error: 'Configuração do servidor incompleta (service role ou token do GitHub ausente)' });
  }

  const consultorNome = perfilRowAcesso?.nome || authUser.email?.split('@')[0] || authUser.email || 'Usuário';

  const linhaBase = {
    consultor_id: authUser.id,
    consultor_nome: consultorNome,
    razao_social: (razaoSocial || '').trim() || null,
    cnpj: (cnpj || '').trim() || null,
    cliente_final: clienteFinal.trim(),
    quantidade_circuitos: Number(quantidadeCircuitos) || 1,
    cep: cep.replace(/\D/g, ''),
    status: 'pendente',
  };

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
      body: JSON.stringify(catalogos.map(catalogo => ({
        ...linhaBase,
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

  try {
    const respDispatch = await fetch(
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
    if (respDispatch.status !== 204) {
      const erro = await respDispatch.text();
      // A linha já foi gravada como "pendente" — o próximo agendamento do
      // bot (a cada 15 min) processa mesmo se o disparo imediato falhar.
      console.error('Falha ao disparar o Radar Bot:', erro);
    }
  } catch (e) {
    console.error('Falha ao disparar o Radar Bot:', e.message);
  }

  res.status(200).json({ ok: true, ids: novasLinhas.map(l => l.id) });
}
