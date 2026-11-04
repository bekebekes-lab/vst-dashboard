-- Módulo de PEDIDOS (fase de teste): consultores sobem pedidos e o BKO trata no painel.
-- Acesso por LISTA FECHADA (public.pedidos_acesso): hoje só o admin que está testando. Para liberar mais gente depois é um INSERT
-- (papel 'consultor' vê só os próprios pedidos; 'bko' e 'teste' veem e tratam todos). Nenhum acesso anônimo.

-- ─── acesso ──────────────────────────────────────────────────────────────────
create table if not exists public.pedidos_acesso (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  papel      text not null default 'teste' check (papel in ('teste', 'consultor', 'bko')),
  criado_em  timestamptz not null default now()
);
alter table public.pedidos_acesso enable row level security;
revoke all on table public.pedidos_acesso from anon, authenticated;   -- só gerenciada por quem tem a chave de serviço / SQL

create or replace function public.pedidos_papel() returns text
  language sql stable security definer set search_path = public as
  $$ select papel from public.pedidos_acesso where user_id = auth.uid() $$;
create or replace function public.pedidos_pode() returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.pedidos_acesso where user_id = auth.uid()) $$;
create or replace function public.pedidos_ve_todos() returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.pedidos_acesso where user_id = auth.uid() and papel in ('teste', 'bko')) $$;
revoke all on function public.pedidos_papel(), public.pedidos_pode(), public.pedidos_ve_todos() from public, anon;
grant execute on function public.pedidos_papel(), public.pedidos_pode(), public.pedidos_ve_todos() to authenticated;

