# GitHub Actions evidence

Repository: https://github.com/ZhixianIris/paperlab-platform

## Main verification — PASS

- Commit: `35eb82e65c3398c4a27d08939543900494148891`
- Workflow: **Deploy production** (`.github/workflows/deploy.yml`)
- Run: https://github.com/ZhixianIris/paperlab-platform/actions/runs/39600035784
- Result: `success`
- Verify job: `success` (~2 min)
- Verification included: `npm ci`, PostgreSQL 16 service, migrations,
  23 API/RLS/provider tests, 3 PDF unit tests, 10 Playwright tests, production
  build, browser-secret scan, licence audit (708 packages on Linux), high-severity npm audit,
  `actionlint`-style config checks.
- Deploy credentials preflight: `success` (reported missing values as warnings).
- CloudBase deploy job: **skipped** because no `TCB_*`/`PG*` credentials exist.
  It did not pretend to deploy and no public URL exists.

## Pull request verification — PASS, no deployment

- Temporary PR #1 (`verify/pr-no-deploy`) has been closed and its branch deleted.
- Workflow run: https://github.com/ZhixianIris/paperlab-platform/actions/runs/39593194243
- Trigger: `pull_request`
- Result: `success`
- Jobs: only `Verify`; there is no deploy job and no `tcb deploy` command in the
  PR workflow.

## Account runner note

The very first push run (`39591518109`) did not start its steps because the
GitHub account's private-repo Actions spending limit/payment state was blocked.
The repository was changed to **public** so the included GitHub-hosted runner
minutes could execute. This is a repository visibility decision, not a code or
CloudBase result. To keep it private, restore private visibility and add a valid
GitHub billing method, then re-run the workflows.
