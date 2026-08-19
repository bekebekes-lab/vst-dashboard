// Monta o PDF da "Proposta Comercial" (padrão VST Group / Claro Empresas),
// replicando o layout do template já validado (Proposta_Viacao_Colombo_
// Conecta_Smart_com_logos v3.pdf). TODAS as cores, tamanhos de fonte,
// posições de logo e espaçamentos abaixo foram medidos diretamente no PDF
// de referência (via PyMuPDF — get_text('dict') pra spans de texto,
// get_drawings() pra retângulos/faixas, extract_image() pras logos), não
// estimados — pra manter fidelidade real ao invés de aproximação visual.
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGEM = 42.5;
const LARGURA_UTIL = PAGE_W - 2 * MARGEM;

// Cores exatas medidas no PDF de referência (packed RGB decimal -> 0..1):
// faixa/títulos = rgb(103,43,43) · corpo de texto = rgb(51,51,51) ·
// data/texto secundário = rgb(102,102,102) · header da tabela = branco.
const COR_MAROON = rgb(103 / 255, 43 / 255, 43 / 255);
const COR_MAROON_CLARO = rgb(0.988, 0.988, 0.988); // fundo da tabela de dados do cliente
const COR_CINZA_ESCURO = rgb(0.2, 0.2, 0.2); // faixa do rodapé
const COR_TEXTO = rgb(51 / 255, 51 / 255, 51 / 255);
const COR_TEXTO_2 = rgb(102 / 255, 102 / 255, 102 / 255);
const COR_BRANCO = rgb(1, 1, 1);
const COR_LINHA = rgb(0.85, 0.85, 0.85);

const TAM_TITULO = 16;
const TAM_SECAO = 13;
const TAM_CORPO = 11;
const ALTURA_LINHA = 16.5; // medido: 16.5pt entre linhas de parágrafo/bullet a 11pt

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

