# Local test evidence

Snapshot: 2026-10-21, Windows development machine (Node 24), with PostgreSQL 16
in a disposable Docker container. CI repeats the same suite on Node 22 / Ubuntu.

## Commands and results

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS — 19 unit tests (PDF + assistant registry/parser) |
| `npm run test:api` | PASS — 30 API/provider/RLS/planner tests |
| `npm run build` | PASS |
| `npm run verify:build` | PASS — 9 assets, no server secret markers/values |
| `npm run audit:licenses` | PASS — 706 local packages / 708 on Linux CI, 0 denied |
| `npm run audit:security` | PASS at `--audit-level=high`; 2 moderate React Router v6 advisories remain (mitigated, see SECURITY.md) |
| `npx playwright test` | PASS — 45 browser journeys |
| `npm run test:e2e` | PASS — rebuild + 45 journeys |
| `npm run validate:deploy` | PASS — 43 checks |
| `CloudBase CLI 3.8.4 validate --json` | `{"valid":true,"errors":[],"warnings":[]}` |
| `actionlint` 1.7.12 | PASS — `ci.yml`, `deploy.yml` |
| `npm ci --dry-run` | PASS |

## Browser journeys

1. AI generation succeeds against the local fixture, wallet decreases by the
   server price, history contains the request, downloaded PNG is real.
2. Tenant with zero balance is rejected before provider call.
3. Anonymous account/tenant gates.
4. Alice sees Alpha only; Bob sees Beta only; cross-tenant pages deny access.
5. Admin creates a tenant, adds a member, edits settings, manual-credit ledger,
   toggles a tool and model, sees real order empty state.
6. Workbench routing: root → PDF, three workbenches render only feature cards,
   AI card opens the AI page.
7. Offline PDF merge (chromium offline) — 4 pages, text layer preserved,
   `offline-network-log.json` shows zero requests.
8. PDF split and additive rotate.
9. Offline drag-to-crop (chromium offline) with pointer handle; zero external
   requests.
10. Drag-to-resize with pointer handle; visual WebP conversion, visual compression
   preset and draggable before/after comparison.
11. Workspace E01: delete page 2 then rotate remaining pages offline; 4 pages,
    text layer preserved, zero HTTP requests.
12. Workspace E02/E03: merge + page numbers; image watermark + compression.
13. Workspace E04/E07/E09: clarification, planner failure fallback, lossy warning.
14. Workspace E06: cloud planner request contains only prompt + metadata; no bytes/name.
15. Workspace E05: malicious `system.exec` plan rejected by server and browser.
16. Workspace E08: OPFS save, reload restore, clear and reload.

## Offline evidence files

- [offline-network-pdf.json](offline-network-pdf.json) — `[]`
- [offline-network-image.json](offline-network-image.json) — `[]`
- [offline-pdf-merge.png](../screenshots/offline-pdf-merge.png)
- [offline-image-crop.png](../screenshots/offline-image-crop.png)
- [workspace-offline-network.json](workspace-offline-network.json)
- [workspace-offline-result.png](../screenshots/workspace-offline-result.png)
- [ai-plan-request.json](ai-plan-request.json)

The browser was switched offline after page load, then the file was selected,
processed and downloaded. No HTTP request was captured during the operation.

## External limits of this evidence

The identity, image provider and text planner are test doubles only inside the
local harness; the ordinary backend handler, PostgreSQL schema/transactions and
browser UI are real. This does not prove CloudBase Auth invocation context,
CloudBase-hosted PostgreSQL, a real model response, a real planner call or a real
payment.
