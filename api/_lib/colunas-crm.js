// Colunas da BaseCRM (exportação do NeoSales) que o sistema usa — e como achá-las quando o
// NeoSales muda o cabeçalho.
//
// O Dash, o Beta2, o filtro de escopo e a API de Acessos leem a base pelo NOME da coluna.
// Quando o NeoSales renomeou "PROPRIETÁRIO DO PEDIDO" para "PROPRIETÁRIO DA ATIVIDADE" (nov/2026),
// tudo ficou sem consultor e os perfis travados deixaram de ver linhas. Para isso não se repetir:
//  1. cada coluna usada tem um nome CANÔNICO (o que o sistema lê) e uma lista de apelidos conhecidos;
//  2. a API traduz o cabeçalho para o nome canônico antes de entregar os dados (comparação sem
//     acento, caixa ou pontuação, então variações simples já passam);
//  3. se uma coluna OBRIGATÓRIA não for achada nem por apelido, a API avisa (colunasAusentes) e o
//     Dash mostra o aviso — em vez de mostrar números zerados sem explicar.
// Para ensinar um nome novo: acrescentar o apelido na coluna certa abaixo.

export const COLUNAS_CRM = {
  'PROPRIETÁRIO DO PEDIDO': { obrigatoria: true, apelidos: ['PROPRIETÁRIO DA ATIVIDADE', 'PROPRIETARIO DO PEDIDO', 'PROPRIETARIO DA ATIVIDADE', 'PROPRIETARIO', 'PROPRIETÁRIO', 'CONSULTOR', 'VENDEDOR'] },
  'TAGS PROPRIETARIO PEDIDO': { apelidos: ['TAGS PROPRIETARIO ATIVIDADE', 'TAGS PROPRIETÁRIO PEDIDO', 'TAGS PROPRIETÁRIO ATIVIDADE'] },
  'ADM DO PEDIDO': { apelidos: ['ADM ATIVIDADE', 'ADM DA ATIVIDADE', 'ADM'] },
  'EQUIPE': { obrigatoria: true, apelidos: ['EQUIPE DO PROPRIETARIO', 'EQUIPE PROPRIETARIO', 'TIME'] },
  'ETAPA PEDIDO': { obrigatoria: true, apelidos: ['ETAPA DO PEDIDO', 'ETAPA', 'STATUS PEDIDO', 'STATUS'] },
  'GRUPO': { obrigatoria: true, apelidos: ['GRUPO PRODUTO', 'GRUPO DE PRODUTO'] },
  'FILA': { obrigatoria: true, apelidos: ['FILA PEDIDO', 'FILA DO PEDIDO'] },
  'QUANTIDADE': { obrigatoria: true, apelidos: ['QTD', 'QTDE', 'QUANT'] },
  'PRODUTO': { obrigatoria: true, apelidos: ['NOME PRODUTO', 'NOME DO PRODUTO'] },
  'NUMERO PEDIDO': { obrigatoria: true, apelidos: ['NUMERO DO PEDIDO', 'N PEDIDO', 'PEDIDO'] },
  'CADASTRO': { obrigatoria: true, apelidos: ['DATA CADASTRO', 'DATA DE CADASTRO'] },
  'ATUALIZACAO': { obrigatoria: true, apelidos: ['DATA ATUALIZACAO', 'DATA DE ATUALIZACAO'] },
  'NOME CLIENTE': { apelidos: ['CLIENTE', 'NOME DO CLIENTE'] },
  'CPF/CNPJ': { apelidos: ['CPF CNPJ', 'CNPJ', 'CPF-CNPJ', 'CNPJ CLIENTE'] },
  'VALOR UNIT': { apelidos: ['VALOR UNITARIO', 'VLR UNIT'] },
  'DATA REF': { apelidos: ['DATA REFERENCIA', 'DATA DE REFERENCIA'] },
  'SOLICITACAO': { apelidos: ['DATA SOLICITACAO', 'DATA DE SOLICITACAO'] },
  'TAGS ATIVIDADE': { apelidos: ['TAGS DA ATIVIDADE'] },
  'UF': { apelidos: ['UF INSTALACAO', 'ESTADO INSTALACAO'] },
  'ESTADO': { apelidos: ['UF CLIENTE', 'ESTADO CLIENTE'] },
  'CIDADE INSTALAÇÃO': { apelidos: ['CIDADE INSTALACAO', 'MUNICIPIO INSTALACAO', 'CIDADE DE INSTALACAO'] },
};

// Chave de comparação: sem acento, maiúscula, pontuação virando espaço, espaços colapsados.
export function chaveColuna(s) {
  return (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

// Só vale para abas da BaseCRM (live "BaseCRM" e históricas "BaseCRM MMYYYY").
export function ehAbaBaseCRM(titulo) {
  return /^BaseCRM(\s+\d{6})?$/i.test((titulo || '').toString().trim());
}

// Traduz, NO LUGAR, o cabeçalho para os nomes canônicos. Nunca cria coluna duplicada: se a
// canônica já existe, nada é renomeado. Devolve { renomeadas: [[de, para]], ausentes: [canônica] }
// — ausentes só lista as OBRIGATÓRIAS que não foram achadas nem por apelido.
export function canonicalizarCabecalho(header) {
  const chaves = header.map(chaveColuna);
  const renomeadas = [];
  const ausentes = [];
  for (const [canonica, { apelidos = [], obrigatoria }] of Object.entries(COLUNAS_CRM)) {
    const kc = chaveColuna(canonica);
    if (chaves.includes(kc)) {
      // já existe (talvez só com grafia diferente: sem acento, caixa...) — normaliza o nome
      const i = chaves.indexOf(kc);
      if (header[i] !== canonica) { renomeadas.push([header[i], canonica]); header[i] = canonica; }
      continue;
    }
    let achou = false;
    for (const ap of apelidos) {
      const i = chaves.indexOf(chaveColuna(ap));
      if (i >= 0) { renomeadas.push([header[i], canonica]); header[i] = canonica; chaves[i] = kc; achou = true; break; }
    }
    if (!achou && obrigatoria) ausentes.push(canonica);
  }
  return { renomeadas, ausentes };
}
