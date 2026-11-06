// Permissões por perfil do Beta2 — CÓPIA do index.html (ABAS_PERMITIDAS_POR_PERFIL ~8007-8021, getAbasPermitidas ~8028-8038,
// gfPodeVer ~4946-4951, pnPodeVer/pnPodeVerComissao ~5575-5578). Cada pessoa vê no Beta2 exatamente as abas que o Dash atual
// mostra para ela. Ao mudar a regra no Dash atual, atualizar aqui. (As abas Pedidos e Conectividade/SD ainda não existem no Beta2.)

export const ABAS_PERMITIDAS_POR_PERFIL = {
  'admin':          ['gerencial', 'producao', 'discadora', 'simulador2', 'aace', 'churn', 'carteira', 'qualidade', 'acessos', 'conectividade'],
  'admin_gestao':   ['gerencial', 'producao', 'discadora', 'churn', 'acessos', 'conectividade'],
  'admin_beta':     ['gerencial', 'producao', 'carteira', 'acessos', 'conectividade'],
  'gestor_macro':   ['gerencial', 'discadora', 'acessos', 'conectividade'],
  'gestor_macro2':  ['gerencial', 'producao', 'discadora', 'acessos', 'conectividade'],
  'gestor_macro3':  ['gerencial', 'producao', 'acessos', 'conectividade'],
  'gestor':         ['gerencial', 'discadora', 'acessos', 'conectividade'],
  'gestor_beta':    ['gerencial', 'acessos', 'conectividade'],
  'supervisao':     ['gerencial', 'discadora', 'conectividade'],
  'supervisao_beta':['gerencial', 'producao', 'conectividade'],
  'consultor':      ['gerencial', 'conectividade'],
  'suporte':        ['conectividade'],
};
const ehAdminLike = p => p === 'admin' || p === 'admin_gestao';
// Gerencial Financeiro (piloto): lista fechada de e-mails, e só perfil admin
const GF_EMAILS_PERMITIDOS = ['raphael@vstgroup.com.br', 'everton@vstgroup.com.br', 'financeiro@vstgroup.com.br'];
const gfPodeVer = u => u?.perfil === 'admin' && GF_EMAILS_PERMITIDOS.includes((u.email || '').trim().toLowerCase());

// `usuario` = linha do perfil (usuarios_dashboard) com .email. Devolve a lista de abas (mesmos ids do Dash atual).
export function getAbasPermitidas(usuario) {
  const base = ABAS_PERMITIDAS_POR_PERFIL[usuario?.perfil] || ['gerencial'];
  const extras = usuario?.acesso_extra_abas || [];
  const todas = extras.length ? [...new Set([...base, ...extras])] : base;
  const comGerfin = gfPodeVer(usuario) ? [...new Set([...todas, 'gerfin'])] : todas.filter(a => a !== 'gerfin');
  return ehAdminLike(usuario?.perfil) || extras.includes('painel') ? [...new Set([...comGerfin, 'painel'])] : comGerfin.filter(a => a !== 'painel');
}
// comissão no Painel Analítico: só perfil admin (pnPodeVerComissao)
export const podeVerComissao = usuario => usuario?.perfil === 'admin';
