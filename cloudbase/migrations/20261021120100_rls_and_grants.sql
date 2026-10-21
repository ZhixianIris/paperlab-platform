-- Tenant isolation is enforced twice: server-side authorization in platform-api and
-- PostgreSQL GRANT + RLS for any client that reaches PostgREST directly.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  )
$$;

create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = auth.uid()
  )
$$;

create or replace function public.is_tenant_owner(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.role = 'tenant_owner'
  )
$$;

create or replace function public.can_access_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select public.is_platform_admin() or public.is_tenant_member(p_tenant_id)
$$;

revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.is_tenant_member(uuid) from public, anon;
revoke all on function public.is_tenant_owner(uuid) from public, anon;
revoke all on function public.can_access_tenant(uuid) from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.is_tenant_owner(uuid) to authenticated;
grant execute on function public.can_access_tenant(uuid) to authenticated;

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.platform_admins enable row level security;
alter table public.tool_configs enable row level security;
alter table public.model_prices enable row level security;
alter table public.wallets enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.usage_records enable row level security;
alter table public.orders enable row level security;
alter table public.payment_events enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists tenants_select_member on public.tenants;
create policy tenants_select_member on public.tenants
for select to authenticated
using (public.is_platform_admin() or public.is_tenant_member(id));

drop policy if exists memberships_select_scoped on public.memberships;
create policy memberships_select_scoped on public.memberships
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_platform_admin()
  or public.is_tenant_owner(tenant_id)
);

drop policy if exists platform_admins_select_self on public.platform_admins;
create policy platform_admins_select_self on public.platform_admins
for select to authenticated
using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists tool_configs_select_scoped on public.tool_configs;
create policy tool_configs_select_scoped on public.tool_configs
for select to authenticated
using (public.can_access_tenant(tenant_id));

drop policy if exists model_prices_select_available on public.model_prices;
create policy model_prices_select_available on public.model_prices
for select to authenticated
using (enabled or public.is_platform_admin());

drop policy if exists wallets_select_scoped on public.wallets;
create policy wallets_select_scoped on public.wallets
for select to authenticated
using (public.can_access_tenant(tenant_id));

drop policy if exists ai_jobs_select_scoped on public.ai_jobs;
create policy ai_jobs_select_scoped on public.ai_jobs
for select to authenticated
using (
  public.is_platform_admin()
  or public.is_tenant_owner(tenant_id)
  or (user_id = auth.uid() and public.is_tenant_member(tenant_id))
);

drop policy if exists wallet_ledger_select_scoped on public.wallet_ledger;
create policy wallet_ledger_select_scoped on public.wallet_ledger
for select to authenticated
using (
  public.is_platform_admin()
  or public.is_tenant_owner(tenant_id)
  or (user_id = auth.uid() and public.is_tenant_member(tenant_id))
);

drop policy if exists usage_records_select_scoped on public.usage_records;
create policy usage_records_select_scoped on public.usage_records
for select to authenticated
using (
  public.is_platform_admin()
  or public.is_tenant_owner(tenant_id)
  or (user_id = auth.uid() and public.is_tenant_member(tenant_id))
);

drop policy if exists orders_select_scoped on public.orders;
create policy orders_select_scoped on public.orders
for select to authenticated
using (
  public.is_platform_admin()
  or public.is_tenant_owner(tenant_id)
  or (user_id = auth.uid() and public.is_tenant_member(tenant_id))
);

drop policy if exists payment_events_select_admin on public.payment_events;
create policy payment_events_select_admin on public.payment_events
for select to authenticated
using (public.is_platform_admin());

drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log
for select to authenticated
using (public.is_platform_admin());

-- The browser may only read a narrow, RLS-filtered subset. All mutations go
-- through platform-api, so no INSERT/UPDATE/DELETE policy or table grant exists.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.tenants to authenticated;
grant select on public.memberships to authenticated;
grant select on public.platform_admins to authenticated;
grant select on public.tool_configs to authenticated;
grant select on public.model_prices to authenticated;
grant select on public.wallets to authenticated;
grant select on public.ai_jobs to authenticated;
grant select on public.wallet_ledger to authenticated;
grant select on public.usage_records to authenticated;
grant select on public.orders to authenticated;
grant select on public.payment_events to authenticated;
grant select on public.audit_log to authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
