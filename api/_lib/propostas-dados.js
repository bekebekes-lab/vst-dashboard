// Tabelas de preço e cálculo pras propostas de Conectividade — extraídas da
// planilha "Calculadora VOZ, MPLS, EPL, BLD, Conecta e PABX Virtual" (aba
// "BLD Oferta PME" e aba "Alicotas") e do prompt de especificação. O cálculo
// SEMPRE roda aqui no servidor — nunca confia em valor calculado no cliente.

// Conecta Smart — tabela fechada, já com imposto, não varia por UF.
export const CONECTA_SMART_PRECOS = {
  '10 Mega': { de: 590.00, para: 575.00, desconto: 15.00 },
  '20 Mega': { de: 650.00, para: 625.00, desconto: 25.00 },
  '50 Mega': { de: 690.00, para: 680.00, desconto: 10.00 },
  '100 Mega': { de: 990.00, para: 950.00, desconto: 40.00 },
};

// BLD Oferta PME — valores sem imposto (Região I).
export const BLD_PRECOS = {
  '10M': 475.00,
  '20M': 505.00,
  '30M': 565.00,
  '50M': 590.00,
  '100M': 647.00,
  '200M': 1101.00,
};

// Roteadores do BLD Oferta PME — sem imposto. HP 954 não existe pra 200M.
export const ROTEADORES = {
  'HP 954': { preco: 88.77, velocidadesExcluidas: ['200M'] },
  'Huawei AR651': { preco: 173.43, velocidadesExcluidas: [] },
  'Meraki MX67': { preco: 201.53, velocidadesExcluidas: [] },
};

// Fator por UF (aba "Alicotas") — usado só pelo BLD Oferta PME.
// "Para impostar: Divide pelo fator" (nota da própria planilha).
export const ALICOTAS_UF = {
  AC: 0.7804350000000001,
  AL: 0.7707999999999999,
  AM: 0.7707999999999999,
  AP: 0.6840849999999999,
  BA: 0.7659825,
  CE: 0.7707999999999999,
  DF: 0.7707999999999999,
  ES: 0.7997049999999999,
  GO: 0.7804350000000001,
  MA: 0.7418950000000001,
  MG: 0.7900699999999999,
  MS: 0.7804350000000001,
  MT: 0.7804350000000001,
  PA: 0.7804350000000001,
  PB: 0.75153,
  PE: 0.7659825,
  PI: 0.7467125,
  PR: 0.7756175,
  RJ: 0.73226,
  RN: 0.7707999999999999,
  RO: 0.7756175,
  RR: 0.7707999999999999,
  RS: 0.7997049999999999,
  SC: 0.7997049999999999,
  SE: 0.7707999999999999,
  SP: 0.7900699999999999,
  TO: 0.7707999999999999,
};

// Conecta com BLC — tabela fechada (Book Clareando PME, Agosto/2026, pág.
// 118), já com imposto, não varia por UF. Inclui Voz Ilimitada ou Franquia
// de Minutos (50.000+10.000 ON NET) + Microsoft 365 Business Basic 1TB.
export const CONECTA_BLC_PRECOS = {
  '150 Mega': 350.00,
  '300 Mega': 400.00,
};

// Combos Conecta 2P BLD — tabela fechada (Book Clareando PME, Agosto/2026,
// pág. 117), já com imposto, não varia por UF. Roteador incluso é só uma
// escolha de modelo (não altera o preço, diferente do BLD Oferta PME).
export const COMBO_2P_BLD_PRECOS = {
  '10 Mega': 1035.23,
  '20 Mega': 1392.23,
  '50 Mega': 1606.23,
  '100 Mega': 1796.22,
  '200 Mega': 1906.22,
  '500 Mega': 3236.22,
};

export const ROTEADORES_COMBO_2P_BLD = ['Fortigate 40F', 'Huawei AR651'];

// Retorna { valorMensal } ou null se a velocidade não existir na tabela.
export function calcularConectaBLC(velocidade) {
  const valorMensal = CONECTA_BLC_PRECOS[velocidade];
  if (valorMensal === undefined) return null;
  return { valorMensal };
}

