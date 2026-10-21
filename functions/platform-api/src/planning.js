'use strict';

const crypto = require('node:crypto');
const { AppError } = require('./errors');
const { TOOL_KEYS } = require('./authz');
const { PlannerProviderError } = require('./providers/text');

const LOCAL_TOOL_KEYS = Object.freeze(TOOL_KEYS.filter((key) => !key.startsWith('ai.')));

const ALLOWED_ARGS = Object.freeze({
  'pdf.merge': [],
  'pdf.split': ['range'],
  'pdf.rotate': ['angle', 'allPages', 'range'],
  'pdf.delete': ['range'],
  'pdf.organize': ['order'],
  'pdf.blanks': ['afterPage', 'count'],
  'pdf.numbers': ['start', 'position', 'range'],
  'pdf.watermark': ['text', 'opacity', 'range'],
  'pdf.crop': ['margin', 'range'],
  'pdf.metadata': ['title', 'author', 'subject', 'keywords', 'clear'],
  'pdf.images': ['paper'],
  'pdf.to-image': ['range', 'format', 'scale'],
  'pdf.to-text': ['range'],
  'pdf.compress': ['quality', 'scale', 'threshold'],
  'pdf.grayscale': ['quality', 'scale', 'threshold'],
  'pdf.background': ['quality', 'scale', 'threshold'],
  'pdf.stamp': ['range', 'widthPercent', 'position'],
  'pdf.flatten': [],
  'pdf.insert': ['afterPage', 'range'],
  'pdf.split-pages': ['range'],
  'pdf.resize-pages': ['paper', 'orientation'],
  'pdf.nup': ['layout'],
  'pdf.fill': ['values'],
  'image.crop': ['x', 'y', 'width', 'height', 'format', 'quality'],
  'image.resize': ['mode', 'width', 'height', 'percent', 'keepAspect', 'format', 'quality'],
  'image.convert': ['format', 'quality', 'background'],
  'image.compress': ['quality', 'maxSizeMB', 'maxDimension'],
  'image.rotate': ['angle', 'format', 'quality'],
  'image.flip': ['direction', 'format', 'quality'],
  'image.adjust': ['brightness', 'contrast', 'saturation', 'grayscale', 'sepia', 'blurRadius', 'format', 'quality'],
  'image.watermark': ['text', 'textSize', 'opacity', 'color', 'position', 'format', 'quality'],
  'image.frame': ['border', 'color', 'format', 'quality'],
  'image.round': ['cornerRadius', 'format', 'quality'],
  'image.pixelate': ['region', 'mosaicSize', 'format', 'quality'],
  'image.blur': ['region', 'blurRadius', 'format', 'quality'],
  'image.mask': ['region', 'color', 'format', 'quality'],
  'image.background': ['background', 'tolerance', 'format', 'quality'],
  'image.replace-background': ['background', 'format', 'quality'],
  'image.strip': ['format', 'quality'],
  'image.collage': ['arrangement', 'gap', 'background'],
  'image.batch': ['mode', 'format', 'quality', 'percent'],
});

const RANGE_KEYS = new Set(['range', 'order']);
const RANGE_RE = /^[1-9]\d*(?:-[1-9]\d*)?(?:,[1-9]\d*(?:-[1-9]\d*)?)*$/;
const DAY_START = `(date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')`;

function fail(message, code = 'planner_invalid_output') {
  throw new AppError(code, message, { status: 502 });
}

function validateFileMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('文件元数据格式无效', 'validation_error');
  }
  const allowed = new Set(['fileId', 'kind', 'sizeBytes', 'pageCount', 'width', 'height', 'hasTextLayer']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('文件元数据包含不允许的字段', 'validation_error');
  }
  if (typeof value.fileId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(value.fileId)) {
    fail('fileId 格式无效', 'validation_error');
  }
  if (!['pdf', 'image', 'text'].includes(value.kind)) fail('文件类型无效', 'validation_error');
  if (!Number.isInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > 50 * 1024 * 1024) {
    fail('文件大小无效', 'validation_error');
  }
  if (value.kind === 'pdf') {
    if (!Number.isInteger(value.pageCount) || value.pageCount < 1 || value.pageCount > 1000) {
      fail('PDF 页数无效', 'validation_error');
    }
    if (value.hasTextLayer !== undefined && typeof value.hasTextLayer !== 'boolean') {
      fail('文字层标记无效', 'validation_error');
    }
  }
  if (value.kind === 'image') {
    for (const key of ['width', 'height']) {
      if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 30000) {
        fail('图片尺寸无效', 'validation_error');
      }
    }
  }
  return {
    fileId: value.fileId,
    kind: value.kind,
    sizeBytes: value.sizeBytes,
    ...(value.pageCount !== undefined ? { pageCount: value.pageCount } : {}),
    ...(value.width !== undefined ? { width: value.width } : {}),
    ...(value.height !== undefined ? { height: value.height } : {}),
    ...(value.hasTextLayer !== undefined ? { hasTextLayer: value.hasTextLayer } : {}),
  };
}

