# Windows Build and Validation

This guide is the Windows handoff procedure for the Tauri 2 desktop application. Windows
WebView2 is the primary native validation target. The browser build remains a basic development
and fallback target, while macOS has a separate release acceptance guide. Linux, Android, and iOS
are outside the supported scope.

Run every command from the repository root. Keep paths repository-relative; the build and E2E
scripts resolve their output paths for the current host and optional Cargo target.

## Prerequisites

Use Windows 10 or 11 x64 with:

1. Node.js `22.12.0` or newer, as specified by `.nvmrc` and `package.json`.
2. npm `10` or newer.
3. Rustup with the repository-pinned Rust `1.90.0` MSVC toolchain. The checked-in
   `rust-toolchain.toml` also installs Rustfmt and Clippy.
4. Visual Studio Build Tools 2022 with `Desktop development with C++`, MSVC, and the Windows SDK.
5. Microsoft WebView2 Runtime. Most supported Windows installations already include it.

Check the active toolchain:

```powershell
node --version
npm --version
rustc --version
cargo --version
rustup show active-toolchain
```

If the pinned Rust toolchain is missing, install it without changing repository files:

```powershell
rustup toolchain install 1.90.0-x86_64-pc-windows-msvc --profile minimal --component rustfmt --component clippy
```

## Repository Inputs

A functional checkout requires:

- `src/`
- `src-tauri/`
- `public/data/`
- `public/assets/`
- `heroes/selection/`
- `omg-layout-2560x1440.json`
- `scripts/`
- `tests/`
- `package-lock.json`

Do not copy generated directories such as `node_modules/`, `dist/`, `src-tauri/target/`, or
`src-tauri/gen/` between machines. Recreate them from the lockfiles and build commands.

## Install and Baseline Validation

Install locked dependencies:

```powershell
npm ci
```

Run the platform-neutral validation steps:

```powershell
npm test
npm run build
npm run format:rust:check
npm run lint:rust
npm run verify:runtime
```

Expected results:

- Vitest passes all test files, including the host-portable Tauri target and macOS bundle path
  tests.
- `npm run build` type-checks the TypeScript application and creates `dist/`.
- Rustfmt and Clippy complete without changes or warnings.
- `npm run verify:runtime` reports matching candidate, signature, and cached manifest IDs with zero
  failures.

`npm run check` additionally runs the repository-wide Prettier gate. If it fails, distinguish
pre-existing formatting debt from files changed by the current work; do not bulk-format unrelated
files as part of a focused fix.

## Desktop Development Smoke Test

Start the Tauri development application:

```powershell
npm run desktop:dev
```

Verify the main window:

- It opens near the `720 x 540` default size, remains freely resizable, and has no native minimum
  size lock.
- Narrow windows stack content or expose intentional scrolling; wide windows enable the analysis,
  layout debug, and Draft parallel layouts without overlap.
- The five navigation pages open: Analysis, Layout, Tier, Pairs, and Draft.
- Switching between Simplified Chinese and English updates the UI and survives a window refresh.

Verify the analysis workflow:

- Upload a supported OMG screenshot.
- Confirm that recognition produces 60 slots: 12 heroes, 36 abilities, and 12 ultimates.
- Review and accept suggested candidates.
- Move or resize a layout slot, run `Re-slice`, and confirm that recognition updates.
- Save a layout, load it again, restart the application, and confirm that calibration persists.

Verify data and overlay behavior:

- Filter and sort the Tier and Pairs pages.
- Change the Draft strategy and use the replay controls.
- Open the Tier and recommendation native overlays independently.
- Confirm that overlays remain above other windows, receive synchronized language/state updates,
  and allow cursor input to reach the window behind them.
- Confirm that switching to Hold closes an open recommendation overlay, pressing the configured
  shortcut opens it, and releasing the shortcut closes it again.
- Hide the main window to the tray and confirm that the configured global shortcut still toggles
  or holds the recommendation overlay according to the selected mode.

## Windows Tauri E2E

The supported native automation stack is WebdriverIO with `@wdio/tauri-service`. It drives the
Tauri WebView2 application through the embedded WebDriver provider; Chromium Playwright and an
external `tauri-driver` are not used.

Build the release-mode test binary, then run the E2E suite:

```powershell
npm run build:tauri:test
npm run test:tauri
```

The build command:

1. Sets `VITE_WDIO_E2E=true` for the frontend build.
2. Compiles the Tauri application with `custom-protocol,wdio` features.
3. Uses the release binary directly instead of copying or renaming it into another directory.
4. Resolves the executable with host-native path semantics.

On Windows, the WebdriverIO service downloads a compatible EdgeDriver when required. Network or
proxy restrictions may therefore affect the first E2E run. The embedded driver listens on port
`4445` during the test process.

To test an explicit Cargo target, set a target triple for both commands:

```powershell
$env:TAURI_TEST_TARGET = 'x86_64-pc-windows-msvc'
npm run build:tauri:test
npm run test:tauri
Remove-Item Env:TAURI_TEST_TARGET
```

