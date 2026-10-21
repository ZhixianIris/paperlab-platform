# GitHub Actions evidence

Repository: https://github.com/ZhixianIris/paperlab-platform

## Main verification — PASS

- Commit: `51e1404f333e0831e5233612c9a0290a8a37b112`
- Pull request: https://github.com/ZhixianIris/paperlab-platform/pull/6
- PR CI run: https://github.com/ZhixianIris/paperlab-platform/actions/runs/39630410165
- Workflow: **Deploy production** (`.github/workflows/deploy.yml`)
- Main run: https://github.com/ZhixianIris/paperlab-platform/actions/runs/39631026730
- Result: `success`
- Verify job: `success` (~2 min)
- Verification included: `npm ci`, PostgreSQL 16 service, migrations,
  30 API/RLS/planner tests, 19 unit tests, 45 Playwright tests, production
  build, browser-secret scan, licence audit (708 packages on Linux), high-severity npm audit,
  `actionlint`-style config checks.
- Deploy credentials preflight: `success` (reported missing values as warnings).
- CloudBase deploy job: **skipped** because no `TCB_*`/`PG*` credentials exist.
  It did not pretend to deploy and no public URL exists.

## Pull request verification — PASS, no deployment

- PR #6 (`feat/ai-local-workspace`) was merged after green CI; its branch was deleted.
- Workflow run: https://github.com/ZhixianIris/paperlab-platform/actions/runs/39630410165
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
