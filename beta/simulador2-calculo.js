// SIMULADOR 2.0 — cálculo puro (sem DOM). PORTE LITERAL de index.html:
//   s2PuxarDadosSheet ........ index.html 8327-8391 (agregação do BaseCRM por tag/escopo)
//   s2RecalcularFatores ...... index.html 8466-8502 (fator fixo + adicional por meta)
//   renderSimulador2 ......... index.html 10429-10674 (recebimento por unidade, produtividade, categoria)
// As contas e a ordem das operações são as mesmas do original; só trocamos "ler do campo/escrever no
// elemento" por "ler do estado/devolver no resultado". Ao mudar a regra no Dash atual, atualizar aqui.
//
// Detalhe importante preservado: no Dash atual os 3 fatores passam por um campo de texto (toFixed(2)) e são
// LIDOS de volta (s2num) — por isso aqui também são arredondados em 2 casas antes de multiplicar.

import { getGrupoKey } from './nucleo.js';
import { MAPEAMENTO_TAGS } from './regras.js';
import { FILAS_POR_VISAO, FATORES_FIXOS_TABELA1, FATORES_ADICIONAIS_TABELA1, PLUGIN_PORTABILIDADE_VOZ, s2FaixaAdicionalIdx } from './politica.js';
import { FAIXAS_CNPJHC_DEFINITIVA, FAIXAS_CNPJHC_TRANSICAO, UNITARIO_NETADDS_NEGATIVO, TETO_LIBERACAO, BONUS_CATEGORIA_PCT, RAMPA_PRODUTIVIDADE, FAIXAS_BONUS_PRODUTIVIDADE } from './politica-sim.js';

// origem: index.html 8306-8309 (códigos AACE = unidades/tags do MAPEAMENTO_TAGS)
export const CODIGOS_AACE2 = Object.entries(MAPEAMENTO_TAGS)
  .sort((a, b) => a[1].localeCompare(b[1]))
  .map(([tag, nome]) => ({ tag, nome }))
  .concat([{ tag: 'Sem Tag', nome: 'Sem Tag' }]);

// origem: index.html 8312
export function s2Sid(tag) { return tag.replace(/[^a-zA-Z0-9]/g, ''); }

// origem: index.html 8546-8549 (s2FaixasCnpjHc / s2FaixaPorCnpjHc; tabela = valor do seletor)
const faixasCnpjHc = tabela => (tabela === 'transicao' ? FAIXAS_CNPJHC_TRANSICAO : FAIXAS_CNPJHC_DEFINITIVA);
const faixaPorCnpjHc = (tabela, razao) => { const f = faixasCnpjHc(tabela); return f.find(x => razao >= x.min && razao <= x.max) || f[f.length - 1]; };

// origem: index.html 8538 (s2num: parseFloat(valor) || 0)
export const num = v => parseFloat(v) || 0;

// Agrega o BaseCRM do período (todas as linhas, como ALL_DATA) por unidade, no escopo de filas escolhido.
// origem: s2PuxarDadosSheet, index.html 8327-8383. `monitorDup` = MONITOR_SD_DUPLICADO da carga.
export function s2PuxarDados(rows, visao, monitorDup) {
  const filasPermitidas = FILAS_POR_VISAO[visao];
  const produtosAlvo = ['NET PJ - VIRTUA', 'VOZ - Novo', 'VOZ - Portabilidade'];
  const aggAtivacao = {};
  CODIGOS_AACE2.forEach(({ tag }) => {
    aggAtivacao[tag] = { virtua: { qtd: 0, rec: 0 }, vozNovo: { qtd: 0, rec: 0 }, vozPort: { qtd: 0, rec: 0 } };
  });
  let recSDCents = 0;
  (rows || []).forEach(r => {
    const tagRaw = r['TAGS ATIVIDADE'] || '';
    const tag = MAPEAMENTO_TAGS[tagRaw] ? tagRaw : 'Sem Tag';
    const grupo = r['GRUPO'] || '';
    const produto = r['PRODUTO'] || '';
    const fila = r['FILA'] || '';
    const qtd = parseInt(r['QUANTIDADE']) || 1;
    const valor = parseFloat((r['VALOR UNIT'] || '0').toString().replace(',', '.')) || 0;
    if (!filasPermitidas.includes(fila)) return;
    const recCents = Math.round(valor * 100);
    // Solução Digital: soma independente da unidade/tag (meta de HC é apurada no total, item 2.7-iii-a-3)
    if (getGrupoKey(grupo, produto, '', monitorDup) === 'SERV. DIGITAIS') recSDCents += recCents;
    if (!aggAtivacao[tag]) return;
    if (!produtosAlvo.includes(grupo)) return;
    if (grupo === 'NET PJ - VIRTUA') {
      aggAtivacao[tag].virtua.qtd += qtd;
      aggAtivacao[tag].virtua.rec += qtd * recCents;   // NET PJ = qtd × valor unit
    } else if (grupo === 'VOZ - Novo') {
      aggAtivacao[tag].vozNovo.qtd += qtd;
      aggAtivacao[tag].vozNovo.rec += recCents;        // VOZ = 1 linha = 1 valor unit
    } else if (grupo === 'VOZ - Portabilidade') {
      aggAtivacao[tag].vozPort.qtd += qtd;
      aggAtivacao[tag].vozPort.rec += recCents;
    }
  });
  return { ativacao: aggAtivacao, receitaSD: recSDCents / 100 };
}

