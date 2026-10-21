-- Times dentro da empresa: cada time vê só os próprios leads; dono e gerentes gerais (sem time) veem tudo.

create table public.times (
  id uuid primary key default gen_random_uuid(),
  imobiliaria_id uuid not null references public.imobiliarias(id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  token_captura text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (imobiliaria_id, id)
);
create index times_imobiliaria_idx on public.times (imobiliaria_id);
alter table public.times enable row level security;

alter table public.membros add column time_id uuid;
alter table public.convites add column time_id uuid;
alter table public.leads add column time_id uuid;
alter table public.membros add constraint membros_time_fk foreign key (imobiliaria_id, time_id)
  references public.times (imobiliaria_id, id) on delete set null (time_id);
alter table public.convites add constraint convites_time_fk foreign key (imobiliaria_id, time_id)
  references public.times (imobiliaria_id, id) on delete set null (time_id);
alter table public.leads add constraint leads_time_fk foreign key (imobiliaria_id, time_id)
  references public.times (imobiliaria_id, id) on delete set null (time_id);
create index leads_time_idx on public.leads (time_id) where time_id is not null;
create index membros_time_idx on public.membros (time_id) where time_id is not null;

-- "Gerencia a empresa" passa a ser só o dono e o gerente geral (sem time).
create or replace function private.imobiliarias_que_gerencio()
 returns setof uuid language sql stable security definer set search_path to '' as $$
  select m.imobiliaria_id from public.membros m
  where m.user_id = (select auth.uid()) and m.ativo
    and (m.papel = 'dono' or (m.papel = 'gerente' and m.time_id is null))
$$;

create or replace function private.times_que_gerencio()
 returns setof uuid language sql stable security definer set search_path to '' as $$
  select m.time_id from public.membros m
  where m.user_id = (select auth.uid()) and m.ativo and m.papel = 'gerente' and m.time_id is not null
$$;

create or replace function private.meu_time(p_imobiliaria_id uuid)
 returns uuid language sql stable security definer set search_path to '' as $$
  select m.time_id from public.membros m
  where m.user_id = (select auth.uid()) and m.imobiliaria_id = p_imobiliaria_id and m.ativo
$$;

-- Regra única de visibilidade de lead.
create or replace function private.lead_visivel(p_imobiliaria_id uuid, p_time_id uuid, p_corretor_id uuid)
 returns boolean language sql stable security definer set search_path to '' as $$
  select p_imobiliaria_id in (select private.imobiliarias_que_gerencio())
      or (p_time_id is not null and p_time_id in (select private.times_que_gerencio()))
      or (p_imobiliaria_id in (select private.minhas_imobiliarias())
          and (p_corretor_id = (select auth.uid())
               or (p_corretor_id is null and p_time_id is not distinct from private.meu_time(p_imobiliaria_id))))
$$;

create or replace function private.posso_ver_lead(p_lead uuid)
 returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.leads l where l.id = p_lead
    and private.lead_visivel(l.imobiliaria_id, l.time_id, l.corretor_id))
$$;

drop policy leads_select on public.leads;
create policy leads_select on public.leads for select
  using (private.lead_visivel(imobiliaria_id, time_id, corretor_id));
drop policy leads_update on public.leads;
create policy leads_update on public.leads for update
  using (private.lead_visivel(imobiliaria_id, time_id, corretor_id))
  with check (imobiliaria_id in (select private.minhas_imobiliarias()));

-- Tarefas: gerente do time também vê e mexe nas tarefas do seu time.
drop policy tarefas_select on public.tarefas;
create policy tarefas_select on public.tarefas for select using (
  (imobiliaria_id in (select private.imobiliarias_que_gerencio()))
  or ((imobiliaria_id in (select private.minhas_imobiliarias())) and (responsavel_id = (select auth.uid())))
  or (responsavel_id in (select m.user_id from public.membros m where m.time_id in (select private.times_que_gerencio()))));
drop policy tarefas_update on public.tarefas;
create policy tarefas_update on public.tarefas for update using (
  (imobiliaria_id in (select private.imobiliarias_que_gerencio()))
  or ((imobiliaria_id in (select private.minhas_imobiliarias())) and (responsavel_id = (select auth.uid())))
  or (responsavel_id in (select m.user_id from public.membros m where m.time_id in (select private.times_que_gerencio()))))
  with check (imobiliaria_id in (select private.minhas_imobiliarias()));

