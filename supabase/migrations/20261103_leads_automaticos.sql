-- Leads automáticos de todos os anúncios (formulários da Meta e WhatsApp), entrando no time certo
--
-- 1. Cada página da Meta pode mandar os leads para um time (time_id) e cada formulário pode ter
--    um time próprio (times_formularios: {"<form_id>": "<time_id>"}). Sem time: rodízio da empresa toda.
-- 2. O WhatsApp da empresa pode mandar os contatos novos para um time (integracoes_whatsapp.time_id).
-- 3. A cada 15 minutos o CRM busca na Meta os leads novos de todas as páginas conectadas
--    (rede de segurança para o que o webhook não entregar).

alter table public.integracoes_meta
  add column if not exists time_id uuid references public.times(id) on delete set null,
  add column if not exists times_formularios jsonb not null default '{}'::jsonb,
  add column if not exists sincronizado_em timestamptz;

alter table public.integracoes_whatsapp
  add column if not exists time_id uuid references public.times(id) on delete set null;

-- integracoes_meta usa permissões por coluna (o token da página não sai do servidor)
grant select (time_id, times_formularios, sincronizado_em) on public.integracoes_meta to authenticated;
grant update (time_id, times_formularios) on public.integracoes_meta to authenticated;

-- O time escolhido precisa ser da mesma empresa
create or replace function private.integracao_time_valido()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_time text;
begin
  if new.time_id is not null and not exists (
    select 1 from public.times t where t.id = new.time_id and t.imobiliaria_id = new.imobiliaria_id) then
    raise exception 'Time não pertence a esta empresa';
  end if;
  if tg_table_name = 'integracoes_meta' then
    new.times_formularios := coalesce(new.times_formularios, '{}'::jsonb);
    if jsonb_typeof(new.times_formularios) <> 'object' then raise exception 'times_formularios inválido'; end if;
    for v_time in select value from jsonb_each_text(new.times_formularios) loop
      if not exists (select 1 from public.times t
                     where t.id::text = v_time and t.imobiliaria_id = new.imobiliaria_id) then
        raise exception 'Time não pertence a esta empresa';
      end if;
    end loop;
  end if;
  return new;
end $$;

create or replace trigger integracoes_meta_time_valido before insert or update of time_id, times_formularios, imobiliaria_id
  on public.integracoes_meta for each row execute function private.integracao_time_valido();

create or replace trigger integracoes_whatsapp_time_valido before insert or update of time_id, imobiliaria_id
  on public.integracoes_whatsapp for each row execute function private.integracao_time_valido();

-- Contato novo no WhatsApp entra no time escolhido para o número (o rodízio já respeita time_id)
do $$
declare
  d text := pg_get_functiondef('public.receber_whatsapp(text,text,text,text,boolean,text,jsonb)'::regprocedure);
  antes text;
begin
  if position('v_time uuid;' in d) > 0 then return; end if; -- já aplicado
  antes := d;
  d := replace(d, E'  v_imovel uuid;\nbegin', E'  v_imovel uuid;\n  v_time uuid;\nbegin');
  d := replace(d,
    'select w.imobiliaria_id, i.minutos_primeiro_contato into v_imob, v_min',
    'select w.imobiliaria_id, i.minutos_primeiro_contato, t.id into v_imob, v_min, v_time');
  d := replace(d,
    'from public.integracoes_whatsapp w join public.imobiliarias i on i.id = w.imobiliaria_id',
    'from public.integracoes_whatsapp w join public.imobiliarias i on i.id = w.imobiliaria_id' || E'\n'
    || '  left join public.times t on t.id = w.time_id and t.ativo');
  d := replace(d,
    'insert into public.leads (imobiliaria_id, nome, telefone, origem, mensagem, imovel_id,',
    'insert into public.leads (imobiliaria_id, time_id, nome, telefone, origem, mensagem, imovel_id,');
  d := replace(d,
    'values (v_imob, coalesce(nullif(trim(p_nome), ''''), ''Contato WhatsApp''), v_tel,',
    'values (v_imob, v_time, coalesce(nullif(trim(p_nome), ''''), ''Contato WhatsApp''), v_tel,');
  if (length(d) - length(antes)) <> (length(E'\n  v_time uuid;') + length(', t.id') + length(', v_time')
       + length(E'\n  left join public.times t on t.id = w.time_id and t.ativo') + length('time_id, ') + length('v_time, ')) then
    raise exception 'receber_whatsapp mudou; ajuste a migração';
  end if;
  execute d;
end $$;

-- Sincronização automática dos formulários da Meta (a cada 15 min)
create or replace function private.sincronizar_meta_leads()
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if exists (select 1 from public.integracoes_meta where ativo) then
    perform net.http_post(
      url := 'https://dmmifwbgncfmwyaizitg.supabase.co/functions/v1/meta-leads',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'crm_cron_secret')),
      body := '{"acao":"sincronizar"}'::jsonb,
      timeout_milliseconds := 120000);
  end if;
end $$;

select cron.schedule('crm-meta-leads-sincronizar', '*/15 * * * *', 'select private.sincronizar_meta_leads()');
