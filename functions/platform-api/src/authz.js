'use strict';

const { AppError } = require('./errors');
const { uuid } = require('./validation');

const TOOL_KEYS = Object.freeze([
  'pdf.merge',
  'pdf.split',
  'pdf.rotate',
  'pdf.delete',
  'pdf.organize',
  'pdf.blanks',
  'pdf.numbers',
  'pdf.watermark',
  'pdf.crop',
  'pdf.metadata',
  'pdf.images',
  'pdf.to-image',
  'pdf.to-text',
  'pdf.compress',
  'pdf.grayscale',
  'pdf.background',
  'pdf.stamp',
  'pdf.flatten',
  'pdf.insert',
  'pdf.split-pages',
  'pdf.resize-pages',
  'pdf.nup',
  'pdf.fill',
  'image.crop',
  'image.resize',
  'image.convert',
  'image.compress',
  'image.rotate',
  'image.flip',
  'image.adjust',
  'image.watermark',
  'image.frame',
  'image.round',
  'image.pixelate',
  'image.blur',
  'image.mask',
  'image.background',
  'image.replace-background',
  'image.strip',
  'image.collage',
  'image.batch',
  'ai.image.generate',
]);

const MONTH_START = `(date_trunc('month', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')`;

async function findUserByUid(client, uid) {
  const { rows } = await client.query(
    'select id, email, user_metadata from auth.users where id = $1',
    [uid]
  );
  return rows[0]
    ? { id: rows[0].id, email: rows[0].email || '', metadata: rows[0].user_metadata || {} }
    : { id: uid, email: '', metadata: {} };
}

async function findUserByEmail(client, email) {
  const { rows } = await client.query(
    'select id, email from auth.users where lower(email) = lower($1) limit 1',
    [email]
  );
  return rows[0] || null;
}

async function isPlatformAdmin(client, uid) {
  const { rows } = await client.query(
    'select 1 from public.platform_admins where user_id = $1',
    [uid]
  );
  return rows.length > 0;
}

async function requirePlatformAdmin(client, uid) {
  const admin = await isPlatformAdmin(client, uid);
  if (!admin) throw new AppError('forbidden', '需要平台管理员权限', { status: 403 });
  return true;
}

async function getMembership(client, uid, tenantId, { forUpdate = false, ownerOnly = false } = {}) {
  uuid(tenantId, 'tenantId');
  const lock = forUpdate ? 'for update of m, t' : '';
  const { rows } = await client.query(
    `select
       m.id as membership_id,
       m.tenant_id,
       m.user_id,
       m.role,
       m.monthly_ai_budget_cents as user_budget_cents,
       t.slug,
       t.name as tenant_name,
       t.status as tenant_status,
       t.monthly_ai_budget_cents as tenant_budget_cents,
       t.max_job_cost_cents
     from public.memberships m
     join public.tenants t on t.id = m.tenant_id
     where m.tenant_id = $1 and m.user_id = $2
     ${lock}`,
    [tenantId, uid]
  );
  const membership = rows[0];
  if (!membership) {
    throw new AppError('forbidden', '你不是该租户成员', { status: 403 });
  }
  if (ownerOnly && membership.role !== 'tenant_owner') {
    throw new AppError('forbidden', '需要租户所有者权限', { status: 403 });
  }
  return membership;
}

async function requireActiveTenant(client, uid, tenantId, { ownerOnly = false, lock = false } = {}) {
  const membership = await getMembership(client, uid, tenantId, {
    forUpdate: lock,
    ownerOnly,
  });
  if (membership.tenant_status !== 'active') {
    throw new AppError('tenant_suspended', '该租户已停用', { status: 403 });
  }
  return membership;
}

