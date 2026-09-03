// Mapeia nossa oferta (tipoOferta + velocidade) pro texto de busca do campo
// "Item de Produto" no Radar (Salesforce da Embratel) —
// conferido 1:1 com api/_lib/propostas-dados.js (mesmos preços). Usa o NOME
// COMPLETO e exato do item de catálogo (copiado literal do Radar,
// espaçamento incluso) — uma tentativa anterior com um trecho
// abreviado/reescrito não batia como substring real e a busca do Salesforce
// não retornava nada (confirmado em execução real). Só cobre as ofertas com
// correspondência confirmada no catálogo do Radar — as demais (0800, MPLS,
// LAN EPL) não passam por consulta de viabilidade no Radar ainda.
//
// O campo pai "Produto" do lookup varia por família — confirmado gravando
// o fluxo manual: Conecta (Smart/BLC/2P BLD) fica sob "CONECTA+", mas o BLD
// link single (Porta+Acesso, sem roteador) fica sob "BUSINESS LINK DIRECT",
// um Produto pai diferente.
export const PRODUTO_PAI_POR_TIPO = {
  conecta_smart: 'CONECTA+',
  conecta_blc: 'CONECTA+',
  combo_2p_bld: 'CONECTA+',
  bld_oferta_pme: 'BUSINESS LINK DIRECT',
};

export const ITEM_DE_PRODUTO_RADAR = {
  conecta_smart: {
    '10 Mega': 'OFERTA CONECTA 2P BLD 50.000 MIN. VOZ- 10MB SMART(R$575 COM IMPOSTOS)',
    '20 Mega': 'OFERTA CONECTA 2P BLD 50.000 MIN. VOZ - 20MB SMART (R$625 COM IMPOSTOS)',
    '50 Mega': 'OFERTA CONECTA 2P BLD 50.000 MIN. VOZ - 50MB SMART (R$680 COM IMPOSTOS)',
    '100 Mega': 'OFERTA CONECTA 2P BLD 50.000 MIN. VOZ- 100MB SMART (R$950 COM IMPOSTOS)',
  },
  conecta_blc: {
    '150 Mega': 'OFERTA CONECTA 2P BLC 50.000 MIN. VOZ - 150MB  (R$350 COM IMPOSTOS)',
    '300 Mega': 'OFERTA CONECTA 2P BLC 50.000 MIN. VOZ - 300MB (R$400 COM IMPOSTOS)',
  },
  combo_2p_bld: {
    '10 Mega': 'OFERTA CONECTA 2P BLD 50.000 MIN. VOZ - 10MB (R$1.035,23 COM IMPOSTOS)',
    '20 Mega': 'OFERTA CONECTA 2P BLD 50.000 MIN. VOZ - 20MB (R$1.392,23 COM IMPOSTOS)',
    '50 Mega': 'OFERTA CONECTA 2P BLD 50.000 MIN. VOZ - 50MB (R$1.606,23 COM IMPOSTOS)',
    '100 Mega': 'OFERTA CONECTA 2P BLD 50.000 MIN. VOZ - 100MB (R$1.796,22 COM IMPOSTOS)',
    '200 Mega': 'OFERTA CONECTA 2P BLD 50.000 MIN. VOZ- 200MB (R$1.906,22 COM IMPOSTOS)',
    '500 Mega': 'OFERTA CONECTA 2P BLD 50.000 MIN. VOZ - 500MB (R$3.236,22 COM IMPOSTOS)',
  },
  // BLD Oferta PME — duas famílias de item, ambas sob o mesmo Produto pai
  // (BUSINESS LINK DIRECT):
  // 1) "Link single" (Porta+Acesso, sem roteador, 500M-1G).
  // 2) "Clássico" (10M-200M, roteador embutido no item). O catálogo real
  //    tem 3 modelos de CPE por velocidade (HP 954/Huawei AR651/Meraki
  //    MX67, mesmas opções da Proposta Comercial), mas aqui, pro EV, usa
  //    sempre o item com Huawei AR651 (pedido explícito: "é apenas para o
  //    estudo" — a viabilidade não muda por marca de roteador, então não
  //    vale a pena expor essa escolha só pra consulta).
  bld_oferta_pme: {
    '500M': 'BLD.p-500M_Porta+Acesso',
    '600M': 'BLD.p-600M_Porta+Acesso',
    '700M': 'BLD.p-700M_Porta+Acesso',
    '800M': 'BLD.p-800M_Porta+Acesso',
    '1G': 'BLD.q -1G_Porta+Acesso',
    '10M': 'BLD.PME.10MB + HUAWEI 651',
    '20M': 'BLD.PME.20MB + HUAWEI 651',
    '30M': 'BLD.PME.30MB + HUAWEI 651',
    '50M': 'BLD.PME.50MB + HUAWEI 651',
    '100M': 'BLD.PME.100MB + HUAWEI 651',
    '200M': 'BLD.PME.200MB + HUAWEI 651',
  },
};

// Retorna null se a combinação tipoOferta+velocidade não tiver
// correspondência conhecida no catálogo do Radar.
export function resolverItemDeProdutoRadar(tipoOferta, velocidade) {
  const busca = ITEM_DE_PRODUTO_RADAR[tipoOferta]?.[velocidade];
  const produtoPai = PRODUTO_PAI_POR_TIPO[tipoOferta];
  if (!busca || !produtoPai) return null;
  return { produto: produtoPai, itemProduto: busca };
}
