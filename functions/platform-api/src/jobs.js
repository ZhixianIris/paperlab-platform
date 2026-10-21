'use strict';

const { AppError } = require('./errors');
const { withTransaction } = require('./db');
const {
  requireActiveTenant,
  assertToolEnabled,
} = require('./authz');
const {
  reserveJob,
  settleJob,
  holdJob,
  releaseJob,
  mapJob,
  requestFingerprint,
} = require('./billing');
const { ProviderError } = require('./providers/image');

const ALLOWED_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536', 'auto']);

function mapModel(row, providers, { includeDisabled = false } = {}) {
  const status = providers.status(row.provider);
  const available = row.enabled && status.configured;
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    displayName: row.display_name,
    description: row.description,
    unitPriceCents: Number(row.unit_price_cents),
    currency: row.currency,
    enabled: row.enabled,
    maxImages: Number(row.max_images),
    maxPromptChars: Number(row.max_prompt_chars),
    monthlyBudgetCents: Number(row.monthly_budget_cents),
    providerConfigured: status.configured,
    available,
    unavailableReason: !row.enabled
      ? 'model_disabled'
      : !status.configured
        ? 'provider_not_configured'
        : null,
    ...(includeDisabled ? {} : {}),
  };
}

async function listModels(client, providers, { includeDisabled = false } = {}) {
  const { rows } = await client.query(
    `select * from public.model_prices
     ${includeDisabled ? '' : 'where enabled = true'}
     order by enabled desc, unit_price_cents asc, display_name asc`
  );
  return rows.map((row) => mapModel(row, providers, { includeDisabled }));
}

async function createImageJob({ pool, uid, input, config, providers }) {
  const size = input.size || '1024x1024';
  if (!ALLOWED_SIZES.has(size)) {
    throw new AppError('validation_error', '图片尺寸不受支持', { status: 400 });
  }

  let reserved;
  try {
    reserved = await withTransaction(pool, async (client) => {
      const membership = await requireActiveTenant(client, uid, input.tenantId, {
        lock: true,
      });
      await assertToolEnabled(client, input.tenantId, 'ai.image.generate');
      const { rows } = await client.query(
        'select * from public.model_prices where id = $1 and currency = $2',
        [input.modelId, 'CNY']
      );
      const model = rows[0];
      if (!model) throw new AppError('model_not_found', '模型不存在', { status: 404 });
      if (!model.enabled) {
        throw new AppError('model_disabled', '该模型已被管理员停用', { status: 403 });
      }
      if (input.prompt.length > model.max_prompt_chars) {
        throw new AppError(
          'prompt_too_long',
          `提示词不能超过 ${model.max_prompt_chars} 个字符`,
          { status: 400 }
        );
      }
      if (input.count > model.max_images) {
        throw new AppError('max_images_exceeded', `该模型单次最多 ${model.max_images} 张`, {
          status: 400,
        });
      }
      const provider = providers.get(model.provider);
      void provider;

      const fingerprint = requestFingerprint({
        feature: 'image.generate',
        modelId: model.id,
        prompt: input.prompt,
        count: input.count,
        size,
      });
      const response = await reserveJob(client, {
        tenantId: input.tenantId,
        userId: uid,
        membership,
        model,
        requestId: input.requestId,
        fingerprint,
        prompt: input.prompt,
        requestParams: { size, count: input.count },
        count: input.count,
        rateLimits: {
          user: config.ai.userRatePerMinute,
          tenant: config.ai.tenantRatePerMinute,
        },
      });
      return { ...response, model };
    });
  } catch (error) {
    if (error?.code === '23505') {
      // Two retries of the same request id raced. The losing transaction was
      // fully rolled back; return the winner without charging twice.
      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          'select * from public.ai_jobs where tenant_id = $1 and request_id = $2',
          [input.tenantId, input.requestId]
        );
        if (rows[0]) {
          return finishExistingJob(rows[0]);
        }
      } finally {
        client.release();
      }
    }
    throw error;
  }

  if (reserved.existing) return finishExistingJob(reserved.job);
  return processJob({ pool, job: reserved.job, config, providers });
}

function finishExistingJob(job) {
  const data = mapJob(job, { includePrompt: true, includeResult: true });
  if (job.status === 'failed') {
    return {
      job: data,
      error: {
        code: job.error_code || 'provider_failed',
        message: job.error_message || '任务失败',
      },
    };
  }
  if (job.status === 'pending_reconciliation') {
    return {
      job: data,
      error: {
        code: 'pending_reconciliation',
        message: '供应商结果待核对，额度暂时保留',
      },
    };
  }
  return { job: data, error: null };
}

