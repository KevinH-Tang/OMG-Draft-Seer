# Windows Build and Validation

This guide is the Windows handoff procedure for the Tauri desktop shell. The desktop target is
Windows and macOS; the browser build remains available through an HTTP development or preview
server. Linux, Android, and iOS are outside the supported scope.

Run all commands from the repository root. PowerShell is sufficient; no Python environment is
required.

## Prerequisites

Use Windows 10 or 11 x64 with:

1. Node.js `22.12.0` or newer, as specified by `.nvmrc` and `package.json`.
2. npm `10` or newer.
3. Rust stable with the `stable-x86_64-pc-windows-msvc` toolchain and Rust `1.90` or newer.
4. Visual Studio Build Tools 2022 with `Desktop development with C++`, MSVC, and the Windows SDK.
5. Microsoft WebView2 Runtime. Most supported Windows installations already include it.

Check the installed toolchain:

```powershell
node --version
npm --version
rustc --version
cargo --version
rustup show active-toolchain
```

If needed, select the MSVC toolchain:

```powershell
rustup default stable-x86_64-pc-windows-msvc
```

## Repository Inputs

The following files and directories are required for a functional checkout:

- `src-tauri/`
- `src/platform/`
- `public/data/`
- `public/assets/`
- `heroes/selection/`
- `omg-layout-2560x1440.json`
- `scripts/`
- `package-lock.json`

Do not copy local generated directories such as `node_modules/`, `dist/`, `src-tauri/target/`,
`src-tauri/gen/`, or `.DS_Store`. Recreate them with the commands below.

## Install and Baseline Checks

```powershell
npm ci
npm test
npm run build
npm run verify:runtime
```

Expected results:

- All Vitest tests pass.
- `npm run build` creates the frontend `dist/` bundle.
- `npm run verify:runtime` reports matching candidate, signature, and icon-manifest IDs with zero
  failures.

## Desktop Development

Start the Tauri development window:

```powershell
npm run desktop:dev
```

Perform this smoke check in the desktop window:

- Upload a screenshot using the supported OMG UI.
- Confirm that the page shows 60 slots: 12 heroes, 36 abilities, and 12 ultimates.
- Move or resize a slot, click `Re-slice`, and confirm that recognition updates.
- Export a layout with `Save layout` and restore it with `Load layout`.
- Close and reopen the window and confirm that saved calibration remains available.
- Switch between recognition, candidate confirmation, `Tier List`, `Ability Pairs`, and
  recommendations.
- Confirm the main window opens at approximately 720px wide. From page one, open the Tier and
  recommendation overlays independently; verify that each stays above other windows and that
  cursor movement over the overlay reaches the window behind it.

## Production Build

```powershell
npm run desktop:build
```

The command builds the Vite frontend before packaging the Tauri application. Common output paths
are:

```text
src-tauri/target/release/bundle/nsis/*.exe
src-tauri/target/release/bundle/msi/*.msi
```

Install one generated package and repeat the desktop smoke check. Verify the application title,
720px default window size, screenshot workflow, layout persistence, independent overlays, and
recommendation pages.

## Recorded Windows Run

The 2026-07-22 Windows validation used:

| Check                                  | Result  | Recorded detail                                                    |
| -------------------------------------- | ------- | ------------------------------------------------------------------ |
| Node/npm                               | Passed  | Node `24.16.0`, npm `11.13.0`                                      |
| Rust/Cargo                             | Passed  | `1.97.1`, stable MSVC toolchain                                    |
| `npm ci`                               | Passed  | Lockfile installation completed                                    |
| `npm test`                             | Passed  | Test suite completed successfully                                  |
| `npm run build`                        | Passed  | Production `dist/` bundle generated                                |
| `npm run verify:runtime`               | Passed  | 636 candidates, 636 signature IDs, 636 manifest IDs, zero failures |
| `npm run desktop:build`                | Passed  | x64 MSI and NSIS packages generated                                |
| Release executable startup             | Pending | Pre-rename executable started; renamed executable needs retest     |
| MSI/NSIS installation                  | Pending | Installer startup check not recorded                               |
| Screenshot recognition and persistence | Pending | Full target-WebView workflow not recorded                          |

The generated package names were:

```text
src-tauri/target/release/bundle/msi/OMG-Draft-Seer_0.1.0_x64_en-US.msi
src-tauri/target/release/bundle/nsis/OMG-Draft-Seer_0.1.0_x64-setup.exe
```

## Troubleshooting

- `cl.exe`, `link.exe`, or the Windows SDK is missing: repair the Visual Studio C++ workload and
  open a new terminal.
- WebView2 errors appear at startup: install or repair the Microsoft WebView2 Runtime.
- Cargo cannot download dependencies: check network, proxy, and crates.io access. Keep
  `Cargo.toml` and `Cargo.lock` intact.
- Build output is stale or inconsistent: remove `dist/`, `src-tauri/target/`, and `src-tauri/gen/`,
  then rerun `npm run desktop:build`.
- The browser page is blank when `index.html` is opened directly: use `npm run dev`,
  `npm run preview`, or a Tauri command instead. `file://` is not supported.

## Current Limits

- The supported layout targets one OMG UI composition and uses manual alignment.
- The application does not capture the game window, provide an overlay, or register global
  shortcuts.
- Recognition accuracy still needs a larger independently labelled screenshot set.
- Windrun, DatDota, local VPK-derived images, and desktop icon sources require licence review
  before redistribution.
