-- Dono geral definido por e-mail (vale quando a conta for criada e confirmada)
create table if not exists private.admins_plataforma_email (
  email text primary key check (email = lower(trim(email))),
  created_at timestamptz not null default now()
);
-- private.sou_admin() passa a aceitar também os e-mails desta tabela

-- Usado pelas Edge Functions (service role) para liberar o dono geral nas integrações
create or replace function public.eh_admin_plataforma(p_user uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from private.admins_plataforma a where a.user_id = p_user)
      or exists (select 1 from private.admins_plataforma_email e
                 join auth.users u on lower(u.email) = e.email and u.email_confirmed_at is not null
                 where u.id = p_user)
$$;
revoke all on function public.eh_admin_plataforma(uuid) from public, anon, authenticated;
grant execute on function public.eh_admin_plataforma(uuid) to service_role;
