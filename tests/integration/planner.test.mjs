import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { TEST_USERS, TENANTS, resetAndSeed, testPool } from '../support/seed.mjs';

const require = createRequire(import.meta.url);
const { loadConfig } = require('../../functions/platform-api/src/config.js');
const { createApp } = require('../../functions/platform-api/src/app.js');

process.env.APP_ENV = 'test';
const pool = testPool();
const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/paperlab';

function buildApp(overrides = {}) {
  const config = loadConfig({
    APP_ENV: 'test',
    AI_PROVIDER: 'fixture',
    AI_TEXT_PROVIDER: 'fixture',
    AI_PLAN_USER_PER_MINUTE: '20',
    AI_PLAN_USER_PER_DAY: '100',
    AI_PLAN_TENANT_PER_DAY: '200',
    DATABASE_URL: databaseUrl,
    ...overrides,
  });
  return createApp({ pool, config, logger: { error() {} } });
}

const app = buildApp();

function identity(user) {
  return { authenticated: true, uid: user.id, isAnonymous: false };
}

async function call(action, payload = {}, user = null, instance = app) {
  return instance.handle(
    { action, payload },
    {
      identity: user ? identity(user) : { authenticated: false, uid: '', isAnonymous: true },
      requestId: crypto.randomUUID(),
    },
  );
}

function planPayload(prompt, extra = {}) {
  return {
    tenantId: TENANTS.alpha.id,
    requestId: crypto.randomUUID(),
    prompt,
    files: [{
      fileId: 'file-11111111-1111-4111-8111-111111111111',
      kind: 'pdf',
      sizeBytes: 2048,
      pageCount: 5,
      hasTextLayer: true,
    }],
    ...extra,
  };
}

beforeEach(async () => {
  await resetAndSeed(pool);
});

after(async () => {
  await pool.end();
});

test('planner requires authentication and tenant membership', async () => {
  const anonymous = await call('ai.plan', planPayload('删除第2页'));
  assert.equal(anonymous.ok, false);
  assert.equal(anonymous.error.code, 'unauthenticated');

  const bob = await call('ai.plan', planPayload('删除第2页'), TEST_USERS.bob);
  assert.equal(bob.ok, false);
  assert.equal(bob.error.code, 'forbidden');
});

test('fixture planner returns a validated local plan and records quota without storing prompt', async () => {
  const result = await call('ai.plan', planPayload('把第2页拿掉，再把余下页面旋转90度'), TEST_USERS.alice);
  assert.equal(result.ok, true);
  assert.equal(result.data.kind, 'plan');
  assert.equal(result.data.source, 'cloud');
  assert.equal(result.data.requiresConfirmation, true);
  assert.equal(result.data.steps[0].toolKey, 'pdf.delete');
  assert.equal(result.data.steps[1].toolKey, 'pdf.rotate');

  const { rows } = await pool.query(
    'select status, prompt_chars, file_count, plan from public.ai_plan_requests where tenant_id = $1',
    [TENANTS.alpha.id],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'succeeded');
  assert.equal(rows[0].prompt_chars, '把第2页拿掉，再把余下页面旋转90度'.length);
  assert.equal(rows[0].file_count, 1);
  assert.equal(rows[0].plan.kind, 'plan');
});

test('malicious or malformed model output is rejected before any browser execution', async () => {
  const result = await call('ai.plan', planPayload('__EVIL__'), TEST_USERS.alice);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'planner_invalid_output');
  const { rows } = await pool.query(
    'select status, error_code from public.ai_plan_requests where tenant_id = $1',
    [TENANTS.alpha.id],
  );
  assert.equal(rows[0].status, 'failed');
  assert.ok(rows[0].error_code);
});

test('metadata containing names or invalid file ids is rejected before the provider', async () => {
  const payload = planPayload('删除第2页');
  payload.files[0].name = 'private.pdf';
  const result = await call('ai.plan', payload, TEST_USERS.alice);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'validation_error');

  const badId = planPayload('删除第2页');
  badId.files[0].fileId = '../escape';
  const second = await call('ai.plan', badId, TEST_USERS.alice);
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'validation_error');
});

test('planner enforces per-user minute and daily quota server-side', async () => {
  const limited = buildApp({
    AI_PLAN_USER_PER_MINUTE: '2',
    AI_PLAN_USER_PER_DAY: '2',
    AI_PLAN_TENANT_PER_DAY: '3',
  });
  const first = await call('ai.plan', planPayload('随便改一下'), TEST_USERS.alice, limited);
  const second = await call('ai.plan', planPayload('随便改一下'), TEST_USERS.alice, limited);
  const third = await call('ai.plan', planPayload('随便改一下'), TEST_USERS.alice, limited);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false);
  assert.equal(third.error.code, 'plan_quota_exceeded');
});

test('disabled tenant planner switch is respected', async () => {
  await pool.query(
    `update public.tool_configs set enabled = false
     where tenant_id = $1 and tool_key = 'ai.plan'`,
    [TENANTS.alpha.id],
  );
  const result = await call('ai.plan', planPayload('删除第2页'), TEST_USERS.alice);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'tool_disabled');
});

test('missing real text provider fails closed without affecting local tools', async () => {
  const unconfigured = buildApp({
    AI_TEXT_PROVIDER: 'openai',
    AI_TEXT_API_KEY: '',
  });
  const result = await call('ai.plan', planPayload('把第2页拿掉'), TEST_USERS.alice, unconfigured);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'planner_not_configured');
  const publicConfig = await call('public.config', {}, null, unconfigured);
  assert.equal(publicConfig.ok, true);
  assert.equal(publicConfig.data.planner.configured, false);
});
