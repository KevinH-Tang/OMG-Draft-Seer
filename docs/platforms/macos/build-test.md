# macOS Build and Release Validation

This guide covers the supported macOS desktop path. Windows Tauri/WebView2 remains the
highest-priority desktop target and the only continuous native E2E target. macOS uses
WKWebView, a release-candidate desktop build, and the manual checks below; do not run
`npm run test:tauri` as a macOS CI gate.

The macOS overlay implementation requires Tauri's `macos-private-api` feature and
`app.macOSPrivateApi`. This project distributes it directly through GitHub Releases as an
Apple Silicon build without Developer ID signing, notarization, or stapling. It is not eligible
for Mac App Store submission. A downloaded build will require the documented Gatekeeper first-open
flow.

## Prerequisites

Run all commands from the repository root on an Apple Silicon Mac. macOS releases support
`arm64` only. Install:

1. Node `22.12.0` and npm `>=10`, as specified by `.nvmrc` and `package.json`.
2. Rust `>=1.90` and the Apple Silicon `aarch64-apple-darwin` target.
3. Xcode Command Line Tools and a supported macOS SDK. Full Xcode, `notarytool`, and an Apple
   Developer Program membership are not required by this release strategy.

Check the environment before building:

```sh
node --version
npm --version
rustc --version
rustup show active-toolchain
xcode-select -p
uname -m
git status --short
```

Install dependencies and run the portable checks:

```sh
npm ci
npm test
npm run build
npm run verify:runtime
```

## Desktop Builds

For local development, build and verify the Apple Silicon app without creating a DMG:

```sh
npm run desktop:build -- --bundles app
npm run verify:macos-bundle -- --require-arm64 --require-runtime-assets
```

For a GitHub Release candidate, create the Apple Silicon DMG and verify the final artifacts:

```sh
npm run desktop:build
npm run verify:macos-bundle -- --require-arm64 --require-dmg --require-runtime-assets
```

The app and DMG are written beneath `src-tauri/target/release/bundle/macos/` and
`src-tauri/target/release/bundle/dmg/`. Artifact filenames include the version and architecture;
release automation must enumerate one matching artifact and fail if it finds zero or more than
one rather than relying on a sample filename. The packaged executable must report `arm64` from
`lipo -info` or `lipo -archs`.

`--require-runtime-assets` confirms that every generated `dist/` frontend file, every candidate
icon, and the snapshot and signature files verified by `npm run verify:runtime` are embedded in
each Mach-O architecture slice. It also rejects a package containing the test-only
`TAURI_WEBDRIVER_PORT` bridge.

`npm run build:tauri:test` and `npm run test:tauri` are Windows-only continuous E2E commands.
Their shared binary-path helper also resolves macOS release paths, but macOS does not maintain a
second WebDriver suite.

## GitHub Release and Integrity

The project does not use Apple credentials. A GitHub Release needs only a GitHub token with
`contents: write`; it must not require, store, or print an `APPLE_*` secret, a Developer ID
certificate, a notarization password, or an App Store Connect key. The checked-in
[macOS release workflow](../../../.github/workflows/release-macos.yml) builds the unsigned DMG, then
uses the GitHub Actions runner to generate and attach a same-name `.sha256` file. No local checksum
generation or manual asset upload is part of the release process.

For every release candidate, the workflow resolves exactly one DMG, verifies its disk image, and
generates the SHA-256 file beside it before attaching both files to the same GitHub Release. The
published checksum verifies a downloaded DMG with:

```sh
shasum -a 256 -c 'OMG-Draft-Seer-arm64.dmg.sha256'
```

The release description must state all of the following: Apple Silicon (`arm64`) only; the DMG is
not Developer ID signed or notarized; how to compare the published SHA-256; and the first-open
steps below. An ad-hoc `codesign` result is not Apple authentication and must not be described as
one. `spctl`, `notarytool`, and `stapler` are not release gates for this project.

After verifying the source and SHA-256, a user opens the app with Finder by holding `Control`,
choosing **Open**, then choosing **Open** again in the warning dialog. If macOS instead blocks the
launch, use **System Settings -> Privacy & Security -> Open Anyway** for that same app. The
terminal command `xattr -dr com.apple.quarantine /Applications/OMG-Draft-Seer.app` is an
advanced, user-initiated last resort after verification; it is not an installer step and the app
must never run it itself.

## Release-Candidate Smoke Check

Record the macOS version, CPU architecture, display scaling, and whether multiple Spaces are
enabled. On an Apple Silicon Mac, download the final DMG outside a development directory, compare
its SHA-256 with the published value, and check it. Record the result in the
[release acceptance template](release-acceptance-template.md):

These checks cover the phase-1 Desktop overlay: it uses display/desktop coordinates rather than a
Dota window target. Across-Spaces and full-screen-app checks validate current desktop-window
behavior only; they do not prove game-window attachment, full-screen Space following, capture, or a
future `GameWindowPlacement` adapter.

The proposed repeatable Button, Trigger, Hold, hidden-main-window, native-state, and system-screenshot
evidence harness is documented separately in the
[shared overlay production acceptance design](../../overlays/production-acceptance/shared.md) and
[macOS adapter](../../overlays/production-acceptance/macos.md). It is not a current command or a
replacement for this manual release-candidate checklist until implemented.

- The resizable main window starts near 720 x 540 logical points without a native minimum-size lock.
  Navigation and toolbars wrap, tables scroll horizontally, and wider windows enable parallel layouts.
- A supported screenshot yields 60 slots. Re-slice, candidate confirmation, layout save/load, and
  restart persistence work.
- Analysis, Layout, Tier List, Ability Pairs, recommendations, and Draft Replay remain usable.
  Switching Chinese and English updates both already-open native overlays immediately.
- Tier and recommendation overlays open and close independently. They are transparent,
  borderless, always on top, visible across Spaces, excluded from the Dock, and pass mouse input
  through to the window below. Repeat this Desktop overlay check with a full-screen application
  and multiple Spaces.
- With the download still quarantined, Gatekeeper showed the expected unrecognized-developer
  warning and the documented Finder or Privacy & Security first-open path launched the app.
- The production executable was built without the `wdio` feature. It has no
  `TAURI_WEBDRIVER_PORT` listener after launch.

Any macOS version that rejects transparency or cursor pass-through should be recorded with its
native error; do not quietly ship an overlay that intercepts game mouse input.

## Troubleshooting

- Missing SDK or `xcrun` tools: install or select Xcode, then rerun `xcode-select -p`.
- An Apple Silicon build fails before linking: verify that the active Rust toolchain includes
  `aarch64-apple-darwin`, then rebuild the app bundle before retrying the DMG.
- `tauri build` stops at `Running bundle_dmg.sh`: Tauri's normal DMG path mounts an interstitial
  image under `/Volumes` and uses Finder to place icons. A managed or headless environment may
  block that flow even when basic `hdiutil create` succeeds. Use a macOS host with the GUI and
  disk-image services required by Tauri, or evaluate a separately documented plain-DMG fallback
  before publishing it. Do not claim that a successfully created DMG is Apple signed or notarized.
- A release app is blocked by Gatekeeper: first compare its SHA-256 with the GitHub Release value,
  then follow the documented user-controlled first-open path. This is expected for this unsigned
  distribution strategy, not a failed notarization check.
- A release app starts but the overlay is opaque or intercepts clicks: record the exact macOS
  version and reproduce with the downloaded candidate. The private API is a product constraint,
  not a reason to degrade cursor pass-through.
