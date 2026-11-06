// REGRAS DO SIMULADOR DE AACE (política Claro, Anexo III-A) — CÓPIA LITERAL do index.html.
// Gerado por script (extração por linhas): constantes AACE_*, motor aaceCalcular e importador de extrato
// (CSV analítico + texto do PDF resumo). NÃO reescrever regra aqui: ao mudar no Dash atual, regerar.
// Cada bloco indica a linha de origem no index.html. O estado AACE (lados A e B) vive neste módulo.

import { s2FaixaAdicionalIdx, GF_RENOVACAO_TABELA1 } from './politica.js';
import { BONUS_CATEGORIA_PCT, FAIXAS_CNPJHC_TRANSICAO, FAIXAS_CNPJHC_DEFINITIVA, UNITARIO_NETADDS_NEGATIVO, TETO_LIBERACAO, FAIXAS_BONUS_PRODUTIVIDADE, s2fmt } from './politica-sim.js';

// ── origem: index.html linhas 8580-8765 (copiado sem alteração, só com "export") ──
export const AACE_STORAGE_KEY = 'vst_aace_v1';

// Item 2.2, Tabela 1 (PDF p.8) — fatores fixos. m* = Master; e* = Elite; P/M/G = Elite dentro da área
export const AACE_T1 = {
  movelL1: { mFora: 1.80, mDentro: 4.30, eFora: 1.90, P: 5.00, M: 5.20, G: 5.60 }, // Novo Voz / Portab. Novo VOZ-BL / Portab. Increm. VOZ-BL / TT Pré PF-PJ VOZ-BL
  movelL2: { mFora: 1.30, mDentro: 3.20, eFora: 1.40, P: 3.70, M: 3.90, G: 4.20 }, // Novo BL / Incremento linhas e receita VOZ-BL
  movelL3: { mFora: 0.60, mDentro: 2.30, eFora: 0.70, P: 2.50, M: 2.50, G: 2.50 }, // Incremento módulo VOZ-BL / TT Pós PF-PJ VOZ-BL
  m2m:     { mFora: 1.20, mDentro: 1.90, eFora: 1.30, P: 2.20, M: 2.20, G: 2.20 },
  fixa:    { mFora: 1.80, mDentro: 2.40, eFora: 2.00, P: 2.90, M: 3.10, G: 3.40 }, // Fixa Básica TV / Fone / Banda Larga
  hotel:   { mFora: 1.00, mDentro: 1.00, eFora: 1.00, P: 1.00, M: 1.00, G: 1.00 }, // Hotel e Hospital
};
export const AACE_PLUGIN_PORT_VOZ = 1.50;  // Plugin Portabilidade Voz (item 2.2-v), vale p/ Voz, não p/ BL móvel
export const AACE_CONECT_ATIVACAO = 3.00;  // Conectividade Avançada — ativação (igual em Master/Elite/cluster/fora)
export const AACE_CONECT_RENOV = 2.00;     // Renovação Conecta (após 36 meses)

// Item 2.3, Tabela 1 — fator adicional por faixa (1 = 100–119,99%; 2 = 120–139,99%; 3 = ≥140%) e cluster
export const AACE_ADIC = {
  G1: [{ P: .50, M: .60, G: .75 }, { P: .60, M: .70, G: .85 }, { P: .70, M: .80, G: .95 }],   // Móvel Novo VOZ/BL + TT Pré
  G2: [{ P: .50, M: .65, G: .90 }, { P: .60, M: .85, G: 1.10 }, { P: .70, M: 1.05, G: 1.40 }], // Portabilidade Voz (Novo e Increm.)
  G3: [{ P: .50, M: .60, G: .75 }, { P: .60, M: .70, G: .85 }, { P: .70, M: .80, G: .95 }],   // Portabilidade BL (Novo e Increm.) + Incremento Voz/BL
  FBL: [{ P: .95, M: 1.15, G: 1.55 }, { P: 1.15, M: 1.35, G: 1.75 }, { P: 1.45, M: 1.65, G: 2.05 }], // Fixa Básica: Banda Larga e TV
  FFONE: [{ P: .70, M: .90, G: 1.10 }, { P: .80, M: 1.00, G: 1.20 }, { P: 1.00, M: 1.20, G: 1.40 }], // Fixa Básica: Fone
  CONECT: [{ P: .30, M: .40, G: .50 }, { P: .50, M: .60, G: .70 }, { P: .80, M: .90, G: 1.00 }],     // Conectividade Avançada
};

// Item 2.4-ii-b, Tabela 2 — Renovação para CNPJ em área cabeada sem convergência (a Tabela 1 é GF_RENOVACAO_TABELA1)
export const AACE_RENOV_T2 = [
  { P: 1.15, M: 1.35, G: 1.55 }, { P: 1.13, M: 1.33, G: 1.53 }, { P: 1.08, M: 1.28, G: 1.48 },
  { P: 0.85, M: 1.05, G: 1.25 }, { P: 0.65, M: 0.85, G: 1.05 }, { P: 0.45, M: 0.65, G: 0.85 }, { P: 0.35, M: 0.55, G: 0.75 },
];
export const AACE_PLUGIN_CONVERGENCIA = 0.70; // item 2.8

// Anexo III — clusterização (Móvel Voz em linhas, Fixa BL em UGR, Conectividade em R$ de receita): [máx. P, máx. M]
export const AACE_CLUSTER = {
  A: { voz: [199, 699], bl: [49, 119], av: [1999.99, 3999.99] },
  B: { voz: [99, 299], bl: [19, 59], av: [1499.99, 3499.99] },
};
// Anexo IV — limites mínimos de cada desempenho 1..5 (CNPJ Novo Voz / Fixa Básica)
export const AACE_METAS_BONUS = {
  A: { voz: [15, 35, 100, 210, 350], bl: [15, 40, 110, 190, 290] },
  B: { voz: [10, 25, 45, 70, 100], bl: [10, 20, 40, 65, 95] },
};
export const AACE_MIN_VENDEDORES_ELITE = 4; // item 2.1-iii-b-1 / 2.7-i-c

