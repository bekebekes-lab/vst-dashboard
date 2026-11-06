// REGRAS DE COMISSÃO do Gerencial Financeiro (Simulador 2.0 / política Claro) — CÓPIA do index.html.
// Ao mudar uma regra no Dash atual, atualizar aqui (cada bloco indica a linha de origem).
// Gerado por extração do index.html; as funções gf* abaixo foram portadas à mão (ver nota em cada uma).

// origem: index.html ~6223 (escopo do Simulador 2.0; padrão "ativo")
export const FILAS_POR_VISAO = {
  ativo:     ['Ativo/Instalado'],
  ativacao:  ['Ativo/Instalado','Portabilidade Agendada','Aguardando Instalação'],
  aprovados: ['Ativo/Instalado','Portabilidade Agendada','Aguardando Instalação','Aguardando NF','Aguardando Portabilidade'],
  geral:     ['Ativo/Instalado','Portabilidade Agendada','Aguardando Instalação','Aguardando NF','Aguardando Portabilidade','Para Input','Validação Pendente','Análise de Crédito']
};

// origem: index.html ~8404 (Tabela 1, fator fixo por cluster)
export const FATORES_FIXOS_TABELA1 = {
  P: { virtua: 2.90, vozNovo: 3.70, vozPort: 5.00 },
  M: { virtua: 3.10, vozNovo: 3.90, vozPort: 5.20 },
  G: { virtua: 3.40, vozNovo: 4.20, vozPort: 5.60 },
};

// origem: index.html ~8414
export const PLUGIN_PORTABILIDADE_VOZ = 1.50;

// origem: index.html ~8423 (item 2.3, adicional por atingimento)
export const FATORES_ADICIONAIS_TABELA1 = {
  vozNovo: [
    { P: 0.50, M: 0.60, G: 0.75 },
    { P: 0.60, M: 0.70, G: 0.85 },
    { P: 0.70, M: 0.80, G: 0.95 },
  ],
  vozPort: [
    { P: 0.50, M: 0.65, G: 0.90 },
    { P: 0.60, M: 0.85, G: 1.10 },
    { P: 0.70, M: 1.05, G: 1.40 },
  ],
  virtua: [
    { P: 0.95, M: 1.15, G: 1.55 },
    { P: 1.15, M: 1.35, G: 1.75 },
    { P: 1.45, M: 1.65, G: 2.05 },
  ],
};

// origem: index.html ~8442
export function s2FaixaAdicionalIdx(pct) {
  if (pct >= 140) return 2;
  if (pct >= 120) return 1;
  if (pct >= 100) return 0;
  return -1;
}

// origem: index.html ~5109 (renovação, item 2.4)
export const GF_RENOVACAO_TABELA1 = [
  { faixa: 'Faixa 1', delta: '≥ 10,01%',          P: 2.30, M: 2.70, G: 3.10 },
  { faixa: 'Faixa 2', delta: '3,5% a 10%',        P: 2.25, M: 2.65, G: 3.05 },
  { faixa: 'Faixa 3', delta: '0% a 3,49%',        P: 2.15, M: 2.55, G: 2.95 },
  { faixa: 'Faixa 4', delta: '-0,01% a -5,99%',   P: 1.70, M: 2.10, G: 2.50 },
  { faixa: 'Faixa 5', delta: '-6% a -12,99%',     P: 1.30, M: 1.70, G: 2.10 },
  { faixa: 'Faixa 6', delta: '-13% a -24,99%',    P: 0.90, M: 1.30, G: 1.70 },
  { faixa: 'Faixa 7', delta: '≤ -25%',            P: 0.70, M: 1.10, G: 1.50 },
];

// origem: index.html ~10718
export const S2_METAS_TRIMESTRE = {
  '2026-06': { 'meta-movel-voz': 1325, 'meta-fixa-bl': 578 },
  '2026-07': { 'meta-movel-voz': 1706, 'meta-fixa-bl': 620 },
  '2026-08': { 'meta-movel-voz': 1706, 'meta-fixa-bl': 712 },
};

// ── funções portadas de index.html ─────────────────────────────────────────────

import { getGrupoKey, receitaLinha } from './nucleo.js';