-- ─── pedidos ─────────────────────────────────────────────────────────────────
create table if not exists public.pedidos (
  id               uuid primary key default gen_random_uuid(),
  numero           bigint generated always as identity,
  tipo             text not null check (char_length(btrim(tipo)) between 1 and 80),
  cliente_nome     text not null check (char_length(btrim(cliente_nome)) between 2 and 160),
  cliente_cnpj     text check (cliente_cnpj is null or char_length(cliente_cnpj) <= 20),
  contato_nome     text check (contato_nome is null or char_length(contato_nome) <= 120),
  contato_telefone text check (contato_telefone is null or char_length(contato_telefone) <= 30),
  contato_email    text check (contato_email is null or char_length(contato_email) <= 160),
  qtd_linhas       integer check (qtd_linhas is null or (qtd_linhas >= 0 and qtd_linhas <= 100000)),
  observacao       text check (observacao is null or char_length(observacao) <= 4000),
  dados            jsonb not null default '{}'::jsonb,                  -- reservado: campos estruturados do checklist (fase seguinte)
  status           text not null default 'novo' check (status in ('novo', 'em_analise', 'pendencia', 'concluido', 'cancelado')),
  consultor_id     uuid not null default auth.uid(),
  consultor_nome   text,
  equipe           text,
  gestor           text,
  responsavel_id   uuid,
  responsavel_nome text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index if not exists pedidos_status_idx on public.pedidos (status, atualizado_em desc);
create index if not exists pedidos_consultor_idx on public.pedidos (consultor_id, criado_em desc);

create or replace function public.pedidos_toca_atualizado() returns trigger language plpgsql as
  $$ begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists pedidos_atualizado_trg on public.pedidos;
create trigger pedidos_atualizado_trg before update on public.pedidos for each row execute function public.pedidos_toca_atualizado();

-- ─── histórico (criação, comentários, mudanças de status, atribuição, anexos) ──
create table if not exists public.pedidos_eventos (
  id          uuid primary key default gen_random_uuid(),
  pedido_id   uuid not null references public.pedidos(id) on delete cascade,
  tipo        text not null check (tipo in ('criado', 'comentario', 'status', 'atribuicao', 'anexo')),
  texto       text check (texto is null or char_length(texto) <= 4000),
  de_status   text,
  para_status text,
  autor_id    uuid not null default auth.uid(),
  autor_nome  text,
  criado_em   timestamptz not null default now()
);
create index if not exists pedidos_eventos_pedido_idx on public.pedidos_eventos (pedido_id, criado_em);

-- ─── anexos (o arquivo fica no Storage, privado; aqui só o registro) ─────────
create table if not exists public.pedidos_anexos (
  id               uuid primary key default gen_random_uuid(),
  pedido_id        uuid not null references public.pedidos(id) on delete cascade,
  nome             text not null check (char_length(nome) <= 200),
  caminho          text not null unique,
  tamanho          bigint,
  mime             text,
  enviado_por      uuid not null default auth.uid(),
  enviado_por_nome text,
  criado_em        timestamptz not null default now()
);
create index if not exists pedidos_anexos_pedido_idx on public.pedidos_anexos (pedido_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.pedidos         enable row level security;
alter table public.pedidos_eventos enable row level security;
alter table public.pedidos_anexos  enable row level security;
revoke all on table public.pedidos, public.pedidos_eventos, public.pedidos_anexos from anon, public;
grant select, insert, update on table public.pedidos to authenticated;          -- sem DELETE: pedido não se apaga, se cancela
grant select, insert on table public.pedidos_eventos, public.pedidos_anexos to authenticated;

drop policy if exists pedidos_sel on public.pedidos;
create policy pedidos_sel on public.pedidos for select to authenticated
  using (public.pedidos_ve_todos() or (public.pedidos_pode() and consultor_id = auth.uid()));
drop policy if exists pedidos_ins on public.pedidos;
create policy pedidos_ins on public.pedidos for insert to authenticated
  with check (public.pedidos_pode() and consultor_id = auth.uid() and status = 'novo');
drop policy if exists pedidos_upd on public.pedidos;
create policy pedidos_upd on public.pedidos for update to authenticated
  using (public.pedidos_ve_todos()) with check (public.pedidos_ve_todos());

drop policy if exists pedidos_ev_sel on public.pedidos_eventos;
create policy pedidos_ev_sel on public.pedidos_eventos for select to authenticated
  using (exists (select 1 from public.pedidos p where p.id = pedido_id));          -- herda a visibilidade do pedido
drop policy if exists pedidos_ev_ins on public.pedidos_eventos;
create policy pedidos_ev_ins on public.pedidos_eventos for insert to authenticated
  with check (public.pedidos_pode() and autor_id = auth.uid() and exists (select 1 from public.pedidos p where p.id = pedido_id));

drop policy if exists pedidos_an_sel on public.pedidos_anexos;
create policy pedidos_an_sel on public.pedidos_anexos for select to authenticated
  using (exists (select 1 from public.pedidos p where p.id = pedido_id));
drop policy if exists pedidos_an_ins on public.pedidos_anexos;
create policy pedidos_an_ins on public.pedidos_anexos for insert to authenticated
  with check (public.pedidos_pode() and enviado_por = auth.uid() and exists (select 1 from public.pedidos p where p.id = pedido_id));

-- ─── Storage: bucket privado "pedidos" (caminho: <id do pedido>/<arquivo>) ───
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pedidos', 'pedidos', false, 10485760, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
  'image/png', 'image/jpeg', 'text/csv'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists pedidos_obj_sel on storage.objects;
create policy pedidos_obj_sel on storage.objects for select to authenticated
  using (bucket_id = 'pedidos' and public.pedidos_pode()
         and exists (select 1 from public.pedidos p where p.id::text = (storage.foldername(name))[1]));
drop policy if exists pedidos_obj_ins on storage.objects;
create policy pedidos_obj_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'pedidos' and public.pedidos_pode()
              and exists (select 1 from public.pedidos p where p.id::text = (storage.foldername(name))[1]));

-- ─── liberação inicial: só o admin que está testando (Raphael Mariano) ───────
insert into public.pedidos_acesso (user_id, papel)
select id, 'teste' from auth.users where lower(email) in ('raphael@vstgroup.com.br', 'patricia@vstgroup.com.br', 'diou@vstgroup.com.br')
on conflict (user_id) do nothing;