// Tipos de pedido com qtd × ticket. linha = linha da Tabela 1; adic = tabela de adicional; cnt = realizado que mede a meta
export const AACE_ITENS = [
  { k: 'novoVoz', l: 'Novo — Voz', grupo: 'movel', linha: 'movelL1', adic: 'G1', cnt: 'voz' },
  { k: 'ttPre', l: 'TT Pré PF/PJ — Voz', grupo: 'movel', linha: 'movelL1', adic: 'G1', cnt: 'voz' },
  { k: 'portVoz', l: 'Portabilidade (Novo e Increm.) — Voz', grupo: 'movel', linha: 'movelL1', adic: 'G2', cnt: 'voz', plug: true },
  { k: 'incrVoz', l: 'Incremento — Voz', grupo: 'movel', linha: 'movelL2', adic: 'G3', cnt: 'voz' },
  { k: 'novoBl', l: 'Novo — Banda Larga móvel', grupo: 'movel', linha: 'movelL2', adic: 'G1', cnt: 'movelBl' },
  { k: 'portBl', l: 'Portabilidade (Novo e Increm.) — BL móvel', grupo: 'movel', linha: 'movelL1', adic: 'G3', cnt: 'movelBl' },
  { k: 'incrBl', l: 'Incremento — BL móvel', grupo: 'movel', linha: 'movelL2', adic: 'G3', cnt: 'movelBl' },
  { k: 'blFixa', l: 'Fixa Básica — Banda Larga', grupo: 'fixa', linha: 'fixa', adic: 'FBL', cnt: 'fixaBl' },
  { k: 'tvFixa', l: 'Fixa Básica — TV', grupo: 'fixa', linha: 'fixa', adic: 'FBL', cnt: 'fixaTv' },
  { k: 'foneFixa', l: 'Fixa Básica — Fone', grupo: 'fixa', linha: 'fixa', adic: 'FFONE', cnt: 'fixaFone' },
];
export const AACE_CNT_META = { voz: 'metaVoz', movelBl: 'metaMovelBl', fixaBl: 'metaFixaBl', fixaTv: 'metaFixaTv', fixaFone: 'metaFixaFone' };

export const AACE_OP_FAIXA = [['auto', 'Automático (meta × realizado informados)'], ['0', 'Abaixo de 100% — sem adicional'], ['1', '100% da meta — Faixa 1'], ['2', '120% da meta — Faixa 2'], ['3', '140% da meta — Faixa 3']];
export const AACE_OP_CLUSTER = [['auto', 'Automático (pela produção)'], ['P', 'P'], ['M', 'M'], ['G', 'G']];
export const AACE_OP_DESEMP = [['auto', 'Automático (pelo valor informado)'], ['0', 'Desempenho 0'], ['1', 'Desempenho 1'], ['2', 'Desempenho 2'], ['3', 'Desempenho 3'], ['4', 'Desempenho 4'], ['5', 'Desempenho 5']];
export const AACE_OP_CATEGORIA = [['auto', 'Automático (4 indicadores)'], ['bronze', 'Bronze'], ['prata', 'Prata'], ['ouro', 'Ouro'], ['safira', 'Safira'], ['diamante', 'Diamante']];

