'use strict';

const crypto = require('node:crypto');
const { AppError } = require('./errors');
const { withTransaction } = require('./db');
const { MONTH_START, recordAudit } = require('./authz');

function mapJob(row, { includePrompt = false, includeResult = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    requestId: row.request_id,
    status: row.status,
    feature: row.feature,
    provider: row.provider,
    model: row.model,
    modelPriceId: row.model_price_id,
    ...(includePrompt ? { prompt: row.prompt } : {}),
    params: row.params || {},
    reservedCents: Number(row.reserved_cents || 0),
    settledCents: Number(row.settled_cents || 0),
    usageQuantity: Number(row.usage_quantity || 0),
    providerRequestId: row.provider_request_id || null,
    ...(includeResult ? { result: row.result || null } : {}),
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

async function findJobByRequest(client, tenantId, requestId) {
  const { rows } = await client.query(
    'select * from public.ai_jobs where tenant_id = $1 and request_id = $2',
    [tenantId, requestId]
  );
  return rows[0] || null;
}

async function budgetSnapshot(client, { tenantId, userId, provider, model, costCents }) {
  const { rows } = await client.query(
    `select
       coalesce((select sum(amount_cents)::bigint from public.usage_records
                 where tenant_id = $1 and created_at >= ${MONTH_START}), 0)::bigint as tenant_used,
       coalesce((select sum(reserved_cents)::bigint from public.ai_jobs
                 where tenant_id = $1 and status in ('processing', 'pending_reconciliation')), 0)::bigint as tenant_held,
       coalesce((select sum(amount_cents)::bigint from public.usage_records
                 where tenant_id = $1 and user_id = $2 and created_at >= ${MONTH_START}), 0)::bigint as user_used,
       coalesce((select sum(reserved_cents)::bigint from public.ai_jobs
                 where tenant_id = $1 and user_id = $2 and status in ('processing', 'pending_reconciliation')), 0)::bigint as user_held,
       coalesce((select sum(amount_cents)::bigint from public.usage_records
                 where provider = $3 and model = $4 and created_at >= ${MONTH_START}), 0)::bigint as model_used,
       coalesce((select sum(reserved_cents)::bigint from public.ai_jobs
                 where provider = $3 and model = $4 and status in ('processing', 'pending_reconciliation')), 0)::bigint as model_held,
       coalesce((select count(*)::int from public.ai_jobs
                 where tenant_id = $1 and created_at > now() - interval '1 minute'), 0)::int as tenant_recent,
       coalesce((select count(*)::int from public.ai_jobs
                 where tenant_id = $1 and user_id = $2 and created_at > now() - interval '1 minute'), 0)::int as user_recent,
       $5::bigint as cost`,
    [tenantId, userId, provider, model, costCents]
  );
  const row = rows[0];
  return {
    tenantUsed: Number(row.tenant_used),
    tenantHeld: Number(row.tenant_held),
    userUsed: Number(row.user_used),
    userHeld: Number(row.user_held),
    modelUsed: Number(row.model_used),
    modelHeld: Number(row.model_held),
    tenantRecent: Number(row.tenant_recent),
    userRecent: Number(row.user_recent),
    cost: Number(row.cost),
  };
}

/**
 * Caller owns the transaction and must already hold the tenant/membership locks.
 * Returns `{ job, existing }`; only a newly-created job may invoke the provider.
 */
async function reserveJob(client, params) {
  const {
    tenantId,
    userId,
    membership,
    model,
    requestId,
    fingerprint,
    prompt,
    requestParams,
    count,
    rateLimits,
  } = params;

  const existing = await findJobByRequest(client, tenantId, requestId);
  if (existing) {
    if (existing.user_id !== userId || existing.request_fingerprint !== fingerprint) {
      throw new AppError('idempotency_conflict', '该请求 ID 已用于另一个请求', { status: 409 });
    }
    return { job: existing, existing: true };
  }

  const cost = Number(model.unit_price_cents) * count;
  if (cost > Number(membership.max_job_cost_cents)) {
    throw new AppError('job_cost_limit_exceeded', '本次请求金额超过租户单次上限', { status: 402 });
  }

  const snapshot = await budgetSnapshot(client, {
    tenantId,
    userId,
    provider: model.provider,
    model: model.model,
    costCents: cost,
  });

  if (snapshot.tenantUsed + snapshot.tenantHeld + cost > Number(membership.tenant_budget_cents)) {
    throw new AppError('tenant_budget_exceeded', '租户本月 AI 预算不足', { status: 402 });
  }
  if (snapshot.userUsed + snapshot.userHeld + cost > Number(membership.user_budget_cents)) {
    throw new AppError('user_budget_exceeded', '你的本月 AI 预算不足', { status: 402 });
  }
  if (
    snapshot.modelUsed + snapshot.modelHeld + cost >
    Number(model.monthly_budget_cents)
  ) {
    throw new AppError('model_budget_exceeded', '该模型本月平台成本额度已用完', { status: 402 });
  }
  if (snapshot.tenantRecent >= rateLimits.tenant) {
    throw new AppError('rate_limited', '租户请求过于频繁，请稍后再试', { status: 429 });
  }
  if (snapshot.userRecent >= rateLimits.user) {
    throw new AppError('rate_limited', '请求过于频繁，请稍后再试', { status: 429 });
  }

  const wallet = await client.query(
    `update public.wallets
       set available_cents = available_cents - $2,
           reserved_cents = reserved_cents + $2,
           updated_at = now()
     where tenant_id = $1 and available_cents >= $2
     returning available_cents, reserved_cents`,
    [tenantId, cost]
  );
  if (!wallet.rows[0]) {
    throw new AppError('insufficient_balance', '余额不足，请先充值或联系管理员', { status: 402 });
  }

  const inserted = await client.query(
    `insert into public.ai_jobs (
       tenant_id, user_id, request_id, request_fingerprint, feature, provider, model,
       model_price_id, prompt, params, status, reserved_cents, usage_quantity
     ) values ($1,$2,$3,$4,'image.generate',$5,$6,$7,$8,$9::jsonb,'processing',$10,$11)
     returning *`,
    [
      tenantId,
      userId,
      requestId,
      fingerprint,
      model.provider,
      model.model,
      model.id,
      prompt,
      JSON.stringify(requestParams),
      cost,
      count,
    ]
  );
  const job = inserted.rows[0];
  await client.query(
    `insert into public.wallet_ledger (
       tenant_id, user_id, job_id, kind, available_delta_cents, reserved_delta_cents,
       available_after_cents, reserved_after_cents, idempotency_key, metadata
     ) values ($1,$2,$3,'reserve',$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      tenantId,
      userId,
      job.id,
      -cost,
      cost,
      wallet.rows[0].available_cents,
      wallet.rows[0].reserved_cents,
      `job:${job.id}:reserve`,
      JSON.stringify({ model: model.model, quantity: count }),
    ]
  );
  return { job, existing: false };
}

async function settleJob(pool, jobId, { providerRequestId = null, result = null, allowPending = false, status = 'succeeded' } = {}) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query('select * from public.ai_jobs where id = $1 for update', [jobId]);
    const job = rows[0];
    if (!job) throw new AppError('not_found', '任务不存在', { status: 404 });
    if (!['processing', 'pending_reconciliation'].includes(job.status) || (!allowPending && job.status !== 'processing')) {
      if (['succeeded', 'settled', 'failed'].includes(job.status)) return { job, duplicate: true };
      throw new AppError('job_not_settleable', '任务当前状态不可结算', { status: 409 });
    }
    const cost = Number(job.reserved_cents);
    const wallet = await client.query(
      `update public.wallets
         set reserved_cents = reserved_cents - $2, updated_at = now()
       where tenant_id = $1 and reserved_cents >= $2
       returning available_cents, reserved_cents`,
      [job.tenant_id, cost]
    );
    if (!wallet.rows[0]) throw new Error('wallet reservation invariant violated');

    const updated = await client.query(
      `update public.ai_jobs
         set status = $2, settled_cents = reserved_cents, provider_request_id = $3,
             result = $4::jsonb, error_code = null, error_message = null, completed_at = now()
       where id = $1
       returning *`,
      [job.id, status, providerRequestId, result === null ? null : JSON.stringify(result)]
    );
    await client.query(
      `insert into public.usage_records (
         tenant_id, user_id, job_id, feature, provider, model, quantity,
         unit_price_cents, amount_cents
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (job_id) do nothing`,
      [
        job.tenant_id,
        job.user_id,
        job.id,
        job.feature,
        job.provider,
        job.model,
        job.usage_quantity,
        job.usage_quantity > 0 ? Math.floor(cost / job.usage_quantity) : 0,
        cost,
      ]
    );
    await client.query(
      `insert into public.wallet_ledger (
         tenant_id, user_id, job_id, kind, available_delta_cents, reserved_delta_cents,
         available_after_cents, reserved_after_cents, idempotency_key, metadata
       ) values ($1,$2,$3,'settle',0,$4,$5,$6,$7,$8::jsonb)`,
      [
        job.tenant_id,
        job.user_id,
        job.id,
        -cost,
        wallet.rows[0].available_cents,
        wallet.rows[0].reserved_cents,
        `job:${job.id}:settle`,
        JSON.stringify({ status }),
      ]
    );
    return { job: updated.rows[0], duplicate: false };
  });
}

async function holdJob(pool, jobId, { code, message }) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query('select * from public.ai_jobs where id = $1 for update', [jobId]);
    const job = rows[0];
    if (!job) throw new AppError('not_found', '任务不存在', { status: 404 });
    if (job.status === 'pending_reconciliation') return { job, duplicate: true };
    if (job.status !== 'processing') return { job, duplicate: true };
    const updated = await client.query(
      `update public.ai_jobs
         set status = 'pending_reconciliation', error_code = $2, error_message = $3
       where id = $1 returning *`,
      [job.id, code, message.slice(0, 500)]
    );
    await client.query(
      `insert into public.wallet_ledger (
         tenant_id, user_id, job_id, kind, available_delta_cents, reserved_delta_cents,
         available_after_cents, reserved_after_cents, idempotency_key, metadata
       )
       select $1,$2,$3,'reconcile_hold',0,0,w.available_cents,w.reserved_cents,$4,$5::jsonb
       from public.wallets w where w.tenant_id = $1
       on conflict (idempotency_key) do nothing`,
      [
        job.tenant_id,
        job.user_id,
        job.id,
        `job:${job.id}:hold`,
        JSON.stringify({ code }),
      ]
    );
    return { job: updated.rows[0], duplicate: false };
  });
}

async function releaseJob(pool, jobId, { code = 'provider_failed', message = '供应商调用失败', actorUserId = null } = {}) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query('select * from public.ai_jobs where id = $1 for update', [jobId]);
    const job = rows[0];
    if (!job) throw new AppError('not_found', '任务不存在', { status: 404 });
    if (job.status === 'failed') return { job, duplicate: true };
    if (!['processing', 'pending_reconciliation'].includes(job.status)) {
      throw new AppError('job_not_releasable', '该任务已结算，不能释放预占', { status: 409 });
    }
    const cost = Number(job.reserved_cents);
    const wallet = await client.query(
      `update public.wallets
         set available_cents = available_cents + $2,
             reserved_cents = reserved_cents - $2,
             updated_at = now()
       where tenant_id = $1 and reserved_cents >= $2
       returning available_cents, reserved_cents`,
      [job.tenant_id, cost]
    );
    if (!wallet.rows[0]) throw new Error('wallet reservation invariant violated');
    const updated = await client.query(
      `update public.ai_jobs
         set status = 'failed', error_code = $2, error_message = $3, completed_at = now()
       where id = $1 returning *`,
      [job.id, code, String(message || '').slice(0, 500)]
    );
    await client.query(
      `insert into public.wallet_ledger (
         tenant_id, user_id, job_id, kind, available_delta_cents, reserved_delta_cents,
         available_after_cents, reserved_after_cents, idempotency_key, metadata
       ) values ($1,$2,$3,'release',$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        job.tenant_id,
        job.user_id,
        job.id,
        cost,
        -cost,
        wallet.rows[0].available_cents,
        wallet.rows[0].reserved_cents,
        `job:${job.id}:release`,
        JSON.stringify({ code, actorUserId }),
      ]
    );
    return { job: updated.rows[0], duplicate: false };
  });
}

async function adjustWallet(pool, { tenantId, actorUserId, amountCents, reason, requestId }) {
  return withTransaction(pool, async (client) => {
    const idempotencyKey = `adjust:${requestId}`;
    const existing = await client.query(
      'select * from public.wallet_ledger where idempotency_key = $1',
      [idempotencyKey]
    );
    if (existing.rows[0]) {
      return { duplicate: true, ledger: existing.rows[0] };
    }
    const wallet = await client.query(
      `update public.wallets
         set available_cents = available_cents + $2, updated_at = now()
       where tenant_id = $1 and available_cents + $2 >= 0
       returning available_cents, reserved_cents`,
      [tenantId, amountCents]
    );
    if (!wallet.rows[0]) {
      throw new AppError('insufficient_balance', '调整后余额不能为负', { status: 402 });
    }
    const ledger = await client.query(
      `insert into public.wallet_ledger (
         tenant_id, user_id, kind, available_delta_cents, reserved_delta_cents,
         available_after_cents, reserved_after_cents, idempotency_key, metadata
       ) values ($1,$2,'adjustment',$3,0,$4,$5,$6,$7::jsonb)
       returning *`,
      [
        tenantId,
        actorUserId,
        amountCents,
        wallet.rows[0].available_cents,
        wallet.rows[0].reserved_cents,
        idempotencyKey,
        JSON.stringify({ reason }),
      ]
    );
    await recordAudit(client, {
      actorUserId,
      action: 'wallet.adjust',
      targetType: 'tenant',
      targetId: tenantId,
      details: { amountCents, reason },
    });
    return { duplicate: false, ledger: ledger.rows[0] };
  });
}

function requestFingerprint({ feature, modelId, prompt, count, size }) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ feature, modelId, prompt, count, size }))
    .digest('hex');
}

module.exports = {
  mapJob,
  findJobByRequest,
  reserveJob,
  settleJob,
  holdJob,
  releaseJob,
  adjustWallet,
  requestFingerprint,
};