// origem: s2RecalcularFatores, index.html 8466-8499.  `v` = estado (chaves iguais às do config_simulador2).
export function s2Fatores(v, sheet) {
  const cluster = v['cluster'];
  const fFixo = FATORES_FIXOS_TABELA1[cluster] || FATORES_FIXOS_TABELA1.P;
  const aggAtivacao = (sheet || {}).ativacao || {};
  let realMovelVoz = 0, realFixaBl = 0;
  Object.values(aggAtivacao).forEach(u => {
    realMovelVoz += (u.vozNovo?.qtd || 0) + (u.vozPort?.qtd || 0);
    realFixaBl += (u.virtua?.qtd || 0);
  });
  const metaMovelVoz = num(v['meta-movel-voz']);
  const metaFixaBl = num(v['meta-fixa-bl']);
  const pctMovelVoz = metaMovelVoz > 0 ? (realMovelVoz / metaMovelVoz * 100) : 0;
  const pctFixaBl = metaFixaBl > 0 ? (realFixaBl / metaFixaBl * 100) : 0;
  const faixaMovelVozIdx = s2FaixaAdicionalIdx(pctMovelVoz);
  const faixaFixaBlIdx = s2FaixaAdicionalIdx(pctFixaBl);
  const adicVozNovo = faixaMovelVozIdx >= 0 ? FATORES_ADICIONAIS_TABELA1.vozNovo[faixaMovelVozIdx][cluster] : 0;
  const adicVozPort = faixaMovelVozIdx >= 0 ? FATORES_ADICIONAIS_TABELA1.vozPort[faixaMovelVozIdx][cluster] : 0;
  const adicVirtua = faixaFixaBlIdx >= 0 ? FATORES_ADICIONAIS_TABELA1.virtua[faixaFixaBlIdx][cluster] : 0;
  // no Dash atual: campo.value = (...).toFixed(2), depois lido por s2num()
  const fVirtua = num((fFixo.virtua + adicVirtua).toFixed(2));
  const fVozNovo = num((fFixo.vozNovo + adicVozNovo).toFixed(2));
  const fVozPort = num((fFixo.vozPort + adicVozPort + PLUGIN_PORTABILIDADE_VOZ).toFixed(2));
  return { fVirtua, fVozNovo, fVozPort, realMovelVoz, realFixaBl, pctMovelVoz, pctFixaBl, faixaMovelVozIdx, faixaFixaBlIdx };
}