// Formulário: cada seção é uma lista de linhas; `esp` = campo copiado pelo botão "Espelhar produção no Lado B"
export const AACE_SECOES = [
  { id: 'enq', titulo: '1. Enquadramento', tipo: 'campos', campos: [
    { k: 'modalidade', l: 'Modalidade', t: 'sel', op: [['auto', 'Automático (4 ou mais HCs = Elite)'], ['elite', 'Elite'], ['master', 'Master']], def: 'auto' },
    { k: 'regiao', l: 'Região (Anexos III e IV)', t: 'sel', op: [['A', 'Grupo A — SP1, RSUL, NE, DF, SP2, GO, MS, MT, RJ'], ['B', 'Grupo B — NO, MG, BA-SE, ES, AC, RO, TO']], def: 'A' },
    { k: 'clusterMovel', l: 'Cluster — Móvel', t: 'sel', op: AACE_OP_CLUSTER, def: 'auto' },
    { k: 'clusterFixa', l: 'Cluster — Fixa Básica', t: 'sel', op: AACE_OP_CLUSTER, def: 'auto' },
    { k: 'clusterConect', l: 'Cluster — Conectividade', t: 'sel', op: AACE_OP_CLUSTER, def: 'auto' },
    { k: 'categoria', l: 'Categoria do Bônus', t: 'sel', op: AACE_OP_CATEGORIA, def: 'auto' },
    { k: 'faixaMovel', l: 'Atingimento da meta — Móvel', t: 'sel', op: AACE_OP_FAIXA, def: 'auto' },
    { k: 'faixaFixa', l: 'Atingimento da meta — Fixa Básica', t: 'sel', op: AACE_OP_FAIXA, def: 'auto' },
    { k: 'faixaConect', l: 'Atingimento da meta — Conectividade', t: 'sel', op: AACE_OP_FAIXA, def: 'auto' },
    { k: 'faixaProd', l: 'Faixa do Bônus Produtividade', t: 'sel', op: [['auto', 'Automático (meta × realizado)'], ['0', 'Faixa 0 — R$ 0'], ['1', 'Faixa 1 — R$ 1.200 por vendedor'], ['2', 'Faixa 2 — R$ 1.700 por vendedor'], ['3', 'Faixa 3 — R$ 2.300 por vendedor']], def: 'auto' },
    { k: 'tetoCarteira', l: 'Teto da recorrência de carteira', t: 'sel', op: [['auto', 'Automático (aplica o teto da política)'], ['sem', 'Sem teto — paga 100% das linhas']], def: 'auto' },
    { k: 'foraPct', l: '% da produção fora da área de atuação', t: 'num', def: '0', esp: true },
  ] },
  { id: 'movel', titulo: '2. Produção do mês — Móvel (Voz)', tipo: 'linhas', cab: ['Linhas', 'Ticket (R$/linha)'],
    linhas: AACE_ITENS.filter(i => i.grupo === 'movel').map(i => ({ l: i.l, cols: [i.k + 'Qtd', i.k + 'Ticket'], mais: !['novoVoz', 'portVoz', 'incrVoz'].includes(i.k) })) },
  { id: 'fixa', titulo: '3. Produção do mês — Fixa Básica', tipo: 'linhas', cab: ['Instalações', 'Ticket (R$/mês)'],
    linhas: AACE_ITENS.filter(i => i.grupo === 'fixa').map(i => ({ l: i.l, cols: [i.k + 'Qtd', i.k + 'Ticket'] })) },
  { id: 'renov', titulo: '4. Renovação / Migração Móvel (por faixa de Delta Ticket)', tipo: 'linhas', cab: ['Quantidade', 'Ticket (R$/linha)', 'Faixa de Delta'],
    linhas: [1, 2, 3].map(i => ({ l: 'Linha ' + i, cols: ['renov' + i + 'Qtd', 'renov' + i + 'Ticket', 'renov' + i + 'Faixa'] }))
      .concat([{ l: 'Tabela aplicada', cols: [null, null, 'renovTabela'] }])
      .concat([4, 5, 6, 7].map(i => ({ l: 'Linha ' + i, cols: ['renov' + i + 'Qtd', 'renov' + i + 'Ticket', 'renov' + i + 'Faixa'], mais: true }))) },
  { id: 'rec', titulo: '5. Receitas do mês', tipo: 'linhas', cab: ['Receita contratada (R$)', 'Fator / parâmetro'],
    linhas: [
      { l: 'Conectividade Avançada — ativação', cols: ['conectRec'] },
      { l: 'Soluções Digitais e SVA  |  fator do Anexo I (%)', cols: ['sdRec', 'sdFator'] },
      { l: 'Plugin de Convergência  |  fator', cols: ['convRec', 'convFator'] },
      { l: 'Incremento de módulo e TT Pós PF/PJ (Voz/BL)', cols: ['modulosRec'], mais: true },
      { l: 'M2M (Rastreamento e Telemetria)', cols: ['m2mRec'], mais: true },
      { l: 'Hotel e Hospital (TV/Fone/BL)', cols: ['hotelRec'], mais: true },
      { l: 'Conectividade — Renovação Conecta (36 meses)', cols: ['conectRenovRec'], mais: true },
    ] },
  { id: 'meta', titulo: '6. Metas do mês (carta meta da Claro)', tipo: 'campos', campos: [
    { k: 'metaVoz', l: 'Móvel Voz (linhas)', t: 'num', def: '' },
    { k: 'metaMovelBl', l: 'Móvel Banda Larga (linhas)', t: 'num', def: '' },
    { k: 'metaFixaBl', l: 'Fixa Básica — Banda Larga', t: 'num', def: '' },
    { k: 'metaFixaTv', l: 'Fixa Básica — TV', t: 'num', def: '' },
    { k: 'metaFixaFone', l: 'Fixa Básica — Fone', t: 'num', def: '' },
    { k: 'metaConect', l: 'Conectividade Avançada (R$)', t: 'num', def: '' },
  ] },
  { id: 'ind', titulo: '7. Indicadores do Bônus Categoria (item 2.5)', tipo: 'campos', campos: [
    { k: 'cnpjNovoVoz', l: 'CNPJs novos — Móvel Voz', t: 'num', def: '', esp: true },
    { k: 'cnpjNovoBl', l: 'CNPJs novos — Fixa Básica BL', t: 'num', def: '', esp: true },
    { k: 'gross', l: 'Linhas de Voz ativadas no mês (gross)', t: 'num', def: '', esp: true },
    { k: 'cancel', l: 'Linhas de Voz canceladas no mês', t: 'num', def: '', esp: true },
    { k: 'netAddsPct', l: 'Net Adds % (direto; vale no lugar de gross/cancelamentos)', t: 'num', def: '', esp: true },
    { k: 'churn', l: 'Churn Safra 180 dias Móvel (%)', t: 'num', def: '', esp: true },
    { k: 'dvForca', l: 'Desempenho — CNPJ Novo Voz', t: 'sel', op: AACE_OP_DESEMP, def: 'auto' },
    { k: 'dbForca', l: 'Desempenho — CNPJ Novo Fixa BL', t: 'sel', op: AACE_OP_DESEMP, def: 'auto' },
    { k: 'dnForca', l: 'Desempenho — Net Adds', t: 'sel', op: AACE_OP_DESEMP, def: 'auto' },
    { k: 'dcForca', l: 'Desempenho — Churn Safra', t: 'sel', op: AACE_OP_DESEMP, def: 'auto' },
  ] },
  { id: 'cart', titulo: '8. Carteira e equipe (itens 2.6 e 2.7)', tipo: 'campos', campos: [
    { k: 'linhasAtivas', l: 'Linhas ativas na carteira (foto do fim do mês)', t: 'num', def: '', esp: true },
    { k: 'cnpjs', l: 'CNPJs na carteira', t: 'num', def: '', esp: true },
    { k: 'hcs', l: 'Vendedores / HCs ativos declarados', t: 'num', def: '', esp: true },
    { k: 'razaoGrupo', l: 'CNPJ/HC do grupo (vazio = CNPJs ÷ HCs)', t: 'num', def: '' },
    { k: 'faixaCnpjHc', l: 'Faixa de CNPJ/HC', t: 'sel', op: [['auto', 'Automático (pela razão)'], ['1', 'Faixa 1'], ['2', 'Faixa 2'], ['3', 'Faixa 3'], ['4', 'Faixa 4']], def: 'auto' },
    { k: 'metaVendVoz', l: 'Meta por vendedor — Móvel Voz (linhas)', t: 'num', def: '18' },
    { k: 'metaVendBl', l: 'Meta por vendedor — Fixa BL', t: 'num', def: '6' },
    { k: 'metaVendSd', l: 'Meta por vendedor — Solução Digital (R$)', t: 'num', def: '50' },
  ] },
  { id: 'ext', titulo: '9. Conferência com o extrato (opcional)', tipo: 'campos', campos: [
    { k: 'extratoTotal', l: 'Total pago no extrato do mês (R$)', t: 'num', def: '' },
  ] },
  { id: 'ajustes', titulo: '10. Ajustes do extrato', tipo: 'campos', somenteImport: true, campos: [
    { k: 'reducaoPct', l: 'Redução MKT Nacional — % do fator pago', t: 'num', def: '60' },
    { k: 'ajusteSaldo', l: 'Estornos e recálculos — saldo do mês (R$; negativo = desconto)', t: 'num', def: '' },
  ] },
  { id: 'reds', titulo: '11. Linhas com redução MKT Nacional', tipo: 'linhas', somenteImport: true, cab: ['Linhas com redução'],
    linhas: AACE_ITENS.filter(i => i.grupo === 'movel').map(i => ({ l: i.l, cols: [i.k + 'Red'] }))
      .concat([1, 2, 3, 4, 5, 6, 7].map(i => ({ l: 'Renovação / Migração — linha ' + i, cols: ['renov' + i + 'Red'] }))) },
  { id: 'fora', titulo: '12. Linhas fora da área de atuação (por tipo)', tipo: 'linhas', somenteImport: true, cab: ['Linhas fora da área'],
    linhas: AACE_ITENS.map(i => ({ l: i.l, cols: [i.k + 'Fora'] })) },
];
// campos soltos usados pelas "linhas" (valor, receita etc.) com seus padrões
export const AACE_CAMPOS_LINHA = {
  sdFator: { def: '100' }, convFator: { def: String(AACE_PLUGIN_CONVERGENCIA) },
  renovTabela: { t: 'sel', op: [['1', 'Tabela 1 (fora da cabeada / com BL / convergência)'], ['2', 'Tabela 2 (cabeada, sem convergência)']], def: '1' },
};
[1, 2, 3, 4, 5, 6, 7].forEach(i => {
  AACE_CAMPOS_LINHA['renov' + i + 'Faixa'] = { t: 'sel', op: [1, 2, 3, 4, 5, 6, 7].map(f => [String(f), 'Faixa ' + f + ' — ' + GF_RENOVACAO_TABELA1[f - 1].delta]), def: String(i) };
});

// Produção (seções 2–4), metas (5), % fora da área e linhas ativas da carteira vêm SEMPRE do Lado A para o Lado B, travados: a comparação
// isola o efeito do enquadramento (cluster, categoria, atingimento, KPIs) sobre a mesma produção.
export const AACE_SECOES_ESPELHADAS = ['movel', 'fixa', 'renov', 'rec', 'meta', 'ajustes', 'reds', 'fora'];
export let _aaceSecDoCampo = null;
export function aaceEspelhado(k) {
  if (!_aaceSecDoCampo) { _aaceSecDoCampo = {}; aaceTodosCampos().forEach(c => { _aaceSecDoCampo[c.k] = c.sec; }); }
  return k === 'foraPct' || k === 'linhasAtivas' || AACE_SECOES_ESPELHADAS.includes(_aaceSecDoCampo[k]);
}
// Seções 10–12 não aceitam digitação: só aparecem (recolhidas e travadas) quando o extrato importado as preencheu
export const AACE_SECOES_SO_IMPORT = ['ajustes', 'reds', 'fora'];
export function aaceSomenteImport(k) {
  aaceEspelhado(k); // garante o mapa campo → seção
  return AACE_SECOES_SO_IMPORT.includes(_aaceSecDoCampo[k]);
}
export function aaceValor(lado, k) { return (lado === 'b' && aaceEspelhado(k)) ? AACE.a[k] : AACE[lado][k]; }
export function aaceEstadoEfetivo(lado) {
  const e = { ...AACE[lado] };
  if (lado === 'b') Object.keys(e).forEach(k => { if (aaceEspelhado(k)) e[k] = AACE.a[k]; });
  return e;
}