`TAURI_TEST_TARGET` takes precedence over `CARGO_BUILD_TARGET`. Do not paste an absolute binary
path into the WDIO configuration; the shared target helper derives the repository-relative output
location.

The current E2E suite covers:

- Main-window startup and five-page navigation.
- Chinese/English switching and persistence across WebView refresh.
- Tier and Pairs filtering and the same-hero exclusion toggle.
- Screenshot upload, recognition completion, candidate acceptance, and layout reset dialog.
- Draft strategy switching and opening a native Tier overlay window.
- Creating and closing the assistant overlay through its button, plus registering and restoring the
  default `Tab` shortcut configuration.

The overlay assertions currently prove window-handle creation and Rust lifecycle state only. They
do not prove that the operating system marks the overlay visible or that the transparent WebView
contains rendered pixels. Do not report a visual pass from `npm run test:tauri` alone. See
[Windows native overlay visual validation issue](windows-overlay-visual-validation-incident.md)
for the open incident, captured evidence, and the required visual acceptance criteria.

The WDIO-enabled binary is test-only and must not be published or used as the release artifact.

## Production Build

Build the signed-or-unsigned local production packages with the normal feature set:

```powershell
npm run desktop:build
```

The command builds the Vite frontend before compiling and packaging Tauri. Expected package
locations are:

```text
src-tauri/target/release/bundle/nsis/*.exe
src-tauri/target/release/bundle/msi/*.msi
```

Install at least one generated package and repeat the development smoke test. Confirm the product
name, `720 x 540` default size, free resizing, screenshot workflow, persisted layout, Draft page,
and independent native overlays. The production package must not expose the WDIO bridge or listen
on the embedded test-driver port.

## Recorded Windows Run

The July 24, 2026 validation used:

| Check                       | Result  | Recorded detail                                                    |
| --------------------------- | ------- | ------------------------------------------------------------------ |
| Node/npm                    | Passed  | Node `24.16.0`, npm `11.13.0`                                      |
| Rust/Cargo                  | Passed  | `1.90.0`, repository-pinned MSVC toolchain                         |
| `npm ci`                    | Passed  | 650 packages installed from the lockfile                           |
| `npm test`                  | Passed  | 21 test files and 92 tests passed                                  |
| `npm run build`             | Passed  | Production frontend bundle generated                               |
| `npm run format:rust:check` | Passed  | Rustfmt reported no changes                                        |
| `npm run lint:rust`         | Passed  | Clippy completed with warnings denied                              |
| `npm run verify:runtime`    | Passed  | 636 candidates, 636 signature IDs, 636 manifest IDs, zero failures |
| `npm run desktop:build`     | Passed  | x64 MSI and NSIS packages generated                                |
| `npm run format:check`      | Blocked | Existing repository-wide Prettier baseline remains unresolved      |
| Native WDIO E2E             | Not run | Test binary build and WebdriverIO execution were not recorded      |
| Installed-package smoke     | Not run | MSI/NSIS launch and native interaction checks remain manual        |

Generated package names:

```text
src-tauri/target/release/bundle/msi/OMG-Draft-Seer_0.1.0_x64_en-US.msi
src-tauri/target/release/bundle/nsis/OMG-Draft-Seer_0.1.0_x64-setup.exe
```

The frontend build currently emits a chunk-size warning for the main JavaScript bundle. It does
not fail the build, but route or page-level lazy loading remains a follow-up optimization.

## Troubleshooting

- `prettier` is not recognized: run `npm ci` and confirm that `node_modules/.bin/` was created.
- `cl.exe`, `link.exe`, or the Windows SDK is missing: repair the Visual Studio C++ workload and
  open a new terminal.
- WebView2 errors appear at startup: install or repair Microsoft WebView2 Runtime.
- Cargo cannot download dependencies: check network, proxy, and crates.io access. Keep
  `Cargo.toml` and `Cargo.lock` intact.
- The Tauri test binary is missing: run `npm run build:tauri:test` before `npm run test:tauri` with
  the same target environment variables.
- EdgeDriver download fails: check network/proxy access or warm the WebdriverIO cache in the build
  environment.
- Port `4445` is already in use: stop the previous embedded-driver process before rerunning E2E.
- Build output is stale: remove only the repository-relative generated directories relevant to the
  failing command, then rerun the corresponding build.
- The browser page is blank when `index.html` is opened directly: use `npm run dev`,
  `npm run preview`, or Tauri. Direct `file://` loading is unsupported.

## Current Limits

- Recognition projects the resource-defined layout from the screenshot resolution, treats narrow
  screenshots as centered `4:3` letterboxed viewports, and retains manual fixed-layout calibration
  as a fallback.
- The application does not capture or follow the game window. It registers one configurable
  OS-global shortcut for the recommendation overlay, with Trigger and Hold modes.
- Native Tier and recommendation overlays are user-opened analysis views, not automatic in-game
  HUD tracking. The internal layout overlay kind is not exposed as a separate user control.
- Recognition accuracy needs a larger independently labelled screenshot set.
- Windrun, DatDota, local VPK-derived images, and desktop icon sources require licence review before
  redistribution.
