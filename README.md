# OMG-Draft-Seer

> A local Dota 2 Ability Draft screenshot analyzer for reviewing picks and building five-pick drafts.

**License:** [AGPL-3.0-only](LICENSE)

OMG-Draft-Seer turns an Ability Draft selection screenshot into a reviewable draft. Project the
resource-defined layout, match icons against local templates, confirm candidates, inspect tier and pair
statistics, and generate a data-backed recommendation.

## Scope

- Windows Tauri v2/WebView2 is the primary desktop target and the only continuous native E2E target. Core build checks pass, while native E2E and installed-package acceptance remain tracked validation work. macOS is supported for desktop builds, direct distribution, and release-candidate manual acceptance with WKWebView. The React/Vite browser build remains a basic HTTP-served fallback for core analysis and data pages.
- A resource-projected 60-slot draft layout: 12 heroes, 36 abilities, and 12 ultimate abilities.
- Runtime projection for the input resolution, with centered `4:3` letterboxing for narrower
  screenshots and a committed `2560x1440` fixed-layout fallback.
- Local runtime data: a bundled Windrun snapshot, icon signatures, hero templates, and cached icons.
- The browser build must be served over HTTP. Direct `file://` usage is not supported.
- The Tauri desktop build can open independent Tier and recommendation overlays. They stay above
  other windows and ignore cursor events; the browser build uses fixed, mouse-transparent panels.
- Page two's assistant overlay combines the Tier box, candidate Tier list, Pair/Triple recommendations,
  and the five-pick build score. Its `Tab` shortcut supports `Trigger` and `Hold` modes configured in
  Settings. The desktop build registers `Tab` as an OS-global hotkey, while the browser build listens
  only when its window is focused.
- The app does not capture the game window or provide tray integration.
- Static interface text supports 简体中文 and English. Chinese is the first-run default; the header selector persists the choice locally and synchronizes open desktop overlays.

## Quick Start

### Browser

Requirements:

- Node.js `22.12.0` or newer
- npm `10` or newer

Install dependencies and start the development server:

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:5173> in a browser.

To preview the production bundle:

```sh
npm run build
npm run preview
```

### Desktop

The desktop shell requires Rust `1.90` or newer and the platform dependencies required by Tauri.
Windows also needs the MSVC toolchain, Visual Studio C++ build tools, and WebView2. See the
[Windows build and validation guide](docs/windows-build-test.md) for the complete setup. macOS
requires Xcode Command Line Tools and an Apple Silicon Rust target. GitHub Releases publish an
unsigned arm64 DMG with a SHA-256 file; they do not require an Apple Developer membership. See the
[macOS build and release validation guide](docs/macos-build-test.md).

```sh
npm run desktop:dev
npm run desktop:build
```

The desktop bundle reuses the same Vite frontend and bundled runtime resources. Desktop icon
sources and generated files are documented in [src-tauri/icons/README.md](src-tauri/icons/README.md).
macOS transparent overlays use Tauri's macOS private API, so macOS releases are distributed
directly through GitHub, not through the Mac App Store. The current free distribution strategy
does not include Developer ID signing or notarization; users must verify the published SHA-256 and
complete the documented Gatekeeper first-open flow.

### Windows native E2E

The desktop regression suite targets the actual Tauri WebView through WebdriverIO. It is Windows-only
and builds a test-only desktop binary with its WebDriver bridge enabled; production desktop bundles
do not include that bridge.

```sh
npm run build:tauri:test
npm run test:tauri
```

## Workflow

1. Upload a screenshot that uses the supported OMG ability-draft layout.
2. The app projects all 60 slots from the input resolution and resource camera geometry.
3. Review the projected slots. Load or adjust a fixed layout only when manual correction is needed,
   then click `Re-slice` to run recognition again.
4. Review the top candidates and confirm the ability for each slot. `Save layout` and `Load layout`
   store the complete layout document; browser calibration data is kept in `localStorage`.
5. Use `Tier List` and `Ability Pairs` to inspect the current snapshot.
6. Open page two to review Pair/Triple combinations from the current candidate pool, then lock
   confirmed picks and review the five-pick score for one hero, three abilities, and one ultimate.
7. In Settings, choose whether `Tab` toggles the assistant overlay (`Trigger`) or shows it only
   while held (`Hold`). The page-two overlay includes Tier reference and recommendation content.
8. Desktop overlays are independent native windows; browser overlays remain inside the browser window.

## Recognition

The Web Worker uses `projectAbilityDraftResourceSlots` by default, validates the 60 projected
slots, and crops each projected `matchQuad` bounding box. Invalid projection geometry falls back
to the scaled `omg-layout-2560x1440.json`; imported or manually adjusted layouts remain
authoritative. The matcher derives a `16x16` grayscale structure signature and color features,
then ranks candidates within the slot category. The UI shows the crop, coordinates, match mode,
and top candidates for manual review.

The standard runtime uses the committed template signature file and local icon assets. A color-only
fallback is shown when the signature file cannot be loaded; fallback results should not be treated
as recognition conclusions.

## Recommendations

The recommender evaluates complete builds with this shape:

```text
1 hero + 3 abilities + 1 ultimate
```

`Score` combines a five-pick logit base with Pair effects and complete Triple residuals. Every Pair
or Triple with at least 50 picks contributes its signed logit effect when the Triple has all three
eligible component Pairs. Incomplete Triples are diagnostics only. Tier rank and average pick position
affect candidate ordering and display, but do not enter the final `Score` formula.

Page two separately ranks eligible Pair and Triple records from the current recognized candidate pool.
Their displayed combination score is the observed group win rate, with the individual logit base,
synergy lift, and sample count shown alongside it. This does not replace the five-pick score above.

