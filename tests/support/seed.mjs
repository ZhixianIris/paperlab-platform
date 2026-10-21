import pg from 'pg';

export const TEST_USERS = Object.freeze({
  admin: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'admin@paperlab.test',
    password: 'Passw0rd!',
    name: '平台管理员',
  },
  alice: {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'alice@paperlab.test',
    password: 'Passw0rd!',
    name: 'Alice',
  },
  bob: {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'bob@paperlab.test',
    password: 'Passw0rd!',
    name: 'Bob',
  },
  carol: {
    id: '44444444-4444-4444-8444-444444444444',
    email: 'carol@paperlab.test',
    password: 'Passw0rd!',
    name: 'Carol',
  },
});

export const TENANTS = Object.freeze({
  alpha: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    slug: 'alpha',
    name: 'Alpha Studio',
    owner: TEST_USERS.alice.id,
    member: TEST_USERS.carol.id,
    walletCents: 5000,
  },
  beta: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    slug: 'beta',
    name: 'Beta Works',
    owner: TEST_USERS.bob.id,
    walletCents: 0,
  },
});

export const TEST_MODEL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

export function databaseUrl() {
  return process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/paperlab';
}

export function testPool() {
  return new pg.Pool({ connectionString: databaseUrl(), max: 6 });
}

export async function resetAndSeed(pool) {
  await pool.query(`
    truncate table
      public.payment_events,
      public.wallet_ledger,
      public.usage_records,
      public.ai_jobs,
      public.orders,
      public.wallets,
      public.tool_configs,
      public.memberships,
      public.platform_admins,
      public.audit_log,
      public.model_prices,
      public.tenants,
      auth.users
    restart identity cascade
  `);

  for (const user of Object.values(TEST_USERS)) {
    await pool.query(
      `insert into auth.users (id, email, user_metadata) values ($1,$2,$3::jsonb)`,
      [user.id, user.email, JSON.stringify({ name: user.name })]
    );
  }
  await pool.query(
    `insert into public.platform_admins (user_id, note) values ($1, 'integration test admin')`,
    [TEST_USERS.admin.id]
  );

  for (const tenant of Object.values(TENANTS)) {
    await pool.query(
      `insert into public.tenants (id, slug, name, monthly_ai_budget_cents, max_job_cost_cents)
       values ($1,$2,$3,100000,5000)`,
      [tenant.id, tenant.slug, tenant.name]
    );
    await pool.query(
      `insert into public.wallets (tenant_id, available_cents) values ($1,$2)`,
      [tenant.id, tenant.walletCents]
    );
  }

  await pool.query(
    `insert into public.memberships (tenant_id, user_id, role, monthly_ai_budget_cents)
     values
       ($1,$2,'tenant_owner',50000),
       ($1,$3,'tenant_member',20000),
       ($4,$5,'tenant_owner',50000)`,
    [
      TENANTS.alpha.id,
      TEST_USERS.alice.id,
      TEST_USERS.carol.id,
      TENANTS.beta.id,
      TEST_USERS.bob.id,
    ]
  );

  const tools = [
    'pdf.merge',
    'pdf.split',
    'pdf.rotate',
    'image.crop',
    'image.resize',
    'image.convert',
    'image.compress',
    'ai.image.generate',
  ];
  for (const tenant of Object.values(TENANTS)) {
    for (const key of tools) {
      await pool.query(
        'insert into public.tool_configs (tenant_id, tool_key, enabled) values ($1,$2,true)',
        [tenant.id, key]
      );
    }
  }

  await pool.query(
    `insert into public.model_prices (
       id, provider, model, display_name, description, unit_price_cents,
       enabled, max_images, max_prompt_chars, monthly_budget_cents
     ) values ($1,'fixture','paperlab-fixture-v1','Fixture Image (test only)',
       'Deterministic test provider; not an external model.',500,true,1,4000,100000)`,
    [TEST_MODEL_ID]
  );
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  const pool = testPool();
  resetAndSeed(pool)
    .then(() => {
      console.log('test database reset and seeded');
    })
    .finally(() => pool.end());
}
