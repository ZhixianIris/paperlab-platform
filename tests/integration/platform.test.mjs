import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  TEST_USERS,
  TENANTS,
  TEST_MODEL_ID,
  resetAndSeed,
  testPool,
} from '../support/seed.mjs';

const require = createRequire(import.meta.url);
const { loadConfig } = require('../../functions/platform-api/src/config.js');
const { createApp } = require('../../functions/platform-api/src/app.js');

process.env.APP_ENV = 'test';

const pool = testPool();
const config = loadConfig({
  APP_ENV: 'test',
  AI_PROVIDER: 'fixture',
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/paperlab',
  AI_USER_RATE_PER_MINUTE: '20',
  AI_TENANT_RATE_PER_MINUTE: '60',
});
const app = createApp({ pool, config, logger: { error() {} } });

function identity(user) {
  return { authenticated: true, uid: user.id, isAnonymous: false };
}

async function call(action, payload = {}, user = null, appInstance = app) {
  return appInstance.handle(
    { action, payload },
    { identity: user ? identity(user) : { authenticated: false, uid: '', isAnonymous: true }, requestId: `test-${Date.now()}` }
  );
}

async function generate(user, prompt, requestId = crypto.randomUUID(), extra = {}) {
  return call(
    'ai.generate',
    {
      tenantId: TENANTS.alpha.id,
      modelId: TEST_MODEL_ID,
      prompt,
      count: 1,
      size: '1024x1024',
      requestId,
      ...extra,
    },
    user
  );
}

async function wallet(tenantId = TENANTS.alpha.id) {
  const { rows } = await pool.query(
    'select available_cents, reserved_cents from public.wallets where tenant_id = $1',
    [tenantId]
  );
  return { available: Number(rows[0].available_cents), reserved: Number(rows[0].reserved_cents) };
}

async function ledger(tenantId = TENANTS.alpha.id) {
  const { rows } = await pool.query(
    'select kind, available_delta_cents, reserved_delta_cents from public.wallet_ledger where tenant_id = $1 order by id',
    [tenantId]
  );
  return rows.map((row) => ({
    kind: row.kind,
    available: Number(row.available_delta_cents),
    reserved: Number(row.reserved_delta_cents),
  }));
}

async function asRole(role, claims, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(claims),
    ]);
    const result = await fn(client);
    await client.query('rollback');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

before(async () => {
  await resetAndSeed(pool);
});

beforeEach(async () => {
  await resetAndSeed(pool);
});

after(async () => {
  await pool.end();
});

test('health and public config work without a session', async () => {
  const health = await call('health');
  assert.equal(health.ok, true);
  assert.equal(health.database, 'up');
  assert.equal(health.payments.enabled, false);

  const publicConfig = await call('public.config');
  assert.equal(publicConfig.ok, true);
  assert.equal(publicConfig.data.payments.enabled, false);
  assert.equal(publicConfig.data.ai.configured, true);
});

test('unauthenticated requests are rejected and body identity cannot spoof', async () => {
  const unauthorized = await call('session.bootstrap', { userId: TEST_USERS.admin.id });
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.error.code, 'unauthenticated');

  const bobResponse = await call('session.bootstrap', { userId: TEST_USERS.admin.id }, TEST_USERS.bob);
  assert.equal(bobResponse.ok, true);
  assert.equal(bobResponse.data.user.id, TEST_USERS.bob.id);
  assert.equal(bobResponse.data.platformAdmin, false);
  assert.equal(bobResponse.data.memberships.length, 1);
  assert.equal(bobResponse.data.memberships[0].slug, 'beta');
});

test('tenant membership isolation is enforced by the API', async () => {
  const alice = await call('tenant.dashboard', { tenantId: TENANTS.alpha.id }, TEST_USERS.alice);
  assert.equal(alice.ok, true);
  assert.equal(alice.data.tenant.slug, 'alpha');
  assert.equal(alice.data.role, 'tenant_owner');

  const forbidden = await call('tenant.dashboard', { tenantId: TENANTS.beta.id }, TEST_USERS.alice);
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.error.code, 'forbidden');

  const adminForbidden = await call('admin.overview', {}, TEST_USERS.alice);
  assert.equal(adminForbidden.ok, false);
  assert.equal(adminForbidden.error.code, 'forbidden');

  const bob = await call('tenant.dashboard', { tenantId: TENANTS.beta.id }, TEST_USERS.bob);
  assert.equal(bob.ok, true);
  assert.equal(bob.data.tenant.slug, 'beta');
});

