'use strict';

const crypto = require('node:crypto');
const { AppError, isAppError } = require('./errors');
const { withTransaction } = require('./db');
const { requireUser } = require('./identity');
const {
  TOOL_KEYS,
  loadSession,
  listMemberships,
  getMembership,
  requireActiveTenant,
  requirePlatformAdmin,
  findUserByEmail,
  getPublicTenantBySlug,
  ensureTenantDefaults,
  assertToolEnabled,
  recordAudit,
  MONTH_START,
} = require('./authz');
const {
  mapJob,
  adjustWallet,
  settleJob,
  releaseJob,
} = require('./billing');
const { createProviderRegistry } = require('./providers/image');
const { createPlannerRegistry } = require('./providers/text');
const { planDocument } = require('./planning');
const { createPaymentService } = require('./payments');
const {
  listModels,
  mapModel,
  createImageJob,
  getJobForUser,
  markStaleJobs,
  ALLOWED_SIZES,
} = require('./jobs');
const v = require('./validation');

function createApp({ pool, config, providers = createProviderRegistry(config), planner = createPlannerRegistry(config), payments = createPaymentService(config), logger = console }) {
  async function queryOne(sql, params) {
    const { rows } = await pool.query(sql, params);
    return rows[0];
  }

  async function publicConfig() {
    return {
      payments: payments.status(),
      ai: providers.publicStatus(),
      planner: planner.publicStatus(),
      version: config.version,
      environment: config.appEnv,
    };
  }

  async function bootstrap(uid) {
    const session = await loadSession(pool, uid);
    return {
      user: { id: session.user.id, email: session.user.email },
      platformAdmin: session.platformAdmin,
      memberships: session.memberships,
      config: await publicConfig(),
    };
  }

  async function accountSummary(uid) {
    const session = await loadSession(pool, uid);
    const [usage, orders, ledger] = await Promise.all([
      pool.query(
        `select u.id, u.tenant_id, t.name as tenant_name, u.feature, u.model,
                u.quantity, u.amount_cents, u.created_at
         from public.usage_records u join public.tenants t on t.id = u.tenant_id
         where u.user_id = $1 order by u.created_at desc limit 20`,
        [uid]
      ),
      pool.query(
        `select o.id, o.tenant_id, t.name as tenant_name, o.amount_cents, o.currency,
                o.status, o.provider, o.created_at, o.paid_at
         from public.orders o join public.tenants t on t.id = o.tenant_id
         where o.user_id = $1 order by o.created_at desc limit 20`,
        [uid]
      ),
      pool.query(
        `select l.id, l.tenant_id, t.name as tenant_name, l.kind,
                l.available_delta_cents, l.reserved_delta_cents,
                l.available_after_cents, l.reserved_after_cents, l.created_at
         from public.wallet_ledger l join public.tenants t on t.id = l.tenant_id
         where l.user_id = $1 order by l.created_at desc limit 20`,
        [uid]
      ),
    ]);
    return {
      user: { id: session.user.id, email: session.user.email },
      platformAdmin: session.platformAdmin,
      memberships: session.memberships,
      usage: usage.rows.map(mapUsage),
      orders: orders.rows.map(mapOrder),
      ledger: ledger.rows.map(mapLedger),
      config: await publicConfig(),
    };
  }

  async function tenantDashboard(uid, tenantId) {
    const client = await pool.connect();
    try {
      const membership = await getMembership(client, uid, tenantId);
      const tenant = await queryOne('select * from public.tenants where id = $1', [tenantId]);
      const wallet = await queryOne('select * from public.wallets where tenant_id = $1', [tenantId]);
      const tools = await client.query(
        'select tool_key, enabled, updated_at from public.tool_configs where tenant_id = $1 order by tool_key',
        [tenantId]
      );
      const members = await client.query(
        `select m.user_id, m.role, m.monthly_ai_budget_cents, m.created_at, u.email
         from public.memberships m left join auth.users u on u.id = m.user_id
         where m.tenant_id = $1 order by m.role, m.created_at`,
        [tenantId]
      );
      const jobs = await client.query(
        `select * from public.ai_jobs
         where tenant_id = $1 ${membership.role === 'tenant_owner' ? '' : 'and user_id = $2'}
         order by created_at desc limit 12`,
        membership.role === 'tenant_owner' ? [tenantId] : [tenantId, uid]
      );
      const usage = await queryOne(
        `select
           coalesce((select sum(amount_cents)::bigint from public.usage_records
             where tenant_id = $1 and created_at >= ${MONTH_START}),0)::bigint as tenant_used,
           coalesce((select sum(amount_cents)::bigint from public.usage_records
             where tenant_id = $1 and user_id = $2 and created_at >= ${MONTH_START}),0)::bigint as user_used,
           coalesce((select sum(reserved_cents)::bigint from public.ai_jobs
             where tenant_id = $1 and status in ('processing','pending_reconciliation')),0)::bigint as tenant_held`,
        [tenantId, uid]
      );
      return {
        tenant: mapTenant(tenant),
        role: membership.role,
        membership: {
          userBudgetCents: Number(membership.user_budget_cents),
          userMonthSpentCents: Number(usage.user_used),
        },
        wallet: {
          availableCents: Number(wallet?.available_cents || 0),
          reservedCents: Number(wallet?.reserved_cents || 0),
          currency: wallet?.currency || 'CNY',
        },
        usage: {
          tenantMonthSpentCents: Number(usage.tenant_used),
          userMonthSpentCents: Number(usage.user_used),
          reservedCents: Number(usage.tenant_held),
        },
        tools: tools.rows.map((row) => ({
          key: row.tool_key,
          enabled: row.enabled,
          updatedAt: row.updated_at,
        })),
        members: members.rows.map((row) => ({
          userId: row.user_id,
          email: row.email || '',
          role: row.role,
          userBudgetCents: Number(row.monthly_ai_budget_cents),
          createdAt: row.created_at,
        })),
        jobs: jobs.rows.map((row) => mapJob(row, { includePrompt: true })),
        config: await publicConfig(),
      };
    } finally {
      client.release();
    }
  }

  async function listModelsForUser(uid, tenantId) {
    await getMembership(pool, uid, tenantId);
    const client = await pool.connect();
    try {
      return await listModels(client, providers, { includeDisabled: false });
    } finally {
      client.release();
    }
  }

  async function listUserJobs(uid, tenantId, limit) {
    const membership = await getMembership(pool, uid, tenantId);
    const { rows } = await pool.query(
      `select * from public.ai_jobs
       where tenant_id = $1 ${membership.role === 'tenant_owner' ? '' : 'and user_id = $2'}
       order by created_at desc limit $${membership.role === 'tenant_owner' ? 2 : 3}`,
      membership.role === 'tenant_owner' ? [tenantId, limit] : [tenantId, uid, limit]
    );
    return rows.map((row) => mapJob(row, { includePrompt: true }));
  }

  async function listOrders(uid, tenantId, limit) {
    const membership = await getMembership(pool, uid, tenantId);
    const { rows } = await pool.query(
      `select o.*, t.name as tenant_name from public.orders o
       join public.tenants t on t.id = o.tenant_id
       where o.tenant_id = $1 ${membership.role === 'tenant_owner' ? '' : 'and o.user_id = $2'}
       order by o.created_at desc limit $${membership.role === 'tenant_owner' ? 2 : 3}`,
      membership.role === 'tenant_owner' ? [tenantId, limit] : [tenantId, uid, limit]
    );
    return rows.map(mapOrder);
  }

  async function createOrder(uid, tenantId, amountCents) {
    await requireActiveTenant(pool, uid, tenantId);
    const status = payments.status();
    if (!status.enabled) {
      throw new AppError('payments_disabled', status.message, { status: 503 });
    }
    throw new AppError('payment_provider_not_configured', '支付渠道尚未配置', { status: 503 });
  }

  async function addMembership(uid, { tenantId, email, role, ownerScope }) {
    return withTransaction(pool, async (client) => {
      let membership = null;
      if (ownerScope) {
        membership = await getMembership(client, uid, tenantId, {
          forUpdate: true,
          ownerOnly: true,
        });
      } else {
        await requirePlatformAdmin(client, uid);
        const tenant = await client.query(
          'select id from public.tenants where id = $1 for update',
          [tenantId]
        );
        if (!tenant.rows[0]) throw new AppError('not_found', '租户不存在', { status: 404 });
      }
      if (ownerScope && role !== 'tenant_member') {
        throw new AppError('forbidden', '租户所有者只能添加普通成员', { status: 403 });
      }
      const target = await findUserByEmail(client, email);
      if (!target) {
        throw new AppError('user_not_found', '该邮箱尚未注册 CloudBase 账号', { status: 404 });
      }
      try {
        await client.query(
          `insert into public.memberships (tenant_id, user_id, role)
           values ($1,$2,$3)`,
          [tenantId, target.id, role]
        );
      } catch (error) {
        if (error.code === '23505') {
          throw new AppError('already_member', '该用户已经是租户成员', { status: 409 });
        }
        throw error;
      }
      await recordAudit(client, {
        actorUserId: uid,
        action: 'membership.add',
        targetType: 'tenant',
        targetId: tenantId,
        details: { userId: target.id, role },
      });
      return {
        userId: target.id,
        email: target.email,
        role,
        tenantId,
        actorRole: membership?.role || 'platform_admin',
      };
    });
  }

  async function removeMembership(uid, { tenantId, targetUserId, ownerScope }) {
    return withTransaction(pool, async (client) => {
      if (ownerScope) {
        await getMembership(client, uid, tenantId, { forUpdate: true, ownerOnly: true });
      } else {
        await requirePlatformAdmin(client, uid);
        const tenant = await client.query(
          'select id from public.tenants where id = $1 for update',
          [tenantId]
        );
        if (!tenant.rows[0]) throw new AppError('not_found', '租户不存在', { status: 404 });
      }
      const { rows } = await client.query(
        `select m.*, t.name as tenant_name
         from public.memberships m join public.tenants t on t.id = m.tenant_id
         where m.tenant_id = $1 and m.user_id = $2 for update of m`,
        [tenantId, targetUserId]
      );
      const target = rows[0];
      if (!target) throw new AppError('not_found', '成员不存在', { status: 404 });
      if (ownerScope && target.role !== 'tenant_member') {
        throw new AppError('forbidden', '租户所有者不能移除其他所有者', { status: 403 });
      }
      if (target.role === 'tenant_owner') {
        const owners = await client.query(
          `select count(*)::int as count from public.memberships
           where tenant_id = $1 and role = 'tenant_owner'`,
          [tenantId]
        );
        if (Number(owners.rows[0].count) <= 1) {
          throw new AppError('last_owner', '不能移除租户最后一位所有者', { status: 409 });
        }
      }
      await client.query('delete from public.memberships where tenant_id = $1 and user_id = $2', [
        tenantId,
        targetUserId,
      ]);
      await recordAudit(client, {
        actorUserId: uid,
        action: 'membership.remove',
        targetType: 'tenant',
        targetId: tenantId,
        details: { userId: targetUserId, role: target.role },
      });
      return { removed: true, userId: targetUserId };
    });
  }

  async function updateTool(uid, { tenantId, toolKey, enabled, ownerScope }) {
    if (!TOOL_KEYS.includes(toolKey)) {
      throw new AppError('validation_error', '未知工具', { status: 400 });
    }
    return withTransaction(pool, async (client) => {
      if (ownerScope) {
        await getMembership(client, uid, tenantId, { forUpdate: true, ownerOnly: true });
      } else {
        await requirePlatformAdmin(client, uid);
        const tenant = await client.query(
          'select id from public.tenants where id = $1 for update',
          [tenantId]
        );
        if (!tenant.rows[0]) throw new AppError('not_found', '租户不存在', { status: 404 });
      }
      await client.query(
        `insert into public.tool_configs (tenant_id, tool_key, enabled)
         values ($1,$2,$3)
         on conflict (tenant_id, tool_key) do update set enabled = excluded.enabled, updated_at = now()`,
        [tenantId, toolKey, enabled]
      );
      await recordAudit(client, {
        actorUserId: uid,
        action: 'tool.update',
        targetType: 'tenant',
        targetId: tenantId,
        details: { toolKey, enabled },
      });
      return { toolKey, enabled };
    });
  }

  async function adminOverview(uid) {
    await requirePlatformAdmin(pool, uid);
    await markStaleJobs(pool, { olderThanMinutes: 10 }).catch((error) => {
      logger.error?.('[paperlab] stale job scan failed', { code: error.code });
    });
    const [counts, tenants, models, jobs, orders, usage] = await Promise.all([
      queryOne(
        `select
           (select count(*)::int from public.tenants) as tenant_count,
           (select count(*)::int from public.memberships) as member_count,
           (select count(*)::int from public.platform_admins) as admin_count,
           (select count(*)::int from public.ai_jobs where status = 'pending_reconciliation') as pending_jobs,
           (select count(*)::int from public.orders where status = 'paid') as paid_orders,
           (select count(*)::int from public.model_prices where enabled) as enabled_models,
           (select coalesce(sum(available_cents + reserved_cents), 0)::bigint from public.wallets) as wallet_total,
           (select coalesce(sum(amount_cents), 0)::bigint from public.usage_records where created_at >= ${MONTH_START}) as month_usage`
      ),
      pool.query(
        `select t.*, w.available_cents, w.reserved_cents,
           (select count(*)::int from public.memberships m where m.tenant_id = t.id) as member_count,
           coalesce((select string_agg(coalesce(u.email, m.user_id), ', ')
             from public.memberships m left join auth.users u on u.id = m.user_id
             where m.tenant_id = t.id and m.role = 'tenant_owner'), '') as owners,
           coalesce((select sum(amount_cents)::bigint from public.usage_records u
             where u.tenant_id = t.id and u.created_at >= ${MONTH_START}), 0)::bigint as month_usage
         from public.tenants t left join public.wallets w on w.tenant_id = t.id
         order by t.created_at desc`
      ),
      pool.query('select * from public.model_prices order by enabled desc, unit_price_cents asc'),
      pool.query(
        `select j.*, t.name as tenant_name from public.ai_jobs j
         join public.tenants t on t.id = j.tenant_id
         order by j.created_at desc limit 30`
      ),
      pool.query(
        `select o.*, t.name as tenant_name from public.orders o
         join public.tenants t on t.id = o.tenant_id
         order by o.created_at desc limit 30`
      ),
      pool.query(
        `select u.*, t.name as tenant_name from public.usage_records u
         join public.tenants t on t.id = u.tenant_id
         order by u.created_at desc limit 30`
      ),
    ]);
    return {
      counts: {
        tenantCount: Number(counts.tenant_count),
        memberCount: Number(counts.member_count),
        adminCount: Number(counts.admin_count),
        pendingJobs: Number(counts.pending_jobs),
        paidOrders: Number(counts.paid_orders),
        enabledModels: Number(counts.enabled_models),
        walletTotalCents: Number(counts.wallet_total),
        monthUsageCents: Number(counts.month_usage),
      },
      tenants: tenants.rows.map(mapAdminTenant),
      models: models.rows.map((row) => mapModel(row, providers, { includeDisabled: true })),
      jobs: jobs.rows.map((row) => mapJob(row)),
      orders: orders.rows.map(mapOrder),
      usage: usage.rows.map(mapUsage),
      config: await publicConfig(),
    };
  }

  async function adminCreateTenant(uid, { name, slug, ownerEmail }) {
    return withTransaction(pool, async (client) => {
      const inserted = await client.query(
        'insert into public.tenants (name, slug) values ($1,$2) returning *',
        [name, slug]
      );
      const tenant = inserted.rows[0];
      await ensureTenantDefaults(client, tenant.id);
      let owner = null;
      if (ownerEmail) {
        owner = await findUserByEmail(client, ownerEmail);
        if (!owner) {
          throw new AppError('user_not_found', '所有者邮箱尚未注册 CloudBase 账号', { status: 404 });
        }
        await client.query(
          `insert into public.memberships (tenant_id, user_id, role)
           values ($1,$2,'tenant_owner')`,
          [tenant.id, owner.id]
        );
      }
      await recordAudit(client, {
        actorUserId: uid,
        action: 'tenant.create',
        targetType: 'tenant',
        targetId: tenant.id,
        details: { slug, name, ownerEmail: owner?.email || null },
      });
      return { tenant: mapTenant(tenant), owner: owner ? { id: owner.id, email: owner.email } : null };
    }).catch((error) => {
      if (error.code === '23505') {
        throw new AppError('slug_taken', '该租户 slug 已被使用', { status: 409 });
      }
      throw error;
    });
  }

  async function adminUpdateTenant(uid, payload) {
    return withTransaction(pool, async (client) => {
      const current = await client.query('select * from public.tenants where id = $1 for update', [
        payload.tenantId,
      ]);
      if (!current.rows[0]) throw new AppError('not_found', '租户不存在', { status: 404 });
      const updated = await client.query(
        `update public.tenants set
           name = coalesce($2, name),
           status = coalesce($3, status),
           monthly_ai_budget_cents = coalesce($4, monthly_ai_budget_cents),
           max_job_cost_cents = coalesce($5, max_job_cost_cents)
         where id = $1 returning *`,
        [payload.tenantId, payload.name ?? null, payload.status ?? null, payload.monthlyBudgetCents ?? null, payload.maxJobCostCents ?? null]
      );
      await recordAudit(client, {
        actorUserId: uid,
        action: 'tenant.update',
        targetType: 'tenant',
        targetId: payload.tenantId,
        details: {
          name: payload.name,
          status: payload.status,
          monthlyBudgetCents: payload.monthlyBudgetCents,
          maxJobCostCents: payload.maxJobCostCents,
        },
      });
      return { tenant: mapTenant(updated.rows[0]) };
    });
  }

  async function adminCreateModel(uid, payload) {
    return withTransaction(pool, async (client) => {
      try {
        const { rows } = await client.query(
          `insert into public.model_prices (
             provider, model, display_name, description, unit_price_cents, enabled,
             max_images, max_prompt_chars, monthly_budget_cents
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
          [
            payload.provider,
            payload.model,
            payload.displayName,
            payload.description,
            payload.unitPriceCents,
            payload.enabled,
            payload.maxImages,
            payload.maxPromptChars,
            payload.monthlyBudgetCents,
          ]
        );
        await recordAudit(client, {
          actorUserId: uid,
          action: 'model.create',
          targetType: 'model',
          targetId: rows[0].id,
          details: { provider: payload.provider, model: payload.model },
        });
        return { model: mapModel(rows[0], providers, { includeDisabled: true }) };
      } catch (error) {
        if (error.code === '23505') {
          throw new AppError('model_exists', '该供应商模型已存在', { status: 409 });
        }
        throw error;
      }
    });
  }

  async function adminUpdateModel(uid, payload) {
    return withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `update public.model_prices set
           display_name = coalesce($2, display_name),
           description = coalesce($3, description),
           unit_price_cents = coalesce($4, unit_price_cents),
           enabled = coalesce($5, enabled),
           max_images = coalesce($6, max_images),
           max_prompt_chars = coalesce($7, max_prompt_chars),
           monthly_budget_cents = coalesce($8, monthly_budget_cents)
         where id = $1 returning *`,
        [
          payload.modelId,
          payload.displayName ?? null,
          payload.description ?? null,
          payload.unitPriceCents ?? null,
          payload.enabled ?? null,
          payload.maxImages ?? null,
          payload.maxPromptChars ?? null,
          payload.monthlyBudgetCents ?? null,
        ]
      );
      if (!rows[0]) throw new AppError('not_found', '模型不存在', { status: 404 });
      await recordAudit(client, {
        actorUserId: uid,
        action: 'model.update',
        targetType: 'model',
        targetId: payload.modelId,
        details: {
          enabled: payload.enabled,
          unitPriceCents: payload.unitPriceCents,
          maxImages: payload.maxImages,
        },
      });
      return { model: mapModel(rows[0], providers, { includeDisabled: true }) };
    });
  }

  async function adminAdjustWallet(uid, payload) {
    const tenant = await queryOne('select id from public.tenants where id = $1', [payload.tenantId]);
    if (!tenant) throw new AppError('not_found', '租户不存在', { status: 404 });
    const result = await adjustWallet(pool, {
      tenantId: payload.tenantId,
      actorUserId: uid,
      amountCents: payload.amountCents,
      reason: payload.reason,
      requestId: payload.requestId,
    });
    const wallet = await queryOne('select * from public.wallets where tenant_id = $1', [
      payload.tenantId,
    ]);
    return {
      duplicate: result.duplicate,
      availableCents: Number(wallet.available_cents),
      reservedCents: Number(wallet.reserved_cents),
    };
  }

  async function adminListJobs(uid, { tenantId, status, limit }) {
    await requirePlatformAdmin(pool, uid);
    await markStaleJobs(pool, { olderThanMinutes: 10 }).catch(() => {});
    const params = [];
    const where = [];
    if (tenantId) {
      params.push(tenantId);
      where.push(`j.tenant_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`j.status = $${params.length}`);
    }
    params.push(limit);
    const { rows } = await pool.query(
      `select j.*, t.name as tenant_name from public.ai_jobs j
       join public.tenants t on t.id = j.tenant_id
       ${where.length ? `where ${where.join(' and ')}` : ''}
       order by j.created_at desc limit $${params.length}`,
      params
    );
    return rows.map((row) => mapJob(row));
  }

  async function adminReconcileJob(uid, { jobId, decision }) {
    await requirePlatformAdmin(pool, uid);
    const job = await queryOne('select * from public.ai_jobs where id = $1', [jobId]);
    if (!job) throw new AppError('not_found', '任务不存在', { status: 404 });
    if (job.status !== 'pending_reconciliation') {
      throw new AppError('job_not_pending', '只有待核对任务可以人工处理', { status: 409 });
    }
    const result =
      decision === 'settle'
        ? await settleJob(pool, jobId, { allowPending: true, status: 'settled' })
        : await releaseJob(pool, jobId, {
            code: 'manual_release',
            message: '管理员核对后释放',
            actorUserId: uid,
          });
    await withTransaction(pool, async (client) => {
      await recordAudit(client, {
        actorUserId: uid,
        action: `job.${decision}`,
        targetType: 'job',
        targetId: jobId,
        details: { previousStatus: job.status, reservedCents: Number(job.reserved_cents) },
      });
    });
    return { job: mapJob(result.job) };
  }

  async function handleAction(action, payload, uid) {
    switch (action) {
      case 'health': {
        await pool.query('select 1');
        return {
          ok: true,
          database: 'up',
          version: config.version,
          payments: payments.status(),
          ai: providers.publicStatus(),
          planner: planner.publicStatus(),
        };
      }
      case 'public.config':
        return publicConfig();
      case 'tenant.public': {
        const slug = v.slug(payload.slug);
        const tenant = await getPublicTenantBySlug(pool, slug);
        if (!tenant) throw new AppError('not_found', '租户不存在', { status: 404 });
        return tenant;
      }
      case 'session.bootstrap':
        return bootstrap(uid);
      case 'account.summary':
        return accountSummary(uid);
      case 'tenant.dashboard':
        return tenantDashboard(uid, v.uuid(payload.tenantId, 'tenantId'));
      case 'models.list':
        return listModelsForUser(uid, v.uuid(payload.tenantId, 'tenantId'));
      case 'ai.plan': {
        const tenantId = v.uuid(payload.tenantId, 'tenantId');
        await requireActiveTenant(pool, uid, tenantId);
        await assertToolEnabled(pool, tenantId, 'ai.plan');
        return planDocument({
          pool,
          config,
          planner,
          uid,
          tenantId,
          payload,
        });
      }
      case 'ai.generate': {
        const input = {
          tenantId: v.uuid(payload.tenantId, 'tenantId'),
          modelId: v.uuid(payload.modelId, 'modelId'),
          requestId: v.uuid(payload.requestId, 'requestId'),
          prompt: v.text(payload.prompt, 'prompt', { min: 3, max: 4000 }),
          count: v.integer(payload.count ?? 1, 'count', { min: 1, max: 4 }),
          size: payload.size ?? '1024x1024',
        };
        if (!ALLOWED_SIZES.has(input.size)) {
          throw new AppError('validation_error', '图片尺寸不受支持', { status: 400 });
        }
        return createImageJob({ pool, uid, input, config, providers });
      }
      case 'ai.jobs': {
        const tenantId = v.uuid(payload.tenantId, 'tenantId');
        return listUserJobs(uid, tenantId, v.integer(payload.limit ?? 20, 'limit', { min: 1, max: 50 }));
      }
      case 'ai.job':
        return getJobForUser({
          client: pool,
          uid,
          jobId: v.uuid(payload.jobId, 'jobId'),
          isAdmin: false,
        });
      case 'orders.list': {
        const tenantId = v.uuid(payload.tenantId, 'tenantId');
        return {
          orders: await listOrders(uid, tenantId, v.integer(payload.limit ?? 20, 'limit', { min: 1, max: 50 })),
          payments: payments.status(),
        };
      }
      case 'orders.create': {
        const tenantId = v.uuid(payload.tenantId, 'tenantId');
        const amountCents = v.integer(payload.amountCents, 'amountCents', { min: 100, max: 10_000_000 });
        return createOrder(uid, tenantId, amountCents);
      }
      case 'tenant.members.list': {
        const tenantId = v.uuid(payload.tenantId, 'tenantId');
        await getMembership(pool, uid, tenantId, { ownerOnly: true });
        const { rows } = await pool.query(
          `select m.user_id, m.role, m.monthly_ai_budget_cents, m.created_at, u.email
           from public.memberships m left join auth.users u on u.id = m.user_id
           where m.tenant_id = $1 order by m.role, m.created_at`,
          [tenantId]
        );
        return rows.map((row) => ({
          userId: row.user_id,
          email: row.email || '',
          role: row.role,
          userBudgetCents: Number(row.monthly_ai_budget_cents),
          createdAt: row.created_at,
        }));
      }
      case 'tenant.members.add': {
        const tenantId = v.uuid(payload.tenantId, 'tenantId');
        const email = v.email(payload.email);
        return addMembership(uid, {
          tenantId,
          email,
          role: 'tenant_member',
          ownerScope: true,
        });
      }
      case 'tenant.members.remove': {
        const tenantId = v.uuid(payload.tenantId, 'tenantId');
        const targetUserId = v.text(payload.userId, 'userId', { min: 1, max: 64 });
        return removeMembership(uid, { tenantId, targetUserId, ownerScope: true });
      }
      case 'tenant.tools.update': {
        const tenantId = v.uuid(payload.tenantId, 'tenantId');
        const toolKey = v.text(payload.toolKey, 'toolKey', { max: 64 });
        const enabled = v.boolean(payload.enabled, 'enabled');
        return updateTool(uid, { tenantId, toolKey, enabled, ownerScope: true });
      }
      case 'admin.overview':
        return adminOverview(uid);
      case 'admin.tenant.detail': {
        await requirePlatformAdmin(pool, uid);
        const tenantId = v.uuid(payload.tenantId, 'tenantId');
        const tenant = await queryOne('select * from public.tenants where id = $1', [tenantId]);
        if (!tenant) throw new AppError('not_found', '租户不存在', { status: 404 });
        const [wallet, members, tools, jobs, ledger] = await Promise.all([
          queryOne('select * from public.wallets where tenant_id = $1', [tenantId]),
          pool.query(
            `select m.user_id, m.role, m.monthly_ai_budget_cents, m.created_at, u.email
             from public.memberships m left join auth.users u on u.id = m.user_id
             where m.tenant_id = $1 order by m.role, m.created_at`,
            [tenantId]
          ),
          pool.query(
            'select tool_key, enabled, updated_at from public.tool_configs where tenant_id = $1 order by tool_key',
            [tenantId]
          ),
          pool.query(
            `select j.*, t.name as tenant_name from public.ai_jobs j
             join public.tenants t on t.id = j.tenant_id
             where j.tenant_id = $1 order by j.created_at desc limit 20`,
            [tenantId]
          ),
          pool.query(
            `select * from public.wallet_ledger where tenant_id = $1 order by created_at desc limit 20`,
            [tenantId]
          ),
        ]);
        return {
          tenant: mapAdminTenant({
            ...tenant,
            available_cents: wallet?.available_cents || 0,
            reserved_cents: wallet?.reserved_cents || 0,
            member_count: members.rows.length,
            owners: members.rows
              .filter((row) => row.role === 'tenant_owner')
              .map((row) => row.email || row.user_id)
              .join(', '),
          }),
          members: members.rows.map((row) => ({
            userId: row.user_id,
            email: row.email || '',
            role: row.role,
            userBudgetCents: Number(row.monthly_ai_budget_cents),
            createdAt: row.created_at,
          })),
          tools: tools.rows.map((row) => ({
            key: row.tool_key,
            enabled: row.enabled,
            updatedAt: row.updated_at,
          })),
          jobs: jobs.rows.map((row) => mapJob(row)),
          ledger: ledger.rows.map(mapLedger),
        };
      }
      case 'admin.tenants.create':
        return adminCreateTenant(uid, {
          name: v.text(payload.name, 'name', { max: 80 }),
          slug: v.slug(payload.slug),
          ownerEmail: payload.ownerEmail ? v.email(payload.ownerEmail) : '',
        });
      case 'admin.tenants.update': {
        await requirePlatformAdmin(pool, uid);
        const tenantId = v.uuid(payload.tenantId, 'tenantId');
        return adminUpdateTenant(uid, {
          tenantId,
          name: payload.name === undefined ? undefined : v.text(payload.name, 'name', { max: 80 }),
          status:
            payload.status === undefined
              ? undefined
              : v.oneOf(payload.status, 'status', ['active', 'suspended']),
          monthlyBudgetCents:
            payload.monthlyBudgetCents === undefined
              ? undefined
              : v.integer(payload.monthlyBudgetCents, 'monthlyBudgetCents', { min: 0 }),
          maxJobCostCents:
            payload.maxJobCostCents === undefined
              ? undefined
              : v.integer(payload.maxJobCostCents, 'maxJobCostCents', { min: 0 }),
        });
      }
      case 'admin.members.add': {
        await requirePlatformAdmin(pool, uid);
        const tenantId = v.uuid(payload.tenantId, 'tenantId');
        const email = v.email(payload.email);
        const role = v.oneOf(payload.role ?? 'tenant_member', 'role', [
          'tenant_owner',
          'tenant_member',
        ]);
        return addMembership(uid, { tenantId, email, role, ownerScope: false });
      }
      case 'admin.members.remove': {
        await requirePlatformAdmin(pool, uid);
        const tenantId = v.uuid(payload.tenantId, 'tenantId');
        const targetUserId = v.text(payload.userId, 'userId', { min: 1, max: 64 });
        return removeMembership(uid, { tenantId, targetUserId, ownerScope: false });
      }
      case 'admin.tools.update': {
        await requirePlatformAdmin(pool, uid);
        const tenantId = v.uuid(payload.tenantId, 'tenantId');
        const toolKey = v.text(payload.toolKey, 'toolKey', { max: 64 });
        return updateTool(uid, {
          tenantId,
          toolKey,
          enabled: v.boolean(payload.enabled, 'enabled'),
          ownerScope: false,
        });
      }
      case 'admin.models.create': {
        await requirePlatformAdmin(pool, uid);
        return adminCreateModel(uid, {
          provider: v.text(payload.provider, 'provider', { max: 32 }).toLowerCase(),
          model: v.text(payload.model, 'model', { max: 120 }),
          displayName: v.text(payload.displayName, 'displayName', { max: 120 }),
          description: v.optionalText(payload.description, 'description', { max: 500 }),
          unitPriceCents: v.integer(payload.unitPriceCents, 'unitPriceCents', { min: 0 }),
          enabled: payload.enabled === undefined ? false : v.boolean(payload.enabled, 'enabled'),
          maxImages: v.integer(payload.maxImages ?? 1, 'maxImages', { min: 1, max: 4 }),
          maxPromptChars: v.integer(payload.maxPromptChars ?? 1000, 'maxPromptChars', {
            min: 1,
            max: 4000,
          }),
          monthlyBudgetCents: v.integer(
            payload.monthlyBudgetCents ?? 10000,
            'monthlyBudgetCents',
            { min: 0 }
          ),
        });
      }
      case 'admin.models.update': {
        await requirePlatformAdmin(pool, uid);
        const payload2 = {
          modelId: v.uuid(payload.modelId, 'modelId'),
          displayName:
            payload.displayName === undefined
              ? undefined
              : v.text(payload.displayName, 'displayName', { max: 120 }),
          description:
            payload.description === undefined
              ? undefined
              : v.optionalText(payload.description, 'description', { max: 500 }),
          unitPriceCents:
            payload.unitPriceCents === undefined
              ? undefined
              : v.integer(payload.unitPriceCents, 'unitPriceCents', { min: 0 }),
          enabled:
            payload.enabled === undefined ? undefined : v.boolean(payload.enabled, 'enabled'),
          maxImages:
            payload.maxImages === undefined
              ? undefined
              : v.integer(payload.maxImages, 'maxImages', { min: 1, max: 4 }),
          maxPromptChars:
            payload.maxPromptChars === undefined
              ? undefined
              : v.integer(payload.maxPromptChars, 'maxPromptChars', { min: 1, max: 4000 }),
          monthlyBudgetCents:
            payload.monthlyBudgetCents === undefined
              ? undefined
              : v.integer(payload.monthlyBudgetCents, 'monthlyBudgetCents', { min: 0 }),
        };
        if (Object.values(payload2).every((value) => value === undefined)) {
          throw new AppError('validation_error', '没有可更新的字段', { status: 400 });
        }
        return adminUpdateModel(uid, payload2);
      }
      case 'admin.wallet.adjust': {
        await requirePlatformAdmin(pool, uid);
        return adminAdjustWallet(uid, {
          tenantId: v.uuid(payload.tenantId, 'tenantId'),
          amountCents: v.integer(payload.amountCents, 'amountCents', {
            min: -10_000_000,
            max: 10_000_000,
          }),
          reason: v.text(payload.reason, 'reason', { min: 3, max: 200 }),
          requestId: v.uuid(payload.requestId, 'requestId'),
        });
      }
      case 'admin.usage.list': {
        await requirePlatformAdmin(pool, uid);
        const params = [];
        let where = '';
        if (payload.tenantId) {
          params.push(v.uuid(payload.tenantId, 'tenantId'));
          where = 'where u.tenant_id = $1';
        }
        params.push(v.integer(payload.limit ?? 50, 'limit', { min: 1, max: 100 }));
        const { rows } = await pool.query(
          `select u.*, t.name as tenant_name from public.usage_records u
           join public.tenants t on t.id = u.tenant_id
           ${where} order by u.created_at desc limit $${params.length}`,
          params
        );
        return rows.map(mapUsage);
      }
      case 'admin.orders.list': {
        await requirePlatformAdmin(pool, uid);
        const { rows } = await pool.query(
          `select o.*, t.name as tenant_name from public.orders o
           join public.tenants t on t.id = o.tenant_id
           order by o.created_at desc limit $1`,
          [v.integer(payload.limit ?? 50, 'limit', { min: 1, max: 100 })]
        );
        return { orders: rows.map(mapOrder), payments: payments.status() };
      }
      case 'admin.jobs.list': {
        const tenantId = payload.tenantId ? v.uuid(payload.tenantId, 'tenantId') : undefined;
        const status = payload.status
          ? v.oneOf(payload.status, 'status', [
              'processing',
              'pending_reconciliation',
              'succeeded',
              'settled',
              'failed',
            ])
          : undefined;
        return adminListJobs(uid, {
          tenantId,
          status,
          limit: v.integer(payload.limit ?? 50, 'limit', { min: 1, max: 100 }),
        });
      }
      case 'admin.jobs.reconcile': {
        const jobId = v.uuid(payload.jobId, 'jobId');
        const decision = v.oneOf(payload.decision, 'decision', ['settle', 'release']);
        return adminReconcileJob(uid, { jobId, decision });
      }
      default:
        throw new AppError('unknown_action', '未知操作', { status: 404 });
    }
  }

  async function handle(event, context = {}) {
    const requestId = context.requestId || crypto.randomUUID();
    let action = '';
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new AppError('validation_error', '请求格式不正确', { status: 400 });
      }
      if (typeof event.action !== 'string' || event.action.length > 64) {
        throw new AppError('validation_error', '缺少 action', { status: 400 });
      }
      action = event.action;
      const payload = event.payload ?? {};
      v.object(payload, 'payload');
      if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 64 * 1024) {
        throw new AppError('payload_too_large', '请求内容过大', { status: 413 });
      }

      const publicActions = new Set(['health', 'public.config', 'tenant.public']);
      let uid = null;
      if (!publicActions.has(action)) {
        uid = requireUser(context.identity);
      }
      const data = await handleAction(action, payload, uid);
      if (data?.ok === true) return { requestId, ...data };
      return { ok: true, data, requestId };
    } catch (error) {
      const known = isAppError(error);
      const status = known ? error.status : 500;
      const code = known ? error.code : 'internal_error';
      logger.error?.('[paperlab] api error', {
        requestId,
        action,
        code,
        status,
        name: error?.name,
      });
      return {
        ok: false,
        error: {
          code,
          message: known ? error.message : '服务暂时不可用，请稍后重试',
          ...(known && error.details ? { details: error.details } : {}),
        },
        requestId,
      };
    }
  }

  return { handle };
}

