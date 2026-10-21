-- Dono geral da plataforma: vê e administra todas as empresas
create table if not exists private.admins_plataforma (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists private.convites_dono (
  imobiliaria_id uuid not null references public.imobiliarias(id) on delete cascade,
  email text not null check (email = lower(trim(email))),
  nome text,
  aceito_em timestamptz,
  created_at timestamptz not null default now(),
  primary key (imobiliaria_id, email)
);
create or replace function private.sou_admin() returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from private.admins_plataforma a where a.user_id = (select auth.uid()))
$$;
-- minhas_imobiliarias, imobiliarias_que_sou_dono e imobiliarias_que_gerencio
-- passam a incluir todas as empresas quando private.sou_admin()
create or replace function public.sou_admin_plataforma() returns boolean
language sql stable security definer set search_path to '' as $$ select private.sou_admin() $$;
alter policy imobiliarias_delete on public.imobiliarias using (private.sou_admin());
