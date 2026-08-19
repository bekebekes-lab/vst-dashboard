// Gera a proposta comercial (PDF) de Conectividade e grava os dados do
// cliente/oferta em conectividade_propostas (funil de oportunidades) — o
// PDF em si NÃO é armazenado, só devolvido pro navegador baixar.
import { requireAuth, getUsuarioDashboard } from './_lib/auth.js';
import { calcularConectaSmart, calcularBLDOfertaPME, roteadoresDisponiveisPara } from './_lib/propostas-dados.js';
import { gerarPdfProposta } from './_lib/gerar-pdf-proposta.js';

const SUPA_URL = 'https://kzlchetrpsfefwybaaoy.supabase.co';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const {
    tipoOferta, velocidade, roteador,
    clienteNome, clienteCnpj, clienteEndereco, clienteCidade, clienteUf, clienteContato,
  } = req.body || {};

  if (!clienteNome || !clienteNome.trim()) {
    return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
  }
  if (tipoOferta !== 'conecta_smart' && tipoOferta !== 'bld_oferta_pme') {
    return res.status(400).json({ error: 'Tipo de oferta inválido' });
  }

  // Cálculo do preço SEMPRE aqui — nunca confia em valor vindo do cliente.
  let calculo;
  if (tipoOferta === 'conecta_smart') {
    calculo = calcularConectaSmart(velocidade);
    if (!calculo) return res.status(400).json({ error: `Velocidade "${velocidade}" inválida para Conecta Smart` });
  } else {
    if (!clienteUf) {
      return res.status(400).json({ error: 'UF do cliente é obrigatória para calcular o BLD Oferta PME' });
    }
    const disponiveis = roteadoresDisponiveisPara(velocidade).map(r => r.nome);
    if (!disponiveis.includes(roteador)) {
      return res.status(400).json({ error: `Roteador "${roteador}" não disponível para a velocidade "${velocidade}"` });
    }
    calculo = calcularBLDOfertaPME(velocidade, roteador, clienteUf);
    if (!calculo) {
      // Regra de segurança do prompt: UF fora da tabela de Alíquotas
      // bloqueia a geração — nunca gerar com preço errado.
      return res.status(400).json({ error: `UF "${clienteUf}" não reconhecida na tabela de Alíquotas — confirme a UF do cliente antes de gerar a proposta.` });
    }
  }

  const perfilRow = await getUsuarioDashboard(req, authUser.id);
  const consultorNome = perfilRow?.nome || authUser.email?.split('@')[0] || 'Consultor VST';
  const consultorEmail = perfilRow?.email || authUser.email || '';
  const consultorTelefone = perfilRow?.telefone || '';

  let pdfBytes;
  try {
    pdfBytes = await gerarPdfProposta({
      tipoOferta, velocidade, roteador,
      clienteNome, clienteCnpj, clienteEndereco, clienteCidade, clienteUf, clienteContato,
      consultorNome, consultorEmail, consultorTelefone,
      valorMensal: calculo.valorMensal,
      valorDe: calculo.valorDe,
      valorDesconto: calculo.valorDesconto,
    });
  } catch (e) {
    return res.status(500).json({ error: `Falha ao montar o PDF: ${e.message}` });
  }

  // Grava a oportunidade no funil (service-role — RLS não permite insert
  // direto do cliente, só leitura/atualização do que já existe).
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    try {
      await fetch(`${SUPA_URL}/rest/v1/conectividade_propostas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          consultor_id: authUser.id,
          consultor_nome: consultorNome,
          cliente_nome: clienteNome,
          cliente_cnpj: clienteCnpj || null,
          cliente_endereco: clienteEndereco || null,
          cliente_cidade: clienteCidade || null,
          cliente_uf: clienteUf || null,
          cliente_contato: clienteContato || null,
          tipo_oferta: tipoOferta,
          velocidade,
          roteador: roteador || null,
          valor_mensal: calculo.valorMensal,
          valor_de: calculo.valorDe ?? null,
          valor_desconto: calculo.valorDesconto ?? null,
        }),
      });
    } catch (e) {
      // Não bloqueia a geração/download do PDF por causa disso — só loga.
      console.error('Falha ao gravar oportunidade no funil:', e.message);
    }
  }

  const pdfBase64 = Buffer.from(pdfBytes).toString('base64');
  res.status(200).json({ pdfBase64, valorMensal: calculo.valorMensal });
}