export function aaceTodosCampos() {
  const out = [];
  AACE_SECOES.forEach(s => {
    if (s.tipo === 'campos') s.campos.forEach(c => out.push({ ...c, sec: s.id }));
    else s.linhas.forEach(r => r.cols.forEach(k => { if (k) out.push({ k, sec: s.id, esp: true, ...(AACE_CAMPOS_LINHA[k] || {}) }); }));
  });
  return out;
}
export function aaceEstadoPadrao(lado) {
  const e = {};
  aaceTodosCampos().forEach(c => { e[c.k] = c.def !== undefined ? c.def : ''; });
  return e;
}
export let AACE = { a: aaceEstadoPadrao('a'), b: aaceEstadoPadrao('b'), g: { tabela: 'definitiva' } };
export let _aaceIniciou = false;

// ── origem: index.html linhas 8767-8949 (copiado sem alteração, só com "export") ──
// ─── Funções puras de cálculo ────────────────────────────────────────────────
export function aaceNum(v) { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; }
// Redução de campanha (ex.: "REDUÇÃO % - MKT NACIONAL"): parte das linhas recebe só pctPago% do fator
export function aaceMultReducao(qtd, red, pctPago) {
  if (qtd <= 0 || red <= 0) return 1;
  return 1 - Math.min(red / qtd, 1) * (1 - pctPago / 100);
}
export function aaceClusterPor(v, [maxP, maxM]) { return v <= maxP ? 'P' : (v <= maxM ? 'M' : 'G'); }
export function aaceDesempenho(v, limites) { return limites.filter(l => v >= l).length; }
// Net Adds % = (gross − cancelamentos) ÷ gross — faixas do Anexo IV (sem arredondar)
export function aaceDesempNetAdds(pct, temGross) {
  if (!temGross || pct <= 0) return 0;
  return pct < 20 ? 1 : pct < 50 ? 2 : pct < 80 ? 3 : pct < 90 ? 4 : 5;
}
// Churn Safra 180 dias — menor é melhor (Anexo IV)
export function aaceDesempChurn(v) { return v >= 11.01 ? 0 : v >= 9.5 ? 1 : v >= 5.5 ? 2 : v >= 3.5 ? 3 : v >= 2.5 ? 4 : 5; }
export const AACE_ORDEM_CAT = ['bronze', 'prata', 'ouro', 'safira', 'diamante'];
export const AACE_MIN_CAT = { ouro: 3, safira: 4, diamante: 5 }; // desempenho mínimo em CNPJ Novo Voz E Fixa BL (2.5.4-v)
export function aaceCategoriaDaNota(nota100, dv, db) {
  let i = nota100 <= 222 ? 0 : nota100 <= 282 ? 1 : nota100 <= 382 ? 2 : nota100 <= 482 ? 3 : 4;
  while (i > 1 && (dv < AACE_MIN_CAT[AACE_ORDEM_CAT[i]] || db < AACE_MIN_CAT[AACE_ORDEM_CAT[i]])) i--;
  return AACE_ORDEM_CAT[i];
}

