# Project Status

> Audit baseline and cross-platform validation: 2026-07-24. Overlay lifecycle implementation and
> Apple Silicon native smoke evidence: 2026-07-28. Pre-commit validation: 2026-07-29.

This document records the current implementation boundary, validated repository inputs, and open
handoff items. It is a status record, not a product roadmap.

## Current State

OMG-Draft-Seer is a React/Vite browser application with a Tauri v2 desktop shell for Windows and
macOS. Windows/WebView2 is the complete desktop experience and continuous native E2E target.
macOS/WKWebView is supported for desktop builds and release-candidate manual validation, not a
second continuous E2E suite. The main flow is screenshot upload, manual alignment of 60 slot
rectangles, template matching, candidate confirmation, tier and pair browsing, and five-pick
recommendation.

The recommendation flow still scores an individual five-pick build, while Draft Replay now models
the shared 10-player serpentine pool. It applies a configurable `tier-first` or `pair-first`
strategy to every player position, records up to 20 legal candidates at each global pick, and
consumes Top1 for the deterministic path. The implementation boundary and assumptions are recorded
in [Draft strategy tree](../product/draft-strategy-tree.md).

Layout is projected from resource geometry and the screenshot resolution, with manual fixed-layout
calibration retained as a fallback. The project does not capture or attach to a game window. Its
current phase-1 Desktop overlay uses display/desktop coordinates; full-display recommendation and
layout windows target the main application window's monitor. The Tauri shell
exposes independent Tier, recommendation, and layout overlay windows with always-on-top and
cursor-pass-through behavior. Its configurable OS-global shortcut controls the recommendation
overlay in Trigger or Hold mode even while the main window is hidden; the browser build uses a
focused-window shortcut and a fixed mouse-transparent recommendation panel. Rust owns native
overlay requests, content readiness, request revisions, OS visibility observations, target-monitor
geometry, and shortcut press cycles; React consumes a revisioned `displayed` projection. See
[Overlay lifecycle state machine](../overlays/lifecycle.md) for the command, readiness,
content-sync, and shortcut event flows.

The future phase-2 Game-attached overlay is a separate placement mode, not a description of current
behavior. It may reuse the existing overlay content, readiness, revision, shortcut, and
cursor-pass-through lifecycle, but must add platform-specific verified game target identity,
client-area geometry tracking, display eligibility, and detach behavior behind an
`OverlayPlacement` boundary. It must not silently fall back to a desktop monitor when attachment is
lost. The proposed capture and placement architecture is documented in
[Game capture and overlay design](../overlays/game-capture-design.md).

The native shortcut callback sends press/release events to one dedicated FIFO worker. On Windows,
the worker ignores a release while the shortcut's main key is still physically down, so a stale
release cannot close a newer Hold press. Switching to Hold closes the recommendation overlay before
committing the mode in both desktop and browser runtimes; a browser Hold press also claims an
already-open overlay so release closes it. Native overlay ready is gated on the bundled runtime
snapshot settling and a current main-WebView content handshake. Requested transparent windows
remain OS-visible during bootstrap so WebView2 can execute, while React withholds the panel DOM
until content-ready. Full-screen native bounds come from the target monitor rather than screenshot
pixels; screenshot viewport remains the content coordinate system. WebView creation runs off the
main thread, and reload/hide transitions reassert cursor pass-through without resetting an
existing visible window behind the cursor poller's state.

The macOS transparent-overlay implementation uses Tauri's macOS private API, so macOS releases
must be direct-distribution builds rather than Mac App Store submissions. The project does not
join the Apple Developer Program: its macOS release target is an unsigned Apple Silicon DMG plus a
GitHub Actions-generated SHA-256 file on GitHub Releases. Developer ID signing, notarization, stapling, and automatic
Gatekeeper approval are intentionally out of scope; users follow the documented first-open flow.
`src/platform/` contains the browser adapters for resource URLs, layout storage, file import/export,
overlay state, shortcuts, and runtime capability checks. Local macOS validation produces an
unsigned Apple Silicon `.app`; the protected release workflow owns normal DMG packaging and
checksum publication. Universal binaries and cross-compilation remain out of scope.

