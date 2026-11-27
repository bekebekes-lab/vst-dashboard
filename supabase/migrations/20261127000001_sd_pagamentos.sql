-- Qualidade > SD (Blip GO): marcação das faturas pagas (1ª a 5ª) por pedido.
--
-- Grão: (pedido, fatura). "Não pago" não é gravado: é a AUSÊNCIA de linha. Controle SEPARADO da aba
-- Estorno (qualidade_parcelas): marcar aqui não mexe nas 9 parcelas de lá.
--
-- Segurança: RLS ligada e NENHUMA policy -> anon e authenticated não leem nem escrevem. Só o servidor
-- (api/qualidade.js, chave de serviço) acessa, e ele exige perfil 'admin' ou a concessão 'qualidade'.

create table if not exists public.sd_pagamentos (
  pedido       text        not null,
  fatura       smallint    not null check (fatura between 1 and 5),
  marcado_por  text        not null,
  marcado_em   timestamptz not null default now(),
  primary key (pedido, fatura)
);

alter table public.sd_pagamentos enable row level security;
