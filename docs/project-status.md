# Project Status

> Audit baseline: 2026-07-22. Windows validation update: 2026-07-22. macOS Apple Silicon bundle update: 2026-07-22.

This document records the current implementation boundary, validated repository inputs, and open
handoff items. It is a status record, not a product roadmap.

## Current State

OMG-Draft-Seer is a React/Vite browser application with a Tauri v2 desktop shell for Windows and
macOS. The main flow is screenshot upload, manual alignment of 60 slot rectangles, template
matching, candidate confirmation, tier and pair browsing, and five-pick recommendation.

The recommendation flow still scores an individual five-pick build, while Draft Replay now models
the shared 10-player serpentine pool. It applies a configurable `tier-first` or `pair-first`
strategy to every player position, records up to 20 legal candidates at each global pick, and
consumes Top1 for the deterministic path. The implementation boundary and assumptions are recorded
in [Draft strategy tree](draft-strategy-tree.md).

Layout detection is manual. The project does not capture a game window, expose a native overlay, or
provide global shortcuts. `src/platform/` contains the browser adapters for resource URLs, layout
storage, file import/export, and runtime capability checks. Tauri bundles have been built for both
macOS Apple Silicon and Windows x64.

## Runtime Inventory

| Resource | Current state | Role |
| --- | ---: | --- |
| `omg-layout-2560x1440.json` | 60 slots | Versioned default layout |
| `heroes/selection/` | 127 images | Local hero template sources |
| `public/data/snapshots/latest.json` | 3,122 abilities, 636 statistical candidates | Bundled Windrun snapshot |
| `public/data/icon-signatures.json` | 636 candidates, 4,452 signatures | Worker template matching |
| `public/assets/hero-icons/` | 127 images | Hero display icons |
| `public/assets/ability-icons/` | 509 images | Statistical ability display icons |
| `tests/fixtures/` | 4 fixtures | Labelled recognition regression inputs |

The snapshot was generated on 2026-07-22. Signatures, caches, and self-check reports were regenerated
on 2026-07-22. These are derived inputs and reports; regenerate them instead of editing counts by
hand.

## Latest Validation

On 2026-07-22, macOS 26.5.1 Apple Silicon validation completed:

- `npm test`: 17 test files and 75 tests passed.
- `npm run build` passed.
- `npm run build:fixture-labels` generated labels for 4 fixtures with 60 slots each.
- `npm run verify:runtime` passed for 636 runtime candidates, 636 signature IDs, and 636 icon
  manifest IDs with zero failures.
- `npm run desktop:build` generated and `hdiutil imageinfo` inspected the `.app` and
  `OMG-Draft-Seer_0.1.0_aarch64.dmg` bundle.
- The app uses a local ad-hoc/linker signature. Developer signing and notarization are not
  configured.
- The 4 fixtures passed offline top-1 template recognition for all 240 slots. This is a regression
  check, not an independent accuracy evaluation.

On 2026-07-22, Windows validation used Node `24.16.0`, npm `11.13.0`, and Rust/Cargo `1.97.1`
with the stable MSVC toolchain. `npm ci`, `npm test`, `npm run build`, `npm run verify:runtime`,
and `npm run desktop:build` passed. The pre-rename release executable started successfully. The
renamed `OMG-Draft-Seer` executable and newly generated x64 MSI, NSIS installer, and release
executable still need startup and installation checks.

## Repository Responsibilities

| Path | State | Responsibility |
| --- | --- | --- |
| `src/` | Maintained | React UI, recognition worker, layout, matching, tiers, pairs, and recommendations |
| `src/platform/` | Maintained | Resource, storage, file, and runtime capability adapters |
| `src-tauri/` | Maintained; bundles built | Tauri v2 shell, window configuration, relative asset packaging, and minimal capability |
| `src-tauri/icons/` | Derived; licence review pending | Windrun favicon-derived Windows/macOS bundle icons |
| `.github/workflows/ci.yml` | Configured; execution pending | macOS/Windows Node test, build, and runtime asset checks |
| `public/data/` | Derived runtime input | Snapshot and template signatures used by the application |
| `public/assets/` | Derived runtime input | Cached display icons |
| `heroes/selection/` | Maintained source input | Local Dota 2 VPK-derived hero selection images |
| `scripts/` | Maintained tools | Data sync, mapping, signature generation, caching, and verification |
| `reports/` | Generated reports | Cache, mapping, and self-check output; not read directly by the web app |
| `tests/fixtures/` | Maintained test input | Approved screenshots and matching 60-slot label maps |
| `dist/`, `node_modules/`, `src-tauri/target/`, `src-tauri/gen/` | Generated directories | Recreated by install and build commands; do not commit |