## Runtime Inventory

| Resource                            |                               Current state | Role                                   |
| ----------------------------------- | ------------------------------------------: | -------------------------------------- |
| `omg-layout-2560x1440.json`         |                                    60 slots | Versioned default layout               |
| `heroes/selection/`                 |                                  127 images | Local hero template sources            |
| `public/data/snapshots/latest.json` | 3,122 abilities, 636 statistical candidates | Bundled Windrun snapshot               |
| `public/data/icon-signatures.json`  |            636 candidates, 4,452 signatures | Worker template matching               |
| `public/assets/hero-icons/`         |                                  127 images | Hero display icons                     |
| `public/assets/ability-icons/`      |                                  509 images | Statistical ability display icons      |
| `tests/fixtures/`                   |                                  4 fixtures | Labelled recognition regression inputs |

The snapshot was generated on 2026-07-22. Signatures, caches, and self-check reports were regenerated
on 2026-07-22. These are derived inputs and reports; regenerate them instead of editing counts by
hand.

## Latest Validation

On 2026-07-29, the current Apple Silicon workspace used Node `24.18.0`, npm `11.16.0`, and the
repository-pinned Rust/Cargo `1.90.0` Apple Silicon toolchain. This is a Node 24 compatibility
validation, not the `.nvmrc`-pinned Node `22.12.0` release baseline:

- `npm run check` passed: Prettier, Rustfmt, 31 Rust unit tests, TypeScript/Vite, 25 Vitest files
  with 129 tests, Clippy with warnings denied, and the offline runtime graph all completed
  successfully. Vite emitted only the existing main-chunk size warning.
- `npm run test:rust` passed all 31 Rust unit tests, including native overlay lifecycle,
  Trigger/Hold transactionality, shortcut worker ordering, Windows release filtering, background
  WebView creation, and cursor-state preservation.
- `npm run desktop:build -- --bundles app` produced
  `src-tauri/target/release/bundle/macos/OMG-Draft-Seer.app`; its executable is arm64.
- The macOS bundle verifier with `--require-arm64 --require-runtime-assets` verified the arm64
  executable, embedded runtime resources, and absence of the test WebDriver bridge.
- A macOS 26.5.1 system-level button smoke on an earlier candidate from this repair series confirmed
  the recommendation panel appears with `ready=true`, Tauri `visible=true`, valid monitor bounds,
  and non-transparent screenshot pixels, then disappears with `visible=false`. The latest arm64
  `.app` was rebuilt and bundle-verified after the final revision/retry changes, but its system-level
  screenshot smoke has not been repeated. This remains local WKWebView evidence, not Windows or
  macOS release-candidate acceptance.

On 2026-07-24, the current Windows workspace used Node `24.16.0`, npm `11.13.0`, and the
repository-pinned Rust/Cargo `1.90.0` MSVC toolchain:

- `npm test`: 21 test files and 92 tests passed, including the host-portable Tauri target and
  macOS bundle path tests.
- `npm run build` passed and emitted only the existing main-chunk size warning.
- `npm run format:rust:check` and `npm run lint:rust` passed.
- `npm run verify:runtime` passed for 636 runtime candidates, 636 signature IDs, and 636 icon
  manifest IDs with zero failures.
- The recorded `npm run desktop:build` passed and generated the x64 MSI and NSIS packages listed in
  `docs/platforms/windows/build-test.md`.
- `npm run format:check` remains blocked by repository-wide Prettier debt outside this focused
  documentation correction. Native WDIO E2E and installed-package smoke tests were not run.

Also on 2026-07-24, local macOS Apple Silicon validation completed:

- `npm test`: 21 test files and 92 tests passed.
- `npm run build` passed.
- `npm run verify:runtime` passed for 636 runtime candidates, 636 signature IDs, and 636 icon
  manifest IDs with zero failures.
- The analysis/layout, Tier/Pairs, Draft, and Overlay page surfaces now use Tailwind utility
  classes. `src/styles.css` retains only theme tokens, global base rules, icon and SVG overlay
  defaults, native-overlay transparency, and toast styling.