function mapTenant(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    monthlyAiBudgetCents: Number(row.monthly_ai_budget_cents),
    maxJobCostCents: Number(row.max_job_cost_cents),
    createdAt: row.created_at,
  };
}

function mapAdminTenant(row) {
  return {
    ...mapTenant(row),
    availableCents: Number(row.available_cents || 0),
    reservedCents: Number(row.reserved_cents || 0),
    memberCount: Number(row.member_count || 0),
    owners: row.owners || '',
    monthUsageCents: Number(row.month_usage || 0),
  };
}

function mapOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name || null,
    userId: row.user_id || null,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    status: row.status,
    provider: row.provider,
    providerOrderId: row.provider_order_id || null,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

function mapUsage(row) {
  return {
    id: String(row.id),
    tenantId: row.tenant_id,
    tenantName: row.tenant_name || null,
    userId: row.user_id,
    feature: row.feature,
    provider: row.provider,
    model: row.model,
    quantity: row.quantity,
    unitPriceCents: Number(row.unit_price_cents),
    amountCents: Number(row.amount_cents),
    createdAt: row.created_at,
  };
}

function mapLedger(row) {
  return {
    id: String(row.id),
    tenantId: row.tenant_id,
    tenantName: row.tenant_name || null,
    kind: row.kind,
    availableDeltaCents: Number(row.available_delta_cents),
    reservedDeltaCents: Number(row.reserved_delta_cents),
    availableAfterCents: Number(row.available_after_cents),
    reservedAfterCents: Number(row.reserved_after_cents),
    createdAt: row.created_at,
  };
}

module.exports = { createApp, mapTenant, mapOrder, mapUsage };
