-- metas_carteira e config_simulador têm políticas antigas conflitantes,
-- várias delas com "roles: public, qual/with_check: true" — ou seja,
-- liberado geral para SELECT/INSERT/UPDATE/DELETE sem nenhuma
-- autenticação. Confirmado via teste direto com a anon key antes desta
-- migration: os dados reais dessas tabelas eram legíveis sem login.
-- Removendo tudo e recriando limpo, restrito a admin (única aba do
-- front-end que usa essas tabelas — "Simulador" — já é admin-only).

drop policy if exists "acesso_autenticado_metas" on public.metas_carteira;
drop policy if exists "escrita_admin"            on public.metas_carteira;
drop policy if exists "leitura_autenticados"      on public.metas_carteira;
drop policy if exists "ler_metas"                 on public.metas_carteira;
drop policy if exists "metas_insert"              on public.metas_carteira;
drop policy if exists "metas_select"              on public.metas_carteira;
drop policy if exists "salvar_metas"              on public.metas_carteira;

drop policy if exists "acesso_autenticado_config" on public.config_simulador;
drop policy if exists "config_insert"             on public.config_simulador;
drop policy if exists "config_select"             on public.config_simulador;
drop policy if exists "escrita_admin"             on public.config_simulador;
drop policy if exists "leitura_autenticados"       on public.config_simulador;
drop policy if exists "ler_config"                on public.config_simulador;
drop policy if exists "salvar_config"             on public.config_simulador;

create policy "metas_carteira: select admin"
  on public.metas_carteira for select
  to authenticated
  using (public.is_admin());

create policy "metas_carteira: insert admin"
  on public.metas_carteira for insert
  to authenticated
  with check (public.is_admin());

create policy "metas_carteira: update admin"
  on public.metas_carteira for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "config_simulador: select admin"
  on public.config_simulador for select
  to authenticated
  using (public.is_admin());

create policy "config_simulador: insert admin"
  on public.config_simulador for insert
  to authenticated
  with check (public.is_admin());

create policy "config_simulador: update admin"
  on public.config_simulador for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- config_simulador2 já está corretamente protegida (policies "Admins podem
-- ler/inserir/atualizar", checando usuarios_dashboard/usuarios) —
-- nenhuma alteração necessária.