// s = campos de um lado; g = parâmetros gerais. Devolve tudo que a tela mostra.
export function aaceCalcular(s, g) {
  const n = k => aaceNum(s[k]);
  // Automático: Elite exige no mínimo 4 vendedores (2.1-iii); com menos de 4 HCs informados o AACE é Master
  const modAuto = !s.modalidade || s.modalidade === 'auto';
  const master = s.modalidade === 'master' || (modAuto && aaceNum(s.hcs) > 0 && aaceNum(s.hcs) < AACE_MIN_VENDEDORES_ELITE);
  const regiao = s.regiao === 'B' ? 'B' : 'A';
  const reg = AACE_CLUSTER[regiao];
  const avisos = [];
  const pf = Math.min(Math.max(n('foraPct'), 0), 100) / 100; // parcela fora da área
  const redPct = (s.reducaoPct === '' || s.reducaoPct === undefined) ? 60 : Math.min(Math.max(n('reducaoPct'), 0), 100);

  // realizado por tipo de meta (linhas) e receita de Conectividade
  const real = { voz: 0, movelBl: 0, fixaBl: 0, fixaTv: 0, fixaFone: 0 };
  AACE_ITENS.forEach(it => { real[it.cnt] += n(it.k + 'Qtd'); });
  const conectRec = n('conectRec');

  // cluster por segmento (2.1-vi/viii): Master é sempre P
  const sug = { movel: aaceClusterPor(real.voz, reg.voz), fixa: aaceClusterPor(real.fixaBl, reg.bl), conect: aaceClusterPor(conectRec, reg.av) };
  const forca = { movel: s.clusterMovel, fixa: s.clusterFixa, conect: s.clusterConect };
  const cl = seg => master ? 'P' : ((forca[seg] && forca[seg] !== 'auto') ? forca[seg] : sug[seg]);
  const C = { movel: cl('movel'), fixa: cl('fixa'), conect: cl('conect') };

  // % de atingimento e faixa do fator adicional (2.3) — Master também recebe (coluna P)
  const pct = {};
  Object.keys(AACE_CNT_META).forEach(c => { pct[c] = n(AACE_CNT_META[c]) > 0 ? real[c] / n(AACE_CNT_META[c]) * 100 : 0; });
  pct.conect = n('metaConect') > 0 ? conectRec / n('metaConect') * 100 : 0;
  const faixaDe = (cnt, campo) => (s[campo] && s[campo] !== 'auto') ? Number(s[campo]) - 1 : s2FaixaAdicionalIdx(pct[cnt]);
  const fx = { voz: faixaDe('voz', 'faixaMovel'), movelBl: faixaDe('movelBl', 'faixaMovel'),
    fixaBl: faixaDe('fixaBl', 'faixaFixa'), fixaTv: faixaDe('fixaTv', 'faixaFixa'), fixaFone: faixaDe('fixaFone', 'faixaFixa'),
    conect: faixaDe('conect', 'faixaConect') };
  const fxAuto = {}, metaInf = {};
  Object.keys(AACE_CNT_META).forEach(c => { fxAuto[c] = s2FaixaAdicionalIdx(pct[c]); metaInf[c] = n(AACE_CNT_META[c]) > 0; });
  fxAuto.conect = s2FaixaAdicionalIdx(pct.conect); metaInf.conect = n('metaConect') > 0;
  Object.keys(AACE_CNT_META).forEach(c => {
    if (real[c] > 0 && n(AACE_CNT_META[c]) <= 0 && s[c === 'voz' || c === 'movelBl' ? 'faixaMovel' : 'faixaFixa'] === 'auto') {
      avisos.push('Meta de ' + { voz: 'Móvel Voz', movelBl: 'Móvel BL', fixaBl: 'Fixa BL', fixaTv: 'Fixa TV', fixaFone: 'Fixa Fone' }[c] + ' não informada: sem fator adicional.');
    }
  });

  const fixoDe = (linha, cluster) => { const t = AACE_T1[linha]; return master ? { dentro: t.mDentro, fora: t.mFora } : { dentro: t[cluster], fora: t.eFora }; };

  // tipos de pedido com qtd × ticket (2.2-iv: receita contratada × fator)
  const itens = AACE_ITENS.map(it => {
    const seg = it.grupo === 'movel' ? 'movel' : 'fixa';
    const c = C[seg];
    const f = fixoDe(it.linha, c);
    const plug = it.plug ? AACE_PLUGIN_PORT_VOZ : 0;
    const f_ = fx[it.cnt];
    const adic = f_ >= 0 ? AACE_ADIC[it.adic][f_][c] : 0;
    const qtd = n(it.k + 'Qtd'), receita = qtd * n(it.k + 'Ticket');
    // linhas fora da área informadas por tipo (extrato importado) valem mais que o % geral
    const pfi = (s[it.k + 'Fora'] === '' || s[it.k + 'Fora'] === undefined) ? pf : Math.min(n(it.k + 'Fora') / (qtd || 1), 1);
    const fator = (1 - pfi) * (f.dentro + adic + plug) + pfi * (f.fora + plug);
    const mult = aaceMultReducao(qtd, n(it.k + 'Red'), redPct);
    return { ...it, cluster: c, qtd, receita, fixo: f.dentro, adic, plug, fator, mult, comissao: receita * fator * mult };
  });
  const so = (linha, receita, cluster) => { const f = fixoDe(linha, cluster); const fator = (1 - pf) * f.dentro + pf * f.fora; return { receita, fator, comissao: receita * fator }; };
  const modulos = so('movelL3', n('modulosRec'), C.movel);
  const m2m = so('m2m', n('m2mRec'), C.movel);
  const hotel = so('hotel', n('hotelRec'), C.fixa);
  const adicConect = fx.conect >= 0 ? AACE_ADIC.CONECT[fx.conect][C.conect] : 0;
  const conect = { receita: conectRec, fator: (1 - pf) * (AACE_CONECT_ATIVACAO + adicConect) + pf * AACE_CONECT_ATIVACAO, adic: adicConect };
  conect.comissao = conectRec * conect.fator;
  const conectRenov = { receita: n('conectRenovRec'), fator: AACE_CONECT_RENOV };
  conectRenov.comissao = conectRenov.receita * conectRenov.fator;
  const sdFator = s.sdFator === '' ? 1 : n('sdFator') / 100;
  const sd = { receita: n('sdRec'), fator: sdFator, comissao: n('sdRec') * sdFator };
  const tabRenov = s.renovTabela === '2' ? AACE_RENOV_T2 : GF_RENOVACAO_TABELA1;
  // 3 linhas de renovação, cada uma com quantidade, ticket e a faixa de Delta Ticket dela (2.4); fator com 2 casas (2.4-vi-b)
  const renovLinhas = [1, 2, 3, 4, 5, 6, 7].map(i => {
    const faixa = Math.min(Math.max(Number(s['renov' + i + 'Faixa'] || i), 1), 7);
    const fator = Math.round(tabRenov[faixa - 1][C.movel] * 100) / 100;
    const qtd = n('renov' + i + 'Qtd'), receita = qtd * n('renov' + i + 'Ticket');
    const mult = aaceMultReducao(qtd, n('renov' + i + 'Red'), redPct);
    return { qtd, faixa, fator, mult, receita, ticket: n('renov' + i + 'Ticket'), red: n('renov' + i + 'Red'), delta: GF_RENOVACAO_TABELA1[faixa - 1].delta, comissao: receita * fator * mult };
  });
  const renov = { linhas: renovLinhas, cluster: C.movel, tabela: s.renovTabela === '2' ? '2' : '1', redPct, receita: renovLinhas.reduce((a, l) => a + l.receita, 0), comissao: renovLinhas.reduce((a, l) => a + l.comissao, 0) };
  renov.fator = renov.receita > 0 ? renov.comissao / renov.receita : 0;
  // quanto a redução MKT Nacional tirou (itens de ativação + renovação)
  const reducaoTotal = itens.reduce((a, i) => a + i.receita * i.fator * (1 - i.mult), 0) + renovLinhas.reduce((a, l) => a + l.receita * l.fator * (1 - l.mult), 0);
  const ajustes = n('ajusteSaldo'); // estornos e recálculos do extrato (saldo; negativo = desconto)
  const conv = { receita: n('convRec'), fator: s.convFator === '' ? AACE_PLUGIN_CONVERGENCIA : n('convFator') };
  conv.comissao = conv.receita * conv.fator;

  const soma = a => a.reduce((x, y) => x + y, 0);
  const ehMovel = i => i.grupo === 'movel';
  const comMovel = soma(itens.filter(ehMovel).map(i => i.comissao));
  const comTtPre = itens.find(i => i.k === 'ttPre').comissao;
  const comFixa = soma(itens.filter(i => !ehMovel(i)).map(i => i.comissao)) + hotel.comissao;
  const comAtivacao = comMovel + modulos.comissao + m2m.comissao + comFixa + conect.comissao + conectRenov.comissao + sd.comissao;
  // 2.5.5-ii: Ativação Móvel (Novo, Increm., Portab., TT Pré) + Fixa + Conectividade + SD — sem M2M/módulos/renovação
  const baseBonusCat = comMovel + comFixa + conect.comissao + sd.comissao;
  // 2.6.5-v/vi: ativações (Móvel, R&T, SD, Fixa, Conectividade) — sem renovação/migração nem TT Pré/Pós
  const baseTeto = (comMovel - comTtPre) + m2m.comissao + comFixa + conect.comissao + sd.comissao;

  // ── Bônus Categoria (2.5) ──
  const mb = AACE_METAS_BONUS[regiao];
  const dAuto = {};
  const forcaD = (campo, auto, nome) => { dAuto[nome] = auto; return (s[campo] && s[campo] !== 'auto') ? Number(s[campo]) : auto; };
  const dv = forcaD('dvForca', aaceDesempenho(n('cnpjNovoVoz'), mb.voz), 'dv'), db = forcaD('dbForca', aaceDesempenho(n('cnpjNovoBl'), mb.bl), 'db');
  const gross = n('gross'), canc = n('cancel');
  // Net Adds em % informado direto (como vem no extrato) vale no lugar de gross/cancelamentos; o sinal indica carteira negativa
  const pctDireto = s.netAddsPct !== '' && s.netAddsPct !== undefined;
  const netAdds = pctDireto ? n('netAddsPct') : gross - canc;
  const pctNet = pctDireto ? n('netAddsPct') : (gross > 0 ? netAdds / gross * 100 : 0);
  const dn = forcaD('dnForca', aaceDesempNetAdds(pctNet, pctDireto || gross > 0), 'dn'), dc = forcaD('dcForca', aaceDesempChurn(n('churn')), 'dc');
  const x100 = 35 * dv + 30 * db + 17.5 * dn + 17.5 * dc; // nota final × 100 (35%/30%/17,5%/17,5%)
  const nota100 = Math.round(x100); // 2 casas, meio para cima: o extrato real mostra 0,875 → 0,88 e 1,575 → 1,58
  const catAuto = aaceCategoriaDaNota(nota100, dv, db);
  if (gross <= 0 && !pctDireto && s.dnForca === 'auto') avisos.push('Net Adds: informe as linhas de Voz ativadas (gross) — sem isso o desempenho é 0.');
  if (s.churn === '' && s.dcForca === 'auto') avisos.push('Churn Safra não informado: considerado 0% (desempenho 5).');
  const cat = s.categoria && s.categoria !== 'auto' ? s.categoria : catAuto;
  const bonusCat = { dv, db, dn, dc, pctNet, netAdds, direto: pctDireto, nota: nota100 / 100, catAuto, cat, pct: BONUS_CATEGORIA_PCT[cat], base: baseBonusCat };
  bonusCat.valor = bonusCat.pct * baseBonusCat;

  // ── Manutenção de base (2.6) ──
  const hcs = n('hcs'), cnpjs = n('cnpjs');
  const razao = n('razaoGrupo') > 0 ? n('razaoGrupo') : (hcs > 0 ? cnpjs / hcs : 0);
  const tab = g.tabela === 'transicao' ? FAIXAS_CNPJHC_TRANSICAO : FAIXAS_CNPJHC_DEFINITIVA;
  const fxChAuto = Math.max(0, tab.findIndex(f => razao <= f.max));
  const fxCh = (s.faixaCnpjHc && s.faixaCnpjHc !== 'auto') ? Number(s.faixaCnpjHc) - 1 : fxChAuto;
  const negativo = netAdds < 0;
  let unit, lib;
  if (master) { unit = negativo ? 0.60 : 1.00; lib = 0.33; }          // 2.6.6
  else if (negativo) { unit = UNITARIO_NETADDS_NEGATIVO[cat]; lib = 0.33; } // 2.6.4-i
  else { unit = tab[fxCh].unitario; lib = TETO_LIBERACAO[cat][fxCh]; }      // 2.6.4-ii / 2.6.5-ii
  const bruto = n('linhasAtivas') * unit, teto = baseTeto * lib;
  const semTeto = s.tetoCarteira === 'sem';  // escolhido: ignora o teto e paga 100% das linhas
  const manut = { razao, faixa: fxCh + 1, faixaAuto: fxChAuto + 1, unit, lib, negativo, bruto, teto, base: baseTeto, pago: semTeto ? bruto : Math.min(bruto, teto), limitou: !semTeto && bruto > teto, semTeto,
    linhas: n('linhasAtivas'), cat, master, tabela: g.tabela === 'transicao' ? 'transição' : 'definitiva', motivo: master ? 'master' : (negativo ? 'negativo' : 'faixa'), pctNet };
  if (n('linhasAtivas') > 0 && razao <= 0 && s.faixaCnpjHc === 'auto') avisos.push('Carteira: informe CNPJs e HCs para enquadrar a faixa de CNPJ/HC.');

  // ── Bônus Produtividade (2.7) — só Elite, mínimo 4 vendedores ──
  const elegivel = !master && hcs >= AACE_MIN_VENDEDORES_ELITE;
  const realMovel = real.voz - itens.find(i => i.k === 'ttPre').qtd; // 2.7-ii-a: Novo, Increm., Portab. Novo e Increm. de Voz (sem TT Pré)
  const metaM = hcs * n('metaVendVoz'), metaF = hcs * n('metaVendBl'), metaS = hcs * n('metaVendSd');
  const alM = metaM > 0 ? realMovel / metaM * 100 : 0, alF = metaF > 0 ? real.fixaBl / metaF * 100 : 0, alS = metaS > 0 ? sd.receita / metaS * 100 : 0;
  const menor = Math.min(alM, alF);
  let fxP = menor >= 100 ? 3 : menor >= 80 ? 2 : menor >= 60 ? 1 : 0;
  if (alM < 60 || alF < 60) fxP = 0;                // dupla performance mínima
  const retro = fxP > 0 && alS < 100;                // SD < 100% retroage uma faixa (1 → 0)
  if (retro) fxP -= 1;
  const fxProdAuto = fxP;
  const prodForcada = !!(s.faixaProd && s.faixaProd !== 'auto');
  if (prodForcada) fxP = Number(s.faixaProd);       // faixa escolhida = faixa final paga por vendedor
  const valorVend = FAIXAS_BONUS_PRODUTIVIDADE[fxP].valor;
  const prod = { elegivel, alM, alF, alS, faixa: fxP, faixaAuto: fxProdAuto, forcada: prodForcada, retro: retro && !prodForcada, valorVend, total: elegivel ? hcs * valorVend : 0 };
  if (prodForcada && !elegivel) avisos.push('Faixa do Bônus Produtividade escolhida, mas o AACE não é elegível (Master ou menos de ' + AACE_MIN_VENDEDORES_ELITE + ' HCs): bônus zero.');
  if (!master && hcs > 0 && hcs < AACE_MIN_VENDEDORES_ELITE) avisos.push('Bônus Produtividade: Elite precisa de no mínimo ' + AACE_MIN_VENDEDORES_ELITE + ' vendedores (HCs).');
  if (master && modAuto) avisos.push('Modalidade automática: Master, porque há menos de ' + AACE_MIN_VENDEDORES_ELITE + ' HCs (Elite exige no mínimo ' + AACE_MIN_VENDEDORES_ELITE + ' vendedores, item 2.1-iii).');
  if (master) avisos.push('Master: cluster sempre P (2.1-ix), sem Bônus Produtividade, Manutenção de Carteira a R$ 1,00/R$ 0,60 com teto de 33% (2.6.6).' +
    ' Fator adicional por meta pela coluna P: o item 2.3 não exclui o Master.');

  const total = comAtivacao + renov.comissao + conv.comissao + bonusCat.valor + manut.pago + prod.total + ajustes;
  const fxForca = { voz: s.faixaMovel !== 'auto', movelBl: s.faixaMovel !== 'auto', fixaBl: s.faixaFixa !== 'auto', fixaTv: s.faixaFixa !== 'auto', fixaFone: s.faixaFixa !== 'auto', conect: s.faixaConect !== 'auto' };
  return { master, modAuto, ajustes, reducaoTotal, regiao, C, sug, pct, fx, fxAuto, metaInf, dAuto, fxForca, real, itens, modulos, m2m, hotel, conect, conectRenov, sd, renov, conv,
    comMovel, comFixa, comAtivacao, baseBonusCat, baseTeto, bonusCat, manut, prod, total, avisos };
}