async function listMemberships(client, uid) {
  const { rows } = await client.query(
    `select
       m.tenant_id,
       m.role,
       m.user_id,
       m.monthly_ai_budget_cents as user_budget_cents,
       t.slug,
       t.name as tenant_name,
       t.status as tenant_status,
       t.monthly_ai_budget_cents as tenant_budget_cents,
       t.max_job_cost_cents,
       coalesce(w.available_cents, 0) as available_cents,
       coalesce(w.reserved_cents, 0) as reserved_cents,
       coalesce((
         select sum(u.amount_cents)::bigint from public.usage_records u
         where u.tenant_id = m.tenant_id and u.user_id = m.user_id
           and u.created_at >= ${MONTH_START}
       ), 0)::bigint as user_month_spent_cents,
       coalesce((
         select sum(u.amount_cents)::bigint from public.usage_records u
         where u.tenant_id = m.tenant_id and u.created_at >= ${MONTH_START}
       ), 0)::bigint as tenant_month_spent_cents,
       (select count(*)::int from public.memberships mm where mm.tenant_id = m.tenant_id) as member_count
     from public.memberships m
     join public.tenants t on t.id = m.tenant_id
     left join public.wallets w on w.tenant_id = m.tenant_id
     where m.user_id = $1
     order by t.name asc`,
    [uid]
  );
  return rows.map(mapMembership);
}

async function loadSession(pool, uid) {
  const client = await pool.connect();
  try {
    const [user, platformAdmin, memberships] = await Promise.all([
      findUserByUid(client, uid),
      isPlatformAdmin(client, uid),
      listMemberships(client, uid),
    ]);
    return { user, platformAdmin, memberships };
  } finally {
    client.release();
  }
}

async function getTenantById(client, tenantId) {
  const { rows } = await client.query('select * from public.tenants where id = $1', [tenantId]);
  return rows[0] || null;
}

async function getPublicTenantBySlug(client, slug) {
  const { rows } = await client.query(
    'select slug, name, status from public.tenants where slug = $1',
    [slug]
  );
  return rows[0] || null;
}

async function assertToolEnabled(client, tenantId, toolKey) {
  const { rows } = await client.query(
    'select enabled from public.tool_configs where tenant_id = $1 and tool_key = $2',
    [tenantId, toolKey]
  );
  if (!rows[0] || !rows[0].enabled) {
    throw new AppError('tool_disabled', '该工具在当前租户已关闭', { status: 403 });
  }
}

async function ensureTenantDefaults(client, tenantId) {
  await client.query(
    `insert into public.wallets (tenant_id) values ($1)
     on conflict (tenant_id) do nothing`,
    [tenantId]
  );
  for (const key of TOOL_KEYS) {
    await client.query(
      `insert into public.tool_configs (tenant_id, tool_key, enabled)
       values ($1, $2, true) on conflict (tenant_id, tool_key) do nothing`,
      [tenantId, key]
    );
  }
}

async function recordAudit(client, { actorUserId, action, targetType, targetId, details = {} }) {
  await client.query(
    `insert into public.audit_log (actor_user_id, action, target_type, target_id, details)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [actorUserId, action, targetType, String(targetId), JSON.stringify(details)]
  );
}

function mapMembership(row) {
  return {
    tenantId: row.tenant_id,
    slug: row.slug,
    tenantName: row.tenant_name,
    tenantStatus: row.tenant_status,
    role: row.role,
    userId: row.user_id,
    availableCents: Number(row.available_cents || 0),
    reservedCents: Number(row.reserved_cents || 0),
    userBudgetCents: Number(row.user_budget_cents || 0),
    userMonthSpentCents: Number(row.user_month_spent_cents || 0),
    tenantBudgetCents: Number(row.tenant_budget_cents || 0),
    tenantMonthSpentCents: Number(row.tenant_month_spent_cents || 0),
    maxJobCostCents: Number(row.max_job_cost_cents || 0),
    memberCount: Number(row.member_count || 0),
  };
}

module.exports = {
  TOOL_KEYS,
  MONTH_START,
  findUserByUid,
  findUserByEmail,
  isPlatformAdmin,
  requirePlatformAdmin,
  getMembership,
  requireActiveTenant,
  listMemberships,
  loadSession,
  getTenantById,
  getPublicTenantBySlug,
  assertToolEnabled,
  ensureTenantDefaults,
  recordAudit,
  mapMembership,
};
