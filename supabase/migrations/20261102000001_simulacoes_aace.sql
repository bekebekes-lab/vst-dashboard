-- Simulações salvas da aba "Simulador de AACE" (só admin).
-- Compartilhadas entre os admins (perfil 'admin'): todos leem; só quem salvou altera ou apaga.
-- Guarda apenas os números digitados/importados (produção, KPIs, enquadramento); nenhum nome de cliente, CNPJ ou telefone.
create table if not exists public.simulacoes_aace (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null check (char_length(btrim(nome)) between 1 and 120),
  dados            jsonb not null,
  criado_por       uuid not null default auth.uid(),
  criado_por_nome  text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

create index if not exists simulacoes_aace_atualizado_idx on public.simulacoes_aace (atualizado_em desc);

alter table public.simulacoes_aace enable row level security;

-- nada de acesso anônimo; só o papel authenticated, e mesmo assim restrito às policies abaixo
revoke all on table public.simulacoes_aace from anon;
revoke all on table public.simulacoes_aace from public;
grant select, insert, update, delete on table public.simulacoes_aace to authenticated;

drop policy if exists aace_sim_select on public.simulacoes_aace;
create policy aace_sim_select on public.simulacoes_aace
  for select to authenticated
  using (public.is_admin_user(auth.uid()));

drop policy if exists aace_sim_insert on public.simulacoes_aace;
create policy aace_sim_insert on public.simulacoes_aace
  for insert to authenticated
  with check (public.is_admin_user(auth.uid()) and criado_por = auth.uid());

drop policy if exists aace_sim_update on public.simulacoes_aace;
create policy aace_sim_update on public.simulacoes_aace
  for update to authenticated
  using (public.is_admin_user(auth.uid()) and criado_por = auth.uid())
  with check (public.is_admin_user(auth.uid()) and criado_por = auth.uid());

drop policy if exists aace_sim_delete on public.simulacoes_aace;
create policy aace_sim_delete on public.simulacoes_aace
  for delete to authenticated
  using (public.is_admin_user(auth.uid()) and criado_por = auth.uid());
