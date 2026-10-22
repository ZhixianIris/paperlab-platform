#!/usr/bin/env node
/* Dependency licence audit. Fails closed on copyleft/network-copyleft and
 * unknown production licences; writes a full machine-readable inventory plus a
 * human-readable notice file. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const licenseChecker = require('license-checker');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'Python-2.0',
  'Unlicense',
  'Zlib',
  'AFL-2.1',
  'MPL-2.0',
  'OFL-1.1',
  'WTFPL',
]);

const DENIED = /(?:^|\b)(?:A?GPL|LGPL|SSPL|BUSL|Commons-Clause|EUPL)(?:\b|$)/i;
const REVIEWED_DEV_UNKNOWN = new Set(['@cloudbase/signature-nodejs@1.1.0']);

function tokenize(expression) {
  return String(expression || 'UNKNOWN')
    .replace(/[()]/g, ' ')
    .split(/\s+(?:AND|OR)\s+|\s+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function auditExpression(expression, name, version, entry) {
  const raw = String(expression || 'UNKNOWN');
  if (raw === 'UNLICENSED' && name.startsWith('paperlab')) return { verdict: 'own' };
  if (DENIED.test(raw)) return { verdict: 'denied', reason: 'copyleft/network-copyleft' };
  if (raw === 'UNKNOWN') {
    const key = `${name}@${version}`;
    if (REVIEWED_DEV_UNKNOWN.has(key)) {
      return {
        verdict: 'allowed',
        reason: 'reviewed CloudBase tooling dependency without package.json licence; dev-only, not distributed',
      };
    }
    return { verdict: 'denied', reason: 'unknown licence' };
  }
  const tokens = tokenize(raw);
  const unknown = tokens.filter((token) => !ALLOWED.has(token));
  if (unknown.length) {
    return { verdict: 'denied', reason: `unreviewed licence token(s): ${unknown.join(', ')}` };
  }
  const attribution = tokens.some((token) => token.startsWith('CC-BY') || token === 'AFL-2.1');
  return {
    verdict: 'allowed',
    reason: attribution ? 'permissive with attribution/source notice' : undefined,
  };
}

const raw = await new Promise((resolve, reject) => {
  licenseChecker.init({ start: root, json: true }, (error, result) => {
    if (error) reject(error);
    else resolve(result);
  });
});

const records = [];
const failures = [];
for (const [key, entry] of Object.entries(raw)) {
  const at = key.lastIndexOf('@');
  const name = key.slice(0, at);
  const version = key.slice(at + 1);
  if (name.startsWith('paperlab')) continue;
  const verdict = auditExpression(entry.licenses, name, version, entry);
  const record = {
    name,
    version,
    license: entry.licenses || 'UNKNOWN',
    repository: entry.repository || null,
    publisher: entry.publisher || null,
    path: path.relative(root, entry.path || ''),
    verdict: verdict.verdict,
    note: verdict.reason || null,
  };
  records.push(record);
  if (verdict.verdict === 'denied') failures.push(record);
}
records.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));

const allowed = records.filter((item) => item.verdict === 'allowed');
const counts = new Map();
for (const record of allowed) {
  counts.set(record.license, (counts.get(record.license) || 0) + 1);
}
const countRows = [...counts.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([license, count]) => `| ${license} | ${count} |`)
  .join('\n');

const direct = [
  ['React / React DOM', '18.3.1', 'MIT'],
  ['React Router DOM', '6.30.6', 'MIT'],
  ['@fontsource-variable/dm-sans', '5.3.0', 'OFL-1.1'],
  ['pdf-lib', '1.17.1', 'MIT'],
  ['pdfjs-dist', '5.4.149', 'Apache-2.0'],
  ['browser-image-compression', '2.0.2', 'MIT'],
  ['@cloudbase/js-sdk', '3.10.3', 'MIT / Apache-2.0 transitive (see inventory)'],
  ['pg', '8.16.3', 'MIT'],
  ['@cloudbase/manager-node (CI tooling only)', '5.9.1', 'ISC'],
  ['@playwright/test (CI only)', '1.55.0', 'Apache-2.0'],
];

const notices = `# Third-party notices

PaperLab includes and depends on third-party open-source software. This file is
generated from the installed npm tree by "npm run audit:licenses".

- Generated: ${new Date().toISOString()}
- Packages audited: ${records.length}
- Denied packages: ${failures.length}
- Full machine-readable inventory: [docs/dependency-licenses.json](docs/dependency-licenses.json)
- OmniTools source license: [third_party/omni-tools/LICENSE](third_party/omni-tools/LICENSE)

## Vendored source

Parts of the local PDF merge/split/rotate implementations are adapted from
**OmniTools** (https://github.com/iib0011/omni-tools) at commit
dda3a240772459035eb38b14c5c7d94e81626116, MIT licensed. The original MIT
license is preserved at third_party/omni-tools/LICENSE; modifications are
documented in third_party/omni-tools/SOURCE.md.

The ChatLayout/WelcomeMessage interaction pattern is adapted from
**@ant-design/agentic-ui** (https://github.com/antdigital-ai/agentic-ui) at
commit 685f0a4bc14e2ef1a736a678eedd9fdc2a7a5f95, MIT licensed. No upstream
package or antd runtime is bundled. See third_party/agentic-ui/SOURCE.md.

No AGPL, GPL, SSPL, BUSL, Commons Clause or unreviewed production-license
component is used. If a future dependency introduces one, "audit:licenses"
fails CI.

## Direct production and CI dependencies

| Package | Version | License |
| --- | --- | --- |
${direct.map((row) => `| ${row[0]} | ${row[1]} | ${row[2]} |`).join('\n')}

## Licence distribution (audited packages)

| License | Packages |
| --- | --- |
${countRows}

## Attribution and source-notice packages

Packages under CC-BY / AFL expressions require attribution or source notices.
Their names, versions, repositories and publishers are present in the full
inventory. Review that file when redistributing a packaged binary.

## CloudBase tooling caveat

\`@cloudbase/signature-nodejs@1.1.0\` is pulled only by the deployment tool
\`@cloudbase/manager-node\` and has no \`license\` field in its package metadata.
It is **not included in the browser bundle or the deployed cloud function**
(those use \`@cloudbase/signature-nodejs@2.2.2\`, Apache-2.0). It is recorded as a
reviewed dev-only exception rather than represented as a production dependency.
`;

await fs.mkdir(path.join(root, 'docs'), { recursive: true });
await fs.writeFile(
  path.join(root, 'docs/dependency-licenses.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), packages: records }, null, 2)}\n`,
);
await fs.writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), notices);
await fs.writeFile(
  path.join(root, 'docs/license-audit.md'),
  `# Licence audit result\n\n- Packages: ${records.length}\n- Allowed: ${allowed.length}\n- Denied: ${failures.length}\n- Unknown reviewed dev-only: ${records.filter((item) => item.note?.includes('reviewed CloudBase')).length}\n\n${failures.length === 0 ? 'PASS: no denied licences.' : failures.map((failure) => `FAIL: ${failure.name}@${failure.version} (${failure.license}) — ${failure.note}`).join('\n')}\n`,
);

for (const record of records.filter((item) => item.note)) {
  console.log(`${record.verdict.toUpperCase()}  ${record.name}@${record.version} — ${record.note}`);
}
if (failures.length) {
  for (const failure of failures) {
    console.error(`DENIED  ${failure.name}@${failure.version} (${failure.license}) — ${failure.note}`);
  }
  process.exit(1);
}
console.log(`PASS  ${records.length} dependency licences audited; no denied licences`);
