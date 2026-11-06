// Configuração única do Beta2 — nome do sistema, quem pode entrar e o menu.
// O index.html (tela de login) também importa este arquivo, então trocar o
// nome definitivo do sistema ou o e-mail liberado é só aqui.
//
// Chaves do Supabase: a "anon key" é pública por definição (já está em
// index.html e api/_lib/auth.js); quem protege os dados é o RLS e as rotas /api.
// NUNCA colocar service_role, senhas ou tokens neste arquivo (repo público).

export const NOME_SISTEMA = 'Dash Beta2';
// Quem pode entrar no Beta2 (só e-mails desta lista; cada pessoa vê SÓ as abas e dados que o perfil dela tem no Dash atual —
// ver permissoes.js). Para liberar/retirar alguém: editar aqui (e-mail em minúsculas). A segurança de verdade continua no
// RLS do Supabase e nas rotas /api (api/_lib/auth.js + escopo.js), que valem igual para todos.
export const EMAILS_BETA = [
  'raphael@vstgroup.com.br',
  'diou@vstgroup.com.br',       // Diou
  'patricia@vstgroup.com.br',   // Pati (Patrícia Faria)
  'everton@vstgroup.com.br',    // Everton Vasconcellos
  'laura@vstgroup.com.br',      // Laura
];
export const emailLiberadoBeta = email => !!email && EMAILS_BETA.includes(String(email).trim().toLowerCase());
export const EMAIL_ADMIN_BETA = EMAILS_BETA[0];   // legado (mantido para não quebrar quem ainda importa)

export const SUPA_URL = 'https://kzlchetrpsfefwybaaoy.supabase.co';
export const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6bGNoZXRycHNmZWZ3eWJhYW95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNTM4NDIsImV4cCI6MjA5NDYyOTg0Mn0.4euWpZZadXe9ayg6ITY5SNueEhU094ajJv379gC9YrU';

// Menu lateral. Itens com `beta: true` são visões do Beta2 (rota "#<id>", ver VISOES em app.js);
// os demais abrem o Dash atual naquela aba (index.html lê "#aba=<id>" depois do login).
export const MENU = [
  { grupo: 'Gestão', itens: [
    { id: 'gerencial', rotulo: 'Gerencial', icone: 'grid', beta: true },
    { id: 'painel', rotulo: 'Painel Analítico', icone: 'bars', beta: true },
    { id: 'producao', rotulo: 'Produção', icone: 'cloud', beta: true },
    { id: 'gerfin', rotulo: 'Gerencial Financeiro', icone: 'wallet', beta: true },
    { id: 'discadora', rotulo: 'Discadora', icone: 'phone', beta: true },
  ]},
  { grupo: 'Simuladores', itens: [
    { id: 'simulador2', rotulo: 'Simulador 2.0', icone: 'calc', beta: true },
    { id: 'aace', rotulo: 'Simulador de AACE', icone: 'calc', beta: true },
  ]},
  { grupo: 'Operação', itens: [
    { id: 'pedidos', rotulo: 'Pedidos', icone: 'file' },
    { id: 'qualidade', rotulo: 'Qualidade', icone: 'check', beta: true },
    { id: 'conectividade', rotulo: 'Conectividade/SD', icone: 'signal' },
  ]},
  { grupo: 'Base', itens: [
    { id: 'carteira', rotulo: 'Carteira', icone: 'wallet', beta: true },
    { id: 'churn', rotulo: 'Churn', icone: 'refresh', beta: true },
  ]},
  { grupo: 'Admin', itens: [
    { id: 'acessos', rotulo: 'Acessos', icone: 'users', beta: true },
  ]},
];
