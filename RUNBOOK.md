# Runbook — PaperLab CloudBase deployment

This is the one-time setup and operating guide. Until every item under
**External inputs** exists, the deployment job will deliberately skip and the
platform remains a restricted local/test build.

## 0. External inputs

| Input | Where it goes | Required |
| --- | --- | --- |
| CloudBase **PG-mode** environment id | GitHub variable `TCB_ENV_ID` | yes |
| CloudBase Publishable Key | GitHub variable `VITE_CLOUDBASE_PUBLISHABLE_KEY` | yes |
| Restricted CAM SecretId / SecretKey | GitHub secrets `TCB_SECRET_ID`, `TCB_SECRET_KEY` | yes |
| PostgreSQL host/user/password/database | GitHub secrets `PGHOST`, `PGUSER`, `PGPASSWORD`; variables `PGDATABASE`, `PGPORT`, `PGSSL` | yes |
| OpenAI image API key + allowed model | GitHub secret `OPENAI_API_KEY`; variable `OPENAI_BASE_URL` | optional; image generation stays blocked without it |
| Text planner key/model | GitHub secret `AI_TEXT_API_KEY`; variables `AI_TEXT_MODEL`, `AI_TEXT_BASE_URL`, `AI_TEXT_PROVIDER` | optional; complex instructions stay local-only/blocked without it |
| Payment merchant credentials, signed callback, refunds | not wired; leave `PAYMENTS_ENABLED=false` | blocked |
| Domain + ICP filing + generative-AI compliance | external | blocked for public paid operation |

Never put these values into `cloudbaserc.json`, the repo, browser build
arguments other than `VITE_CLOUDBASE_PUBLISHABLE_KEY`, or logs.

## 1. Create and configure CloudBase PG

1. Create a **PG-mode** CloudBase environment in the intended region.
2. Enable **身份认证 (CloudBase Auth)**. Enable email/password and the email OTP
   provider used by `signUp`; configure sender/templates and allowed security
   domains for the hosting domain.
3. Create a **Publishable Key** under environment API keys.
4. Open the PostgreSQL connection information and record host, port, database,
   user and password. Use `PGSSL=true` for CloudBase. These credentials belong
   only in GitHub Secrets and the function runtime environment.
5. Create a restricted CAM sub-account for CI. Limit it to this environment /
   region and the resources used by declarative CLI deployment (function,
   hosting/COS, CloudBase database migration, gateway/CAM reads). Do not use the
   root account. Do not rely on environment-level `api_key` availability.
6. Optional: create a separate staging environment and duplicate the variables
   under a GitHub Environment.

## 2. GitHub repository setup

1. Push this repository to GitHub. `main` is the production branch.
2. Add repository **variables**:

   | Name | Example |
   | --- | --- |
   | `TCB_ENV_ID` | `paperlab-prod-xxxx` |
   | `TCB_REGION` | `ap-shanghai` |
   | `VITE_CLOUDBASE_PUBLISHABLE_KEY` | `eyJ...` |
   | `PGPORT` | `5432` |
   | `PGDATABASE` | `postgres` |
   | `PGSSL` | `true` |
   | `OPENAI_BASE_URL` | `https://api.openai.com/v1` |
   | `AI_TEXT_PROVIDER` | `openai` |
   | `AI_TEXT_MODEL` | `gpt-4o-mini` |
   | `AI_TEXT_BASE_URL` | `https://api.openai.com/v1` |

3. Add repository **secrets**:

   `TCB_SECRET_ID`, `TCB_SECRET_KEY`, `PGHOST`, `PGUSER`, `PGPASSWORD`,
   optionally `OPENAI_API_KEY` and `AI_TEXT_API_KEY`.

4. Create a GitHub Environment named `production` (no required reviewer needed
   for automatic pushes). Add the same variables/secrets there instead of at
   repository scope if you prefer environment-scoped credentials.
5. Protect `main` so only reviewed merges or explicit pushes deploy.
6. Windows local note: environment variables are passed to child processes with
   `$env:NAME = "value"`; do not commit an `.env` file.

### What happens on a push

- `ci.yml` runs on pull requests only. It never has deploy commands.
- `deploy.yml` runs on `main` / manual dispatch:
  1. preflight checks required credentials;
  2. full verification via the reusable `ci.yml` (Postgres 16 service, tests,
     builds, Playwright);
  3. if credentials are absent, the deploy job is skipped with a warning;
  4. otherwise pinned `@cloudbase/cli@3.8.4` logs in, runs `tcb validate`,
     `tcb app build`, `tcb deploy --dry-run`, then `tcb deploy --yes`;
  5. after deploy, `deploy:configure` sets the static hosting error document to
     `index.html` with original status disabled, so `/admin` and `/t/*` refresh;
  6. `deploy:smoke` checks `/`, `/admin`, `/t/smoke-route`, function DB health
     and anonymous rejection of a tenant read.

The deploy concurrency group is fixed; two production deploys never interleave.
No step uses `continue-on-error`.

## 3. First deployment

1. Ensure all required GitHub values above exist and `.github/workflows/deploy.yml`
   is on `main`.
2. Push/merge to `main`.
3. Watch the **Deploy production** workflow. Until this succeeds there is no
   production URL.
4. The smoke step prints the public hosting URL and writes it to
   `PUBLIC_URL`/`APP_ORIGIN` in the GitHub environment. Copy it to the
   `APP_ORIGIN` repository variable for future runs if desired.
5. Run `tcb db pg migration list -e "$TCB_ENV_ID"` to confirm all SQL migrations
   are applied. The CLI records them in `cloudbase_migrations.schema_migrations`.