test('AI generation reserves, settles, and retries one request idempotently', async () => {
  const requestId = crypto.randomUUID();
  const result = await generate(TEST_USERS.alice, 'a paper texture poster', requestId);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.job.status, 'succeeded');
  assert.equal(result.data.job.settledCents, 500);
  assert.match(result.data.job.result.images[0].dataUrl, /^data:image\/png;base64,/);

  assert.deepEqual(await wallet(), { available: 4500, reserved: 0 });
  assert.deepEqual(await ledger(), [
    { kind: 'reserve', available: -500, reserved: 500 },
    { kind: 'settle', available: 0, reserved: -500 },
  ]);
  const usage = await pool.query('select count(*)::int as c from public.usage_records');
  assert.equal(usage.rows[0].c, 1);

  const retry = await generate(TEST_USERS.alice, 'a paper texture poster', requestId);
  assert.equal(retry.ok, true);
  assert.equal(retry.data.job.id, result.data.job.id);
  assert.deepEqual(await wallet(), { available: 4500, reserved: 0 });
  assert.equal((await ledger()).length, 2);
  assert.equal((await pool.query('select count(*)::int as c from public.usage_records')).rows[0].c, 1);

  const conflict = await generate(TEST_USERS.alice, 'different prompt', requestId);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, 'idempotency_conflict');
  assert.deepEqual(await wallet(), { available: 4500, reserved: 0 });
});

test('concurrent retries with the same request id charge exactly once', async () => {
  const requestId = crypto.randomUUID();
  const [first, second] = await Promise.all([
    generate(TEST_USERS.alice, 'concurrent image', requestId),
    generate(TEST_USERS.alice, 'concurrent image', requestId),
  ]);
  const successes = [first, second].filter((response) => response.ok);
  assert.ok(successes.length >= 1);
  assert.deepEqual(await wallet(), { available: 4500, reserved: 0 });
  assert.equal((await ledger()).length, 2);
  assert.equal((await pool.query('select count(*)::int as c from public.ai_jobs')).rows[0].c, 1);
});

test('insufficient balance and budget caps reject before charging', async () => {
  const poor = await generate(TEST_USERS.bob, 'beta has no credits', crypto.randomUUID(), {
    tenantId: TENANTS.beta.id,
  });
  assert.equal(poor.ok, false);
  assert.equal(poor.error.code, 'insufficient_balance');
  assert.equal((await pool.query('select count(*)::int as c from public.wallet_ledger')).rows[0].c, 0);

  await pool.query(
    'update public.memberships set monthly_ai_budget_cents = 100 where tenant_id = $1 and user_id = $2',
    [TENANTS.alpha.id, TEST_USERS.alice.id]
  );
  const budget = await generate(TEST_USERS.alice, 'over budget');
  assert.equal(budget.ok, false);
  assert.equal(budget.error.code, 'user_budget_exceeded');
  assert.deepEqual(await wallet(), { available: 5000, reserved: 0 });

  await pool.query(
    'update public.memberships set monthly_ai_budget_cents = 50000 where tenant_id = $1 and user_id = $2',
    [TENANTS.alpha.id, TEST_USERS.alice.id]
  );
  await pool.query('update public.tenants set max_job_cost_cents = 100 where id = $1', [
    TENANTS.alpha.id,
  ]);
  const cap = await generate(TEST_USERS.alice, 'too expensive');
  assert.equal(cap.ok, false);
  assert.equal(cap.error.code, 'job_cost_limit_exceeded');
});

