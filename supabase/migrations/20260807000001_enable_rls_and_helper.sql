-- Garante RLS habilitado nas 5 tabelas (já estava true em todas no banco,
-- mas ENABLE ROW LEVEL SECURITY é idempotente).
alter table public.usuarios            enable row level security;
alter table public.usuarios_dashboard  enable row level security;
alter table public.metas_carteira      enable row level security;
alter table public.config_simulador    enable row level security;
alter table public.config_simulador2   enable row level security;

-- Helper is_admin(): réplica da lógica de fallback do front-end
-- (carregarPerfil() checa usuarios_dashboard primeiro, depois usuarios).
-- Já existe uma is_admin_user(uuid) no banco (só olha usuarios_dashboard,
-- usada pela policy "admin_tudo" de usuarios_dashboard) — mantida como
-- está. Esta função nova cobre o fallback completo para as tabelas abaixo.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select perfil = 'admin' from public.usuarios_dashboard where id = auth.uid()),
    (select perfil = 'admin' from public.usuarios where id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