// origem: renderSimulador2, index.html 10429-10674. Devolve só números (a tela formata).
export function s2Calcular(v, sheet0) {
  const sheet = sheet0 || { ativacao: {}, carteira: {} };
  const categoria = v['categoria'];
  const fat = s2Fatores(v, sheet);
  const fVirtua = fat.fVirtua, fVozNovo = fat.fVozNovo, fVozPort = fat.fVozPort;

  const totalCnpjs = num(v['total-cnpjs']), totalHcs = Math.max(num(v['total-hcs']), 1);
  const razaoCnpjHc = totalCnpjs / totalHcs;
  const tabela = v['tabela-cnpjhc'];
  const faixaObj = faixaPorCnpjHc(tabela, razaoCnpjHc);
  const faixaIdx = faixasCnpjHc(tabela).findIndex(f => f.faixa === faixaObj.faixa);
  const unitNegativo = UNITARIO_NETADDS_NEGATIVO[categoria];
  const pctLiberacao = TETO_LIBERACAO[categoria][faixaIdx] ?? TETO_LIBERACAO[categoria][3];

  const comissaoAtivacao = {}, valorPagoCarteira = {};
  let totalAtivacaoGeral = 0, totalBrutoCarteira = 0, totalTeto = 0, totalPagoCarteira = 0,
      totalNaoRecebida = 0, totalMesa = 0, totalLinhasVoz = 0, totalLinhasVirtua = 0, totalLinhasCarteira = 0,
      totalPotencial = 0, totalLinhasRecebidas = 0;
  const unidades = [];

  CODIGOS_AACE2.forEach(({ tag, nome }) => {
    const sid = s2Sid(tag);
    const dAt = sheet.ativacao[tag] || { virtua: { qtd: 0, rec: 0 }, vozNovo: { qtd: 0, rec: 0 }, vozPort: { qtd: 0, rec: 0 } };
    const linhasCarteira = num(v['cart-linhas-' + sid]);
    const netAdds = num(v['cart-netadds-' + sid]);

    const comissaoCents = Math.round(dAt.virtua.rec * fVirtua) + Math.round(dAt.vozNovo.rec * fVozNovo) + Math.round(dAt.vozPort.rec * fVozPort);
    const comissao = comissaoCents / 100;
    const unit = netAdds < 0 ? unitNegativo : faixaObj.unitario;
    const teto = comissao * pctLiberacao;

    const potencial = unit > 0 ? Math.floor(teto / unit) : 0;
    const linhasRecebidas = Math.min(potencial, linhasCarteira);
    const bruto = linhasCarteira * unit;
    const recebida = linhasRecebidas * unit;
    const naoRecebida = potencial < linhasCarteira ? (linhasCarteira - potencial) * unit : 0;
    const mesa = potencial > linhasCarteira ? (potencial - linhasCarteira) * unit : 0;

    comissaoAtivacao[tag] = comissao;
    valorPagoCarteira[tag] = recebida;
    totalPotencial += potencial; totalLinhasRecebidas += linhasRecebidas;
    totalAtivacaoGeral += comissao; totalBrutoCarteira += bruto; totalTeto += teto;
    totalPagoCarteira += recebida; totalNaoRecebida += naoRecebida; totalMesa += mesa;
    totalLinhasVoz += dAt.vozNovo.qtd + dAt.vozPort.qtd; totalLinhasVirtua += dAt.virtua.qtd; totalLinhasCarteira += linhasCarteira;

    unidades.push({ tag, sid, nome, comissao, pctLiberacao, teto, potencial, linhasCarteira, netAdds, unit, linhasRecebidas, bruto, recebida, naoRecebida, mesa });
  });

  // ── SEÇÃO 04 — Bônus Produtividade
  const metaVozUnit = num(v['meta-voz']), metaBlUnit = num(v['meta-bl']), metaSdUnit = num(v['meta-sd']);
  const realizadoVoz = totalLinhasVoz, realizadoBl = totalLinhasVirtua;
  const realizadoSd = num(((sheet.receitaSD || 0)).toFixed(2));   // no Dash atual: campo.value = toFixed(2), lido por s2num

  const capVoz = metaVozUnit > 0 ? realizadoVoz / metaVozUnit : Infinity;
  const capBl = metaBlUnit > 0 ? realizadoBl / metaBlUnit : Infinity;
  const capLimitante = Math.min(capVoz, capBl);
  const limitanteLabel = capVoz <= capBl ? 'Voz' : 'BL';

  let capRestante = capLimitante, totalDisponivel = 0;
  const sugestaoPorEstagio = [], disponivelPorEstagio = [];
  RAMPA_PRODUTIVIDADE.forEach((r, i) => {
    const disp = num(v['rampa-disp-' + i]);
    totalDisponivel += disp;
    disponivelPorEstagio[i] = disp;
    let sugerido;
    if (r.pct === 0) {
      sugerido = disp;
    } else {
      const maxPossivel = capRestante === Infinity ? disp : Math.floor(capRestante / r.pct + 1e-9);
      sugerido = Math.max(0, Math.min(disp, maxPossivel));
      capRestante -= sugerido * r.pct;
      if (capRestante < 0) capRestante = 0;
    }
    sugestaoPorEstagio[i] = sugerido;
  });

  let totalVendedores = 0;
  RAMPA_PRODUTIVIDADE.forEach((r, i) => { totalVendedores += sugestaoPorEstagio[i]; });

  // item 2.7-ii-d: arredonda a meta individual de cada estágio para cima, depois multiplica pela quantidade
  function metaPonderadaPorEstagio(qtdPorEstagio, unidade) {
    let total = 0;
    RAMPA_PRODUTIVIDADE.forEach((r, i) => { total += qtdPorEstagio[i] * Math.ceil(r.pct * unidade); });
    return total;
  }
  const metaVozPonderada = metaPonderadaPorEstagio(sugestaoPorEstagio, metaVozUnit);
  const metaBlPonderada = metaPonderadaPorEstagio(sugestaoPorEstagio, metaBlUnit);
  const metaSdPonderada = metaPonderadaPorEstagio(sugestaoPorEstagio, metaSdUnit);
  const metaVozMaxTodos = metaPonderadaPorEstagio(disponivelPorEstagio, metaVozUnit);
  const metaBlMaxTodos = metaPonderadaPorEstagio(disponivelPorEstagio, metaBlUnit);
  const metaSdMaxTodos = metaPonderadaPorEstagio(disponivelPorEstagio, metaSdUnit);

  const pctMovel = metaVozPonderada > 0 ? (realizadoVoz / metaVozPonderada) * 100 : 0;
  const pctFixa = metaBlPonderada > 0 ? (realizadoBl / metaBlPonderada) * 100 : 0;
  const pctSd = metaSdPonderada > 0 ? (realizadoSd / metaSdPonderada) * 100 : 0;

  const travaOk = totalVendedores >= 4 && pctMovel >= 60 && pctFixa >= 60;
  const travaTxt = totalVendedores < 4 ? 'Inelegível (<4 vend.)' : (travaOk ? 'OK' : 'Reprovada (<60%)');

  let faixaBase = FAIXAS_BONUS_PRODUTIVIDADE[0];
  if (travaOk) {
    const menorPct = Math.min(pctMovel, pctFixa);
    faixaBase = FAIXAS_BONUS_PRODUTIVIDADE.find(f => menorPct >= f.min && menorPct <= f.max) || FAIXAS_BONUS_PRODUTIVIDADE[0];
  }
  let faixaFinalIdx = FAIXAS_BONUS_PRODUTIVIDADE.indexOf(faixaBase);
  if (travaOk && pctSd < 100 && faixaFinalIdx > 0) faixaFinalIdx -= 1;   // retroação por SD (2.7-iii-6/7)
  const faixaFinal = FAIXAS_BONUS_PRODUTIVIDADE[faixaFinalIdx];
  const totalBonusProdutividade = travaOk ? faixaFinal.valor * totalVendedores : 0;

  // ── SEÇÃO 05 — Bônus Categoria
  const pctCategoria = BONUS_CATEGORIA_PCT[categoria];
  const totalBonusCategoria = totalAtivacaoGeral * pctCategoria;

  // ── TOTAL GERAL DA COMPETÊNCIA
  const totalGeralCompetencia = totalAtivacaoGeral + totalPagoCarteira + totalBonusProdutividade + totalBonusCategoria;

  return {
    fatores: fat, razaoCnpjHc, faixaObj, pctLiberacao, unidades,
    totais: { totalAtivacaoGeral, totalBrutoCarteira, totalTeto, totalPagoCarteira, totalNaoRecebida, totalMesa, totalLinhasVoz, totalLinhasVirtua, totalLinhasCarteira, totalPotencial, totalLinhasRecebidas },
    prod: { metaVozUnit, metaBlUnit, metaSdUnit, realizadoVoz, realizadoBl, realizadoSd, capVoz, capBl, limitanteLabel, totalDisponivel, totalVendedores,
      sugestaoPorEstagio, metaVozPonderada, metaBlPonderada, metaSdPonderada, metaVozMaxTodos, metaBlMaxTodos, metaSdMaxTodos, pctMovel, pctFixa, pctSd,
      travaOk, travaTxt, faixaBase, faixaFinal, totalBonusProdutividade },
    cat: { categoria, pctCategoria, totalBonusCategoria },
    totalGeralCompetencia,
    // mesmo objeto que o Dash atual guarda em window._s2UltimoResultado (usado no CSV)
    ultimo: { totalAtivacaoGeral, totalBrutoCarteira, totalTeto, totalPagoCarteira, totalBonusProdutividade, totalBonusCategoria, totalGeralCompetencia,
      faixaCnpjHc: faixaObj.faixa, razaoCnpjHc, pctLiberacao },
  };
}