function validateValue(value, key, depth = 0) {
  if (depth > 2) fail('计划参数嵌套过深');
  if (typeof value === 'string') {
    if (value.length > 500 || value.includes('\u0000')) fail('计划字符串参数无效');
    if (/^(?:https?|file|javascript):/i.test(value) || value.includes('..\\') || value.includes('../')) {
      fail('计划参数包含不允许的内容');
    }
    if (RANGE_KEYS.has(key) && value && !RANGE_RE.test(value)) fail('页码参数格式无效');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) fail('计划数字参数无效');
    return;
  }
  if (typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    if (value.length > 50) fail('计划数组过长');
    for (const item of value) validateValue(item, key, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length > 30) fail('计划对象过大');
    for (const [childKey, child] of entries) {
      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(childKey)) fail('计划参数名无效');
      validateValue(child, childKey, depth + 1);
    }
    return;
  }
  fail('计划参数必须是 JSON 标量、对象或数组');
}

function validateSteps(raw, fileIds) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) {
    fail('计划步骤数量无效');
  }
  return raw.map((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) fail('计划步骤格式无效');
    const extra = Object.keys(step).filter((key) => !['toolKey', 'args'].includes(key));
    if (extra.length) fail('计划步骤包含不允许的字段');
    if (typeof step.toolKey !== 'string' || !LOCAL_TOOL_KEYS.includes(step.toolKey)) {
      fail('计划包含未授权工具');
    }
    if (!step.args || typeof step.args !== 'object' || Array.isArray(step.args)) {
      fail('计划参数必须是对象');
    }
    const allowed = new Set(ALLOWED_ARGS[step.toolKey] || []);
    const args = {};
    for (const [key, value] of Object.entries(step.args)) {
      if (!allowed.has(key)) fail(`工具 ${step.toolKey} 不接受参数 ${key}`);
      validateValue(value, key);
      args[key] = value;
    }
    return { toolKey: step.toolKey, args };
  });
}

function validateOutcome(raw, files) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('规划器返回格式无效');
  const known = new Set(['plan', 'needs_clarification', 'unsupported', 'requires_content_consent']);
  if (!known.has(raw.kind)) fail('规划器返回了未知结果');
  if (raw.kind !== 'plan') {
    if (typeof raw.message !== 'string' || raw.message.trim().length < 1 || raw.message.length > 500) {
      fail('规划器说明无效');
    }
    return { kind: raw.kind, message: raw.message.trim() };
  }
  if (!Array.isArray(raw.fileIds) || raw.fileIds.length < 1 || raw.fileIds.length > 8) {
    fail('计划文件数量无效');
  }
  const allowedIds = new Set(files.map((file) => file.fileId));
  const fileIds = [...new Set(raw.fileIds)];
  if (fileIds.length !== raw.fileIds.length || fileIds.some((id) => !allowedIds.has(id))) {
    fail('计划引用了未提供的文件');
  }
  const steps = validateSteps(raw.steps, fileIds);
  if (typeof raw.reason !== 'string' || raw.reason.trim().length < 1 || raw.reason.length > 500) {
    fail('计划原因无效');
  }
  if (raw.message !== undefined && (typeof raw.message !== 'string' || raw.message.length > 500)) {
    fail('计划说明无效');
  }
  return {
    kind: 'plan',
    source: 'cloud',
    fileIds,
    steps,
    requiresConfirmation: true,
    reason: raw.reason.trim(),
    ...(raw.message ? { message: raw.message.trim() } : {}),
  };
}

function fingerprint(prompt, files) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ prompt, files }))
    .digest('hex');
}

function validatePlanInput(payload) {
  if (typeof payload.prompt !== 'string') throw new AppError('validation_error', '缺少指令', { status: 400 });
  const prompt = payload.prompt.trim();
  if (prompt.length < 3 || prompt.length > 1000) {
    throw new AppError('validation_error', '指令长度必须为 3–1000 个字符', { status: 400 });
  }
  if (!Array.isArray(payload.files) || payload.files.length < 1 || payload.files.length > 8) {
    throw new AppError('validation_error', '需要 1–8 个文件元数据', { status: 400 });
  }
  const files = payload.files.map(validateFileMetadata);
  return { prompt, files };
}

