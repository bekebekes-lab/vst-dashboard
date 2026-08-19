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
    clienteNome, clienteCnpj, clienteEndereco, clienteCidade, clienteUf, clienteContato, clienteTelefone,
    consultorNome: consultorNomeInput, consultorTelefone: consultorTelefoneInput, consultorEmail: consultorEmailInput,
    consultorCargo: consultorCargoInput,
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

  // Os campos do consultor vêm editáveis do formulário (o usuário pode
  // ajustar telefone/e-mail por proposta) — o perfil salvo é só o fallback.
  const perfilRow = await getUsuarioDashboard(req, authUser.id);
  const consultorNome = (consultorNomeInput || '').trim() || perfilRow?.nome || authUser.email?.split('@')[0] || 'Consultor VST';
  const consultorEmail = (consultorEmailInput || '').trim() || perfilRow?.email || authUser.email || '';
  const consultorTelefone = (consultorTelefoneInput || '').trim() || perfilRow?.telefone || '';
  const consultorCargo = (consultorCargoInput || '').trim() || perfilRow?.cargo || '';
  // Nome de quem REALMENTE gerou a proposta — nunca sobrescrito pelo campo
  // "Consultor (assinatura da proposta)" do formulário (que é editável e só
  // controla o que aparece impresso no PDF); é o que o funil deve mostrar.
  const geradoPorNome = perfilRow?.nome || authUser.email?.split('@')[0] || authUser.email || 'Usuário';

  let pdfBytes;
  try {
    pdfBytes = await gerarPdfProposta({
      tipoOferta, velocidade, roteador,
      clienteNome, clienteCnpj, clienteEndereco, clienteCidade, clienteUf, clienteContato,
      consultorNome, consultorEmail, consultorTelefone, consultorCargo,
      valorMensal: calculo.valorMensal,
      valorDe: calculo.valorDe,
      valorDesconto: calculo.valorDesconto,
    });
  } catch (e) {
    return res.status(500).json({ error: `Falha ao montar o PDF: ${e.message}` });
  }

  // Grava a oportunidade no funil (service-role — RLS não permite insert
  // direto do cliente, só leitura/atualização do que já existe). Falha aqui
  // NÃO bloqueia a geração/download do PDF, mas o erro real volta pro
  // cliente em `funilErro` — sem isso, uma falha ficava só no log do
  // servidor (inacessível) e a proposta "sumia" do funil sem explicação.
  let funilErro = null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    funilErro = 'SUPABASE_SERVICE_ROLE_KEY não configurado no servidor';
    console.error(funilErro);
  } else {
    try {
      const respFunil = await fetch(`${SUPA_URL}/rest/v1/conectividade_propostas`, {
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
          gerado_por_nome: geradoPorNome,
          cliente_nome: clienteNome,
          cliente_cnpj: clienteCnpj || null,
          cliente_endereco: clienteEndereco || null,
          cliente_cidade: clienteCidade || null,
          cliente_uf: clienteUf || null,
          cliente_contato: clienteContato || null,
          cliente_telefone: (clienteTelefone || '').trim() || null,
          tipo_oferta: tipoOferta,
          velocidade,
          roteador: roteador || null,
          valor_mensal: calculo.valorMensal,
          valor_de: calculo.valorDe ?? null,
          valor_desconto: calculo.valorDesconto ?? null,
        }),
      });
      if (!respFunil.ok) {
        funilErro = await respFunil.text();
        console.error('Falha ao gravar oportunidade no funil:', respFunil.status, funilErro);
      }
    } catch (e) {
      funilErro = e.message;
      console.error('Falha ao gravar oportunidade no funil:', e.message);
    }
  }

  const pdfBase64 = Buffer.from(pdfBytes).toString('base64');
  res.status(200).json({ pdfBase64, valorMensal: calculo.valorMensal, funilErro });
}
