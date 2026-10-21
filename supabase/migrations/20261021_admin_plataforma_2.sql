-- Etapas e mensagens padrão de uma empresa nova
create or replace function private.semear_empresa(v_imob uuid) returns void
language plpgsql security definer set search_path to '' as $$
declare e_novo uuid; e_visita uuid; e_proposta uuid; e_ganho uuid;
begin
  insert into public.etapas_funil (imobiliaria_id, nome, ordem, tipo, cor, sla_horas, gatilho) values
    (v_imob, 'Novo lead', 1, 'aberta', '#2563eb', 2, null) returning id into e_novo;
  insert into public.etapas_funil (imobiliaria_id, nome, ordem, tipo, cor, sla_horas, gatilho) values
    (v_imob, 'Em atendimento', 2, 'aberta', '#7c3aed', 24, null);
  insert into public.etapas_funil (imobiliaria_id, nome, ordem, tipo, cor, sla_horas, gatilho) values
    (v_imob, 'Visita agendada', 3, 'aberta', '#d97706', 48, 'visita_agendada') returning id into e_visita;
  insert into public.etapas_funil (imobiliaria_id, nome, ordem, tipo, cor, sla_horas, gatilho) values
    (v_imob, 'Proposta', 4, 'aberta', '#0891b2', 48, null) returning id into e_proposta;
  insert into public.etapas_funil (imobiliaria_id, nome, ordem, tipo, cor, sla_horas, gatilho) values
    (v_imob, 'Negócio fechado', 5, 'ganho', '#16a34a', 24, null) returning id into e_ganho;
  insert into public.etapas_funil (imobiliaria_id, nome, ordem, tipo, cor, sla_horas, gatilho) values
    (v_imob, 'Perdido', 6, 'perdido', '#dc2626', 24, null);

  insert into public.modelos_mensagem (imobiliaria_id, nome, gatilho, etapa_id, texto) values
    (v_imob, 'Boas-vindas ao novo lead', 'etapa', e_novo,
     'Olá, {primeiro_nome}! Aqui é {corretor}, da {imobiliaria}. Recebi seu contato sobre {imovel} e vou te ajudar. Qual o melhor horário para conversarmos?'),
    (v_imob, 'Confirmação de visita', 'etapa', e_visita,
     'Perfeito, {primeiro_nome}! Sua visita está marcada para {data_visita}. Se surgir qualquer imprevisto, me avise por aqui. {corretor} — {imobiliaria}'),
    (v_imob, 'Envio de proposta', 'etapa', e_proposta,
     '{primeiro_nome}, preparei os detalhes da proposta de {imovel}. Podemos revisar juntos hoje?'),
    (v_imob, 'Parabéns pelo negócio', 'etapa', e_ganho,
     'Parabéns, {primeiro_nome}! Foi um prazer te atender. Conte sempre com a {imobiliaria}.'),
    (v_imob, 'Follow-up de lead parado', 'followup', null,
     'Oi, {primeiro_nome}, tudo bem? Passando para saber se você ainda procura imóvel. Separei algumas opções que podem te interessar. Posso te enviar?'),
    (v_imob, 'Lembrete de visita', 'lembrete_visita', null,
     'Olá, {primeiro_nome}! Passando para lembrar da nossa visita em {imovel}, {data_visita}. Confirma presença? {corretor}');
end $$;
revoke all on function private.semear_empresa(uuid) from public, anon, authenticated;

