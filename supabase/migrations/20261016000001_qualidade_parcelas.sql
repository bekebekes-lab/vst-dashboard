-- Aba "Qualidade" (estorno): acompanhamento das 9 parcelas (270 dias) de cada
-- contratação, contadas a partir da DATA REF.
--
-- Grão: 1 contratação = (pedido, data_ref). Um pedido com itens em DATA REF
-- diferentes vira jornadas separadas. "pendente" não é gravado: é a AUSÊNCIA
-- de linha. Só as marcações explícitas (pago / atrasado / cancelado) ficam aqui.
--
-- Segurança: RLS ligada e NENHUMA policy -> anon e authenticated não leem nem
-- escrevem. Só o servidor (api/qualidade.js, chave de serviço) acessa, e ele
-- exige perfil 'admin'.

create table if not exists public.qualidade_parcelas (
  pedido       text        not null,
  data_ref     date        not null,
  parcela      smallint    not null check (parcela between 1 and 9),
  status       text        not null check (status in ('pago', 'atrasado', 'cancelado')),
  marcado_por  text        not null,
  marcado_em   timestamptz not null default now(),
  observacao   text,
  primary key (pedido, data_ref, parcela)
);

-- Trilha de auditoria: toda mudança (inclusive "voltar para pendente") fica
-- registrada, só de inserção.
create table if not exists public.qualidade_historico (
  id               bigint generated always as identity primary key,
  pedido           text        not null,
  data_ref         date        not null,
  parcela          smallint    not null,
  status_anterior  text,
  status_novo      text,
  por              text        not null,
  em               timestamptz not null default now(),
  observacao       text
);

create index if not exists qualidade_historico_chave_idx
  on public.qualidade_historico (pedido, data_ref, parcela, em desc);

alter table public.qualidade_parcelas  enable row level security;
alter table public.qualidade_historico enable row level security;