-- Times: todos da empresa veem a lista; só dono/gerente geral cria, edita e apaga. Token só pela função.
create policy times_select on public.times for select
  using (imobiliaria_id in (select private.minhas_imobiliarias()));
create policy times_insert on public.times for insert
  with check (imobiliaria_id in (select private.imobiliarias_que_gerencio()));
create policy times_update on public.times for update
  using (imobiliaria_id in (select private.imobiliarias_que_gerencio()))
  with check (imobiliaria_id in (select private.imobiliarias_que_gerencio()));
create policy times_delete on public.times for delete
  using (imobiliaria_id in (select private.imobiliarias_que_gerencio()));
revoke all on public.times from anon;
revoke select on public.times from authenticated;
grant select (id, imobiliaria_id, nome, ativo, created_at) on public.times to authenticated;

create or replace function public.token_captura_time(p_time_id uuid)
 returns text language sql stable security definer set search_path to '' as $$
  select t.token_captura from public.times t
  where t.id = p_time_id
    and (t.imobiliaria_id in (select private.imobiliarias_que_gerencio()) or t.id in (select private.times_que_gerencio()))
$$;
create or replace function public.gerar_novo_token_time(p_time_id uuid)
 returns text language sql security definer set search_path to '' as $$
  update public.times set token_captura = encode(extensions.gen_random_bytes(18), 'hex')
  where id = p_time_id and imobiliaria_id in (select private.imobiliarias_que_gerencio())
  returning token_captura
$$;

-- Membros: só dono/gerente geral troca alguém de time.
create or replace function private.membros_antes_atualizar()
 returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  new.imobiliaria_id := old.imobiliaria_id;
  new.user_id := old.user_id;
  if v_uid is not null and new.papel is distinct from old.papel then
    if old.user_id = v_uid then
      raise exception 'Você não pode alterar o seu próprio papel';
    end if;
    if not exists (select 1 from public.membros m
                   where m.imobiliaria_id = old.imobiliaria_id and m.user_id = v_uid
                     and m.papel = 'dono' and m.ativo) then
      raise exception 'Apenas o dono pode alterar papéis';
    end if;
  end if;
  if v_uid is not null and new.time_id is distinct from old.time_id
     and old.imobiliaria_id not in (select private.imobiliarias_que_gerencio()) then
    raise exception 'Apenas o dono ou um gerente geral pode trocar alguém de time';
  end if;
  if v_uid is not null and old.papel = 'dono' and old.user_id <> v_uid
     and not exists (select 1 from public.membros m
                     where m.imobiliaria_id = old.imobiliaria_id and m.user_id = v_uid
                       and m.papel = 'dono' and m.ativo) then
    raise exception 'Apenas o dono pode alterar outro dono';
  end if;
  return new;
end $$;

-- Rodízio: dentro do time quando o lead tem time; senão, entre todos (como antes).
create or replace function private.proximo_corretor(p_imobiliaria_id uuid, p_time_id uuid)
 returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_user uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('rodizio:' || p_imobiliaria_id::text, 0));
  select m.user_id into v_user
  from public.membros m
  where m.imobiliaria_id = p_imobiliaria_id and m.ativo and m.recebe_leads
    and (p_time_id is null or m.time_id = p_time_id)
  order by m.ultimo_lead_em nulls first, m.created_at
  limit 1;
  if v_user is not null then
    update public.membros set ultimo_lead_em = clock_timestamp()
    where imobiliaria_id = p_imobiliaria_id and user_id = v_user;
  end if;
  return v_user;
end $$;

create or replace function private.proximo_corretor(p_imobiliaria_id uuid)
 returns uuid language sql security definer set search_path to '' as $$
  select private.proximo_corretor(p_imobiliaria_id, null::uuid)
$$;

create or replace function private.leads_antes_inserir()
 returns trigger language plpgsql security definer set search_path to '' as $$
begin
  new.nome := trim(new.nome);
  new.email := nullif(lower(trim(new.email)), '');
  new.telefone := private.so_digitos(new.telefone);

  if new.etapa_id is null then
    select e.id into new.etapa_id from public.etapas_funil e
    where e.imobiliaria_id = new.imobiliaria_id and e.tipo = 'aberta'
    order by e.ordem limit 1;
  end if;

  -- Lead criado por alguém de um time fica no time dessa pessoa.
  if new.time_id is null and (select auth.uid()) is not null then
    new.time_id := private.meu_time(new.imobiliaria_id);
  end if;

  if new.corretor_id is null then
    new.corretor_id := private.proximo_corretor(new.imobiliaria_id, new.time_id);
  elsif not exists (select 1 from public.membros m
                    where m.imobiliaria_id = new.imobiliaria_id and m.user_id = new.corretor_id) then
    raise exception 'Corretor não pertence a esta empresa';
  end if;

  -- Lead sem time herda o time do corretor que recebeu.
  if new.time_id is null and new.corretor_id is not null then
    select m.time_id into new.time_id from public.membros m
    where m.imobiliaria_id = new.imobiliaria_id and m.user_id = new.corretor_id;
  end if;

  new.etapa_desde := now();
  return new;