// ── origem: index.html linhas 8952-8953 (copiado sem alteração, só com "export") ──
export function aaceFmtPct(v) { return (v || 0).toFixed(1).replace('.', ',') + '%'; }
export function aaceFmtNum(v) { return (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }

// ── origem: index.html linhas 9274-9432 (copiado sem alteração, só com "export") ──
export function aaceLerCsv(texto) {
  const linhas = texto.replace(/^﻿/, '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  const dividir = l => {
    const out = []; let cur = '', aspas = false;
    for (const ch of l) {
      if (ch === '"') aspas = !aspas;
      else if (ch === ';' && !aspas) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const cab = dividir(linhas[0]).map(h => h.trim());
  return linhas.slice(1).map(l => {
    const c = dividir(l), o = {};
    cab.forEach((h, i) => { o[h] = (c[i] ?? '').trim(); });
    return o;
  });
}
// Faixa de Delta Ticket (1–7) pela variação % da linha (política 2.4)
export function aaceFaixaDelta(d) {
  const x = Math.round(d * 100) / 100;
  return x >= 10.01 ? 1 : x >= 3.5 ? 2 : x >= 0 ? 3 : x > -6 ? 4 : x > -13 ? 5 : x > -25 ? 6 : 7;
}

// Linhas do analítico → campos do Lado A. Devolve { est (campos), notas (texto para o usuário) }.
export function aaceMapearAnalitico(rows) {
  const nm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const est = {}, notas = [], itens = {}, renov = {}, votosRenov = {}, redPcts = [];
  const votos = { movel: { P: 0, M: 0, G: 0 }, fixa: { P: 0, M: 0, G: 0 }, master: 0, elite: 0 };
  const defItem = Object.fromEntries(AACE_ITENS.map(i => [i.k, i]));
  const perto = (a, b) => Math.abs(a - b) < 0.006;
  const acum = k => itens[k] || (itens[k] = { qtd: 0, rec: 0, red: 0, fora: 0 });
  let saldo = 0, total = 0, linhasAtivas = 0, convRec = 0, convCom = 0, sdRec = 0, sdCom = 0, modRec = 0, recFora = 0, recFixo = 0, lidas = 0, usadas = 0;

  rows.forEach(r => {
    lidas++;
    const evento = nm(r.DSC_EVENTO), tipo = nm(r.DSC_TIPO_PEDIDO), plano = nm(r.DSC_TIPO_PLANO);
    const qtd = aaceNum(r.NUM_QTD_LINHA), rec = aaceNum(r.VALOR_RECEITA_CONTRATADA), com = aaceNum(r.VALOR_COMISSAO), fixo = aaceNum(r.DSC_FATOR_FIXO);
    const pctRaw = r['VALOR COMISSIONAMENTO (%)'];
    const pct = (pctRaw === undefined || pctRaw === '') ? 1 : aaceNum(pctRaw);
    total += com;
    if (evento === 'estorno' || evento === 'recalculo') { saldo += com; usadas++; return; }
    if (evento === 'manutencao base') { linhasAtivas = Math.max(linhasAtivas, qtd); usadas++; return; }
    if (evento.startsWith('bonus')) { convRec += rec; convCom += com; usadas++; return; }
    if (!evento.startsWith('ativacao') || (com === 0 && rec === 0) || pct <= 0) return; // não remunerado
    const redLinhas = pct < 1 ? qtd : 0;
    if (pct < 1) redPcts.push(Math.round(pct * 100));
    const fixa = evento === 'ativacao fixa basica';
    if (plano === 'agregado movel') { sdRec += rec; sdCom += com; usadas++; return; }

    if (!fixa && (tipo === 'renovacao' || tipo === 'migracao')) {
      let faixa = r.DSC_TICKET_DELTA_RECEITA ? aaceFaixaDelta(aaceNum(r.DSC_TICKET_DELTA_RECEITA)) : 0;
      const tabs = [['1', GF_RENOVACAO_TABELA1], ['2', AACE_RENOV_T2]];
      if (!faixa) { // sem delta no arquivo: descobre a faixa pelo fator pago
        for (let f = 1; f <= 7 && !faixa; f++) tabs.forEach(([, tb]) => ['P', 'M', 'G'].forEach(c => { if (!faixa && perto(tb[f - 1][c], fixo)) faixa = f; }));
      }
      if (!faixa) { notas.push('Renovação sem faixa identificável ignorada.'); return; }
      tabs.forEach(([t, tb]) => ['P', 'M', 'G'].forEach(c => { if (perto(tb[faixa - 1][c], fixo)) votosRenov[t + c] = (votosRenov[t + c] || 0) + Math.max(qtd, 1); }));
      const a = renov[faixa] || (renov[faixa] = { qtd: 0, rec: 0, red: 0 });
      a.qtd += qtd; a.rec += rec; a.red += redLinhas; usadas++;
      return;
    }
    let k = null;
    if (fixa) k = plano === 'banda larga' ? 'blFixa' : (plano === 'tv' ? 'tvFixa' : 'foneFixa');
    else if (tipo === 'tt pos-pj') { modRec += rec; usadas++; return; }
    else if (tipo === 'tt pre-pj') k = 'ttPre';
    else if (tipo === 'novo') k = plano === 'banda larga' ? 'novoBl' : 'novoVoz';
    else if (tipo.startsWith('portabilidade')) k = plano === 'banda larga' ? 'portBl' : 'portVoz';
    else if (tipo === 'incremento') k = plano === 'banda larga' ? 'incrBl' : 'incrVoz';
    if (!k) { notas.push('Tipo não mapeado, ignorado: ' + r.DSC_TIPO_PEDIDO + ' / ' + r.DSC_TIPO_PLANO); return; }

    const it = defItem[k], t1 = AACE_T1[it.linha], fx = fixo - (it.plug ? AACE_PLUGIN_PORT_VOZ : 0);
    const a = acum(k); a.qtd += qtd; a.rec += rec; a.red += redLinhas; usadas++;
    recFixo += rec;
    const seg = it.grupo === 'movel' ? 'movel' : 'fixa';
    if (perto(fx, t1.eFora) || perto(fx, t1.mFora)) { recFora += rec; a.fora += qtd; }    // fator "fora da área"
    else if (['P', 'M', 'G'].some(c => perto(fx, t1[c]))) { votos.elite++; ['P', 'M', 'G'].forEach(c => { if (perto(fx, t1[c])) votos[seg][c]++; }); }
    else if (perto(fx, t1.mDentro)) votos.master++;
  });

  Object.entries(itens).forEach(([k, a]) => {
    est[k + 'Qtd'] = String(a.qtd);
    est[k + 'Ticket'] = a.qtd > 0 ? (a.rec / a.qtd).toFixed(2) : '0';
    est[k + 'Red'] = a.red ? String(a.red) : '';
    est[k + 'Fora'] = a.fora ? String(a.fora) : '';
  });
  Object.keys(renov).map(Number).sort((a, b) => a - b).slice(0, 7).forEach((f, idx) => {
    const i = idx + 1, a = renov[f];
    est['renov' + i + 'Qtd'] = String(a.qtd);
    est['renov' + i + 'Ticket'] = a.qtd > 0 ? (a.rec / a.qtd).toFixed(2) : '0';
    est['renov' + i + 'Faixa'] = String(f);
    est['renov' + i + 'Red'] = a.red ? String(a.red) : '';
  });
  const maior = v => { const e = Object.entries(v).sort((a, b) => b[1] - a[1])[0]; return e && e[1] > 0 ? e : null; };
  const vt = maior(votosRenov);
  if (vt) est.renovTabela = vt[0][0];
  const cM = maior(votos.movel), cF = maior(votos.fixa);
  const clusterMovel = cM ? cM[0] : (vt ? vt[0][1] : null);
  if (clusterMovel) est.clusterMovel = clusterMovel;
  if (cF) est.clusterFixa = cF[0];
  est.modalidade = votos.master > votos.elite ? 'master' : 'elite';
  est.modulosRec = modRec ? modRec.toFixed(2) : '';
  if (sdRec) { est.sdRec = sdRec.toFixed(2); est.sdFator = (sdCom / sdRec * 100).toFixed(0); }
  if (convRec) { est.convRec = convRec.toFixed(2); est.convFator = (convCom / convRec).toFixed(2); }
  est.foraPct = '0'; // o "fora da área" vem por tipo (seção 12)
  if (linhasAtivas) est.linhasAtivas = String(linhasAtivas);
  est.ajusteSaldo = saldo ? saldo.toFixed(2) : '';
  if (redPcts.length) {
    const cont = {}; redPcts.forEach(p => { cont[p] = (cont[p] || 0) + 1; });
    est.reducaoPct = String(Object.entries(cont).sort((a, b) => b[1] - a[1])[0][0]);
  }
  est.extratoTotal = total.toFixed(2);

  const redTot = Object.values(itens).reduce((s, a) => s + a.red, 0) + Object.values(renov).reduce((s, a) => s + a.red, 0);
  notas.unshift(`CSV: ${lidas} linhas lidas, ${usadas} usadas. Modalidade ${est.modalidade === 'master' ? 'Master' : 'Elite'}`
    + (clusterMovel ? `, cluster Móvel ${clusterMovel}` : '') + (cF ? `, Fixa ${cF[0]}` : '') + (vt ? `, renovação pela Tabela ${vt[0][0]}` : '') + '.');
  notas.push(`Renovação/Migração em ${Object.keys(renov).length} faixas de Delta; ${redTot} linhas com redução (${est.reducaoPct || '60'}% do fator); estornos e recálculos: saldo de R$ ${aaceFmtNum(saldo)}; fora da área: ${(recFixo > 0 ? recFora / recFixo * 100 : 0).toFixed(1).replace('.', ',')}% da receita (por tipo); total pago no extrato: R$ ${aaceFmtNum(total)}.`);
  return { est, notas };
}

// Texto copiado do "Extrato resumido" (PDF): indicadores, vendedores e enquadramento por indicador
export function aaceAplicarResumo(est, txt) {
  const t = txt.replace(/\s+/g, ' ');
  const notas = [], des = {};
  const num = v => aaceNum(String(v).replace(/\./g, ''));
  let m;
  if ((m = t.match(/CNPJ NOVO\s*-\s*VOZ M.VEL\s+(\d+)\s+DESEMPENHO\s+(\d)/i))) { est.cnpjNovoVoz = m[1]; des.dv = +m[2]; }
  if ((m = t.match(/CNPJ NOVO\s*-\s*FIXA B.SICA\s+(\d+)\s+DESEMPENHO\s+(\d)/i))) { est.cnpjNovoBl = m[1]; des.db = +m[2]; }
  if ((m = t.match(/NET ADDS[^%]*?([\d.,]+)%\s+DESEMPENHO\s+(\d)/i))) {
    const pct = aaceNum(m[1]); des.dn = +m[2];
    est.netAddsPct = String(pct);                  // o extrato só traz o percentual: entra direto, sem gross/cancelamentos inventados
    notas.push(`Net Adds ${aaceFmtPct(pct)} lançado direto em %.`);
  }
  if ((m = t.match(/CHURN SAFRA M.VEL\s+([\d.,]+)%\s+DESEMPENHO\s+(\d)/i))) { est.churn = String(aaceNum(m[1])); des.dc = +m[2]; }
  if ((m = t.match(/Linhas\s+([\d.]+)\s+([\d.]+)\s+R\$\s*([\d.,]+)/))) {
    est.linhasAtivas = String(num(m[2]));
    const un = aaceNum(m[3]), fxCh = { 2.5: '1', 2: '2', 1.5: '3', 1: '4' }[un];
    if (fxCh && est.modalidade !== 'master') est.faixaCnpjHc = fxCh; // o valor por linha do extrato revela a faixa de CNPJ/HC
    notas.push(`Carteira: ${aaceFmtNum(num(m[1]))} → ${aaceFmtNum(num(m[2]))} linhas, ${s2fmt(un)} por linha` + (fxCh && est.modalidade !== 'master' ? ` (Faixa ${fxCh} de CNPJ/HC).` : '.'));
  }
  if ((m = t.match(/VENDEDORES\s+(\d+)\s+(\d+)\s+FAIXA\s+(\d)/i))) { est.hcs = m[2]; est.faixaProd = m[3]; notas.push(`${m[2]} vendedores bonificados (HCs), Bônus Produtividade na Faixa ${m[3]} (do extrato).`); }

  const adic = (re, campos) => {
    const x = t.match(re);
    if (!x) return;
    const pct = aaceNum(x[1]), seg = x[2].toUpperCase(), faixa = x[3];
    if (campos.cluster) est[campos.cluster] = seg;
    est[campos.faixa] = faixa;                       // atingimento do extrato: faixa 0 (<100%) a 3 (≥140%)
    // o extrato traz só o atingimento, não a meta: a faixa e o segmento entram nos seletores e as metas ficam em branco
    notas.push(`${campos.nome}: atingimento ${aaceFmtPct(pct)}, segmento ${seg}, faixa ${faixa} (do extrato).`);
  };
  adic(/\(PLANO DE VOZ\)\s+([\d.,]+)%\s+([PMG])\s+(\d)/i, { nome: 'Móvel Voz', cluster: 'clusterMovel', faixa: 'faixaMovel' });
  adic(/FIXA B.SICA \(BANDA LARGA\)\s+([\d.,]+)%\s+([PMG])\s+(\d)/i, { nome: 'Fixa Básica BL', cluster: 'clusterFixa', faixa: 'faixaFixa' });
  adic(/RECEITA FIXA AVAN.ADA\s+([\d.,]+)%\s+([PMG])\s+(\d)/i, { nome: 'Conectividade', cluster: 'clusterConect', faixa: 'faixaConect' });
  if ((m = t.match(/Categoria\s+([A-Za-zÀ-ú]+)\s+Notal?\s+Final\s+([\d,]+)/i))) notas.push(`Extrato: categoria ${m[1].toUpperCase()}, nota final ${m[2]}.`);
  if (!Object.keys(des).length && !est.hcs) notas.push('Não reconheci o texto do extrato resumido: cole o texto do PDF como está.');
  return { notas, des };
}