## Data Refresh

Run these commands from the repository root when the bundled snapshot or icon inputs need to be
refreshed:

```sh
npm run sync:data
npm run build:hero-map
npm run build:icons
npm run cache:icons
npm run verify:icons
npm run verify:runtime
npm test
npm run build
```

| Command | Input | Output |
| --- | --- | --- |
| `npm run sync:data` | Windrun `/api/v2` public API | `public/data/snapshots/latest.json` |
| `npm run build:hero-map` | Snapshot and `heroes/selection/` | `reports/hero-selection-map.json` |
| `npm run build:icons` | Snapshot, local hero images, and DatDota ability images | `public/data/icon-signatures.json` |
| `npm run cache:icons` | Snapshot and DatDota CDN | `public/assets/`, `reports/ability-icon-cache.json` |
| `npm run verify:icons` | Snapshot, signatures, and icon sources | `reports/icon-self-check.json` |
| `npm run verify:runtime` | Snapshot, signatures, and local icons | Offline terminal check |

`sync:data`, `build:icons`, `cache:icons`, and `verify:icons` may access the network. The runtime
prefers committed local data and icons; missing display icons may fall back to the CDN. Review
Windrun, DatDota, local VPK, and favicon source terms before redistribution.

## Upstream Data Coverage

The current public Windrun endpoints return a bounded relation set rather than a complete Pair/Triple
database: 7,500 Pair rows and 10,000 Triple rows. [Windrun Issue #5](https://github.com/Noxville/windrun/issues/5)
documents the same backend Top-N behavior historically as "only top 5k pairs". Direct checks on
2026-07-22 returned HTTP 200 without authentication; common `limit`, `offset`, `page`, and `take`
parameters were ignored, and the responses provided no pagination metadata.

This is an open data-pipeline limitation, not a local filtering failure. The current snapshot has
2,472 complete Triples and 7,528 partial Triples; all partial cases are caused by missing Pair rows,
not by Pair records below the 50-pick threshold. The recommender scores only complete Triples and
keeps partial Triples as diagnostics.

Local analysis can audit and rank the observed Top-N sample, but it cannot recover omitted relations.
Recovery requires a complete upstream export, a documented pagination/cursor endpoint, or match-level
draft data that can legally be aggregated locally. Authorization is not needed for the current public
endpoints; whether a fuller private export exists is not documented in this repository.

## Open Validation Items

- Validate the all-player Top20 ranking and deterministic mask assumptions against more real draft
  pools. The replay is implemented, but it remains a heuristic simulation rather than a calibrated
  model of actual player choices.
- Re-test startup after the renamed Windows executable was rebuilt.
- Install the generated Windows MSI and NSIS packages and verify startup.
- Exercise screenshot upload, Worker recognition, DPI behavior, layout import/export, and restart
  persistence inside the target WebViews on Windows and macOS.
- Run the configured CI matrix and add more independently labelled screenshots for top-1/top-10
  accuracy evaluation.
- Complete source and redistribution licence review for third-party data and image assets.
- Resolve the bounded Windrun Pair/Triple API coverage before treating the snapshot as a complete
  relation database. Track a full-export, pagination, or match-level-data path with the upstream
  project.

Wails, Go-native UI, game-window capture, global shortcuts, and overlay support are outside the
current implementation. They should not be reintroduced through old migration plans without a new
product requirement and validation scope.

## Intentional Cleanup

The current chain no longer uses the old Python/OpenCV automatic layout detector, its Python
requirements, the Pillow hero-grid splitter, machine-local screenshot paths, or their temporary
directories. The fixed layout and TypeScript data pipeline are the supported replacements. Do not
restore those paths to document or run the current workflow.

## Maintained References

- [Root README](../README.md) is the user-facing setup and usage guide.
- [Windows build and validation](windows-build-test.md) is the platform handoff procedure.
- [Recommendation metrics](recommendation-metrics.md) defines the project-owned scoring model.
- [Draft strategy tree](draft-strategy-tree.md) defines the multi-player draft state, all-player
  strategy simulation, and Top20 ranking.
- [Golden screenshot fixtures](../tests/fixtures/README.md) defines fixture and label conventions.

## Attribution

The bundled statistics snapshot is generated from the [Noxville/windrun](https://github.com/Noxville/windrun)
public API. Recommendation metrics and ranking behavior are defined by this project and are not an
official Windrun score.
