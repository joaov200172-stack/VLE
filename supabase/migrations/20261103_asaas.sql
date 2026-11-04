-- Cobrança automática das empresas do CRM pelo Asaas (mensalidade da agência/CRM)

create table if not exists private.asaas_config (
  id boolean primary key default true check (id),
  ambiente text not null default 'producao' check (ambiente in ('producao', 'sandbox')),
  webhook_id text,
  conta_nome text,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.assinaturas (
  imobiliaria_id uuid primary key references public.imobiliarias(id) on delete cascade,
  asaas_cliente text,
  asaas_assinatura text unique,
  nome_cobranca text,
  cpf_cnpj text,
  email text,
  telefone text,
  valor numeric(12,2) not null check (valor > 0),
  dia_vencimento int not null check (dia_vencimento between 1 and 28),
  forma text not null default 'UNDEFINED' check (forma in ('UNDEFINED', 'PIX', 'BOLETO', 'CREDIT_CARD')),
  descricao text,
  status text not null default 'aguardando' check (status in ('aguardando', 'em_dia', 'atrasada', 'cancelada')),
  proximo_vencimento date,
  ultimo_pagamento_em timestamptz,
  criada_em timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cobrancas (
  id text primary key,                       -- id da cobrança no Asaas (pay_...)
  imobiliaria_id uuid not null references public.imobiliarias(id) on delete cascade,
  asaas_assinatura text,
  valor numeric(12,2),
  vencimento date,
  status text,                               -- PENDING, RECEIVED, CONFIRMED, OVERDUE, REFUNDED...
  forma text,
  link text,                                 -- fatura com Pix, boleto e cartão
  pago_em timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists cobrancas_imob_idx on public.cobrancas (imobiliaria_id, vencimento desc);

alter table public.assinaturas enable row level security;
alter table public.cobrancas enable row level security;

-- leitura: dono geral vê todas; dono da empresa vê a própria (para pagar). Escrita só pela função do servidor.
create policy assinaturas_select on public.assinaturas for select to authenticated
  using (imobiliaria_id in (select private.imobiliarias_que_sou_dono()));
create policy cobrancas_select on public.cobrancas for select to authenticated
  using (imobiliaria_id in (select private.imobiliarias_que_sou_dono()));

-- Dono geral grava a chave da API no cofre (nunca volta para o navegador)
create or replace function public.asaas_salvar_chave(p_chave text, p_ambiente text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.sou_admin() then raise exception 'apenas o dono geral'; end if;
  if coalesce(length(trim(p_chave)), 0) < 20 then raise exception 'chave inválida'; end if;
  if p_ambiente not in ('producao', 'sandbox') then raise exception 'ambiente inválido'; end if;

  select id into v_id from vault.secrets where name = 'asaas_api_key';
  if v_id is null then perform vault.create_secret(trim(p_chave), 'asaas_api_key');
  else perform vault.update_secret(v_id, trim(p_chave)); end if;

  if not exists (select 1 from vault.secrets where name = 'asaas_webhook_token') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'asaas_webhook_token');
  end if;

  insert into private.asaas_config (id, ambiente, atualizado_em) values (true, p_ambiente, now())
  on conflict (id) do update set ambiente = excluded.ambiente, webhook_id = null, conta_nome = null, atualizado_em = now();
end $$;
revoke all on function public.asaas_salvar_chave(text, text) from public, anon;
grant execute on function public.asaas_salvar_chave(text, text) to authenticated;

-- Situação da integração para a tela (sem a chave)
create or replace function public.asaas_situacao()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not private.sou_admin() then null else jsonb_build_object(
    'configurado', exists (select 1 from vault.secrets where name = 'asaas_api_key'),
    'ambiente', (select ambiente from private.asaas_config),
    'webhook', (select webhook_id is not null from private.asaas_config),
    'conta', (select conta_nome from private.asaas_config)) end
$$;
revoke all on function public.asaas_situacao() from public, anon;
grant execute on function public.asaas_situacao() to authenticated;

-- Só para a função do servidor
create or replace function public.asaas_parametros()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'api_key', (select decrypted_secret from vault.decrypted_secrets where name = 'asaas_api_key'),
    'webhook_token', (select decrypted_secret from vault.decrypted_secrets where name = 'asaas_webhook_token'),
    'ambiente', coalesce((select ambiente from private.asaas_config), 'producao'))
$$;
revoke all on function public.asaas_parametros() from public, anon, authenticated;
grant execute on function public.asaas_parametros() to service_role;

create or replace function public.asaas_registrar_webhook(p_webhook_id text, p_conta text)
returns void language sql security definer set search_path = '' as $$
  update private.asaas_config set webhook_id = p_webhook_id, conta_nome = p_conta, atualizado_em = now()
$$;
revoke all on function public.asaas_registrar_webhook(text, text) from public, anon, authenticated;
grant execute on function public.asaas_registrar_webhook(text, text) to service_role;
