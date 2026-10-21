# Local test evidence

Snapshot: 2026-10-21, Windows development machine (Node 24), with PostgreSQL 16
in a disposable Docker container. CI repeats the same suite on Node 22 / Ubuntu.

## Commands and results

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS — 3 PDF tests |
| `npm run test:api` | PASS — 23 API/provider/RLS tests |
| `npm run build` | PASS |
| `npm run verify:build` | PASS — 7 assets, no server secret markers/values |
| `npm run audit:licenses` | PASS — 705 local packages, 0 denied; 707 Linux CI, 0 denied |
| `npm run audit:security` | PASS at `--audit-level=high`; 2 moderate React Router v6 advisories remain (mitigated, see SECURITY.md) |
| `npx playwright test` | PASS — 9 browser journeys |
| `npm run test:e2e` | PASS — rebuild + 9 journeys |
| `npm run validate:deploy` | PASS — 42 checks |
| `CloudBase CLI 3.8.4 validate --json` | `{"valid":true,"errors":[],"warnings":[]}` |
| `actionlint` 1.7.12 | PASS — `ci.yml`, `deploy.yml` |
| `npm ci --dry-run` | PASS |

## Browser journeys

1. AI generation succeeds against the local fixture, wallet decreases by the
   server price, history contains the request, downloaded PNG is real.
2. Tenant with zero balance is rejected before provider call.
3. Anonymous account/tenant gates.
4. Alice sees Alpha only; Bob sees Beta only; cross-tenant pages 403.
5. Admin creates a tenant, adds a member, edits settings, manual-credit ledger,
   toggles a tool and model, sees real order empty state.
6. Offline PDF merge (chromium offline) — 4 pages, text layer preserved,
   `offline-network-log.json` shows zero requests.
7. PDF split and additive rotate.
8. Offline image crop (chromium offline) — exact 300×200 output, zero external
   requests.
9. Image resize, WebP conversion (RIFF/WEBP header) and compression.

## Offline evidence files

- [offline-network-pdf.json](offline-network-pdf.json) — `[]`
- [offline-network-image.json](offline-network-image.json) — `[]`
- [offline-pdf-merge.png](../screenshots/offline-pdf-merge.png)
- [offline-image-crop.png](../screenshots/offline-image-crop.png)

The browser was switched offline after page load, then the file was selected,
processed and downloaded. No HTTP request was captured during the operation.

## External limits of this evidence

The identity and image provider are test doubles only inside the local harness;
the ordinary backend handler, PostgreSQL schema/transactions and browser UI are
real. This does not prove CloudBase Auth invocation context, CloudBase-hosted
PostgreSQL, a real model response or a real payment.
