# Third-party notices

PaperLab includes and depends on third-party open-source software. This file is
generated from the installed npm tree by "npm run audit:licenses".

- Generated: 2026-10-21T11:14:14.620Z
- Packages audited: 705
- Denied packages: 0
- Full machine-readable inventory: [docs/dependency-licenses.json](docs/dependency-licenses.json)
- OmniTools source license: [third_party/omni-tools/LICENSE](third_party/omni-tools/LICENSE)

## Vendored source

Parts of the local PDF merge/split/rotate implementations are adapted from
**OmniTools** (https://github.com/iib0011/omni-tools) at commit
dda3a240772459035eb38b14c5c7d94e81626116, MIT licensed. The original MIT
license is preserved at third_party/omni-tools/LICENSE; modifications are
documented in third_party/omni-tools/SOURCE.md.

No AGPL, GPL, SSPL, BUSL, Commons Clause or unreviewed production-license
component is used. If a future dependency introduces one, "audit:licenses"
fails CI.

## Direct production and CI dependencies

| Package | Version | License |
| --- | --- | --- |
| React / React DOM | 18.3.1 | MIT |
| React Router DOM | 6.30.1 | MIT |
| pdf-lib | 1.17.1 | MIT |
| pdfjs-dist | 5.4.149 | Apache-2.0 |
| browser-image-compression | 2.0.2 | MIT |
| @cloudbase/js-sdk | 3.10.3 | MIT / Apache-2.0 transitive (see inventory) |
| pg | 8.16.3 | MIT |
| @cloudbase/manager-node (CI tooling only) | 5.9.1 | ISC |
| @playwright/test (CI only) | 1.55.0 | Apache-2.0 |

## Licence distribution (audited packages)

| License | Packages |
| --- | --- |
| MIT | 578 |
| ISC | 58 |
| Apache-2.0 | 29 |
| BSD-2-Clause | 14 |
| BSD-3-Clause | 13 |
| (MIT OR CC0-1.0) | 2 |
| (AFL-2.1 OR BSD-3-Clause) | 1 |
| (MIT AND CC-BY-3.0) | 1 |
| (MIT AND Zlib) | 1 |
| 0BSD | 1 |
| CC-BY-3.0 | 1 |
| CC-BY-4.0 | 1 |
| CC0-1.0 | 1 |
| MIT-0 | 1 |
| Python-2.0 | 1 |
| UNKNOWN | 1 |
| Unlicense | 1 |

## Attribution and source-notice packages

Packages under CC-BY / AFL expressions require attribution or source notices.
Their names, versions, repositories and publishers are present in the full
inventory. Review that file when redistributing a packaged binary.

## CloudBase tooling caveat

`@cloudbase/signature-nodejs@1.1.0` is pulled only by the deployment tool
`@cloudbase/manager-node` and has no `license` field in its package metadata.
It is **not included in the browser bundle or the deployed cloud function**
(those use `@cloudbase/signature-nodejs@2.2.2`, Apache-2.0). It is recorded as a
reviewed dev-only exception rather than represented as a production dependency.
