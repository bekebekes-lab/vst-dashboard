// Mapeia nossa oferta (tipoOferta + velocidade) pro texto de busca do campo
// "Item de Produto" no Radar (Salesforce da Embratel) — conferido 1:1 com
// api/_lib/propostas-dados.js (mesmos preços, ex. "OFERTA CONECTA 2P BLD
// 50.000 MIN. VOZ - 50MB SMART (R$680 COM IMPOSTOS)" = CONECTA_SMART_PRECOS
// ['50 Mega']). Só cobre as ofertas com correspondência confirmada no
// catálogo do Radar — as demais (BLD Oferta PME, 0800, MPLS, LAN EPL) não
// passam por consulta de viabilidade no Radar ainda.
export const PRODUTO_PAI_RADAR = 'CONECTA+';

export const ITEM_DE_PRODUTO_RADAR = {
  conecta_smart: {
    '10 Mega': '50.000 MIN. VOZ- 10MB SMART',
    '20 Mega': '50.000 MIN. VOZ - 20MB SMART',
    '50 Mega': '50.000 MIN. VOZ - 50MB SMART',
    '100 Mega': '50.000 MIN. VOZ- 100MB SMART',
  },
  conecta_blc: {
    '150 Mega': '50.000 MIN. VOZ - 150MB',
    '300 Mega': '50.000 MIN. VOZ - 300MB',
  },
  combo_2p_bld: {
    '10 Mega': '50.000 MIN. VOZ - 10MB (R$1.035,23',
    '20 Mega': '50.000 MIN. VOZ - 20MB (R$1.392,23',
    '50 Mega': '50.000 MIN. VOZ - 50MB (R$1.606,23',
    '100 Mega': '50.000 MIN. VOZ - 100MB (R$1.796,22',
    '200 Mega': 'VOZ ILIMITADA - 200MB   (R$1906,22',
    '500 Mega': '50.000 MIN. VOZ - 500MB (R$3.236,22',
  },
};

// Retorna null se a combinação tipoOferta+velocidade não tiver
// correspondência conhecida no catálogo do Radar.
export function resolverItemDeProdutoRadar(tipoOferta, velocidade) {
  const busca = ITEM_DE_PRODUTO_RADAR[tipoOferta]?.[velocidade];
  if (!busca) return null;
  return { produto: PRODUTO_PAI_RADAR, itemProduto: busca };
}
