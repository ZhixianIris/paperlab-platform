-- Expand the tenant tool allowlist for browser-local image processing.
-- Existing tenant-specific settings are never overwritten.
alter table public.tool_configs drop constraint if exists tool_configs_tool_key_check;
alter table public.tool_configs add constraint tool_configs_tool_key_check
  check (tool_key in ('pdf.merge','pdf.split','pdf.rotate','pdf.delete','pdf.organize','pdf.blanks','pdf.numbers','pdf.watermark','pdf.crop','pdf.metadata','pdf.images','pdf.to-image','pdf.to-text','pdf.compress','pdf.grayscale','pdf.background','pdf.stamp','pdf.flatten','pdf.insert','pdf.split-pages','pdf.resize-pages','pdf.nup','pdf.fill','image.crop','image.resize','image.convert','image.compress','image.rotate','image.flip','image.adjust','image.watermark','image.frame','image.round','image.pixelate','image.blur','image.mask','image.background','image.replace-background','image.strip','image.collage','image.batch','ai.image.generate'));

insert into public.tool_configs (tenant_id, tool_key, enabled)
select t.id, x.key, true
from public.tenants t
cross join unnest(array['image.rotate','image.flip','image.adjust','image.watermark','image.frame','image.round','image.pixelate','image.blur','image.mask','image.background','image.replace-background','image.strip','image.collage','image.batch']) as x(key)
on conflict (tenant_id, tool_key) do nothing;