// Categorias do Gerencial Financeiro (index.html ~4939). GROSS é só referência: espelha Voz Novo +
// Portabilidade e não entra na soma do GERAL.
export const GF_CATS = ['GERAL', 'GROSS', 'VOZ NOVO', 'PORTABILIDADE', 'RENOVAÇÃO', 'BL', 'TITULARIDADE', 'SERV. DIGITAIS'];
export const GF_FORA_DO_GERAL = ['SERV. DIGITAIS', 'GROSS'];
export const GF_FATOR_POR_CAT = { 'BL': 'virtua', 'VOZ NOVO': 'vozNovo', 'PORTABILIDADE': 'vozPort', 'RENOVAÇÃO': 'renov' };
export const GF_CATS_SEM_FATOR = ['TITULARIDADE', 'SERV. DIGITAIS'];

// Metas padrão do Simulador 2.0 (S2_DEFAULTS em index.html ~10703): só estas duas valem aqui.
const META_MOVEL_VOZ_PADRAO = 0, META_FIXA_BL_PADRAO = 0;

const gfNorm = s => (s || '').toString().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Categoria financeira de uma linha: o getGrupoKey() do Gerencial + os grupos reais "VOZ - Novo" e
// "VOZ - Portabilidade" (index.html gfKey ~4958).
export function gfKey(r, monitorDup) {
  const key = getGrupoKey(r['GRUPO'] || '', r['PRODUTO'] || '', r['SOLICITACAO'] || '', monitorDup);
  if (key) return key;
  const g = gfNorm(r['GRUPO']).replace(/[‐-―]/g, '-').replace(/\s*-\s*/g, ' - ');
  if (g === 'VOZ - NOVO') return 'VOZ NOVO';
  if (g === 'VOZ - PORTABILIDADE') return 'PORTABILIDADE';
  return null;
}

// Os cabeçalhos da planilha vêm com a grafia exata do Sheets: acha a coluna sem depender de caixa/acento.
export function criarColunas(amostra) {
  const heads = amostra ? Object.keys(amostra) : [];
  const cache = {};
  return nome => (nome in cache ? cache[nome] : (cache[nome] = heads.find(h => gfNorm(h) === nome) || null));
}
const gfNumero = v => { const n = parseFloat((v || '').toString().replace('%', '').replace(',', '.')); return isNaN(n) ? null : n; };

// Índice (0-6) da faixa de Delta Ticket da renovação, ou -1 (index.html gfFaixaDeltaIdx ~5133).
function gfFaixaDeltaIdx(r, col) {
  const colF = col('FAIXA');
  const m = colF && (r[colF] || '').toString().match(/(\d)/);
  if (m && +m[1] >= 1 && +m[1] <= 7) return +m[1] - 1;
  const colV = col('% VARIACAO');
  const v = colV ? gfNumero(r[colV]) : null;
  if (v === null) return -1;
  const x = Math.round(v * 100) / 100;
  if (x >= 10.01) return 0;
  if (x >= 3.5) return 1;
  if (x >= 0) return 2;
  if (x > -6) return 3;
  if (x > -13) return 4;
  if (x > -25) return 5;
  return 6;
}

// Receita-base e fator da linha no modo comissão (index.html gfComissaoLinha ~5153).
export function gfComissaoLinha(r, key, fat, col) {
  const colD = col('% DESCONTO');
  const pctDesc = colD ? gfNumero(r[colD]) : null;
  const pagoPct = pctDesc === null || pctDesc <= 0 ? 1 : Math.min(pctDesc, 100) / 100;
  if (key === 'RENOVAÇÃO') {
    const colA = col('VALOR AGREGADO');
    const agregado = colA ? (gfNumero(r[colA]) || 0) : 0;
    const base = receitaLinha(r) + agregado;
    const idx = gfFaixaDeltaIdx(r, col);
    const fatorTabela = idx >= 0 ? GF_RENOVACAO_TABELA1[idx][fat.cluster] : 0;
    const fator = Math.round(fatorTabela * pagoPct * 100) / 100;      // 2 casas na renovação (política 2.4 vi-b)
    return { base, fator, fatorTabela, pagoPct, valor: base * fator, semFaixa: idx < 0 };
  }
  const base = receitaLinha(r), fatorTabela = fat.porCat[key] || 0;
  const fator = fatorTabela * pagoPct;
  return { base, fator, fatorTabela, pagoPct, valor: base * fator, semFaixa: false };
}

