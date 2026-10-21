# Security model

## Trust boundaries

1. **Local tools** never make a network request to process a file. Files are read
   into browser memory, transformed with pdf-lib / Canvas /
   browser-image-compression, and downloaded as blobs. A PDF.js preview loads the
   same local bytes; it is not an upload.
2. **CloudBase Auth** is the only login system. The platform does not store
   passwords, password hashes or auth sessions.
3. **platform-api** is the only mutation and paid-operation boundary. The caller
   UID comes from the trusted cloud-function invocation context. CloudBase
   injects it as `TCB_UUID` / `TCB_ISANONYMOUS_USER`; this is the exact value
   returned by the official Node SDK's `auth.getUserInfo().uid`. The function
   reads those runtime keys directly to avoid shipping the SDK's unrelated
   NoSQL/axios/lodash dependency tree. Body fields named `userId`, `role`,
   `price` or `tenantId` are ignored for identity and pricing.
4. **PostgreSQL RLS** is a second boundary for any client that talks to
   PostgREST directly. Clients receive only `SELECT`; no client can insert,
   update or delete business tables. Service-role/direct PG access exists only
   inside the function.

## Tenant isolation

- Membership checks happen server-side for every tenant/admin action.
- RLS policies call `SECURITY DEFINER` helpers (`is_tenant_member`,
  `is_tenant_owner`, `is_platform_admin`, `can_access_tenant`) with a pinned
  `search_path`. This avoids recursive policies on `memberships`.
- `anon` has no table grants. `authenticated` has GRANT + RLS.
- Platform-admin status is stored only in `platform_admins`, populated by the
  explicit `npm run admin:grant` command. There is no first-user auto-promotion
  and no client endpoint to grant it.
- Tests cover Alice→Alpha / Bob→Beta, cross-tenant reads, direct PostgREST-style
  RLS sessions, missing writes and anon denial.

## Billing invariants

- Prices, currency, max images, budget caps and enabled state come from
  `model_prices`; the client cannot submit a price.
- Balance operations are integer CNY cents.
- A paid operation runs in a PostgreSQL transaction:
  1. lock tenant/membership; validate active tenant, tool, model, price, image
     count, user/tenant/model monthly budget, rate limit;
  2. atomically move available → reserved and insert `ai_jobs` + reserve ledger;
  3. commit, then call the provider outside the transaction;
  4. success → same amount reserved is settled and `usage_records` + settle
     ledger are inserted;
  5. definite failure → reserved returns to available with a release ledger;
  6. timeout/network/5xx/5xx-like ambiguity/settlement failure → funds remain
     reserved with `pending_reconciliation`;
  7. an admin must explicitly release or settle a pending job.
- `(tenant_id, request_id)` is unique. Retrying with the same request ID and
  identical parameters returns the original job and never charges again;
  changing parameters under the same ID is a conflict.
- `wallet_ledger` and `audit_log` have triggers that reject `UPDATE`/`DELETE` for
  every role, including service operations. Corrections must be new entries.
- `usage_records.job_id` is unique, preventing double usage on a settle retry.
- Tenant and user monthly budget checks include both settled usage and currently
  held reservations.
- Manual admin credit writes an `adjustment` ledger entry and audit record. It is
  visibly not a payment.

## Limits

- Request payload < 64 KiB; prompt max 4,000 chars (model limit also enforced).
- Image count max 4; default model cap 1.
- Rate limits are per user and tenant per rolling minute, enforced from the DB.
- Provider request timeout defaults to 45 s; function timeout is 60 s.
- Result JSON is capped at 5 MB by default (`AI_RESULT_MAX_BYTES`). A larger
  result is held for reconciliation rather than silently charging.
- Tenant status can be `suspended`, which blocks AI and writes.
- Function errors return a stable code and safe message; provider response
  bodies, keys and prompts are not logged or returned in errors.

## Secrets

- Server keys are function environment variables injected from GitHub
  Secrets/variables at deploy:
  `OPENAI_API_KEY`, `PGPASSWORD`, `TCB_SECRET_KEY`, `TCB_SECRET_ID`,
  payment secrets (unused while payments are disabled).
- `VITE_CLOUDBASE_PUBLISHABLE_KEY` is the only key allowed in the browser. It is
  an `anon` JWT by design and is not a service key.
- `scripts/check-build-secrets.mjs` scans the built browser assets for configured
  secret values, credential-shaped provider keys, PostgreSQL credential URLs,
  Tencent secret IDs and private-key blocks.
- `.env` files are ignored; `.env.e2e` contains only local test toggles.
- Do not use root Tencent Cloud credentials in CI. Use a restricted CAM
  sub-account scoped to the CloudBase environment.

## Data and privacy

- Local tool files are not uploaded, fingerprinted or sent to a third party.
- AI prompts and generated images are stored in `ai_jobs` to provide the
  authenticated task history and billing audit. Images are base64 data URLs from
  the provider; if the provider returns a remote URL, the UI can display it.
- `auth.users` is managed by CloudBase Auth. Application tables use the Auth UID
  as a text identifier; no passwords are copied.
- Deleting an Auth user does not cascade-delete their historical ledger/job
  rows; tenant deletion is restricted to operators. A retention/data-deletion
  policy must be written before public launch.

## Residual risks / not claimed

- CloudBase actual RLS, Auth invocation context, direct PG connectivity and
  deployment are **not verified in this delivery** because no environment or
  credentials were supplied.
- The local E2E fixture provider is not an AI model. It only proves the state
  machine. Real AI acceptance is blocked until a provider key is configured.
- Payments are not implemented. There is no signature-verified callback,
  settlement with a merchant, refund or chargeback flow.
- The default hosting domain, lack of ICP filing and lack of generative-AI
  compliance review prevent public paid operation.
- There is no independent penetration test or formal SOC/ISO certification.
- `npm audit --omit=dev --audit-level=high` is clean. The remaining two
  **moderate** advisories are React Router v6 classes: one concerns SSR
  hydration (this is a client-only Vite SPA, no SSR) and one concerns open
  redirects through backslashes/user-controlled links. All links are static
  internal paths; the only user-controlled post-login destination is validated
  by `safeNext()` to a single leading slash with no backslash or protocol-relative
  prefix. Upgrading to React Router 7 is deferred as an unnecessary breaking
  change for this single-page app.
