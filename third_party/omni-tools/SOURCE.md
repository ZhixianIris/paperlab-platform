# OmniTools source provenance

- Upstream: https://github.com/iib0011/omni-tools
- Fixed commit: `dda3a240772459035eb38b14c5c7d94e81626116`
- License: MIT (see `LICENSE` in this directory)
- Imported: 2026-10-21

Commands used to obtain the source rather than reconstructing it from memory:

```bash
git clone https://github.com/iib0011/omni-tools.git .research/omni-tools
git -C .research/omni-tools checkout dda3a240772459035eb38b14c5c7d94e81626116
```

## Adapted files

| Upstream file | Project file | Changes |
| --- | --- | --- |
| `src/pages/tools/pdf/merge-pdf/service.ts` | `web/src/features/tools/pdf/operations.ts` | Typed errors, filename normalisation, no ZIP helper |
| `src/pages/tools/pdf/split-pdf/service.ts` | `web/src/features/tools/pdf/operations.ts` | Strict page-range validation, single output PDF |
| `src/pages/tools/pdf/rotate-pdf/service.ts` | `web/src/features/tools/pdf/operations.ts` | Additive rotation instead of overwriting rotation |
| `src/pages/tools/image/generic/resize/service.ts` | `web/src/features/tools/image/operations.ts` | Canvas-only implementation, limits and format selection |
| `src/pages/tools/image/generic/crop/index.tsx` | `web/src/pages/ImageCropPage.tsx` | New UI, explicit pixel fields, no MUI dependency |
| `src/pages/tools/image/generic/compress/service.ts` | `web/src/features/tools/image/operations.ts` | Same `browser-image-compression` library, single-file flow |
| `src/pages/tools/converters/convert-to-jpg/service.ts` | `web/src/features/tools/image/operations.ts` | Canvas conversion for PNG/JPEG/WebP, no HEIC dependency |

OmniTools' MUI shell, i18n runtime, telemetry-adjacent files and unrelated tool
modules were not imported. The focused PaperLab React shell is new code. The
PDF engine (`pdf-lib`) and the PDF.js viewer are consumed directly as pinned npm
dependencies rather than reimplemented.