test('disabled model and unconfigured provider block generation without charging', async () => {
  await pool.query('update public.model_prices set enabled = false where id = $1', [TEST_MODEL_ID]);
  const disabled = await generate(TEST_USERS.alice, 'disabled model');
  assert.equal(disabled.ok, false);
  assert.equal(disabled.error.code, 'model_disabled');

  await pool.query('update public.model_prices set enabled = true where id = $1', [TEST_MODEL_ID]);
  const openaiConfig = loadConfig({
    APP_ENV: 'test',
    AI_PROVIDER: 'openai',
    DATABASE_URL: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/paperlab',
  });
  const openaiApp = createApp({ pool, config: openaiConfig, logger: { error() {} } });
  const { rows } = await pool.query(
    `insert into public.model_prices (provider, model, display_name, unit_price_cents, enabled)
     values ('openai','gpt-image-1','unconfigured',500,true) returning id`
  );
  const response = await call(
    'ai.generate',
    {
      tenantId: TENANTS.alpha.id,
      modelId: rows[0].id,
      requestId: crypto.randomUUID(),
      prompt: 'should not call',
      count: 1,
      size: '1024x1024',
    },
    TEST_USERS.alice,
    openaiApp
  );
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'provider_not_configured');
  assert.deepEqual(await wallet(), { available: 5000, reserved: 0 });
});

test('definite provider failure releases the reservation and records a release', async () => {
  const response = await generate(TEST_USERS.alice, '__FAIL_DEFINITE__ upstream rejected');
  assert.equal(response.ok, true);
  assert.equal(response.data.job.status, 'failed');
  assert.equal(response.data.error.code, 'provider_failed');
  assert.deepEqual(await wallet(), { available: 5000, reserved: 0 });
  assert.deepEqual(await ledger(), [
    { kind: 'reserve', available: -500, reserved: 500 },
    { kind: 'release', available: 500, reserved: -500 },
  ]);
  assert.equal((await pool.query('select count(*)::int as c from public.usage_records')).rows[0].c, 0);
});

test('uncertain provider outcome holds funds, then admin can release or settle', async () => {
  const held = await generate(TEST_USERS.alice, '__FAIL_UNCERTAIN__ provider disconnect');
  assert.equal(held.ok, true);
  assert.equal(held.data.job.status, 'pending_reconciliation');
  assert.equal(held.data.error.code, 'pending_reconciliation');
  assert.deepEqual(await wallet(), { available: 4500, reserved: 500 });

  const release = await call(
    'admin.jobs.reconcile',
    { jobId: held.data.job.id, decision: 'release' },
    TEST_USERS.admin
  );
  assert.equal(release.ok, true, JSON.stringify(release));
  assert.equal(release.data.job.status, 'failed');
  assert.deepEqual(await wallet(), { available: 5000, reserved: 0 });

  const heldAgain = await generate(TEST_USERS.alice, '__FAIL_UNCERTAIN__ provider disconnect');
  const settle = await call(
    'admin.jobs.reconcile',
    { jobId: heldAgain.data.job.id, decision: 'settle' },
    TEST_USERS.admin
  );
  assert.equal(settle.ok, true, JSON.stringify(settle));
  assert.equal(settle.data.job.status, 'settled');
  assert.equal(settle.data.job.settledCents, 500);
  assert.deepEqual(await wallet(), { available: 4500, reserved: 0 });
  assert.equal((await pool.query('select count(*)::int as c from public.usage_records')).rows[0].c, 1);
});

test('max images, monthly model budget and rate limits are enforced server-side', async () => {
  const tooMany = await generate(TEST_USERS.alice, 'two images', crypto.randomUUID(), { count: 2 });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.error.code, 'max_images_exceeded');

  await pool.query('update public.model_prices set monthly_budget_cents = 100 where id = $1', [
    TEST_MODEL_ID,
  ]);
  const modelBudget = await generate(TEST_USERS.alice, 'model budget');
  assert.equal(modelBudget.ok, false);
  assert.equal(modelBudget.error.code, 'model_budget_exceeded');

  await pool.query('update public.model_prices set monthly_budget_cents = 100000 where id = $1', [
    TEST_MODEL_ID,
  ]);
  const limitedConfig = loadConfig({
    APP_ENV: 'test',
    AI_PROVIDER: 'fixture',
    DATABASE_URL: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/paperlab',
    AI_USER_RATE_PER_MINUTE: '1',
    AI_TENANT_RATE_PER_MINUTE: '10',
  });
  const limited = createApp({ pool, config: limitedConfig, logger: { error() {} } });
  const first = await call(
    'ai.generate',
    {
      tenantId: TENANTS.alpha.id,
      modelId: TEST_MODEL_ID,
      requestId: crypto.randomUUID(),
      prompt: 'rate one',
      count: 1,
      size: '1024x1024',
    },
    TEST_USERS.alice,
    limited
  );
  assert.equal(first.ok, true);
  const second = await call(
    'ai.generate',
    {
      tenantId: TENANTS.alpha.id,
      modelId: TEST_MODEL_ID,
      requestId: crypto.randomUUID(),
      prompt: 'rate two',
      count: 1,
      size: '1024x1024',
    },
    TEST_USERS.alice,
    limited
  );
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'rate_limited');
});