- `npm run desktop:build -- --bundles app` passed. Its arm64 app embeds every generated frontend
  resource, snapshot, signature file, and runtime candidate icon, and contains no
  `TAURI_WEBDRIVER_PORT` bridge.
- macOS scope is Apple Silicon `arm64` only. The checked-in release workflow rejects a non-arm64
  runner, builds an unsigned DMG, generates the SHA-256 on the GitHub Actions runner, and uploads
  both assets using only GitHub `contents: write` permission.
- A transient unsigned arm64 diagnostic DMG was generated from the verified `.app` with
  Tauri's generated `create-dmg` script in `--sandbox-safe --skip-jenkins` mode. `hdiutil verify`
  accepted it, and a read-only mount contained `OMG-Draft-Seer.app` plus the `Applications` link.
  It was removed during build-output cleanup; this mode omits Finder positioning and is only a
  managed-environment packaging check, not yet a public release candidate with a published SHA-256
  and manual acceptance record.
- This host's normal `npm run desktop:build` DMG path still stops at Tauri's Finder-backed
  `bundle_dmg.sh` flow. A public release needs a macOS release host with the GUI and disk-image
  service required by Tauri, or a separately reviewed plain-DMG fallback; neither route needs
  Apple credentials under the current policy.
- No local bundle has a Developer ID signature, Team ID, notarization ticket, or Gatekeeper
  approval. This is expected under the free distribution policy, not an outstanding release gate.

## Repository Responsibilities

| Path                                                            | State                                 | Responsibility                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                                                          | Maintained                            | React UI, recognition worker, layout, matching, tiers, pairs, and recommendations                                                                 |
| `src/platform/`                                                 | Maintained                            | Resource, storage, file, overlay, shortcut, and runtime capability adapters                                                                       |
| `src-tauri/`                                                    | Maintained; bundles built             | Tauri v2 shell, window and shortcut lifecycle, relative asset packaging, and capabilities                                                         |
| `src-tauri/icons/`                                              | Derived; licence review pending       | Windrun-mark vector source and generated Windows/macOS bundle icons                                                                               |
| `.github/workflows/ci.yml`                                      | Configured; execution pending         | macOS/Windows Node test, build, and runtime asset checks                                                                                          |
| `.github/workflows/release-macos.yml`                           | Configured; release execution pending | Build an unsigned arm64 DMG, generate its SHA-256 on the GitHub Actions runner, and create or update a GitHub Release with `contents: write` only |
| `public/data/`                                                  | Derived runtime input                 | Snapshot and template signatures used by the application                                                                                          |
| `public/assets/`                                                | Derived runtime input                 | Cached display icons                                                                                                                              |
| `heroes/selection/`                                             | Maintained source input               | Local Dota 2 VPK-derived hero selection images                                                                                                    |
| `scripts/`                                                      | Maintained tools                      | Data sync, mapping, signature generation, caching, and verification                                                                               |
| `reports/`                                                      | Generated reports                     | Cache, mapping, and self-check output; not read directly by the web app                                                                           |
| `tests/fixtures/`                                               | Maintained test input                 | Approved screenshots and matching 60-slot label maps                                                                                              |
| `dist/`, `node_modules/`, `src-tauri/target/`, `src-tauri/gen/` | Generated directories                 | Recreated by install and build commands; do not commit                                                                                            |

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

| Command                  | Input                                                   | Output                                              |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------------- |
| `npm run sync:data`      | Windrun `/api/v2` public API                            | `public/data/snapshots/latest.json`                 |
| `npm run build:hero-map` | Snapshot and `heroes/selection/`                        | `reports/hero-selection-map.json`                   |
| `npm run build:icons`    | Snapshot, local hero images, and DatDota ability images | `public/data/icon-signatures.json`                  |
| `npm run cache:icons`    | Snapshot and DatDota CDN                                | `public/assets/`, `reports/ability-icon-cache.json` |
| `npm run verify:icons`   | Snapshot, signatures, and icon sources                  | `reports/icon-self-check.json`                      |
| `npm run verify:runtime` | Snapshot, signatures, and local icons                   | Offline terminal check                              |

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
- Run `npm run build:tauri:test` followed by `npm run test:tauri` on Windows and retain the native
  WebdriverIO result.
