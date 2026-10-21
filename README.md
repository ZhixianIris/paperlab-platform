# PaperLab / 纸研所

A natural-language, local-first PDF/image workspace with a real multi-tenant
CloudBase PostgreSQL backend. Users drop a file, describe the change in Chinese,
confirm a plan, execute in the browser, preview and download. AI planner quotas,
balances, orders, tenants and admin actions live in CloudBase.

> **Honest delivery status:** all offline code, PostgreSQL migrations, RLS,
> transaction billing, provider adapter, admin/tenant UI, tests and declarative
> deployment are implemented. GitHub Actions verification is green
> ([PR CI run 39630410165](https://github.com/ZhixianIris/paperlab-platform/actions/runs/39630410165),
> [main verification run 39631026730](https://github.com/ZhixianIris/paperlab-platform/actions/runs/39631026730));
> the CloudBase **deploy job is skipped** because no environment or credentials
> were supplied. Therefore there is no production URL and no real
> CloudBase/AI/payment acceptance result. See
> [docs/BLOCKED_EXTERNAL.md](docs/BLOCKED_EXTERNAL.md),
> [docs/evidence/github-actions.md](docs/evidence/github-actions.md) and
> [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

- Repository: https://github.com/ZhixianIris/paperlab-platform
- Verified feature commit on `main`: `51e1404f333e0831e5233612c9a0290a8a37b112`
- PR: https://github.com/ZhixianIris/paperlab-platform/pull/6
- PR CI: https://github.com/ZhixianIris/paperlab-platform/actions/runs/39630410165
- Main verification: https://github.com/ZhixianIris/paperlab-platform/actions/runs/39631026730
  (deploy skipped; no credentials)


## What is implemented

- Three tool workbenches: `/pdf`, `/image`, `/ai`; root redirects to `/pdf`.
  Tool pages, `/login`, `/account`, `/t/:tenantSlug`, `/admin` share one site.
- MiniMax-inspired white canvas, bundled DM Sans, black pill actions and gradient
  tool cards.
- PDF toolbox: 23 local tools for pages, watermarks, forms, image conversion and scan cleanup.
- Image toolbox: 18 local tools including rotate, mirror, tone/filter adjustment, watermark, borders,
  region mosaic/blur/solid mask, color-key transparency, collages and batch operations.
- Browser-local operations run without file upload, file fingerprinting or analytics.
- Deterministic local parsing handles common commands with no network; ambiguous
  commands offer clarification or, for signed-in tenant members, `ai.plan`.
- `ai.plan` sends only the prompt plus random file IDs and minimal metadata. It
  never receives PDF/image bytes, Base64, names or document text.
- Server-side planner quotas are stored in PostgreSQL; `ai.plan` has its own tenant
  switch and strict allowlisted JSON output validated again in the browser.
- OPFS + IndexedDB drafts are opt-in, scoped by user/tenant, restorable and
  clearable. No cloud file/version library is created.
- Image crop/resize are direct-manipulation editors with draggable handles; no
  coordinate/size inputs. Crop works fully offline.
- CloudBase Auth email/password + email OTP signup through `@cloudbase/js-sdk`.
- CloudBase PG schema with 13 tables (including `ai_plan_requests`), GRANT + RLS,
  security-definer membership helpers and an immutable ledger/audit log.
- Seven forward-only SQL migrations; planner calls are free in Wave B and never
  touch the existing wallet ledger.
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
- 30 API/RLS/planner tests, 19 unit tests and 45 Playwright journeys. The
  browser tests cover actual PDF/image output, the natural-language workspace,
  planner payload privacy, offline execution, OPFS draft restore, branded
  tenant tool availability, drag-handle editing and two-tenant isolation.
- Branded tenant workbenches honor the admin tool-switch configuration when
  opened with `?tenant=<slug>`; public local tools remain freely accessible.

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
harness. AI screenshots use the local deterministic fixture provider; its
display name is generic in the UI and it is not a real provider result.

| | |
| --- | --- |
| **PDF workbench** ![PDF workbench](docs/screenshots/pdf-workbench.png) | **Image workbench** ![Image workbench](docs/screenshots/image-workbench.png) |
| **Natural-language workspace** ![AI workspace](docs/screenshots/ai-workspace.png) | **Login** ![Login](docs/screenshots/login.png) |
| **Offline workspace result** ![Offline workspace](docs/screenshots/workspace-offline-result.png) | **AI studio** ![AI studio](docs/screenshots/ai-studio.png) |
| **Drag-to-crop editor** ![Image crop](docs/screenshots/image-crop.png) | **Drag-to-resize editor** ![Image resize](docs/screenshots/image-resize.png) |
| **PDF merge, never uploaded** ![PDF merge](docs/screenshots/pdf-merge.png) | **Offline PDF merge proof** ![Offline merge](docs/screenshots/offline-pdf-merge.png) |
| **Tenant workspace with budgets** ![Tenant](docs/screenshots/tenant-alpha.png) | **Admin overview** ![Admin overview](docs/screenshots/admin-overview.png) |
| **Admin tenant and member controls** ![Admin](docs/screenshots/admin-tenants.png) | **Admin model and price controls** ![Admin models](docs/screenshots/admin-models.png) |

More evidence: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md),
[docs/screenshots/](docs/screenshots/).

## Third-party and license

OmniTools is fixed at commit
`dda3a240772459035eb38b14c5c7d94e81626116` (MIT). See
[third_party/omni-tools/SOURCE.md](third_party/omni-tools/SOURCE.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). `npm run audit:licenses`
fails closed on AGPL/GPL/SSPL/BUSL/unknown production licenses.

## PDF and image tool boundaries

- Structural PDF operations preserve native content where possible; raster PDF compression, grayscale
  and light-background cleanup are lossy and may discard selectable text.
- Image color-key transparency only handles uniform backgrounds, not AI semantic extraction.
- A solid mask overwrites selected output pixels. Mosaic/blur effects are cosmetic and not
  sufficient for confidential information redaction.
- Image metadata is re-encoded for common EXIF removal, but no forensic claim is made.
- Every added tool shares the existing React workbench, tenant switchboard and CloudBase schema.
- New image tools are currently under pull-request verification and require passing browser
  journeys before being treated as released.

## Not ready for public paid operation

There is no merchant credential, signed payment callback, ICP filing, domain,
or real model key. The platform must **not** be described as publicly available
paid SaaS until those conditions and the applicable generative-AI compliance
review are complete.