See [Recommendation metrics](docs/recommendation-metrics.md) for the formulas, thresholds, and
test coverage.

The Draft Replay page also simulates the shared 10-player serpentine pool. It applies either
`tier-first` or `pair-first` to every player position, calculates up to 20 legal candidates at
each of the 50 global picks, and consumes the top candidate to produce a deterministic replay.
The model is an explicit strategy simulation, not a prediction of actual opponent behavior. See
[Draft strategy tree](docs/draft-strategy-tree.md) for the state and ranking rules.

## Data Pipeline

The application reads committed runtime data. Refreshing the data is an explicit development or
release operation and may contact public services:

```sh
npm run sync:data
npm run build:hero-map
npm run build:icons
npm run cache:icons
npm run verify:icons
npm run verify:runtime
```

Run tests and the production build after refreshing data:

```sh
npm test
npm run build
```

| Command          | Purpose                                       | Main output                                         |
| ---------------- | --------------------------------------------- | --------------------------------------------------- |
| `sync:data`      | Fetch the Windrun `/api/v2` snapshot          | `public/data/snapshots/latest.json`                 |
| `build:hero-map` | Validate local hero selection templates       | `reports/hero-selection-map.json`                   |
| `build:icons`    | Generate template signatures                  | `public/data/icon-signatures.json`                  |
| `cache:icons`    | Cache display icons from DatDota              | `public/assets/`, `reports/ability-icon-cache.json` |
| `verify:icons`   | Check remote/local icon inputs and signatures | `reports/icon-self-check.json`                      |
| `verify:runtime` | Check the offline runtime asset graph         | Terminal output                                     |

The current snapshot contains 3,122 ability records and 636 statistical runtime candidates. These
counts change when the snapshot is refreshed. The runtime prefers local assets and only falls back
to the DatDota CDN for missing display icons.

If the local snapshot cannot be loaded, the UI uses a bundled demo snapshot so the interface can
still be inspected. Recommendations from that fallback are illustrative historical data, not a
current-data result.

## Validation

The portable local checks are:

```sh
npm run format:check
npm run format:rust:check
npm test
npm run build
npm run verify:runtime
```

Run `npm run format` to rewrite frontend, configuration, and documentation files. Rust files can
be rewritten with `npm run format:rust`; `npm run lint:rust` runs Clippy with warnings denied.
The pre-commit hook formats staged supported files and rejects Rust code that does not pass
Rustfmt. `npm run check` runs the portable formatting, build, test, Clippy, and runtime checks.

On Windows, also run the native E2E build and suite:

```sh
npm run build:tauri:test
npm run test:tauri
```

On an Apple Silicon macOS release environment, build the release candidate and perform the manual acceptance
check in [macOS build and release validation](docs/macos-build-test.md):

```sh
npm run desktop:build
npm run verify:macos-bundle -- --require-arm64 --require-dmg --require-runtime-assets
```

Fixture labels can be regenerated with `npm run build:fixture-labels`; see
[tests/fixtures/README.md](tests/fixtures/README.md) before adding or redistributing screenshots.
The repository also defines a Windows/macOS GitHub Actions workflow for the Node test, build, and
runtime-asset checks.

## Repository Layout

```text
src/                    React UI, core logic, platform adapters, and recognition worker
public/data/             Bundled snapshot and template signatures
public/assets/           Cached hero and ability icons
heroes/selection/        Local hero selection templates
scripts/                 Data sync, mapping, caching, signature, and verification tools
tests/fixtures/          Approved screenshot fixtures and slot labels
src-tauri/               Tauri v2 desktop shell and bundle assets
docs/                    Maintained project documentation
omg-layout-2560x1440.json
                        Versioned fixed fallback for the 60 draft slots
reports/                 Generated mapping, cache, and self-check reports
```

`node_modules/`, `dist/`, `src-tauri/target/`, and `src-tauri/gen/` are generated directories and
are intentionally excluded from version control.

## Limitations

- Projection assumes a complete, stable game viewport; unknown cropping or non-uniform scaling is
  unsupported and should use a manually calibrated fixed layout.
- Screenshot recognition still needs broader, independently labelled accuracy evaluation.
- Draft Replay uses a deterministic 50-position strategy simulation with an up-to-20 candidate
  ranking at each position; it does not claim to predict the actual choices of the other players.
- There is no game-window capture or tray integration. The desktop page-two `Tab` shortcut is an
  OS-global hotkey; the browser shortcut is limited to the focused browser window. Overlays are
  information-only and do not interact with the game window.
- Windrun data, DatDota icons, the local VPK-derived hero images, and the desktop favicon require
  source and redistribution licence review before release.
- Tauri bundles build on the validated platforms, but full installer, target-WebView, DPI, and
  end-to-end screenshot validation remains tracked in [project status](docs/project-status.md).

## Documentation

- [Documentation index](docs/README.md)
- [Project status and handoff notes](docs/project-status.md)
- [Recommendation metrics](docs/recommendation-metrics.md)
- [Draft strategy tree](docs/draft-strategy-tree.md)
- [Windows build and validation](docs/windows-build-test.md)
- [macOS build and release validation](docs/macos-build-test.md)
- [Tailwind v4 and Tauri migration design](docs/tailwind-v4-migration-design.md)
- [Golden screenshot fixtures](tests/fixtures/README.md)
- [Desktop icon source](src-tauri/icons/README.md)

## Attribution

Thanks to the [Noxville/windrun](https://github.com/Noxville/windrun) project and its
contributors. This project uses the Windrun public API to create a versioned statistics snapshot.
The recommendation metrics and ranking logic are defined by OMG-Draft-Seer and are not an
official Windrun score.
