// CONSTANTES DE POLÍTICA do Simulador 2.0 / Simulador de AACE — CÓPIA LITERAL do index.html.
// Gerado por script (extração por linhas). Ao mudar uma regra no Dash atual, regerar/atualizar aqui.
// Cada bloco indica a linha de origem no index.html.

// ── origem: index.html linhas 8393-8406 (copiado sem alteração, só com "export") ──
// Item 2.6.4-ii — Faixa CNPJ/HC (tabela definitiva, a partir de set/26)
export const FAIXAS_CNPJHC_DEFINITIVA = [
  { faixa: 'Faixa 1', min: 0,   max: 200,      unitario: 2.50 },
  { faixa: 'Faixa 2', min: 201, max: 300,      unitario: 2.00 },
  { faixa: 'Faixa 3', min: 301, max: 399,      unitario: 1.50 },
  { faixa: 'Faixa 4', min: 400, max: Infinity, unitario: 1.00 },
];
// Item 2.6.7 — Faixa CNPJ/HC (tabela de transição, fechamentos jun/jul/ago-26)
export const FAIXAS_CNPJHC_TRANSICAO = [
  { faixa: 'Faixa 1', min: 0,   max: 400,      unitario: 2.50 },
  { faixa: 'Faixa 2', min: 401, max: 500,      unitario: 2.00 },
  { faixa: 'Faixa 3', min: 501, max: 599,      unitario: 1.50 },
  { faixa: 'Faixa 4', min: 600, max: Infinity, unitario: 1.00 },
];

// ── origem: index.html linhas 8504-8535 (copiado sem alteração, só com "export") ──
// Item 2.6.4-i — Net Adds negativo: unitário fixo por categoria
export const UNITARIO_NETADDS_NEGATIVO = { bronze: 0.60, prata: 0.60, ouro: 0.80, safira: 1.00, diamante: 1.00 };

// Item 2.6.5-ii — % de liberação do Teto de Carteira (categoria × faixa)
export const TETO_LIBERACAO = {
  bronze:   [0.40, 0.37, 0.35, 0.33],
  prata:    [0.43, 0.40, 0.36, 0.33],
  ouro:     [0.47, 0.42, 0.37, 0.33],
  safira:   [0.51, 0.42, 0.37, 0.33],
  diamante: [0.55, 0.42, 0.37, 0.33],
};

// Item 2.5.5-iii — % Bônus Categoria sobre faturamento de comissão
export const BONUS_CATEGORIA_PCT = { bronze: 0, prata: 0.03, ouro: 0.10, safira: 0.13, diamante: 0.18 };

// Item 2.7-ii-d — Rampa de meta para vendedores recém-contratados
export const RAMPA_PRODUTIVIDADE = [
  { label: '1º mês',      pct: 0.00 },
  { label: '2º mês',      pct: 0.25 },
  { label: '3º mês',      pct: 0.25 },
  { label: '4º mês',      pct: 0.50 },
  { label: '5º mês',      pct: 0.75 },
  { label: '6º mês+ (100%)', pct: 1.00 },
];

// Item 2.7-iii — Faixas de bônus produtividade (por vendedor elegível)
export const FAIXAS_BONUS_PRODUTIVIDADE = [
  { min: 0,   max: 59.9999,  valor: 0,    label: 'Faixa 0' },
  { min: 60,  max: 79.9999,  valor: 1200, label: 'Faixa 1' },
  { min: 80,  max: 99.9999,  valor: 1700, label: 'Faixa 2' },
  { min: 100, max: Infinity, valor: 2300, label: 'Faixa 3' },
];

// ── origem: index.html linhas 8537-8537 (copiado sem alteração, só com "export") ──
export function s2fmt(v) { return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

// ── origem: index.html linhas 10713-10727 (copiado sem alteração, só com "export") ──
// Valores default de cada campo — usados pra limpar o formulário antes de
// carregar uma competência nova, senão os valores do mês anterior "vazam"
// pro mês seguinte quando não há nada salvo ainda pra ele.
export const S2_DEFAULTS = {
  'tabela-cnpjhc': 'transicao',
  'categoria':     'bronze',
  'cluster':       'P',
  'total-cnpjs':   0,
  'total-hcs':     1,
  'meta-voz':      18,
  'meta-bl':       6,
  'meta-sd':       50,
  'meta-movel-voz': 0,
  'meta-fixa-bl':   0,
};
