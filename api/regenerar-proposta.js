// Gera de novo o PDF de uma proposta já existente no funil, a partir dos
// dados já salvos em conectividade_propostas — usado pelo botão "Gerar
// Proposta Novamente" no drill-down. Preço é SEMPRE recalculado nas tabelas
// atuais (nunca reaproveita valor_mensal já salvo), igual à geração original.
import { requireAuth } from './_lib/auth.js';
import { calcularOferta } from './_lib/propostas-dados.js';
import { gerarPdfProposta } from './_lib/gerar-pdf-proposta.js';

const SUPA_URL = 'https://kzlchetrpsfefwybaaoy.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6bGNoZXRycHNmZWZ3eWJhYW95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNTM4NDIsImV4cCI6MjA5NDYyOTg0Mn0.4euWpZZadXe9ayg6ITY5SNueEhU094ajJv379gC9YrU';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const { propostaId } = req.body || {};
  if (!propostaId) return res.status(400).json({ error: 'propostaId é obrigatório' });

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const headersUsuario = { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${token}` };

  // Busca com o token do PRÓPRIO usuário — a RLS de SELECT já decide se ele
  // pode ver essa proposta (dono ou admin); se não puder, vem vazio.
  const resRow = await fetch(`${SUPA_URL}/rest/v1/conectividade_propostas?id=eq.${propostaId}&select=*`, { headers: headersUsuario });
  if (!resRow.ok) return res.status(500).json({ error: 'Falha ao buscar a proposta' });
  const rows = await resRow.json();
  const item = rows[0];
  if (!item) return res.status(404).json({ error: 'Oportunidade não encontrada (ou sem permissão de acesso).' });

  // Antes só cobria conecta_smart e (fallback errado) BLD Oferta PME pra
  // qualquer outro tipo — achado real (18/09): regenerar uma proposta de
  // Conecta BLC, Combo 2P BLD, 0800, MPLS ou LAN EPL calculava com a fórmula
  // errada. calcularOferta() é a mesma função usada na geração original,
  // cobre os 7 tipos.
  const resultado = calcularOferta({
    tipoOferta: item.tipo_oferta, velocidade: item.velocidade, roteador: item.roteador,
    pacote: item.pacote, tipo: item.tipo, trajeto: item.trajeto,
    clienteUf: item.cliente_uf, clienteCidade: item.cliente_cidade,
  });
  if (!resultado.ok) {
    return res.status(400).json({ error: `Não foi possível recalcular o preço com os dados salvos: ${resultado.erro}` });
  }
  const calculo = resultado.calculo;

  let calculo0800 = null;
  if (item.combo_oitocentos_pacote) {
    const resultado0800 = calcularOferta({ tipoOferta: 'oitocentos', pacote: item.combo_oitocentos_pacote, clienteUf: item.cliente_uf });
    if (!resultado0800.ok) {
      return res.status(400).json({ error: `Não foi possível recalcular o preço do 0800 combinado: ${resultado0800.erro}` });
    }
    calculo0800 = resultado0800.calculo;
  }

  let pdfBytes;
  try {
    pdfBytes = await gerarPdfProposta({
      tipoOferta: item.tipo_oferta, velocidade: item.velocidade, roteador: item.roteador,
      pacote: item.pacote, tipo: item.tipo, trajeto: item.trajeto,
      clienteNome: item.cliente_nome, clienteCnpj: item.cliente_cnpj, clienteEndereco: item.cliente_endereco,
      clienteCidade: item.cliente_cidade, clienteUf: item.cliente_uf, clienteContato: item.cliente_contato,
      consultorNome: item.consultor_nome, consultorEmail: item.consultor_email,
      consultorTelefone: item.consultor_telefone, consultorCargo: item.consultor_cargo,
      valorMensal: calculo.valorMensal, valorDe: calculo.valorDe, valorDesconto: calculo.valorDesconto,
      combo0800: calculo0800 ? { pacote: item.combo_oitocentos_pacote, valorMensal: calculo0800.valorMensal } : null,
    });
  } catch (e) {
    return res.status(500).json({ error: `Falha ao montar o PDF: ${e.message}` });
  }

  const valorMensalTotal = calculo.valorMensal + (calculo0800 ? calculo0800.valorMensal : 0);

  // Atualiza a data da última geração — com o token do próprio usuário, a
  // RLS de UPDATE (dono ou admin) já cobre esse caso, sem precisar de
  // service-role aqui.
  const agora = new Date().toISOString();
  await fetch(`${SUPA_URL}/rest/v1/conectividade_propostas?id=eq.${propostaId}`, {
    method: 'PATCH',
    headers: { ...headersUsuario, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      ultima_geracao_em: agora, atualizado_em: agora,
      valor_mensal: calculo.valorMensal,
      combo_oitocentos_valor_mensal: calculo0800 ? calculo0800.valorMensal : null,
    }),
  }).catch(() => {});

  const pdfBase64 = Buffer.from(pdfBytes).toString('base64');
  res.status(200).json({ pdfBase64, valorMensal: valorMensalTotal, ultimaGeracaoEm: agora });
}