// Config do Simulador 2.0 de UMA competência a partir das linhas de config_simulador2 (index.html gfMontarCfg ~5181).
// Sem nada salvo vale o Cluster G.
export function gfMontarCfg(periodo, data) {
  const cfg = { periodo, salva: false, cluster: 'G', metaMovelVoz: META_MOVEL_VOZ_PADRAO, metaFixaBl: META_FIXA_BL_PADRAO };
  const v = chave => (data || []).find(d => d.chave === chave)?.valor;
  if (data && data.length) {
    cfg.salva = true;
    if (v('cluster')) cfg.cluster = v('cluster');
    if (v('meta-movel-voz') != null) cfg.metaMovelVoz = parseFloat(v('meta-movel-voz')) || 0;
    if (v('meta-fixa-bl') != null) cfg.metaFixaBl = parseFloat(v('meta-fixa-bl')) || 0;
  }
  const metasDoMes = S2_METAS_TRIMESTRE[periodo];
  const jaTemMeta = data && data.some(d => d.chave === 'meta-movel-voz' || d.chave === 'meta-fixa-bl');
  if (metasDoMes && !jaTemMeta) { cfg.metaMovelVoz = metasDoMes['meta-movel-voz']; cfg.metaFixaBl = metasDoMes['meta-fixa-bl']; }
  return cfg;
}

// Realizado do mês (Móvel Voz e Fixa BL) no escopo de filas escolhido (index.html gfRealizadoDe ~5222).
export function gfRealizadoDe(linhas, escopoFilas = 'ativo') {
  const filas = FILAS_POR_VISAO[escopoFilas] || FILAS_POR_VISAO.ativo;
  let realMovelVoz = 0, realFixaBl = 0;
  linhas.forEach(r => {
    if (!filas.includes(r['FILA'] || '')) return;
    const g = r['GRUPO'] || '';
    const qtd = parseInt(r['QUANTIDADE']) || 1;
    if (g === 'VOZ - Novo' || g === 'VOZ - Portabilidade') realMovelVoz += qtd;
    else if (g === 'NET PJ - VIRTUA') realFixaBl += qtd;
  });
  return { realMovelVoz, realFixaBl };
}

// Fatores finais (fixo + adicional [+ plugin]) de uma competência (index.html gfFatoresDe ~5243).
export function gfFatoresDe(cfg, realMovelVoz, realFixaBl) {
  const cluster = FATORES_FIXOS_TABELA1[cfg.cluster] ? cfg.cluster : 'P';
  const fFixo = FATORES_FIXOS_TABELA1[cluster];
  const pctMovelVoz = cfg.metaMovelVoz > 0 ? realMovelVoz / cfg.metaMovelVoz * 100 : 0;
  const pctFixaBl = cfg.metaFixaBl > 0 ? realFixaBl / cfg.metaFixaBl * 100 : 0;
  const idxMV = s2FaixaAdicionalIdx(pctMovelVoz), idxBL = s2FaixaAdicionalIdx(pctFixaBl);
  const fator = {
    virtua:  fFixo.virtua  + (idxBL >= 0 ? FATORES_ADICIONAIS_TABELA1.virtua[idxBL][cluster] : 0),
    vozNovo: fFixo.vozNovo + (idxMV >= 0 ? FATORES_ADICIONAIS_TABELA1.vozNovo[idxMV][cluster] : 0),
    vozPort: fFixo.vozPort + (idxMV >= 0 ? FATORES_ADICIONAIS_TABELA1.vozPort[idxMV][cluster] : 0) + PLUGIN_PORTABILIDADE_VOZ,
  };
  const porCat = {};
  Object.entries(GF_FATOR_POR_CAT).forEach(([cat, k]) => { porCat[cat] = fator[k]; });
  return { cfg, cluster, fator, porCat, realMovelVoz, realFixaBl, pctMovelVoz, pctFixaBl, idxMV, idxBL };
}
