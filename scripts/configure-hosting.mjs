#!/usr/bin/env node
/* One-time-after-deploy (and every-deploy idempotent) SPA fallback setup. */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';

const require = createRequire(import.meta.url);
const CloudBase = require('@cloudbase/manager-node');

const secretId = process.env.TCB_SECRET_ID;
const secretKey = process.env.TCB_SECRET_KEY;
const envId = process.env.TCB_ENV_ID;

if (!secretId || !secretKey || !envId) {
  console.error('TCB_SECRET_ID, TCB_SECRET_KEY and TCB_ENV_ID are required');
  process.exit(2);
}

CloudBase.init({
  secretId,
  secretKey,
  envId,
  region: process.env.TCB_REGION || 'ap-shanghai',
});

try {
  const info = await CloudBase.hosting.getInfo();
  const hosting = Array.isArray(info) ? info[0] : info;
  if (!hosting?.CdnDomain && !hosting?.CdnDomainName) {
    throw new Error('Hosting is not enabled or has no default domain');
  }
  await CloudBase.hosting.setWebsiteDocument({
    indexDocument: 'index.html',
    errorDocument: 'index.html',
    originalHttpStatus: 'Disabled',
    charity404: 'Disabled',
  });
  const domain = hosting.CdnDomain || hosting.CdnDomainName;
  const url = /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
  console.log(`SPA fallback configured: error/4xx -> index.html (200) at ${url}`);
  if (process.env.GITHUB_ENV) {
    await fs.appendFile(process.env.GITHUB_ENV, `PUBLIC_URL=${url}\nAPP_ORIGIN=${url}\n`);
  }
} catch (error) {
  console.error(`Hosting configuration failed: ${error.message}`);
  process.exit(1);
}