test('payments stay closed and no fake order can be created', async () => {
  const response = await call(
    'orders.create',
    { tenantId: TENANTS.alpha.id, amountCents: 1000 },
    TEST_USERS.alice
  );
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'payments_disabled');
  assert.equal((await call('orders.list', { tenantId: TENANTS.alpha.id }, TEST_USERS.alice)).data.orders.length, 0);
});

test('tenant owners can manage ordinary members and tools, but cannot escalate owners', async () => {
  const added = await call(
    'tenant.members.add',
    { tenantId: TENANTS.alpha.id, email: TEST_USERS.bob.email },
    TEST_USERS.alice
  );
  assert.equal(added.ok, true);
  assert.equal(added.data.role, 'tenant_member');

  const bobAccess = await call('tenant.dashboard', { tenantId: TENANTS.alpha.id }, TEST_USERS.bob);
  assert.equal(bobAccess.ok, true);

  const removeOwner = await call(
    'tenant.members.remove',
    { tenantId: TENANTS.alpha.id, userId: TEST_USERS.alice.id },
    TEST_USERS.alice
  );
  assert.equal(removeOwner.ok, false);
  assert.equal(removeOwner.error.code, 'forbidden');

  const tool = await call(
    'tenant.tools.update',
    { tenantId: TENANTS.alpha.id, toolKey: 'ai.image.generate', enabled: false },
    TEST_USERS.alice
  );
  assert.equal(tool.ok, true);
  const blocked = await generate(TEST_USERS.carol, 'tool off');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'tool_disabled');
});

test('platform admin can create tenants, add members, configure models, credits and tools', async () => {
  const created = await call(
    'admin.tenants.create',
    { name: 'Gamma Lab', slug: 'gamma', ownerEmail: TEST_USERS.carol.email },
    TEST_USERS.admin
  );
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.data.tenant.slug, 'gamma');
  assert.equal(created.data.owner.email, TEST_USERS.carol.email);

  const addAdminMember = await call(
    'admin.members.add',
    { tenantId: created.data.tenant.id, email: TEST_USERS.bob.email, role: 'tenant_member' },
    TEST_USERS.admin
  );
  assert.equal(addAdminMember.ok, true, JSON.stringify(addAdminMember));

  const update = await call(
    'admin.tenants.update',
    {
      tenantId: created.data.tenant.id,
      name: 'Gamma Lab Plus',
      monthlyBudgetCents: 80000,
      maxJobCostCents: 2000,
    },
    TEST_USERS.admin
  );
  assert.equal(update.ok, true);
  assert.equal(update.data.tenant.name, 'Gamma Lab Plus');

  const tool = await call(
    'admin.tools.update',
    { tenantId: created.data.tenant.id, toolKey: 'pdf.merge', enabled: false },
    TEST_USERS.admin
  );
  assert.equal(tool.ok, true);

  const model = await call(
    'admin.models.update',
    { modelId: TEST_MODEL_ID, unitPriceCents: 600, enabled: true },
    TEST_USERS.admin
  );
  assert.equal(model.ok, true);
  assert.equal(model.data.model.unitPriceCents, 600);

  const adjustId = crypto.randomUUID();
  const adjust = await call(
    'admin.wallet.adjust',
    {
      tenantId: created.data.tenant.id,
      amountCents: 5000,
      reason: 'integration test manual credit',
      requestId: adjustId,
    },
    TEST_USERS.admin
  );
  assert.equal(adjust.ok, true, JSON.stringify(adjust));
  assert.equal(adjust.data.availableCents, 5000);

  const retry = await call(
    'admin.wallet.adjust',
    {
      tenantId: created.data.tenant.id,
      amountCents: 5000,
      reason: 'integration test manual credit',
      requestId: adjustId,
    },
    TEST_USERS.admin
  );
  assert.equal(retry.data.duplicate, true);
  assert.equal(retry.data.availableCents, 5000);

  const overview = await call('admin.overview', {}, TEST_USERS.admin);
  assert.equal(overview.ok, true);
  assert.equal(overview.data.counts.tenantCount, 3);
  assert.equal(overview.data.counts.pendingJobs, 0);
  assert.ok(overview.data.models.some((row) => row.unitPriceCents === 600));

  const detail = await call(
    'admin.tenant.detail',
    { tenantId: created.data.tenant.id },
    TEST_USERS.admin
  );
  assert.equal(detail.ok, true, JSON.stringify(detail));
  assert.equal(detail.data.tenant.slug, 'gamma');
  assert.ok(detail.data.members.some((member) => member.email === TEST_USERS.carol.email));
  assert.ok(detail.data.members.some((member) => member.email === TEST_USERS.bob.email));
  assert.ok(detail.data.tools.some((tool) => tool.key === 'pdf.merge' && tool.enabled === false));
  assert.equal(detail.data.ledger[0].kind, 'adjustment');
});