- Launch the generated Windows release executable, install both the MSI and NSIS packages, and
  complete the Button, Trigger, Hold, hidden-main Trigger, and hidden-main Hold evidence matrix
  defined by the [shared overlay production acceptance design](../overlays/production-acceptance/shared.md)
  and [Windows adapter](../overlays/production-acceptance/windows.md). The harness is designed but
  not yet implemented.
- Exercise screenshot upload, Worker recognition, DPI behavior, layout import/export, and restart
  persistence inside the target WebViews on Windows and macOS. Before a macOS release, repeat the
  unsigned-DMG, SHA-256, Gatekeeper-first-open, and overlay acceptance checklist in
  `docs/platforms/macos/build-test.md` on Apple Silicon. The proposed stronger evidence harness is recorded in the
  [macOS overlay production acceptance adapter design](../overlays/production-acceptance/macos.md)
  and is not a current command.
- Extend native shortcut validation beyond the 2026-07-28 Apple Silicon Trigger smoke: cover Hold
  press/release and cancellation, macOS loss of focus while the main window remains visible, and
  Windows focused/hidden main-window paths. Repeat macOS validation on the Node 22 release baseline.
- Run the free release workflow: one arm64 DMG, one GitHub Actions-generated matching SHA-256
  file, GitHub `contents: write` publication, and release notes that disclose the missing
  Developer ID/notarization and user-controlled first-open path.
- Perform the WKWebView manual smoke check for the resizable 720 x 540 default main window,
  language syncing, Tier/recommendation overlays, transparent background, cursor pass-through, and
  multi-Space behavior. These checks cannot be inferred from the build alone.
- Run the configured CI matrix and add more independently labelled screenshots for top-1/top-10
  accuracy evaluation.
- Complete source and redistribution licence review for third-party data and image assets.
- Resolve the bounded Windrun Pair/Triple API coverage before treating the snapshot as a complete
  relation database. Track a full-export, pagination, or match-level-data path with the upstream
  project.

Wails, Go-native UI, game-window capture, and Game-attached overlay placement remain outside the
current implementation. Native global shortcuts are implemented only for Desktop recommendation-
overlay Trigger/Hold control; they do not capture the game, bind the overlay to Dota, or add in-game
input handling.

## Intentional Cleanup

The current chain does not infer layout from screenshot content and no longer uses the old
Python/OpenCV detector, the removed TypeScript anchor detector, their generated reports, Python
requirements, the Pillow hero-grid splitter, machine-local screenshot paths, or temporary
directories. Resource projection is the default and the committed fixed layout is the fallback.

## Maintained References

- [Root README](../../README.md) is the user-facing setup and usage guide.
- [Windows build and validation](../platforms/windows/build-test.md) is the platform handoff procedure.
- [macOS build and release validation](../platforms/macos/build-test.md) is the macOS release handoff procedure.
- [Recommendation model](../product/recommendation-model.md) defines the project-owned scoring model.
- [Draft strategy tree](../product/draft-strategy-tree.md) defines the multi-player draft state, all-player
  strategy simulation, and Top20 ranking.
- [Overlay lifecycle state machine](../overlays/lifecycle.md) defines native overlay and
  global-shortcut ownership, transitions, readiness, the two-stage overlay boundary, and current
  Desktop overlay smoke-test evidence.
- [Game capture and overlay design](../overlays/game-capture-design.md) defines the proposed phase-2
  capture and Game-attached overlay placement architecture; it is not shipped behavior.
- [Golden screenshot fixtures](../../tests/fixtures/README.md) defines fixture and label conventions.

## Attribution

The bundled statistics snapshot is generated from the [Noxville/windrun](https://github.com/Noxville/windrun)
public API. Recommendation metrics and ranking behavior are defined by this project and are not an
official Windrun score.