-- Agora só o dono geral da plataforma cria empresas
create or replace function public.criar_imobiliaria(p_nome text, p_seu_nome text, p_telefone text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower((select auth.jwt()) ->> 'email');
  v_imob uuid;
begin
  if v_uid is null then raise exception 'É preciso estar logado'; end if;
  if not private.sou_admin() then raise exception 'Só o administrador da plataforma cria empresas'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome da empresa'; end if;
  insert into public.imobiliarias (nome) values (trim(p_nome)) returning id into v_imob;
  insert into public.membros (imobiliaria_id, user_id, nome, email, telefone, papel)
  values (v_imob, v_uid, coalesce(nullif(trim(p_seu_nome), ''), v_email), v_email, p_telefone, 'dono');
  perform private.semear_empresa(v_imob);
  return v_imob;
end $$;

-- Cria a empresa de um cliente e deixa o dono dela convidado
create or replace function public.admin_criar_empresa(p_nome text, p_email_dono text, p_nome_dono text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_imob uuid;
  v_email text := lower(trim(coalesce(p_email_dono, '')));
  v_user uuid;
begin
  if not private.sou_admin() then raise exception 'Só o administrador da plataforma cria empresas'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome da empresa'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Informe um e-mail válido para o dono'; end if;
  insert into public.imobiliarias (nome) values (trim(p_nome)) returning id into v_imob;
  perform private.semear_empresa(v_imob);
  select u.id into v_user from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null;
  if v_user is not null then
    insert into public.membros (imobiliaria_id, user_id, nome, email, papel)
    values (v_imob, v_user, coalesce(nullif(trim(p_nome_dono), ''), v_email), v_email, 'dono');
    insert into private.convites_dono (imobiliaria_id, email, nome, aceito_em) values (v_imob, v_email, nullif(trim(p_nome_dono), ''), now());
  else
    insert into private.convites_dono (imobiliaria_id, email, nome) values (v_imob, v_email, nullif(trim(p_nome_dono), ''));
  end if;
  return v_imob;
end $$;
revoke all on function public.admin_criar_empresa(text, text, text) from public, anon;
grant execute on function public.admin_criar_empresa(text, text, text) to authenticated;

-- Lista de todas as empresas para o dono geral
create or replace function public.admin_empresas()
returns table (id uuid, nome text, criada_em timestamptz, donos text, dono_pendente text, pessoas bigint, times bigint, leads bigint, leads_30d bigint)
language sql stable security definer set search_path to '' as $$
  select i.id, i.nome, i.created_at,
    (select string_agg(m.nome || ' <' || coalesce(m.email, '') || '>', ', ') from public.membros m where m.imobiliaria_id = i.id and m.papel = 'dono' and m.ativo),
    (select string_agg(c.email, ', ') from private.convites_dono c where c.imobiliaria_id = i.id and c.aceito_em is null),
    (select count(*) from public.membros m where m.imobiliaria_id = i.id and m.ativo),
    (select count(*) from public.times t where t.imobiliaria_id = i.id),
    (select count(*) from public.leads l where l.imobiliaria_id = i.id),
    (select count(*) from public.leads l where l.imobiliaria_id = i.id and l.created_at > now() - interval '30 days')
  from public.imobiliarias i
  where private.sou_admin()
  order by i.nome
$$;
grant execute on function public.admin_empresas() to authenticated;

-- Convites de dono são aceitos no login, junto com os convites normais
create or replace function public.aceitar_convites(p_nome text default null)
returns integer language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower((select auth.jwt()) ->> 'email');
  v_n integer; v_d integer;
begin
  if v_uid is null or v_email is null then return 0; end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    return 0;
  end if;
  insert into public.membros (imobiliaria_id, user_id, nome, email, papel)
  select c.imobiliaria_id, v_uid, coalesce(nullif(trim(p_nome), ''), c.nome, v_email), v_email, 'dono'
  from private.convites_dono c
  where c.email = v_email and c.aceito_em is null
  on conflict (imobiliaria_id, user_id) do update set papel = 'dono', ativo = true, time_id = null;
  get diagnostics v_d = row_count;
  update private.convites_dono set aceito_em = now() where email = v_email and aceito_em is null;

  insert into public.membros (imobiliaria_id, user_id, nome, email, papel, time_id)
  select c.imobiliaria_id, v_uid, coalesce(nullif(trim(p_nome), ''), c.nome, v_email), v_email, c.papel, c.time_id
  from public.convites c
  where c.email = v_email and c.aceito_em is null
  on conflict (imobiliaria_id, user_id) do nothing;
  get diagnostics v_n = row_count;
  update public.convites set aceito_em = now() where email = v_email and aceito_em is null;
  return v_n + v_d;
end $$;

-- O dono geral pode mexer em papéis e times de qualquer empresa
create or replace function private.membros_antes_atualizar() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean := private.sou_admin();
begin
  new.imobiliaria_id := old.imobiliaria_id;
  new.user_id := old.user_id;
  if v_uid is not null and new.papel is distinct from old.papel and not v_admin then
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
  if v_uid is not null and old.papel = 'dono' and old.user_id <> v_uid and not v_admin
     and not exists (select 1 from public.membros m
                     where m.imobiliaria_id = old.imobiliaria_id and m.user_id = v_uid
                       and m.papel = 'dono' and m.ativo) then
    raise exception 'Apenas o dono pode alterar outro dono';
  end if;
  return new;
end $$;