test('last tenant owner cannot be removed', async () => {
  const result = await call(
    'admin.members.remove',
    { tenantId: TENANTS.beta.id, userId: TEST_USERS.bob.id },
    TEST_USERS.admin
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'last_owner');
});

test('RLS isolates tenants for authenticated PostgREST-style sessions and blocks writes', async () => {
  const aliceTenants = await asRole(
    'authenticated',
    { sub: TEST_USERS.alice.id, role: 'authenticated' },
    async (client) => (await client.query('select slug from public.tenants order by slug')).rows
  );
  assert.deepEqual(aliceTenants.map((row) => row.slug), ['alpha']);

  const aliceWallets = await asRole(
    'authenticated',
    { sub: TEST_USERS.alice.id, role: 'authenticated' },
    async (client) => (await client.query('select tenant_id from public.wallets')).rows
  );
  assert.deepEqual(aliceWallets.map((row) => row.tenant_id), [TENANTS.alpha.id]);

  const adminTenants = await asRole(
    'authenticated',
    { sub: TEST_USERS.admin.id, role: 'authenticated' },
    async (client) => (await client.query('select slug from public.tenants order by slug')).rows
  );
  assert.deepEqual(adminTenants.map((row) => row.slug), ['alpha', 'beta']);

  await assert.rejects(
    asRole('authenticated', { sub: TEST_USERS.alice.id, role: 'authenticated' }, async (client) => {
      await client.query('insert into public.wallets (tenant_id, available_cents) values ($1, 1)', [
        TENANTS.alpha.id,
      ]);
    }),
    /permission denied|row-level security/i
  );

  await assert.rejects(
    asRole('authenticated', { sub: TEST_USERS.alice.id, role: 'authenticated' }, async (client) => {
      await client.query('update public.wallets set available_cents = 999999 where tenant_id = $1', [
        TENANTS.alpha.id,
      ]);
    }),
    /permission denied/i
  );

  await assert.rejects(
    asRole('anon', { sub: 'anon', role: 'anon' }, async (client) => {
      await client.query('select * from public.tenants');
    }),
    /permission denied/i
  );
});

test('wallet ledger and audit log reject updates and deletes at the database level', async () => {
  await call(
    'admin.wallet.adjust',
    {
      tenantId: TENANTS.alpha.id,
      amountCents: 100,
      reason: 'immutability test',
      requestId: crypto.randomUUID(),
    },
    TEST_USERS.admin
  );
  await assert.rejects(
    pool.query('update public.wallet_ledger set available_delta_cents = 999999'),
    /immutable_table/i
  );
  await assert.rejects(pool.query('delete from public.wallet_ledger'), /immutable_table/i);
  await pool.query(
    `insert into public.audit_log (actor_user_id, action, target_type, target_id)
     values ($1,'test','tenant',$2)`,
    [TEST_USERS.admin.id, TENANTS.alpha.id]
  );
  await assert.rejects(
    pool.query('update public.audit_log set action = $1', ['tampered']),
    /immutable_table/i
  );
});

test('validation rejects prices or tenant ids supplied as malformed input', async () => {
  const badTenant = await call('ai.generate', { tenantId: 'not-a-uuid' }, TEST_USERS.alice);
  assert.equal(badTenant.ok, false);
  assert.equal(badTenant.error.code, 'validation_error');
  const badAction = await call('admin.unknown', {}, TEST_USERS.admin);
  assert.equal(badAction.ok, false);
  assert.equal(badAction.error.code, 'unknown_action');
});
