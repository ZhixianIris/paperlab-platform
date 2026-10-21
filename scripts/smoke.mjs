#!/usr/bin/env node
/* Post-deploy smoke test for the actual public site, SPA refresh routes and
 * the event function's DB/auth boundary. Nothing is mocked. */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CloudBase = require('@cloudbase/manager-node');

const publicUrl = (process.env.PUBLIC_URL || process.env.APP_ORIGIN || '').replace(/\/$/, '');
if (!publicUrl) {
  console.error('PUBLIC_URL or APP_ORIGIN is required');
  process.exit(2);
}

const failures = [];

async function expectHtml(path, label) {
  const response = await fetch(`${publicUrl}${path}`, { redirect: 'follow' });
  const body = await response.text();
  const type = response.headers.get('content-type') || '';
  const ok =
    response.status === 200 &&
    type.includes('text/html') &&
    /PaperLab|id="root"/i.test(body);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label} ${path} -> HTTP ${response.status} ${type.split(';')[0]}`,
  );
  if (!ok) failures.push(`${label} ${path}`);
}

await expectHtml('/', 'home');
await expectHtml('/admin', 'admin SPA refresh');
await expectHtml('/t/smoke-route', 'tenant SPA refresh');

if (process.env.TCB_SECRET_ID && process.env.TCB_ENV_ID) {
  CloudBase.init({
    secretId: process.env.TCB_SECRET_ID,
    secretKey: process.env.TCB_SECRET_KEY,
    envId: process.env.TCB_ENV_ID,
    region: process.env.TCB_REGION || 'ap-shanghai',
  });
  try {
    const result = await CloudBase.functions.invokeFunction('platform-api', {
      action: 'health',
      payload: {},
    });
    const body =
      typeof result?.RetMsg === 'string'
        ? JSON.parse(result.RetMsg)
        : result?.RetMsg || result?.Result || {};
    const ok = body?.ok === true && body?.database === 'up';
    console.log(`${ok ? 'PASS' : 'FAIL'}  platform-api health (database=${body?.database})`);
    if (!ok) failures.push('platform-api health');

    const unauth = await CloudBase.functions.invokeFunction('platform-api', {
      action: 'session.bootstrap',
      payload: {},
    });
    const unauthBody =
      typeof unauth?.RetMsg === 'string'
        ? JSON.parse(unauth.RetMsg)
        : unauth?.RetMsg || unauth?.Result || {};
    const unauthorized = unauthBody?.ok === false && unauthBody?.error?.code === 'unauthenticated';
    console.log(`${unauthorized ? 'PASS' : 'FAIL'}  platform-api rejects anonymous tenant reads`);
    if (!unauthorized) failures.push('platform-api unauthenticated check');
  } catch (error) {
    console.error(`FAIL  platform-api invocation: ${error.message}`);
    failures.push('platform-api invocation');
  }
}

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nPublic site and function smoke checks passed');
