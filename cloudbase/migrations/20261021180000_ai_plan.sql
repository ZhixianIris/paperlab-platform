-- Wave B: lightweight planner requests, quota accounting, and tenant switch.
alter table public.tool_configs drop constraint if exists tool_configs_tool_key_check;
alter table public.tool_configs add constraint tool_configs_tool_key_check
  check (tool_key in ('pdf.merge','pdf.split','pdf.rotate','pdf.delete','pdf.organize','pdf.blanks','pdf.numbers','pdf.watermark','pdf.crop','pdf.metadata','pdf.images','pdf.to-image','pdf.to-text','pdf.compress','pdf.grayscale','pdf.background','pdf.stamp','pdf.flatten','pdf.fill','pdf.insert','pdf.split-pages','pdf.resize-pages','pdf.nup','image.crop','image.resize','image.convert','image.compress','image.rotate','image.flip','image.adjust','image.watermark','image.frame','image.round','image.pixelate','image.blur','image.mask','image.background','image.replace-background','image.strip','image.collage','image.batch','ai.image.generate','ai.plan'));

insert into public.tool_configs (tenant_id, tool_key, enabled)
select t.id, 'ai.plan', true
from public.tenants t
on conflict (tenant_id, tool_key) do nothing;

create table if not exists public.ai_plan_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id varchar(64) not null,
  request_id text not null,
  request_fingerprint text not null,
  provider text not null,
  model text not null,
  status text not null default 'processing'
    check (status in ('processing', 'succeeded', 'failed')),
  prompt_chars integer not null check (prompt_chars between 1 and 1000),
  file_count smallint not null check (file_count between 1 and 8),
  plan jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, request_id)
);

create index if not exists ai_plan_requests_user_created_idx
  on public.ai_plan_requests (user_id, created_at desc);
create index if not exists ai_plan_requests_tenant_created_idx
  on public.ai_plan_requests (tenant_id, created_at desc);
create index if not exists ai_plan_requests_status_idx
  on public.ai_plan_requests (status, created_at);

alter table public.ai_plan_requests enable row level security;
revoke all on public.ai_plan_requests from anon, authenticated;