end $$;

-- Transferências: dono/gerente geral à vontade; gerente do time só dentro do time; trocar de time só geral.
create or replace function private.leads_checar_transferencia()
 returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_geral boolean;
begin
  if v_uid is null then return new; end if;
  v_geral := old.imobiliaria_id in (select private.imobiliarias_que_gerencio());

  if new.time_id is distinct from old.time_id and not v_geral then
    raise exception 'Apenas o dono ou um gerente geral pode mudar o lead de time';
  end if;

  if new.corretor_id is distinct from old.corretor_id and not v_geral then
    if old.corretor_id is null and new.corretor_id = v_uid then
      null;
    elsif old.time_id is not null and old.time_id in (select private.times_que_gerencio())
          and exists (select 1 from public.membros m where m.imobiliaria_id = old.imobiliaria_id
                      and m.user_id = new.corretor_id and m.time_id = old.time_id) then
      null;
    elsif new.corretor_id is not null or old.time_id is null or old.time_id not in (select private.times_que_gerencio()) then
      raise exception 'Apenas o dono ou o gerente pode transferir leads';
    end if;
  end if;

  -- Ao trocar de corretor por um gerente geral, o lead acompanha o time do novo corretor.
  if v_geral and new.corretor_id is distinct from old.corretor_id and new.time_id is not distinct from old.time_id
     and new.corretor_id is not null then
    select coalesce(m.time_id, new.time_id) into new.time_id from public.membros m
    where m.imobiliaria_id = new.imobiliaria_id and m.user_id = new.corretor_id;
  end if;
  return new;
end $$;

-- Convites levam o time.
create or replace function public.aceitar_convites(p_nome text default null::text)
 returns integer language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower((select auth.jwt()) ->> 'email');
  v_n integer;
begin
  if v_uid is null or v_email is null then return 0; end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    return 0;
  end if;
  insert into public.membros (imobiliaria_id, user_id, nome, email, papel, time_id)
  select c.imobiliaria_id, v_uid, coalesce(nullif(trim(p_nome), ''), c.nome, v_email), v_email, c.papel, c.time_id
  from public.convites c
  where c.email = v_email and c.aceito_em is null
  on conflict (imobiliaria_id, user_id) do nothing;
  get diagnostics v_n = row_count;
  update public.convites set aceito_em = now() where email = v_email and aceito_em is null;
  return v_n;
end $$;

-- Gerente de time pode convidar para o próprio time (só como corretor).
create policy convites_time on public.convites for all
  using (time_id in (select private.times_que_gerencio()))
  with check (time_id in (select private.times_que_gerencio()) and papel = 'corretor');

-- Captura: o token do time também vale, e o lead já entra no time.
do $$
declare r record; v_def text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'capturar_lead' loop
    v_def := pg_get_functiondef(r.oid);
    v_def := replace(v_def, '  v_lead uuid;', E'  v_lead uuid;\n  v_time uuid;');
    v_def := replace(v_def, 'select id into v_imob from public.imobiliarias where token_captura = p_token;',
      E'select id into v_imob from public.imobiliarias where token_captura = p_token;\n  if v_imob is null then\n    select t.imobiliaria_id, t.id into v_imob, v_time from public.times t where t.token_captura = p_token and t.ativo;\n  end if;');
    v_def := replace(v_def, 'insert into public.leads (imobiliaria_id, nome,', 'insert into public.leads (imobiliaria_id, time_id, nome,');
    v_def := replace(v_def, 'values (v_imob, coalesce(nullif(trim(p_nome)', 'values (v_imob, v_time, coalesce(nullif(trim(p_nome)');
    if v_def not like '%v_time uuid;%' or v_def not like '%(imobiliaria_id, time_id, nome,%' or v_def not like '%v_imob, v_time, coalesce%' then
      raise exception 'capturar_lead: substituição falhou';
    end if;
    execute v_def;
  end loop;
end $$;