// Sem locale.setlocale (quebra em produção/containers) — dicionário manual.
export function dataPorExtenso(d) {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function quebrarLinhas(texto, font, size, larguraMax) {
  const palavras = texto.split(' ');
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    const teste = atual ? `${atual} ${p}` : p;
    if (font.widthOfTextAtSize(teste, size) > larguraMax && atual) {
      linhas.push(atual);
      atual = p;
    } else {
      atual = teste;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function fmtReais(v) {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Escopo técnico difere por tipo de oferta: Conecta Smart tem Voz + GRC;
// BLD Oferta PME é link avulso (dados), sem voz e sem GRC — o roteador
// aparece como item com custo (à parte), não "incluso".
function montarEscopoTecnico(tipoOferta, dadosOferta) {
  if (tipoOferta === 'conecta_smart') {
    return [
      ['Internet Dedicada (Business Link Direct - BLD):', 'Conexão contínua e exclusiva à rede, sem necessidade de discagem.'],
      ['Banda Simétrica:', `${dadosOferta.velocidade} de velocidade, com 100% da banda contratada garantida e disponível para download e upload.`],
      ['Endereçamento:', 'Fornecimento de IP Estático, contemplando um bloco com 16 Endereços IP válidos.'],
      ['Equipamento (CPE):', 'Roteador avançado de alta performance incluso na solução (modelos Fortinet 40-F ou Huawei AR651).'],
      ['Voz Avançada (Vip Único):', 'Telefonia corporativa integrada com voz ilimitada OTT ou franquia de minutos unificados, permitindo originar e receber chamadas telefônicas locais e de longa distância nacional com alta qualidade.'],
      ['Gerência de Rede (GRC):', 'Controle avançado das atividades e monitoramento do uso dos recursos no ambiente da rede, com testes operacionais e acompanhamento contínuo.'],
    ];
  }
  return [
    ['Internet Dedicada (Business Link Direct - BLD):', 'Conexão contínua e exclusiva à rede, sem necessidade de discagem, para tráfego de dados.'],
    ['Banda Simétrica:', `${dadosOferta.velocidade} de velocidade, com 100% da banda contratada garantida e disponível para download e upload.`],
    ['Endereçamento:', 'Fornecimento de IP Estático, contemplando um bloco com 16 Endereços IP válidos.'],
    ['Equipamento (CPE):', `Roteador ${dadosOferta.roteador}, com custo já incluso no valor mensal do investimento abaixo — o cliente não pode usar roteador próprio nesta oferta.`],
  ];
}

export async function gerarPdfProposta(dados) {
  const {
    tipoOferta, velocidade, roteador,
    clienteNome, clienteCnpj, clienteEndereco, clienteCidade, clienteUf, clienteContato,
    consultorNome, consultorEmail, consultorTelefone,
    valorMensal, valorDe, valorDesconto,
  } = dados;

  const pdfDoc = await PDFDocument.create();
  const fonte = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const vstLogoBytes = readFileSync(path.join(__dirname, 'assets', 'vst_logo_branco.png'));
  const claroEmpresasBytes = readFileSync(path.join(__dirname, 'assets', 'claro_empresas_branco.png'));
  const claroCirculoBytes = readFileSync(path.join(__dirname, 'assets', 'claro_logo_circulo.png'));
  const vstLogoImg = await pdfDoc.embedPng(vstLogoBytes);
  const claroEmpresasImg = await pdfDoc.embedPng(claroEmpresasBytes);
  const claroCirculoImg = await pdfDoc.embedPng(claroCirculoBytes);

  let page;
  let y;

  function novaPagina() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    // Faixa vinho no topo — 50pt de altura, do topo da página (medido: rect
    // (0,0,595.28,50) em coords top-based = (0, PAGE_H-50, 595.28, PAGE_H) em pdf-lib).
    page.drawRectangle({ x: 0, y: PAGE_H - 50, width: PAGE_W, height: 50, color: COR_MAROON });
    // Logo VST: bbox medido (42.5,6)-(128,44) top-based -> largura 85.5, altura 38.
    const vstDim = vstLogoImg.scale(85.5 / vstLogoImg.width);
    page.drawImage(vstLogoImg, { x: MARGEM, y: PAGE_H - 44, width: vstDim.width, height: vstDim.height });
    // Logotipo "Claro empresas": bbox medido (411.4,12)-(552.8,38) top-based.
    const claroDim = claroEmpresasImg.scale(141.3 / claroEmpresasImg.width);
    page.drawImage(claroEmpresasImg, { x: PAGE_W - MARGEM - claroDim.width, y: PAGE_H - 38, width: claroDim.width, height: claroDim.height });
    // Faixa cinza-escura no rodapé — 50pt de altura (medido: rect
    // (0,791.9,595.28,841.89) top-based = (0,0,595.28,50) em pdf-lib).
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 50, color: COR_CINZA_ESCURO });
    // Logo Claro (círculo): medido (512.8,796.9)-(552.8,836.9) top-based -> 40x40.
    const circDim = claroCirculoImg.scale(40 / claroCirculoImg.width);
    page.drawImage(claroCirculoImg, { x: PAGE_W - MARGEM - circDim.width, y: 5, width: circDim.width, height: circDim.height });
    y = PAGE_H - 82; // logo abaixo da faixa do topo, onde entra a data/local
  }

  function garantirEspaco(altura) {
    if (y - altura < 60) novaPagina();
  }

  function titulo(texto) {
    garantirEspaco(TAM_SECAO + 20);
    y -= 20;
    page.drawRectangle({ x: MARGEM, y: y - 3, width: 3, height: TAM_SECAO + 4, color: COR_MAROON });
    page.drawText(texto, { x: MARGEM + 9, y, size: TAM_SECAO, font: fonteNegrito, color: COR_MAROON });
    y -= (TAM_SECAO + 17);
  }

  function paragrafo(texto, opts = {}) {
    const size = opts.size ?? TAM_CORPO;
    const cor = opts.cor ?? COR_TEXTO;
    const fonteUsada = opts.negrito ? fonteNegrito : fonte;
    const linhas = quebrarLinhas(texto, fonteUsada, size, LARGURA_UTIL);
    for (const l of linhas) {
      garantirEspaco(ALTURA_LINHA);
      page.drawText(l, { x: MARGEM, y, size, font: fonteUsada, color: cor });
      y -= ALTURA_LINHA;
    }
    y -= 6;
  }

  function bullet(label, texto) {
    const size = TAM_CORPO;
    const xTexto = MARGEM + 15;
    const prefixo = '•  ';
    const labelLargura = fonteNegrito.widthOfTextAtSize(label, size);
    const espacoLargura = fonte.widthOfTextAtSize(' ', size);
    const linhas = quebrarLinhas(texto, fonte, size, LARGURA_UTIL - 15 - labelLargura - espacoLargura);
    garantirEspaco(ALTURA_LINHA);
    page.drawText(prefixo, { x: MARGEM, y, size, font: fonte, color: COR_TEXTO });
    page.drawText(label, { x: xTexto, y, size, font: fonteNegrito, color: COR_TEXTO });
    if (linhas[0]) {
      page.drawText(linhas[0], { x: xTexto + labelLargura + espacoLargura, y, size, font: fonte, color: COR_TEXTO });
    }
    y -= ALTURA_LINHA;
    for (let i = 1; i < linhas.length; i++) {
      garantirEspaco(ALTURA_LINHA);
      page.drawText(linhas[i], { x: xTexto, y, size, font: fonte, color: COR_TEXTO });
      y -= ALTURA_LINHA;
    }
    y -= 5;
  }

  novaPagina();

  // Data/local no topo direito (medido: size 11, cor #666666, y~82 top-based).
  const dataTexto = `${clienteCidade || 'Londrina'}, ${dataPorExtenso(new Date())}`;
  page.drawText(dataTexto, { x: PAGE_W - MARGEM - fonte.widthOfTextAtSize(dataTexto, TAM_CORPO), y, size: TAM_CORPO, font: fonte, color: COR_TEXTO_2 });
  y -= 32;

  page.drawText('Proposta Comercial - Conectividade e Voz', { x: MARGEM, y, size: TAM_TITULO, font: fonteNegrito, color: COR_TEXTO });
  y -= 10;
  page.drawRectangle({ x: MARGEM, y: y - 2, width: LARGURA_UTIL, height: 2, color: COR_MAROON });
  y -= 34;

  // Tabela de dados do cliente — um único fundo por trás das 4 linhas
  // (medido: rect (42.5,151.9)-(552.8,269.7) fill quase-branco), com borda
  // e divisor vertical entre label/valor, igual ao original.
  const linhasTabela = [
    ['Para:', clienteNome],
    ['CNPJ:', clienteCnpj || '—'],
    ['Endereço:', clienteEndereco || '—'],
    ['A/C:', clienteContato || '—'],
  ];
  const alturaLinhaTabela = 29.3;
  const alturaTabela = alturaLinhaTabela * linhasTabela.length;
  garantirEspaco(alturaTabela);
  const topoTabela = y;
  page.drawRectangle({ x: MARGEM, y: topoTabela - alturaTabela, width: LARGURA_UTIL, height: alturaTabela, color: COR_MAROON_CLARO, borderColor: COR_LINHA, borderWidth: 1 });
  page.drawLine({ start: { x: MARGEM + 102, y: topoTabela }, end: { x: MARGEM + 102, y: topoTabela - alturaTabela }, thickness: 1, color: COR_LINHA });
  linhasTabela.forEach(([label, valor], i) => {
    const linhaY = topoTabela - i * alturaLinhaTabela - 19.5;
    if (i > 0) page.drawLine({ start: { x: MARGEM, y: topoTabela - i * alturaLinhaTabela }, end: { x: MARGEM + LARGURA_UTIL, y: topoTabela - i * alturaLinhaTabela }, thickness: 1, color: COR_LINHA });
    page.drawText(label, { x: MARGEM + 7, y: linhaY, size: TAM_CORPO, font: fonteNegrito, color: COR_TEXTO });
    const linhasValor = quebrarLinhas(String(valor), fonte, TAM_CORPO, LARGURA_UTIL - 110);
    page.drawText(linhasValor[0] || '', { x: MARGEM + 108, y: linhaY, size: TAM_CORPO, font: fonteNegrito, color: rgb(51 / 255, 51 / 255, 51 / 255) });
  });
  y = topoTabela - alturaTabela - 26;

  paragrafo(`Prezado(a) ${clienteContato || 'Sr(a)'},`);
  paragrafo('Temos o prazer de apresentar esta proposta de serviços de conectividade e tecnologia da informação, contemplando o descritivo técnico, valores e demais condições comerciais para o fornecimento das soluções da Claro Empresas.');
  paragrafo('Esta proposta é baseada em soluções de altíssima qualidade, disponibilidade e desempenho, projetadas para contribuir com o aumento de produtividade e agilidade nos seus negócios, proporcionando uma sólida vantagem competitiva frente ao mercado.');

  titulo('1. Sobre a Solução');
  const nomeOferta = tipoOferta === 'conecta_smart' ? 'Conecta Smart' : 'BLD Oferta PME';
  const textoSolucao = tipoOferta === 'conecta_smart'
    ? `A solução ${nomeOferta} oferece múltiplos serviços de alta performance, unindo link dedicado, comunicação de voz e IP Fixo. Com esta estrutura, sua empresa acessa a internet com qualidade, segurança e alta confiabilidade o tempo todo.`
    : `A solução ${nomeOferta} oferece um link de internet dedicado de alta performance com IP Fixo, unindo qualidade, segurança e alta confiabilidade — ideal para quem precisa de conectividade robusta e estável, sem os serviços de voz agregados.`;
  paragrafo(textoSolucao);

  titulo('2. Escopo Técnico do Serviço');
  for (const [label, texto] of montarEscopoTecnico(tipoOferta, { velocidade, roteador })) {
    bullet(label, texto);
  }

  titulo('3. Acordo de Nível de Serviço (SLA)');
  bullet('Disponibilidade:', 'A Claro tem como meta garantir uma disponibilidade mensal da Rede de Telecomunicações igual ou melhor que 99,00%.');
  bullet('Tempo de Reparo:', 'Para incidentes com impacto crítico ao negócio, o atendimento é imediato com prazo de solução de até 4 horas.');

  titulo('4. Investimento Comercial');
  paragrafo('Abaixo, detalhamos o investimento necessário para a implementação da solução no seu endereço matriz.');

  const alturaHeaderTabela = 24;
  const alturaLinhaInvest = 26;
  garantirEspaco(alturaHeaderTabela + alturaLinhaInvest + 10);
  const colunas = tipoOferta === 'conecta_smart'
    ? ['Serviço', 'Banda', 'Prazo Contratual', 'Valor Mensal']
    : ['Serviço', 'Banda', 'Roteador', 'Valor Mensal'];
  const larguras = [LARGURA_UTIL * 0.4, LARGURA_UTIL * 0.18, LARGURA_UTIL * 0.22, LARGURA_UTIL * 0.2];
  let x = MARGEM;
  page.drawRectangle({ x: MARGEM, y: y - alturaHeaderTabela, width: LARGURA_UTIL, height: alturaHeaderTabela, color: COR_MAROON });
  colunas.forEach((c, i) => {
    page.drawText(c, { x: x + 8, y: y - alturaHeaderTabela + 8, size: TAM_CORPO, font: fonteNegrito, color: COR_BRANCO });
    x += larguras[i];
  });
  y -= alturaHeaderTabela;

  const nomeServico = tipoOferta === 'conecta_smart'
    ? `${nomeOferta} (Internet Dedicada + Voz + GRC)`
    : `${nomeOferta} (Internet Dedicada)`;
  const colValores = tipoOferta === 'conecta_smart'
    ? [nomeServico, velocidade, '36 Meses', fmtReais(valorMensal)]
    : [nomeServico, velocidade, roteador, fmtReais(valorMensal)];
  page.drawRectangle({ x: MARGEM, y: y - alturaLinhaInvest, width: LARGURA_UTIL, height: alturaLinhaInvest, color: COR_BRANCO, borderColor: COR_LINHA, borderWidth: 1 });
  x = MARGEM;
  colValores.forEach((v, i) => {
    page.drawText(String(v), { x: x + 8, y: y - alturaLinhaInvest + 9, size: TAM_CORPO, font: i === 3 ? fonteNegrito : fonte, color: COR_TEXTO });
    x += larguras[i];
  });
  y -= (alturaLinhaInvest + 20);

  if (tipoOferta === 'conecta_smart' && valorDesconto) {
    bullet('Desconto Aplicado:', `O valor mensal apresentado já contempla um desconto de ${fmtReais(valorDesconto)} (reduzido do valor original de ${fmtReais(valorDe)}).`);
  }
  bullet('Taxa de Instalação e Ativação:', 'Isenta, condicionada ao cumprimento do prazo de permanência estipulado.');

  titulo('5. Condições Gerais e Faturamento');
  bullet('Faturamento:', 'A cobrança dos serviços será iniciada somente após a ativação técnica, constatação de funcionamento e disponibilização do ambiente.');
  bullet('Fidelidade:', 'O prazo de prestação dos serviços é de 36 meses. Em caso de cancelamento total ou parcial do serviço antes deste prazo, será aplicada uma multa proporcional ao tempo restante para o término do contrato de permanência.');
  bullet('Validade da Proposta:', 'Este documento tem validade comercial de 20 (vinte) dias, contados a partir da data de sua emissão.');

  garantirEspaco(90);
  y -= 26;
  paragrafo('Atenciosamente,');
  garantirEspaco(16);
  page.drawText(consultorNome || '', { x: MARGEM, y, size: TAM_CORPO, font: fonteNegrito, color: rgb(0.1, 0.1, 0.1) });
  y -= 20;
  const linhaCargo = ['Consultor B2B | VST Group - Claro Empresas', consultorEmail, consultorTelefone].filter(Boolean).join(' · ');
  paragrafo(linhaCargo, { size: 10, cor: COR_TEXTO_2 });

  return pdfDoc.save();
}
