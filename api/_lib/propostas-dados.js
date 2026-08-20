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
