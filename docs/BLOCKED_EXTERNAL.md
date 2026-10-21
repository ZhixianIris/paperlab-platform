# External blockers

These are the only items that cannot be completed from the local workspace. Do
not treat any of them as passed.

## 1. CloudBase actual environment — `BLOCKED_EXTERNAL`

Missing:

- PG-mode CloudBase environment id
- CAM sub-account SecretId/SecretKey with deployment permissions
- environment Publishable Key
- PostgreSQL direct-connection host/user/password/database
- Auth provider setup (email/OTP sender, allowed security domain)

Consequence: no public URL, no actual CloudBase login, no actual PG+RLS
verification, no actual `tcb deploy`, no real function invocation, no cloud
smoke result. The repository contains the complete deployment path and official
`tcb validate` passes locally.

Exact required GitHub variables/secrets are listed in
[RUNBOOK.md](../RUNBOOK.md#0-external-inputs).

## 2. Real image model — `BLOCKED_EXTERNAL`

Missing: `OPENAI_API_KEY` (or another reviewed provider adapter and key) and an
approved model name. The adapter is implemented and contract-tested; the UI
shows “未配置” and refuses to create a charge when the key is absent. The local
E2E fixture is a deterministic test provider, not a model.

## 3. Payments — `BLOCKED_EXTERNAL`

Missing: WeChat Pay / Alipay merchant credentials, merchant certificate/API v3
key, signed callback endpoint and sandbox acceptance. There is intentionally no
payment provider implementation, no fake checkout, and no order marked paid.
`PAYMENTS_ENABLED=false`; the UI says “充值暂未开放”. A platform admin may make
an auditable manual credit for testing, clearly not a payment.

## 4. Domain, ICP, AI compliance — `BLOCKED_EXTERNAL`

Missing: an ICP-filed custom domain, SSL binding, and applicable generative-AI
content/compliance review for the intended jurisdiction. Until these exist the
service must not be marketed or operated as public paid SaaS. The default
`*.tcloudbaseapp.com` hosting domain is not a production domain.

## 5. GitHub repository / Actions — available, with one visibility caveat

The repository now exists at
https://github.com/ZhixianIris/paperlab-platform and the public CI run is green.
The deploy job is skipped because of the CloudBase/PostgreSQL items above, not a
code failure.

The account's **private-repository** Actions minutes were blocked by a GitHub
billing/spending-limit state on the first run, so the repository was made public
to execute the included free public-repo workflows. If the project must be
private, add a valid GitHub billing method, switch visibility back to private,
and re-run; the workflows themselves are visibility-agnostic. See
[docs/evidence/github-actions.md](evidence/github-actions.md).

## Reproduce the blocked checks once values exist

```bash
# CloudBase declarative validation
tcb login --apiKeyId "$TCB_SECRET_ID" --apiKey "$TCB_SECRET_KEY"
tcb validate
tcb app build
tcb deploy --dry-run
tcb deploy --yes
npm run deploy:configure
npm run deploy:smoke

# Real AI check requires OPENAI_API_KEY and an enabled model
# Real payment check requires a merchant implementation and sandbox callback.
```
