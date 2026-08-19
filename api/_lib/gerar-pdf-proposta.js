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
const HEADER_MARGEM = 16; // margem das logos nas faixas do topo/rodapé — mais próxima do canto que o corpo do texto
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
    consultorNome, consultorEmail, consultorTelefone, consultorCargo,
    valorMensal, valorDe, valorDesconto,
  } = dados;

  const pdfDoc = await PDFDocument.create();
  const fonte = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const vstLogoBytes = readFileSync(path.join(__dirname, 'assets', 'vst_logo_branco.png'));
  const claroEmpresasBytes = readFileSync(path.join(__dirname, 'assets', 'claro_empresas_branco.png'));
  const claroCirculoBytes = readFileSync(path.join(__dirname, 'assets', 'claro_logo_circulo.png'));
  const iconTelefoneBytes = readFileSync(path.join(__dirname, 'assets', 'icon_telefone.png'));
  const iconEmailBytes = readFileSync(path.join(__dirname, 'assets', 'icon_email.png'));
  const iconSiteBytes = readFileSync(path.join(__dirname, 'assets', 'icon_site.png'));
  const vstLogoImg = await pdfDoc.embedPng(vstLogoBytes);
  const claroEmpresasImg = await pdfDoc.embedPng(claroEmpresasBytes);
  const claroCirculoImg = await pdfDoc.embedPng(claroCirculoBytes);
  const iconTelefoneImg = await pdfDoc.embedPng(iconTelefoneBytes);
  const iconEmailImg = await pdfDoc.embedPng(iconEmailBytes);
  const iconSiteImg = await pdfDoc.embedPng(iconSiteBytes);

  let page;
  let y;
  let totalPaginas = 0;

  // Faixa vinho + logos no topo só entram na 1ª página; a faixa cinza +
  // logo Claro no rodapé só entram na última — desenhada depois que todo o
  // conteúdo já foi montado, direto na página final real (ver fim da função).
  function novaPagina() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    totalPaginas++;
    if (totalPaginas === 1) {
      // Faixa vinho no topo — 50pt de altura, do topo da página (medido: rect
      // (0,0,595.28,50) em coords top-based = (0, PAGE_H-50, 595.28, PAGE_H) em pdf-lib).
      page.drawRectangle({ x: 0, y: PAGE_H - 50, width: PAGE_W, height: 50, color: COR_MAROON });
      // Logos mais próximas do canto (margem menor que a do corpo do texto)
      // e Claro empresas maior — ajuste pedido pelo usuário sobre a versão
      // anterior, que respeitava a mesma margem do corpo e ficava pequena.
      const vstDim = vstLogoImg.scale(90 / vstLogoImg.width);
      page.drawImage(vstLogoImg, { x: HEADER_MARGEM, y: PAGE_H - 50 + (50 - vstDim.height) / 2, width: vstDim.width, height: vstDim.height });
      const claroDim = claroEmpresasImg.scale(175 / claroEmpresasImg.width);
      page.drawImage(claroEmpresasImg, { x: PAGE_W - HEADER_MARGEM - claroDim.width, y: PAGE_H - 50 + (50 - claroDim.height) / 2, width: claroDim.width, height: claroDim.height });
      y = PAGE_H - 82; // logo abaixo da faixa do topo, onde entra a data/local
    } else {
      y = PAGE_H - 40; // páginas seguintes não repetem a faixa do topo
    }
  }

  function desenharRodapeNaPagina(pg) {
    // Faixa cinza-escura no rodapé — 50pt de altura (medido: rect
    // (0,791.9,595.28,841.89) top-based = (0,0,595.28,50) em pdf-lib).
    pg.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 50, color: COR_CINZA_ESCURO });
    // Logo Claro (círculo): 40x40, mesma margem reduzida do cabeçalho.
    const circDim = claroCirculoImg.scale(40 / claroCirculoImg.width);
    pg.drawImage(claroCirculoImg, { x: PAGE_W - HEADER_MARGEM - circDim.width, y: 5, width: circDim.width, height: circDim.height });
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

  const tituloProposta = tipoOferta === 'conecta_smart' ? 'Proposta Comercial - Conectividade e Voz' : 'Proposta Comercial - Conectividade';
  page.drawText(tituloProposta, { x: MARGEM, y, size: TAM_TITULO, font: fonteNegrito, color: COR_TEXTO });
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
  // "Endereço:" pode virar mais de uma linha agora que o campo é montado a
  // partir de rua+número+complemento+bairro+CEP — cada linha da tabela
  // cresce conforme o texto precisar, em vez de cortar tudo após a 1ª linha.
  const alturaMinLinhaTabela = 29.3;
  const alturaLinhaTextoTabela = 13;
  const larguraValorTabela = LARGURA_UTIL - 110;
  const linhasPorCampoTabela = linhasTabela.map(([, valor]) => quebrarLinhas(String(valor), fonte, TAM_CORPO, larguraValorTabela));
  const alturasLinhasTabela = linhasPorCampoTabela.map(linhas => Math.max(alturaMinLinhaTabela, linhas.length * alturaLinhaTextoTabela + 16));
  const alturaTabela = alturasLinhasTabela.reduce((a, b) => a + b, 0);
  garantirEspaco(alturaTabela);
  const topoTabela = y;
  page.drawRectangle({ x: MARGEM, y: topoTabela - alturaTabela, width: LARGURA_UTIL, height: alturaTabela, color: COR_MAROON_CLARO, borderColor: COR_LINHA, borderWidth: 1 });
  page.drawLine({ start: { x: MARGEM + 102, y: topoTabela }, end: { x: MARGEM + 102, y: topoTabela - alturaTabela }, thickness: 1, color: COR_LINHA });
  let offsetTabela = 0;
  linhasTabela.forEach(([label], i) => {
    const topoLinha = topoTabela - offsetTabela;
    if (i > 0) page.drawLine({ start: { x: MARGEM, y: topoLinha }, end: { x: MARGEM + LARGURA_UTIL, y: topoLinha }, thickness: 1, color: COR_LINHA });
    const yLabel = topoLinha - 19.5;
    page.drawText(label, { x: MARGEM + 7, y: yLabel, size: TAM_CORPO, font: fonteNegrito, color: COR_TEXTO });
    linhasPorCampoTabela[i].forEach((linha, li) => {
      page.drawText(linha, { x: MARGEM + 108, y: yLabel - li * alturaLinhaTextoTabela, size: TAM_CORPO, font: fonteNegrito, color: rgb(51 / 255, 51 / 255, 51 / 255) });
    });
    offsetTabela += alturasLinhasTabela[i];
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
  const paddingCel = 8;
  const alturaLinhaTexto = 13;
  garantirEspaco(alturaHeaderTabela + 26 + 10);
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
  // Cada célula quebra dentro da própria largura de coluna — sem isso, um
  // nome de serviço longo (ex.: "Conecta Smart (Internet Dedicada + Voz +
  // GRC)") ultrapassa a coluna "Serviço" e sobrepõe o texto da coluna
  // seguinte ("Banda"), virando um emaranhado de glifos ilegível.
  const linhasPorColuna = colValores.map((v, i) => {
    const fonteCel = i === 3 ? fonteNegrito : fonte;
    return quebrarLinhas(String(v), fonteCel, TAM_CORPO, larguras[i] - paddingCel * 2);
  });
  const maxLinhas = Math.max(...linhasPorColuna.map(l => l.length));
  const alturaLinhaInvest = Math.max(26, maxLinhas * alturaLinhaTexto + 12);
  page.drawRectangle({ x: MARGEM, y: y - alturaLinhaInvest, width: LARGURA_UTIL, height: alturaLinhaInvest, color: COR_BRANCO, borderColor: COR_LINHA, borderWidth: 1 });
  x = MARGEM;
  linhasPorColuna.forEach((linhas, i) => {
    linhas.forEach((linha, li) => {
      page.drawText(linha, { x: x + paddingCel, y: y - 9 - li * alturaLinhaTexto, size: TAM_CORPO, font: i === 3 ? fonteNegrito : fonte, color: COR_TEXTO });
    });
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

  // Bloco de assinatura: nome em destaque, cargo/regional logo abaixo, e
  // telefone/e-mail/site cada um numa linha com um ícone à esquerda.
  garantirEspaco(90);
  y -= 26;
  paragrafo('Atenciosamente,');
  garantirEspaco(85);
  page.drawText(consultorNome || '', { x: MARGEM, y, size: 15, font: fonteNegrito, color: rgb(0.13, 0.13, 0.13) });
  y -= 17;
  if (consultorCargo) {
    page.drawText(consultorCargo, { x: MARGEM, y, size: 10.5, font: fonte, color: COR_TEXTO_2 });
    y -= 21;
  } else {
    y -= 8;
  }
  const iconTam = 11;
  const linhasContato = [
    { icon: iconTelefoneImg, texto: consultorTelefone },
    { icon: iconEmailImg, texto: consultorEmail },
    { icon: iconSiteImg, texto: 'vstgroup.com.br' },
  ].filter(l => l.texto);
  for (const linha of linhasContato) {
    // `y` do texto é a linha de base; o centro visual do texto fica ~0.35
    // do tamanho da fonte ACIMA dela — o ícone precisa ser centralizado
    // nesse ponto, não na própria linha de base (senão fica baixo demais).
    page.drawImage(linha.icon, { x: MARGEM, y: y + 10.5 * 0.35 - iconTam / 2, width: iconTam, height: iconTam });
    page.drawText(linha.texto, { x: MARGEM + iconTam + 7, y, size: 10.5, font: fonte, color: COR_TEXTO_2 });
    y -= 17;
  }

  desenharRodapeNaPagina(page); // só na última página, gerada por último

  return pdfDoc.save();
}