// Retorna { valorMensal } ou null se velocidade/roteador não forem
// reconhecidos — o roteador aqui só troca o modelo entregue, o preço do
// combo já é fechado por velocidade.
export function calcularCombo2PBLD(velocidade, roteador) {
  const valorMensal = COMBO_2P_BLD_PRECOS[velocidade];
  if (valorMensal === undefined) return null;
  if (!ROTEADORES_COMBO_2P_BLD.includes(roteador)) return null;
  return { valorMensal };
}

// 0800-Flex (Book Clareando PME, Ago/2026, pág. 95 + aba "0800" da
// calculadora) — valores sem imposto, varia por UF (mesmo fator do BLD).
export const OITOCENTOS_PRECOS = {
  '1.000 minutos': 350.00,
  '5.000 minutos': 500.00,
  '10.000 minutos': 800.00,
  '20.000 minutos': 1200.00,
};
export const OITOCENTOS_EXCEDENTE_POR_MINUTO = 0.06; // sem imposto, fixo, independente da origem

export function calcularOitocentos(pacote, uf) {
  const semImposto = OITOCENTOS_PRECOS[pacote];
  if (semImposto === undefined) return null;
  const fatorUF = ALICOTAS_UF[(uf || '').trim().toUpperCase()];
  if (!fatorUF) return null;
  const valorMensal = Math.round((semImposto / fatorUF) * 100) / 100;
  return { valorMensal };
}

// MPLS (Book Clareando PME, Ago/2026, pág. 110 + aba "MPLS") — valores sem
// imposto, "Acesso + Porta". Varia por REGIÃO (decidida pela cidade do
// cliente, não pela UF) e depois por UF (imposto, igual aos outros
// produtos). Região I é a padrão ("Demais localidades"); II e V são
// exceções por cidade específica.
export const MPLS_PRECOS_POR_REGIAO = {
  I: { '20M': 486.00, '50M': 658.00, '100M': 843.00, '200M': 1083.00, '500M': 2150.00, '700M': 2612.00, '1G': 3191.00 },
  II: { '20M': 510.00, '50M': 691.00, '100M': 885.00, '200M': 1137.00, '1G': 3351.00 },
  V: { '20M': 2727.00, '34M': 4412.00 },
};
export const MPLS_CIDADES_REGIAO_II = ['BOA VISTA', 'MACAPÁ', 'MACAPA', 'MANAUS'];
export const MPLS_CIDADES_REGIAO_V = ['CORUMBÁ', 'CORUMBA', 'ITAITUBA', 'TUCURUÍ', 'TUCURUI', 'GUAJARÁ-MIRIM', 'GUAJARA-MIRIM'];
export const MPLS_ROTEADORES = {
  'Huawei AR651': 173.43, // até 500Mbps
  'Huawei AR6121E': 302.50, // até 1Gbps
};
// A aba "MPLS" da calculadora oficial (a mesma usada pela VST hoje) não
// aplica nenhum desconto de fidelidade nas colunas "Mensal s/imposto"/"c/
// imposto" — confirmado comparando o cálculo daqui com a planilha real
// (1G, Região I, PR: 3191,00 / 0,7756175 = 4.114,14, sem desconto). Um
// desconto de até 10% por fidelidade de 36 meses é mencionado no Book como
// condição comercial negociável, mas não é parte do valor de tabela — por
// isso não é aplicado automaticamente aqui.

export function mplsDetectarRegiao(cidade) {
  const c = (cidade || '').trim().toUpperCase();
  if (MPLS_CIDADES_REGIAO_II.some(nome => c.includes(nome))) return 'II';
  if (MPLS_CIDADES_REGIAO_V.some(nome => c.includes(nome))) return 'V';
  return 'I';
}

// roteador é opcional — passe null/'' pra não incluir nenhum.
export function calcularMPLS(velocidade, roteador, uf, cidade) {
  const regiao = mplsDetectarRegiao(cidade);
  const linkSemImposto = MPLS_PRECOS_POR_REGIAO[regiao]?.[velocidade];
  if (linkSemImposto === undefined) return null;

  let roteadorSemImposto = 0;
  if (roteador) {
    roteadorSemImposto = MPLS_ROTEADORES[roteador];
    if (roteadorSemImposto === undefined) return null;
  }

  const fatorUF = ALICOTAS_UF[(uf || '').trim().toUpperCase()];
  if (!fatorUF) return null;

  const valorMensal = Math.round(((linkSemImposto + roteadorSemImposto) / fatorUF) * 100) / 100;
  return { valorMensal, regiao };
}

