// Regras de classificação copiadas de index.html (Gerencial). Manter em sincronia:
//  - PRODUTOS_SOLUCAO_DIGITAL / PRODUTOS_SD_CONTEM / ehProdutoSolucaoDigital  (index.html ~linha 3650)
//  - SUBGRUPOS_FILA / ORDEM_SUBGRUPOS_FILA                                       (index.html ~linha 4218)
//  - MAPEAMENTO_TAGS (tag -> unidade)                                            (index.html ~linha 6205)
// Gerado por extração do index.html; se mudar lá, atualizar aqui.

export const PRODUTOS_SOLUCAO_DIGITAL = [
  'MOTOTALK BASICO', 'MOTOTALK BUSINESS', 'MOTOTALK ENTERPRISE',
  'CLARO MONITOR', 'MCAFEE',
  'POWER BI PRO', 'ONEDRIVE FOR BUSINESS', 'SHAREPOINT (PLAN 1)', 'SHAREPOINT PLAN 1',
  'EXCHANGE ONLINE KIOSK', 'EXCHANGE ONLINE (PLAN 1)', 'EXCHANGE ONLINE PLAN 1',
  'EXCHANGE ONLINE (PLAN 2)', 'EXCHANGE ONLINE PLAN 2',
  'TEAMS ESSENCIAL', 'PROJECT ONLINE ESSENTIALS', 'PROJECT PLAN 1',
  'MICROSOFT DEFENDER FOR OFFICE 365 (PLAN 1)', 'MICROSOFT DEFENDER FOR OFFICE 365 PLAN 1',
  'MICROSOFT DEFENDER FOR ENDPOINT (PLAN 1)', 'MICROSOFT DEFENDER FOR ENDPOINT PLAN 1',
  'MICROSOFT DEFENDER FOR IDENTITY (PLAN 1)', 'MICROSOFT DEFENDER FOR IDENTITY PLAN 1',
  'CONSTRUTOR DE SITES PESSOAL', 'CONSTRUTOR DE SITES PROFISSIONAL',
  'HOSPEDAGEM DE SITES - PLANO PESSOAL', 'HOSPEDAGEM DE SITES - PLANO PROFISSIONAL',
  'HOSPEDAGEM DE SITES - PLANO EMPRESARIAL',
  'GOOGLE WORKSPACE BUSINESS STARTER', 'GOOGLE WORKSPACE BUSINESS STANDARD',
  'GOOGLE WORKSPACE BUSINESS PLUS', 'GOOGLE WORKSPACE ENTERPRISE PLUS',
  'GOOGLE WORKSPACE ENTERPRISE STANDARD',
  'STARBEM BASIC', 'STARBEM BRONZE', 'STARBEM BRONZE C/ DEPENDENTE',
  'STARBEM SILVER', 'STARBEM SILVER C/ DEPENDENTE', 'STARBEM PREMIUM',
  'STARBEM BASIC 5', 'STARBEM BASIC 10', 'STARBEM BASIC 15', 'STARBEM BASIC 20',
  'STARBEM BRONZE 5', 'STARBEM BRONZE 10', 'STARBEM BRONZE 15', 'STARBEM BRONZE 20',
  'STARBEM SILVER 5', 'STARBEM SILVER 10', 'STARBEM SILVER 15', 'STARBEM SILVER 20',
  'ERP GESTAO DE NEGOCIOS',
  'SITE PRONTO', 'OFFICE 365', 'DOMINIO', 'PROTECAO DIGITAL ANTIVIRUS',
  'FIREWALL GERENCIADO SEM FIO', 'WIFI SEGURO', 'FIREWALL GERENCIADO COM FIO', 'WAF',
  'CLOUD SERVER MAIS', 'EDR', 'SMART VIEW', 'ANTI-DDOS',
  'BLIP GO',
  'BLIP GO - BASICO', 'BLIP GO - INTERMEDIARIO', 'BLIP GO - AVANCADO',
  'BLIP GO - BÁSICO', 'BLIP GO - INTERMEDIÁRIO', 'BLIP GO - AVANÇADO',
];

export const PRODUTOS_SD_CONTEM = ['MICROSOFT', 'CONSTRUTOR DE SITES', 'STARBEM', 'GOOGLE WORKSPACE', 'HOSPEDAGEM DE SITES'];

export const SUBGRUPOS_FILA = {
  'Ativo/Instalado': 'Ativo',
  'Aguardando Instalação': 'Esteira de ativação',
  'Aguardando NF': 'Esteira de ativação',
  'Aguardando Portabilidade': 'Esteira de ativação',
  'Portabilidade Agendada': 'Esteira de ativação',
  'Desconexão por Opção': 'Esteira de ativação (correção)',
  'Falha portabilidade': 'Esteira de ativação (correção)',
  'Portabilidade Agendada - SMS Nao': 'Esteira de ativação (correção)',
  'Quebra': 'Esteira de ativação (correção)',
  'Análise de Crédito': 'Esteira operadora',
  'Análise EC': 'Esteira operadora',
  'Validação Pendente': 'Esteira operadora',
  'Aguardando Assinatura': 'Esteira escritório',
  'Aguardando Consultor': 'Esteira escritório',
  'Aguardando GC': 'Esteira escritório',
  'Para Input': 'Esteira escritório',
  'Pendente de Biometria': 'Esteira escritório',
  'Rejeitada Crédito': 'Esteira escritório',
  'Tratativa Operadora': 'Esteira escritório',
};

export const ORDEM_SUBGRUPOS_FILA = ['Ativo', 'Esteira de ativação', 'Esteira de ativação (correção)', 'Esteira operadora', 'Esteira escritório', 'Outros'];

export const MAPEAMENTO_TAGS = {
  '#1EWV': '#1EWV - CASCAVEL',
  '#1FK6': '#1FK6 - PELOTAS',
  '#5Q8X': '#5Q8X - CAXIAS DO SUL',
  '#6OV1': '#6OV1 - CRICIUMA',
  '#E928': '#E928 - CAMPO MOURAO',
  '#EKQG': '#EKQG - LONDRINA',
  '#HG72': '#HG72 - NOVO HAMBURGO',
  '#MW0K': '#MW0K - FRANCISCO BELTRAO',
  '#YI8F': '#YI8F - CURITIBA'
};
