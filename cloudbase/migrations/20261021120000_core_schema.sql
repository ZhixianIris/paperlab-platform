-- PaperLab core schema. Money is always an integer count of CNY cents.
create extension if not exists pgcrypto;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  name text not null check (char_length(name) between 1 and 80),
  status text not null default 'active' check (status in ('active', 'suspended')),
  monthly_ai_budget_cents bigint not null default 10000 check (monthly_ai_budget_cents >= 0),
  max_job_cost_cents bigint not null default 5000 check (max_job_cost_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id varchar(64) not null,
  role text not null check (role in ('tenant_owner', 'tenant_member')),
  monthly_ai_budget_cents bigint not null default 5000 check (monthly_ai_budget_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table if not exists public.platform_admins (
  user_id varchar(64) primary key,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.tool_configs (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tool_key text not null check (tool_key in ('pdf.merge', 'pdf.split', 'pdf.rotate', 'image.crop', 'image.resize', 'image.convert', 'image.compress', 'ai.image.generate')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, tool_key)
);

create table if not exists public.model_prices (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z0-9_-]{2,32}$'),
  model text not null check (char_length(model) between 1 and 120),
  display_name text not null check (char_length(display_name) between 1 and 120),
  description text not null default '',
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  currency char(3) not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  enabled boolean not null default false,
  max_images smallint not null default 1 check (max_images between 1 and 4),
  max_prompt_chars integer not null default 1000 check (max_prompt_chars between 1 and 4000),
  monthly_budget_cents bigint not null default 10000 check (monthly_budget_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, model)
);

create table if not exists public.wallets (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  available_cents bigint not null default 0 check (available_cents >= 0),
  reserved_cents bigint not null default 0 check (reserved_cents >= 0),
  currency char(3) not null default 'CNY' check (currency = 'CNY'),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id varchar(64) not null,
  request_id text not null,
  request_fingerprint text not null,
  feature text not null check (feature in ('image.generate')),
  provider text not null,
  model text not null,
  model_price_id uuid not null references public.model_prices(id),
  prompt text not null,
  params jsonb not null default '{}'::jsonb,
  status text not null default 'processing' check (status in ('processing', 'pending_reconciliation', 'succeeded', 'settled', 'failed')),
  reserved_cents bigint not null check (reserved_cents >= 0),
  settled_cents bigint not null default 0 check (settled_cents >= 0),
  usage_quantity integer not null check (usage_quantity between 1 and 4),
  provider_request_id text,
  result jsonb,
  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, request_id)
);

create table if not exists public.wallet_ledger (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id varchar(64),
  job_id uuid,
  order_id uuid,
  kind text not null check (kind in ('topup', 'adjustment', 'reserve', 'settle', 'release', 'reconcile_hold')),
  available_delta_cents bigint not null,
  reserved_delta_cents bigint not null,
  available_after_cents bigint not null check (available_after_cents >= 0),
  reserved_after_cents bigint not null check (reserved_after_cents >= 0),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_records (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id varchar(64) not null,
  job_id uuid not null unique,
  feature text not null,
  provider text not null,
  model text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id varchar(64) not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'CNY' check (currency = 'CNY'),
  status text not null default 'created' check (status in ('created', 'pending', 'paid', 'failed', 'cancelled', 'refunded')),
  provider text not null,
  provider_order_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (provider, provider_order_id)
);

create table if not exists public.payment_events (
  id bigserial primary key,
  provider text not null,
  provider_event_id text not null,
  order_id uuid not null references public.orders(id),
  amount_cents bigint not null check (amount_cents > 0),
  payload_hash text not null,
  processed_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table if not exists public.audit_log (
  id bigserial primary key,
  actor_user_id varchar(64) not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_tenant_idx on public.memberships (tenant_id);
create index if not exists ai_jobs_tenant_created_idx on public.ai_jobs (tenant_id, created_at desc);
create index if not exists ai_jobs_user_created_idx on public.ai_jobs (user_id, created_at desc);
create index if not exists ai_jobs_pending_idx on public.ai_jobs (status, updated_at) where status in ('processing', 'pending_reconciliation');
create index if not exists usage_tenant_created_idx on public.usage_records (tenant_id, created_at desc);
create index if not exists usage_user_created_idx on public.usage_records (user_id, created_at desc);
create index if not exists ledger_tenant_created_idx on public.wallet_ledger (tenant_id, created_at desc);
create index if not exists orders_tenant_created_idx on public.orders (tenant_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.reject_immutable_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'immutable_table: % rows cannot be changed', tg_table_name
    using errcode = '42501';
end;
$$;

create or replace function public.enforce_tenant_slug_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.slug <> old.slug then
    raise exception 'tenant_slug_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_set_updated_at on public.tenants;
create trigger tenants_set_updated_at before update on public.tenants
for each row execute function public.set_updated_at();

drop trigger if exists tenants_slug_immutable on public.tenants;
create trigger tenants_slug_immutable before update of slug on public.tenants
for each row execute function public.enforce_tenant_slug_immutable();

drop trigger if exists membership_updated_at on public.memberships;
create trigger membership_updated_at before update on public.memberships
for each row execute function public.set_updated_at();

drop trigger if exists model_prices_updated_at on public.model_prices;
create trigger model_prices_updated_at before update on public.model_prices
for each row execute function public.set_updated_at();

drop trigger if exists ai_jobs_updated_at on public.ai_jobs;
create trigger ai_jobs_updated_at before update on public.ai_jobs
for each row execute function public.set_updated_at();

drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists wallet_ledger_immutable on public.wallet_ledger;
create trigger wallet_ledger_immutable before update or delete on public.wallet_ledger
for each row execute function public.reject_immutable_change();

drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable before update or delete on public.audit_log
for each row execute function public.reject_immutable_change();