// LAN EPL (Book Clareando PME, Ago/2026, pág. 114 + aba "LAN EPL") —
// valores sem imposto, por tipo de circuito (A1 ou MEF-B1) e trajeto
// (Local ou Interurbano). Mesma regra do MPLS: sem desconto de fidelidade
// aplicado automaticamente (não faz parte do valor de tabela).
export const LAN_EPL_PRECOS = {
  A1: {
    Local: { '10M': 909.00, '20M': 913.00, '30M': 1043.00, '50M': 1329.00, '70M': 1589.00, '100M': 1940.00, '200M': 2521.00, '500M': 4708.00, '700M': 6012.00, '1G': 7645.00 },
    Interurbano: { '10M': 1037.00, '20M': 1063.00, '30M': 1171.00, '50M': 1456.00, '70M': 1742.00, '100M': 2140.00, '200M': 3157.00, '500M': 5894.00, '700M': 7528.00, '1G': 9572.00 },
  },
  'MEF-B1': {
    Local: { '10M': 1196.00, '20M': 1229.00, '30M': 1364.00, '50M': 1530.00, '70M': 1777.00, '100M': 2122.00, '200M': 2440.00, '500M': 4195.00, '700M': 5548.00, '1G': 7108.00 },
    Interurbano: { '10M': 1547.00, '20M': 1581.00, '30M': 1666.00, '50M': 1931.00, '70M': 2244.00, '100M': 2679.00, '200M': 3451.00, '500M': 6441.00, '700M': 8226.00, '1G': 10161.00 },
  },
};
// Mesmos 2 modelos usados no MPLS — a planilha tem mais opções (Meraki,
// SFPs), deixadas de fora por agora pra simplificar o formulário.
export const LAN_EPL_ROTEADORES = {
  'Huawei AR651': 173.43,
  'Huawei AR6121E': 302.50,
};

// roteador é opcional — passe null/'' pra não incluir nenhum.
export function calcularLANEPL(velocidade, tipo, trajeto, roteador, uf) {
  const linkSemImposto = LAN_EPL_PRECOS[tipo]?.[trajeto]?.[velocidade];
  if (linkSemImposto === undefined) return null;

  let roteadorSemImposto = 0;
  if (roteador) {
    roteadorSemImposto = LAN_EPL_ROTEADORES[roteador];
    if (roteadorSemImposto === undefined) return null;
  }

  const fatorUF = ALICOTAS_UF[(uf || '').trim().toUpperCase()];
  if (!fatorUF) return null;

  const valorMensal = Math.round(((linkSemImposto + roteadorSemImposto) / fatorUF) * 100) / 100;
  return { valorMensal };
}

export function roteadoresDisponiveisPara(velocidade) {
  return Object.entries(ROTEADORES)
    .filter(([, r]) => !r.velocidadesExcluidas.includes(velocidade))
    .map(([nome, r]) => ({ nome, preco: r.preco }));
}

// Retorna { valorMensal, valorDe, valorDesconto } ou null se a velocidade
// não existir na tabela.
export function calcularConectaSmart(velocidade) {
  const linha = CONECTA_SMART_PRECOS[velocidade];
  if (!linha) return null;
  return { valorMensal: linha.para, valorDe: linha.de, valorDesconto: linha.desconto };
}

// Retorna { valorMensal } ou null se velocidade/roteador/UF não forem
// reconhecidos (chamador deve bloquear a geração nesse caso — nunca gerar
// com preço errado).
export function calcularBLDOfertaPME(velocidade, roteador, uf) {
  const bldSemImposto = BLD_PRECOS[velocidade];
  const rot = ROTEADORES[roteador];
  if (bldSemImposto === undefined || !rot) return null;
  if (rot.velocidadesExcluidas.includes(velocidade)) return null;

  const fatorUF = ALICOTAS_UF[(uf || '').trim().toUpperCase()];
  if (!fatorUF) return null;

  const valorMensal = Math.round(((bldSemImposto + rot.preco) / fatorUF) * 100) / 100;
  return { valorMensal };
}

// Tipos de oferta que já incluem voz — únicos que podem vir combinados com
// 0800 na mesma proposta (pedido explícito: só "o que começar com Conecta",
// ou seja, sem BLD Oferta PME, que é link avulso sem voz).
export const TIPOS_OFERTA_COMBINAVEIS_COM_0800 = ['conecta_smart', 'conecta_blc', 'combo_2p_bld'];

