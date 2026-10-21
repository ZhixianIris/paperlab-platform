# Wave A + B — Natural-language local file workspace

Status: merged to `main` at `51e1404f333e0831e5233612c9a0290a8a37b112`
(PR #6, CI run 39630410165; main verification 39631026730). Wave C (PDF semantic analysis, `ai.edit`, cloud image
versions) is deliberately not part of this change.

## Product behaviour

`/ai` is now one chat-style workspace instead of a workbench card page:

1. Upload one or more PDFs/images (up to 4).
2. Enter a Chinese instruction.
3. The browser tries a deterministic local parser first. No file byte is sent.
4. If the local parser cannot resolve the request and the user belongs to an
   active tenant, the browser sends **only the instruction + random file IDs and
   metadata** to `platform-api: ai.plan`.
5. A plan card shows tool steps, target file, page/range, lossy/raster warnings,
   source (local/cloud), zero local cost, and execute/cancel controls.
6. Execution runs the existing browser operations in sequence. Outputs are new
   `File` objects in a registry; the original upload is never overwritten.
7. The right panel previews the result, offers original/result PDF switching or
   image before/after comparison, downloads, two undo checkpoints and a local
   OPFS/IndexedDB draft.

The existing `/ai/image` generator remains reachable through the same page's
"生成图片" tab. It reuses the existing model, wallet and job APIs. Generated
images can be passed into the local file workflow.

## Architecture

- `web/src/features/workspace/fileRegistry.ts` — random file IDs, File objects,
  metadata only.
- `web/src/features/workspace/inspect.ts` — PDF page count/text-layer detection
  (optional when offline) and image dimensions; rejects >50 MB.
- `web/src/features/workspace/history.ts` — at most two in-memory checkpoints.
- `web/src/features/workspace/storage.ts` — OPFS files + IndexedDB metadata,
  scope keyed by user/tenant, quota check, restore/clear.
- `web/src/features/assistant/toolAdapters.ts` — all 41 existing `pdf.*` /
  `image.*` keys bound to existing operations. No algorithm is reimplemented.
  Interactive region tools, form filling and stamping are `manualOnly`.
- `web/src/features/assistant/parseLocalIntent.ts` — high-confidence offline
  grammar for delete/rotate/merge/page numbers/watermark/text extraction/image
  rotate/compress/watermark/convert. Ambiguity returns clarification.
- `web/src/features/assistant/planExecutor.ts` — browser-side revalidation,
  sequential execution, output magic checks, failure stops at the last valid
  result.
- `functions/platform-api/src/providers/text.js` — OpenAI-compatible text
  adapter plus a test-only fixture provider.
- `functions/platform-api/src/planning.js` — strict plan schema/allowlist,
  server-side metadata validation, per-user/tenant quotas, request idempotency.
- Migration `20261021180000_ai_plan.sql` — `ai.plan` tenant switch,
  `ai_plan_requests` audit/quota table, RLS and revoked client grants.

## Privacy boundary

- Local operations never call the network. E01 confirms zero HTTP requests after
  the browser goes offline.
- `ai.plan` receives `{fileId, kind, sizeBytes, pageCount, width, height,
  hasTextLayer}` and the prompt only. It receives no filename, bytes, Base64,
  full text or data URL. E06 inspects the actual request body.
- `ai.plan` requires authentication, active tenant membership, `ai.plan` tool
  switch, and daily/minute server quotas.
- Planner output is validated twice: server action allowlist/schema, then browser
  adapter validation immediately before execution.
- Payment/wallet code is unchanged. Planner calls are free in this wave and do
  not touch the single wallet ledger.

## Verification

| Case | Result |
| --- | --- |
| E01 offline 5-page delete+rotate | 4 pages, all 90°, text layer retained, 0 HTTP requests, original retained |
| E02 merge 2 PDFs + numbers from 3 | 4 pages, both source text markers, numbers 3/4 present |
| E03 image watermark + compression | PNG 800×600, changed watermark pixels, no server processing |
| E04 ambiguous instruction | clarification only, no plan/execution |
| E05 malicious cloud plan | server rejects `system.exec`/invalid schema; browser also rejects a forced malicious plan |
| E06 cloud planning payload | actual request observed; only prompt + metadata, no bytes/name/Base64 |
| E07 planner unavailable | cloud error shown; subsequent local command still executes |
| E08 OPFS draft | save, reload, restore, clear, reload; no draft remains |
| E09 lossy PDF | plan shows lossy + rasterization warning before execution |
| E11 image billing | existing idempotency, wallet and job tests remain green |
| E12 CI | typecheck, lint, unit, real-PostgreSQL API, 45 Playwright, build, license/secret/security checks |

Evidence files:

- [workspace-offline-network.json](evidence/workspace-offline-network.json)
- [ai-plan-request.json](evidence/ai-plan-request.json)
- [workspace-offline-result.png](screenshots/workspace-offline-result.png)
- [ai-workspace.png](screenshots/ai-workspace.png)

## External limits

- The real `AI_TEXT_API_KEY`/model endpoint is not available. The fixture planner
  verifies the contract, allowlist, quotas and rejection paths only; it is **not**
  a real-model acceptance result.
- CloudBase deployment, CloudBase PG, CloudBase Auth and real image provider
  calls remain `BLOCKED_EXTERNAL` because no credentials exist.
- Wave C is not implemented: no `ai.analyze`, no OCR, no `ai.edit`, no RAG or
  vector DB, no cloud image version library, no local image AI.
- Existing `ai.generate` still stores result data URLs in `ai_jobs` and remains
  subject to the existing result-size limit; migrating to private object storage
  is explicitly a Wave C/later task.
