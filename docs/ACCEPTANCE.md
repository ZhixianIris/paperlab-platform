# Acceptance status

Sampled at the local verification stage, before pushing the repository to
GitHub. External items are not represented as passed.

## Completion matrix

| Area | Status | Evidence / boundary |
| --- | --- | --- |
| Single React site, all required routes | **PASS** | Production and E2E builds; route smoke through Playwright |
| Reuse of OmniTools / pdf-lib / PDF.js with fixed licenses | **PASS** | OmniTools commit `dda3a240…`, MIT preserved; pdf-lib 1.17.1; pdfjs-dist 5.4.149 |
| Local PDF merge/split/rotate | **PASS** | 3 Vitest PDF tests + Playwright merge/split/rotate; offline merge preserves text layer |
| Local image crop/resize/convert/compress | **PASS** | Playwright offline crop; resize/convert/compress downloads verified |
| No implicit upload / no analytics | **PASS** | Offline browser journeys; request listeners found no network calls during local operations |
| CloudBase Auth integration (code) | **PASS (code)** | `@cloudbase/js-sdk` 3.10.3, real sign-in/sign-up/OTP/session calls; not run against a real environment |
| CloudBase Auth verified in a real environment | **BLOCKED_EXTERNAL** | No environment id/publishable key/Auth setup |
| PG schema, migrations, constraints, indexes | **PASS (local PG 16)** | 3 migrations applied cleanly to PostgreSQL 16 |
| RLS + GRANT + recursive-policy avoidance | **PASS (local PG 16)** | Direct authenticated/anon sessions tested; no client writes; cross-tenant isolation |
| RLS verified on actual CloudBase PG | **BLOCKED_EXTERNAL** | No CloudBase PG connection |
| Multi-tenant admin/tenant features on real data | **PASS (local real Postgres)** | Two tenant journeys + admin create/members/tools/models/credits; no static/mock rows |
| One event function with trusted UID | **PASS (code)** | Runtime `TCB_UUID` (same value as `auth.getUserInfo().uid`); body userId/role/price ignored; integration tests |
| CloudBase function invocation verified | **BLOCKED_EXTERNAL** | No deployed environment |
| AI provider adapter contract | **PASS (local HTTP contract)** | OpenAI Images request/parse, 4xx definite, 5xx uncertain, timeout, unconfigured registry |
| Real AI image generation | **BLOCKED_EXTERNAL** | No provider API key; fixture provider is test-only and labelled |
| Reserve/settle/release/reconcile transaction billing | **PASS (local PG 16)** | 23 API tests: idempotency, concurrency, budgets, rate limits, failure states, ledger immutability |
| Real provider billing / real money | **BLOCKED_EXTERNAL** | Depends on real AI/payment credentials |
| Payment API + disabled boundary | **PASS (boundary) / BLOCKED (provider)** | `orders.create` returns `payments_disabled`; no fake order/payment; callback not implemented |
| Declarative config v2.1 + CLI 3.8.4 | **PASS (static/official validate)** | `tcb validate` → `valid: true`; config/workflow guard checks 42/42 |
| GitHub PR does not deploy | **PASS (workflow design)** | `ci.yml` has no deploy command; deploy only in main workflow |
| Actual GitHub Actions run | **PENDING PUSH / BLOCKED until repo creation** | Repo URL and run id to be added after the push |
| Actual CloudBase deploy / public URL | **BLOCKED_EXTERNAL** | No credentials; no URL can be honestly supplied |
| SPA fallback `/admin`, `/t/*` | **PASS (local preview routing)**; **BLOCKED (CloudBase error-document setting)** | App uses BrowserRouter; deploy script sets hosting error document and smoke tests it |
| License audit | **PASS** | 705 packages audited locally / 707 on the Linux CI runner; 0 denied; AGPL/GPL/SSPL/BUSL fail closed; one reviewed dev-only CloudBase no-license package, not distributed |
| Browser secret scan | **PASS** | `verify:build` finds no configured secret values/credential patterns |
| Production dependency security | **PASS (high)** | `npm audit --omit=dev --audit-level=high` exits 0; remaining 2 moderate React Router v6 advisories are SSR/backslash classes, mitigated (no SSR; `next` redirect sanitized) |
| Domain/ICP/AI compliance | **BLOCKED_EXTERNAL** | Not supplied |

## Executed test evidence

```text
npm run test:unit
3 PDF tests passed
(parse/validation, merge + native text layer, extract + additive rotate)

npm run test:api
23 tests passed
(OpenAI adapter contract, auth/tenant authz, real PostgreSQL billing, idempotency,
concurrent retry, budgets, rate limits, provider definite/uncertain handling,
admin reconciliation, RLS, immutable ledger/audit, payments disabled)

npx playwright test
9 tests passed
(AI success + charge delta, insufficient balance, anonymous gates, Alice/Bob
isolation, admin CRUD journey, offline PDF merge with text-layer assertion,
split/rotate, offline image crop, resize/convert/compress)

Offline tests write `offline-pdf-merge.png`, `offline-image-crop.png` and
`offline-network-log.json` into Playwright's artifact directory. Both logs
record zero HTTP requests during the local operation.

npm run audit:licenses
705 locally and 707 on Linux CI, 0 denied

node tcb validate --json
{"valid":true,"errors":[],"warnings":[]}

npm run validate:deploy
42/42 checks passed
```

### What the E2E environment is

The browser suite runs against a local HTTP harness that invokes the **same**
`platform-api` handler and a **real local PostgreSQL 16** database. It injects a
test-only identity token (`TEST_AUTH_SECRET`, `APP_ENV=test`) and a deterministic
fixture image provider. This validates authorization and billing state
transitions without claiming a real CloudBase deployment or a real model result.
The fixture model is visibly labelled "Fixture Image (test only)".

## Reproducible local commands

```bash
docker run --name paperlab-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=paperlab -p 5433:5432 -d postgres:16
set DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/paperlab
npm ci
npm run db:setup
npm run test:api
npm run test:unit
npm run build
npm run build:e2e
npx playwright test
npm run validate:deploy
npx tcb validate --json
```

## Screenshots

See [docs/screenshots/](screenshots/). They are local E2E evidence taken from
real running UI backed by PostgreSQL. The AI model shown is explicitly the test
fixture, not an external provider.

- [home.png](screenshots/home.png)
- [login.png](screenshots/login.png)
- [account.png](screenshots/account.png)
- [tenant-alpha.png](screenshots/tenant-alpha.png)
- [ai-studio.png](screenshots/ai-studio.png)
- [pdf-merge.png](screenshots/pdf-merge.png)
- [offline-pdf-merge.png](screenshots/offline-pdf-merge.png)
- [offline-image-crop.png](screenshots/offline-image-crop.png)
- [image-crop.png](screenshots/image-crop.png)
- [admin-overview.png](screenshots/admin-overview.png)
- [admin-tenants.png](screenshots/admin-tenants.png)
- [admin-models.png](screenshots/admin-models.png)

## Failures

No local test failed at the reported snapshot. `npm run typecheck`, `npm run
lint`, `npm run build`, `npm run verify:build`, `npm run audit:licenses`,
`npm run validate:deploy` and official `tcb validate` all exited 0.

## Cannot be marked complete without external inputs

- Real CloudBase login, RLS-on-CloudBase, function invocation and URL.
- Real AI provider output and settlement.
- Real payment/order/refund with a merchant.
- ICP domain and public AI compliance.