async function checkQuota(pool, config, uid, tenantId) {
  const limits = config.planner;
  const { rows } = await pool.query(
    `select
       count(*) filter (where user_id = $1 and created_at >= now() - interval '1 minute')::int as user_minute,
       count(*) filter (where user_id = $1 and created_at >= ${DAY_START})::int as user_day,
       count(*) filter (where tenant_id = $2 and created_at >= ${DAY_START})::int as tenant_day
     from public.ai_plan_requests
     where created_at >= now() - interval '2 days'`,
    [uid, tenantId]
  );
  const counts = rows[0];
  if (Number(counts.user_minute) >= limits.userPerMinute) {
    throw new AppError('plan_quota_exceeded', '云端规划每分钟次数已达上限，请稍后再试', { status: 429 });
  }
  if (Number(counts.user_day) >= limits.userPerDay) {
    throw new AppError('plan_quota_exceeded', '今天的云端规划次数已达上限，基础本地指令仍可使用', { status: 429 });
  }
  if (Number(counts.tenant_day) >= limits.tenantPerDay) {
    throw new AppError('plan_quota_exceeded', '该空间今天的云端规划额度已用完，基础本地指令仍可使用', { status: 429 });
  }
}

async function planDocument({ pool, config, planner, uid, tenantId, payload }) {
  const input = validatePlanInput(payload);
  const hash = fingerprint(input.prompt, input.files);
  const requestId = payload.requestId;
  if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    throw new AppError('validation_error', 'requestId 无效', { status: 400 });
  }

  await checkQuota(pool, config, uid, tenantId);
  const inserted = await pool.query(
    `insert into public.ai_plan_requests
       (tenant_id, user_id, request_id, request_fingerprint, provider, model, prompt_chars, file_count)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (tenant_id, request_id) do nothing
     returning id`,
    [
      tenantId,
      uid,
      requestId,
      hash,
      config.planner.provider,
      config.planner.model,
      input.prompt.length,
      input.files.length,
    ]
  );
  if (inserted.rowCount === 0) {
    const existing = await pool.query(
      `select * from public.ai_plan_requests
       where tenant_id = $1 and request_id = $2`,
      [tenantId, requestId]
    );
    const record = existing.rows[0];
    if (!record || record.request_fingerprint !== hash) {
      throw new AppError('request_conflict', '相同 requestId 的请求内容不一致', { status: 409 });
    }
    if (record.status === 'succeeded' && record.plan) return record.plan;
    if (record.status === 'failed') {
      throw new AppError(record.error_code || 'planner_failed', '这次规划未成功，请重新发起', { status: 502 });
    }
    throw new AppError('request_in_progress', '相同请求正在处理中', { status: 409 });
  }
  const rowId = inserted.rows[0].id;

  try {
    const adapter = planner.get();
    const providerResult = await adapter.plan({
      prompt: input.prompt,
      files: input.files,
      toolKeys: LOCAL_TOOL_KEYS,
    });
    const outcome = validateOutcome(providerResult.raw, input.files);
    await pool.query(
      `update public.ai_plan_requests
       set status = 'succeeded', plan = $2::jsonb, completed_at = now()
       where id = $1`,
      [rowId, JSON.stringify(outcome)]
    );
    return outcome;
  } catch (error) {
    const code = error instanceof PlannerProviderError
      ? error.code
      : error instanceof AppError
        ? error.code
        : 'planner_error';
    await pool.query(
      `update public.ai_plan_requests
       set status = 'failed', error_code = $2, completed_at = now()
       where id = $1`,
      [rowId, String(code).slice(0, 80)]
    );
    if (error instanceof AppError) throw error;
    if (error instanceof PlannerProviderError && error.code === 'provider_not_configured') {
      throw new AppError('planner_not_configured', '复杂指令规划暂未配置，基础本地指令仍可使用。', {
        status: 503,
      });
    }
    throw new AppError('planner_unavailable', '云端规划暂时不可用，基础本地指令仍可执行。', {
      status: 503,
    });
  }
}

module.exports = {
  LOCAL_TOOL_KEYS,
  ALLOWED_ARGS,
  validateFileMetadata,
  validateOutcome,
  validatePlanInput,
  planDocument,
};