// Ponto único de cálculo de preço por tipo de oferta — usado tanto na
// geração original quanto na regeneração (evita o que já aconteceu antes:
// as duas rotas com a mesma lógica duplicada, uma delas ficando pra trás e
// só cobrindo 2 dos 7 tipos). Retorna { ok:true, calculo } ou
// { ok:false, erro } — nunca lança, o chamador decide o status HTTP.
export function calcularOferta({ tipoOferta, velocidade, roteador, pacote, tipo, trajeto, clienteUf, clienteCidade }) {
  if (tipoOferta === 'conecta_smart') {
    const calculo = calcularConectaSmart(velocidade);
    if (!calculo) return { ok: false, erro: `Velocidade "${velocidade}" inválida para Conecta Smart` };
    return { ok: true, calculo };
  }
  if (tipoOferta === 'conecta_blc') {
    const calculo = calcularConectaBLC(velocidade);
    if (!calculo) return { ok: false, erro: `Velocidade "${velocidade}" inválida para Conecta com BLC` };
    return { ok: true, calculo };
  }
  if (tipoOferta === 'combo_2p_bld') {
    if (!ROTEADORES_COMBO_2P_BLD.includes(roteador)) {
      return { ok: false, erro: `Roteador "${roteador}" inválido para Combo Conecta 2P BLD` };
    }
    const calculo = calcularCombo2PBLD(velocidade, roteador);
    if (!calculo) return { ok: false, erro: `Velocidade "${velocidade}" inválida para Combo Conecta 2P BLD` };
    return { ok: true, calculo };
  }
  if (tipoOferta === 'bld_oferta_pme') {
    if (!clienteUf) return { ok: false, erro: 'UF do cliente é obrigatória para calcular o BLD Oferta PME' };
    const disponiveis = roteadoresDisponiveisPara(velocidade).map(r => r.nome);
    if (!disponiveis.includes(roteador)) {
      return { ok: false, erro: `Roteador "${roteador}" não disponível para a velocidade "${velocidade}"` };
    }
    const calculo = calcularBLDOfertaPME(velocidade, roteador, clienteUf);
    if (!calculo) {
      return { ok: false, erro: `UF "${clienteUf}" não reconhecida na tabela de Alíquotas — confirme a UF do cliente antes de gerar a proposta.` };
    }
    return { ok: true, calculo };
  }
  if (tipoOferta === 'oitocentos') {
    if (!clienteUf) return { ok: false, erro: 'UF do cliente é obrigatória para calcular o 0800' };
    const calculo = calcularOitocentos(pacote, clienteUf);
    if (!calculo) return { ok: false, erro: `Pacote "${pacote}" ou UF "${clienteUf}" inválidos para o 0800` };
    return { ok: true, calculo };
  }
  if (tipoOferta === 'mpls') {
    if (!clienteUf) return { ok: false, erro: 'UF do cliente é obrigatória para calcular o MPLS' };
    if (!clienteCidade || !clienteCidade.trim()) {
      return { ok: false, erro: 'Cidade do cliente é obrigatória para calcular o MPLS (define a região de preço)' };
    }
    const calculo = calcularMPLS(velocidade, roteador || null, clienteUf, clienteCidade);
    if (!calculo) return { ok: false, erro: `Velocidade "${velocidade}", roteador "${roteador}" ou UF "${clienteUf}" inválidos para o MPLS` };
    return { ok: true, calculo };
  }
  if (tipoOferta === 'lan_epl') {
    if (!clienteUf) return { ok: false, erro: 'UF do cliente é obrigatória para calcular o LAN EPL' };
    if (!tipo || !trajeto) return { ok: false, erro: 'Tipo e trajeto são obrigatórios para calcular o LAN EPL' };
    const calculo = calcularLANEPL(velocidade, tipo, trajeto, roteador || null, clienteUf);
    if (!calculo) {
      return { ok: false, erro: `Velocidade "${velocidade}", tipo "${tipo}", trajeto "${trajeto}" ou roteador "${roteador}" inválidos para o LAN EPL` };
    }
    return { ok: true, calculo };
  }
  return { ok: false, erro: 'Tipo de oferta inválido' };
}