### Known first-run caveats

- The default CloudBase hosting domain has rate limits. Bind a custom domain for
  real traffic; China-mainland domains need ICP filing.
- The static hosting service must already be enabled for the environment.
- If the manager cannot set the error document, deployment fails at
  `deploy:configure`; fix hosting permissions instead of skipping it.
- If the CAM policy cannot create the function or read hosting details, fix the
  restricted policy. Do not broaden to root credentials.

## 4. Bootstrap a platform administrator

Never auto-promote the first signup. The person must first register a CloudBase
Auth account (the email OTP flow on `/login`).

Then, from a trusted machine with the PostgreSQL connection info:

```bash
export DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/postgres'
export PGSSL=true
npm ci
npm run admin:grant -- --email admin@example.com --note "initial platform owner"
```

The command inserts the Auth UID into `public.platform_admins`, the only table
queried by `is_platform_admin()` and never writable from the client. Sign out and
sign in again to refresh the session bootstrap.

## 5. Create the first tenants and model catalog

1. Sign in as the platform admin and open `/admin`.
2. Create a tenant for each customer (slug is immutable).
3. Add an owner by the email that already exists in CloudBase Auth.
4. Each tenant receives a wallet at zero and enabled defaults for all tools.
5. Under **AI 模型与价格**, set a per-image price, max images, prompt limit,
   monthly platform cost cap, and keep the model disabled until the provider key
   is confirmed.
6. Set a tenant monthly AI budget and per-job cost cap in the tenant panel.
7. Credit a tenant only through **人工入账** (an auditable manual adjustment).
   This is not a payment and must not be described as one.

## 6. Enable real AI (only with a key)

1. Add `OPENAI_API_KEY` in GitHub Secrets and deploy `main` again. The function
   runtime gets the key; the browser bundle does not.
   For complex natural-language planning also add `AI_TEXT_API_KEY` (and
   optionally `AI_TEXT_MODEL`/`AI_TEXT_BASE_URL`). Without it, the workspace
   still executes deterministic local commands and shows a real unavailable state.
   The planner receives prompt + random file metadata only; never file bytes.
2. In `/admin` → models, keep the model provider as `openai` and enable it.
3. In the tenant AI page, confirm the model shows a price and "可用", not
   "供应商密钥未配置".
4. Verify one real request: wallet reserve, usage, ledger, job success. This is
   the only path that counts as real AI acceptance.
5. If the provider times out or returns an ambiguous result, the job enters
   `pending_reconciliation` with funds still reserved. Use `/admin` → AI 任务 to
   verify the upstream outcome before choosing **释放** (release) or **按已消费**
   (settle). Never blind-refund an unknown upstream result.

Model prompts are sent to the provider when AI is used, so publish a clear
privacy notice and obtain any required user/tenant consent before enabling this
in production.

## 7. Payment boundary

`PAYMENTS_ENABLED=false` is intentional and enforced by the server. There is no
payment provider implementation with signing, because no merchant credentials
exist. Do not turn the flag on and expect orders to work.

To enable payments later, all of the following are required, in code and tests:

- a real provider adapter with merchant credentials kept only in function env;
- signed callback verification (timestamp, nonce, certificate/key, replay
  protection);
- unique `payment_events` insert, amount/currency/order matching, idempotent
  wallet top-up and ledger entry;
- paid/failed/refund/cancelled lifecycle and reconciliation;
- an HTTP route to receive the callback (the current single Event function has
  no public HTTP ingress);
- payment/refund/E2E acceptance with a real sandbox merchant account.

Until then the UI must say **充值暂未开放**.

## 8. Database migrations and rollback

- Production migrations live in `cloudbase/migrations/` and are applied by
  `tcb deploy` before functions/hosting.
- Applied migrations are immutable. If one is wrong, add a new timestamped
  migration. Never edit history, drop the database, or re-run destructive SQL.
- `tcb db pg migration list -e "$TCB_ENV_ID"` compares local and remote state.
- A migration failure stops deployment. The existing site remains in place.
- Hosting uses `verify: true` and `safe: true`; a failed upload/verification
  rolls back to the previous hosting version.
- To roll back application code, revert the offending commit and push `main`.
  Do not "repair" state with an ad-hoc script.

## 9. Operating checks

```bash
# public routes (SPA fallback must return 200 HTML)
curl -I https://YOUR_DOMAIN/
curl -I https://YOUR_DOMAIN/admin
curl -I https://YOUR_DOMAIN/t/anything

# function health (no secret values printed)
tcb fn invoke platform-api --params '{"action":"health","payload":{}}' --json

# RLS smoke as the built-in read-only role
tcb db execute -e "$TCB_ENV_ID" --role cloudbase_read_only_user \
  --sql "select tablename, rowsecurity from pg_tables where schemaname='public' order by 1"

# recent migrations
tcb db pg migration list -e "$TCB_ENV_ID"
```

Review `/admin` pending jobs daily. A pending reconciliation is not a refund
request; it is a decision point.

## 10. Known external blockers

- No CloudBase PG environment id, CAM credential, Publishable Key or PG
  connection was supplied, so no real URL, login, RLS-on-CloudBase, AI or deploy
  has been verified.
- No real image-provider key: AI acceptance is blocked.
- No payment merchant credentials/callback: recharge must stay closed.
- No ICP-filed domain or generative-AI compliance review: do not publicly
  operate/charge.
- Default hosting domain is not a production domain.
- The initial GitHub repository must be created/pushed by the owner if it does
  not already exist. CI results only exist after that push.
