-- Add browser-local PDF tools to the tenant switchboard. Existing tenant settings are preserved.
alter table public.tool_configs drop constraint if exists tool_configs_tool_key_check;
alter table public.tool_configs add constraint tool_configs_tool_key_check
  check (tool_key in ('pdf.merge','pdf.split','pdf.rotate','pdf.delete','pdf.organize','pdf.blanks','pdf.numbers','pdf.watermark','pdf.crop','pdf.metadata','pdf.images','pdf.to-image','pdf.to-text','pdf.compress','pdf.grayscale','pdf.background','pdf.stamp','pdf.flatten','image.crop','image.resize','image.convert','image.compress','ai.image.generate'));
insert into public.tool_configs (tenant_id,tool_key,enabled)
select t.id,k.key,true from public.tenants t
cross join unnest(array['pdf.delete','pdf.organize','pdf.blanks','pdf.numbers','pdf.watermark','pdf.crop','pdf.metadata','pdf.images','pdf.to-image','pdf.to-text','pdf.compress','pdf.grayscale','pdf.background','pdf.stamp','pdf.flatten']) as k(key)
on conflict (tenant_id,tool_key) do nothing;
