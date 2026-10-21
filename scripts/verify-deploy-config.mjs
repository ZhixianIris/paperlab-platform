#!/usr/bin/env node
/* Static guardrail for the single declarative CloudBase configuration and the
 * two GitHub workflows. `tcb validate`, `tcb app build` and
 * `tcb deploy --dry-run` still run in CI after this. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import YAML from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const checks = [];

function check(condition, message) {
  checks.push({ ok: Boolean(condition), message });
  if (!condition) failures.push(message);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
}

async function readYaml(file) {
  return YAML.parse(await fs.readFile(path.join(root, file), 'utf8'));
}

const schema = await readJson('cloudbase/cloudbaserc.schema.json');
const config = await readJson('cloudbaserc.json');
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
check(validate(config), `cloudbaserc.json schema: ${ajv.errorsText(validate.errors)}`);
check(config.version === '2.1', 'cloudbaserc version must be 2.1');
check(config.envId === '{{env.TCB_ENV_ID}}', 'envId must be injected from TCB_ENV_ID');
check(config.database?.type === 'postgresql', 'database type must be postgresql');
check(config.functions?.length === 1, 'exactly one event function is allowed');
const fn = config.functions?.[0] || {};
check(fn.name === 'platform-api', 'function must be named platform-api');
check(fn.type === 'Event', 'platform-api must be an Event function');
check(fn.handler === 'index.main', 'platform-api handler must be index.main');
check(fn.runtime === 'Nodejs20.19', 'runtime must be pinned to Nodejs20.19');
check(Object.keys(await readJson('functions/platform-api/package.json')).length > 0, 'function package exists');
check(config.hosting?.length === 1, 'exactly one hosting app is allowed');
check(config.hosting?.[0]?.deployPath === '/', 'hosting must deploy at /');
check(config.hosting?.[0]?.root === './web', 'hosting root must be ./web');
check(config.hosting?.[0]?.buildCommand === 'npm run build', 'hosting must run the project build');
check(config.hosting?.[0]?.verify === true, 'hosting verification must be enabled');
check(config.hosting?.[0]?.safe === true, 'hosting safe rollback must be enabled');

for (const [key, value] of Object.entries(fn.envVariables || {})) {
  if (['PGPASSWORD', 'OPENAI_API_KEY', 'PAYMENT_API_V3_KEY'].includes(key)) {
    check(
      value === '' || (value.startsWith('{{env.') && value.endsWith('}}')),
      `${key} must be injected or empty, never committed`,
    );
  }
}
const serialized = JSON.stringify(config);
check(!/sk-[A-Za-z0-9]/.test(serialized), 'no obvious provider secret in cloudbaserc');
check(!/AKID[A-Za-z0-9]/.test(serialized), 'no obvious Tencent secret id in cloudbaserc');

const migrations = (await fs.readdir(path.join(root, 'cloudbase/migrations'))).filter((name) =>
  name.endsWith('.sql'),
);
check(migrations.length >= 4, 'at least four SQL migrations are required');
check(
  migrations.every((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)),
  'migration filenames must be <14-digit timestamp>_<name>.sql',
);
const migrationContents = await Promise.all(
  migrations.map((name) => fs.readFile(path.join(root, 'cloudbase/migrations', name), 'utf8')),
);
const joined = migrationContents.join('\n').toLowerCase();
check(!/\bdrop\s+database\b/.test(joined), 'migrations must never drop the database');
check(!/\btruncate\b/.test(joined) || !/\bauth\.users\b/.test(joined), 'production migrations must not truncate auth data');
check(joined.includes('enable row level security'), 'RLS must be enabled in migrations');
check(joined.includes('wallet_ledger_immutable'), 'ledger immutability trigger must exist');

const ci = await readYaml('.github/workflows/ci.yml');
const deploy = await readYaml('.github/workflows/deploy.yml');
check(Boolean(ci.on && 'pull_request' in ci.on), 'ci.yml must run on pull requests');
check(!JSON.stringify(ci).includes('tcb deploy --yes'), 'ci.yml must never deploy');
check(Boolean(deploy.on?.push?.branches?.includes('main')), 'deploy.yml must run on main pushes');
check(
  deploy.concurrency?.group?.includes('deploy') || deploy.concurrency?.group?.includes('production'),
  'deploy.yml needs a deploy concurrency group',
);
const deployText = JSON.stringify(deploy);
check(deployText.includes('tcb validate'), 'deploy must run tcb validate');
check(deployText.includes('tcb app build'), 'deploy must run tcb app build');
check(deployText.includes('tcb deploy --dry-run'), 'deploy must run a dry-run before deploy');
check(deployText.includes('tcb deploy --yes'), 'deploy must perform the real deploy');
check(!deployText.includes('continue-on-error'), 'deployment failures must not be ignored');
check(deployText.includes('@cloudbase/cli@3.8.4'), 'CloudBase CLI version must be pinned to 3.8.4');
check(deployText.includes('TCB_SECRET_ID'), 'deploy must use TCB_SECRET_ID');
check(deployText.includes('TCB_SECRET_KEY'), 'deploy must use TCB_SECRET_KEY');
check(deployText.includes('TCB_ENV_ID'), 'deploy must use TCB_ENV_ID');
check(deployText.includes('deploy:configure'), 'deploy must configure the SPA fallback');
check(deployText.includes('deploy:smoke'), 'deploy must run public smoke tests');

for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.message}`);
}
if (failures.length > 0) {
  console.error(`\n${failures.length} deployment configuration check(s) failed`);
  process.exit(1);
}
console.log(`\n${checks.length} deployment configuration checks passed`);
