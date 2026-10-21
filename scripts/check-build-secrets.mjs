#!/usr/bin/env node
/* Fail if server-only secret values or obvious credential material leak into a
 * built browser artifact. Environment variable NAMES may legitimately appear in
 * user-facing setup help; VALUES must never appear. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web', 'dist');

const secretEnv = [
  'OPENAI_API_KEY',
  'PGPASSWORD',
  'PAYMENT_API_V3_KEY',
  'TCB_SECRET_KEY',
  'TCB_SECRET_ID',
];
const secretValues = secretEnv
  .map((name) => process.env[name] || '')
  .filter((value) => value.length >= 8);
const patterns = [
  { label: 'provider key', re: /sk-[A-Za-z0-9_-]{32,}/ },
  { label: 'PostgreSQL URL with credentials', re: /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`]+@/ },
  { label: 'Tencent secret id', re: /AKID[A-Za-z0-9]{20,}/ },
  { label: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

if (!(await fs.stat(dist).catch(() => null))) {
  console.error('web/dist is missing; run npm run build first');
  process.exit(1);
}

const files = await walk(dist);
const hits = [];
for (const file of files) {
  if (/\.(map|png|jpg|jpeg|webp|woff2?|ttf)$/i.test(file)) continue;
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  for (const value of secretValues) {
    if (text.includes(value)) hits.push(`${path.relative(root, file)} contains a configured secret value`);
  }
  for (const pattern of patterns) {
    if (pattern.re.test(text)) hits.push(`${path.relative(root, file)} contains a ${pattern.label}`);
  }
}

if (hits.length) {
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log(
  `PASS  ${files.length} browser assets contain no configured server secret values or credential patterns`,
);