async function processJob({ pool, job, config, providers }) {
  const adapter = providers.get(job.provider);
  let result;
  try {
    result = await adapter.generate({
      model: job.model,
      prompt: job.prompt,
      count: job.usage_quantity,
      size: (job.params && job.params.size) || '1024x1024',
    });
  } catch (error) {
    const providerError =
      error instanceof ProviderError
        ? error
        : new ProviderError('Unknown provider failure', {
            definiteFailure: false,
            code: 'provider_unknown_error',
          });
    if (providerError.definiteFailure) {
      const released = await releaseJob(pool, job.id, {
        code: providerError.code,
        message: '上游模型拒绝了请求，未产生费用',
      }).catch((releaseError) => {
        console.error('[paperlab] release failed', { jobId: job.id, code: releaseError.code });
        return null;
      });
      return {
        job: mapJob(released?.job || job, { includePrompt: true }),
        error: { code: 'provider_failed', message: '上游模型拒绝了请求，未产生费用' },
      };
    }
    const held = await holdJob(pool, job.id, {
      code: providerError.code,
      message: '供应商响应不确定',
    }).catch((holdError) => {
      console.error('[paperlab] hold failed', { jobId: job.id, code: holdError.code });
      return null;
    });
    return {
      job: mapJob(held?.job || job, { includePrompt: true }),
      error: {
        code: 'pending_reconciliation',
        message: '供应商响应不确定，额度已保留，等待管理员核对',
      },
    };
  }

  const payload = {
    images: (result.images || []).slice(0, job.usage_quantity),
    revisedPrompt: result.revisedPrompt || null,
    provider: job.provider,
    model: job.model,
  };
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > config.ai.resultMaxBytes) {
    const held = await holdJob(pool, job.id, {
      code: 'result_too_large',
      message: '结果超过返回大小上限',
    });
    return {
      job: mapJob(held.job, { includePrompt: true }),
      error: {
        code: 'result_too_large',
        message: '图片已生成，但超过当前返回大小上限，额度保留待人工处理',
      },
    };
  }

  try {
    const settled = await settleJob(pool, job.id, {
      providerRequestId: result.providerRequestId || null,
      result: payload,
    });
    const data = mapJob(settled.job, { includePrompt: true, includeResult: true });
    return { job: data, error: null };
  } catch (error) {
    console.error('[paperlab] settle failed', { jobId: job.id, code: error.code });
    await holdJob(pool, job.id, {
      code: 'settlement_failed',
      message: '结算失败，等待核对',
    }).catch(() => {});
    throw new AppError('settlement_failed', '结算暂时失败，额度已保留，请稍后刷新', {
      status: 500,
    });
  }
}

async function getJobForUser({ client, uid, jobId, isAdmin }) {
  const { rows } = await client.query(
    `select j.*, m.role
     from public.ai_jobs j
     left join public.memberships m on m.tenant_id = j.tenant_id and m.user_id = $2
     where j.id = $1`,
    [jobId, uid]
  );
  const job = rows[0];
  if (!job) throw new AppError('not_found', '任务不存在', { status: 404 });
  if (!isAdmin && job.user_id !== uid && job.role !== 'tenant_owner') {
    throw new AppError('forbidden', '无权查看该任务', { status: 403 });
  }
  return mapJob(job, { includePrompt: true, includeResult: true });
}

async function markStaleJobs(pool, { olderThanMinutes = 10 } = {}) {
  const client = await pool.connect();
  let rows;
  try {
    const result = await client.query(
      `select id from public.ai_jobs
       where status = 'processing' and updated_at < now() - ($1 || ' minutes')::interval
       limit 50`,
      [String(olderThanMinutes)]
    );
    rows = result.rows;
  } finally {
    client.release();
  }
  let marked = 0;
  for (const row of rows) {
    const result = await holdJob(pool, row.id, {
      code: 'worker_timeout',
      message: '任务超时未完成',
    });
    if (!result.duplicate) marked += 1;
  }
  return marked;
}

module.exports = {
  ALLOWED_SIZES,
  listModels,
  mapModel,
  createImageJob,
  getJobForUser,
  markStaleJobs,
};
