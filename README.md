# PaperLab / 纸研所

Local-first PDF and image tools plus a real multi-tenant CloudBase PostgreSQL AI
workspace. User files never leave the browser for the seven local tools. AI
jobs, balances, orders, tenants and admin actions live in CloudBase.

> **Honest delivery status:** all offline code, PostgreSQL migrations, RLS,
> transaction billing, provider adapter, admin/tenant UI, tests and declarative
> deployment are implemented and locally verified. **No CloudBase environment or
> credentials were supplied**, so there is no production URL and no real
> CloudBase/AI/payment acceptance result. See
> [docs/BLOCKED_EXTERNAL.md](docs/BLOCKED_EXTERNAL.md) and
> [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

## What is implemented

- One React/Vite site: `/`, `/pdf/*`, `/image/*`, `/ai`, `/login`, `/account`,
  `/t/:tenantSlug`, `/admin`.
- Local-only PDF merge, split, rotate (pdf-lib), image crop, resize, convert and
  compress; PDF.js preview; no file upload, no file fingerprint, no analytics.
- CloudBase Auth email/password + email OTP signup through `@cloudbase/js-sdk`.
- CloudBase PG schema with 12 tables, GRANT + RLS, security-definer membership
  helpers avoiding recursive `memberships` policies, immutable ledger/audit log.
- One `platform-api` Event function: trusted invocation identity, tenant authz,
  server pricing, reserve → provider → settle/release/hold, idempotency, rate
  limits, user/tenant/model budgets, admin reconciliation and manual credits.
- Abstract image provider with OpenAI Images adapter and a test-only fixture
  provider. Without a key the model is reported as unconfigured and generation
  is rejected before any charge.
- Payment boundary deliberately disabled. No fake payment success, no fake order.
- `cloudbaserc.json` v2.1, pinned CLI 3.8.4, PR CI with no deploy, main-only
  production deploy, database migrations before release, SPA fallback and public
  smoke tests after release.
- 23 API/RLS/provider tests, 3 PDF unit tests and 9 Playwright journeys. The
  browser tests include offline PDF and image journeys and two-tenant isolation.

## Local development

Requirements: Node 22, npm, a PostgreSQL 16 database (Docker works).

```bash
# PostgreSQL
docker run --name paperlab-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=paperlab -p 5433:5432 -d postgres:16

# Install the single workspace lockfile
npm ci

# Local auth compatibility + production migrations
$env:DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5433/paperlab"
npm run db:setup

# Run the browser app
npm run dev
```

The local-only tools work with no CloudBase configuration. Login, tenant data
and AI require a deployed `platform-api` and a configured Publishable Key. The
Playwright harness runs the same function handler against real PostgreSQL and a
test-only identity/fixture-provider boundary; it is not used in production.

## Verification

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:api          # requires DATABASE_URL and migrated DB
npm run build
npm run verify:build      # no server secrets in browser assets
npm run audit:licenses
npm run audit:security
npm run validate:deploy
npm run test:e2e          # builds dist-e2e and starts the local harness
```

`npm run test:e2e` requires Chromium: `npx playwright install chromium`.

## Architecture

```mermaid
flowchart LR
  Browser[React SPA] -->|local processing| Device[Browser memory]
  Browser -->|CloudBase Auth| Auth[CloudBase Auth]
  Browser -->|callFunction| API[platform-api Event function]
  API -->|trusted TCB context uid| Authz[authz]
  Authz --> PG[(CloudBase PostgreSQL)]
  API -->|trusted price + tx| Billing[billing]
  Billing --> PG
  API -->|server-side key| Provider[OpenAI Images]
  Browser -->|RLS-filtered reads only| PG
  Deploy[GitHub Actions] -->|tcb deploy| CloudBase[CloudBase environment]
```

The browser uses the event function for tenant/admin/AI actions. It never sends a
price, user id, role or balance. The database still grants only `SELECT` to
`authenticated` and protects every row with RLS as defense in depth.

## Repository map

```text
web/                      React/TypeScript single site
functions/platform-api/   one Event function and deep modules
cloudbase/migrations/     production SQL migrations
cloudbaserc.json          single v2.1 environment declaration
.github/                  PR CI, main deploy, reusable verification
tests/                    DB bootstrap, API/RLS tests, Playwright E2E
scripts/                  migration, admin grant, deploy, smoke, licence checks
third_party/omni-tools/   fixed MIT source provenance + license
docs/                     architecture, acceptance, blockers, screenshots
```

## Deployment in one line

After the one-time CloudBase/GitHub setup in [RUNBOOK.md](RUNBOOK.md):

```bash
git push origin main
```

CI verifies the repo, applies migrations, deploys the function and hosting,
configures the SPA error-document fallback, and smoke-tests `/`, `/admin`, a
tenant deep link and the function's DB/auth boundary. If credentials are absent,
the deploy job reports a warning and is skipped; it never fakes a deployment.

## Screenshots

All screenshots come from the real local UI backed by PostgreSQL and the E2E
harness. The model card is explicitly labelled as the test fixture; it is not a
real AI provider result.

| | |
| --- | --- |
| **Local-first landing** ![Landing](docs/screenshots/home.png) | **PDF merge, never uploaded** ![PDF merge](docs/screenshots/pdf-merge.png) |
| **Offline PDF merge proof** ![Offline merge](docs/screenshots/offline-pdf-merge.png) | **Image crop with local result** ![Image crop](docs/screenshots/image-crop.png) |
| **Tenant workspace with budgets** ![Tenant](docs/screenshots/tenant-alpha.png) | **AI studio, server-priced** ![AI studio](docs/screenshots/ai-studio.png) |
| **Admin tenant and member controls** ![Admin](docs/screenshots/admin-tenants.png) | **Admin model and price controls** ![Admin models](docs/screenshots/admin-models.png) |

More evidence: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md),
[docs/screenshots/](docs/screenshots/).

## Third-party and license

OmniTools is fixed at commit
`dda3a240772459035eb38b14c5c7d94e81626116` (MIT). See
[third_party/omni-tools/SOURCE.md](third_party/omni-tools/SOURCE.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). `npm run audit:licenses`
fails closed on AGPL/GPL/SSPL/BUSL/unknown production licenses.

## Not ready for public paid operation

There is no merchant credential, signed payment callback, ICP filing, domain,
or real model key. The platform must **not** be described as publicly available
paid SaaS until those conditions and the applicable generative-AI compliance
review are complete.
