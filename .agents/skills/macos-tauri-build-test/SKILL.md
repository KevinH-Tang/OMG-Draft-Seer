---
name: macos-tauri-build-test
description: Run and diagnose OMG-Draft-Seer macOS frontend checks, Tauri development, Apple Silicon app builds, bundle verification, unsigned DMG packaging, and release-candidate smoke validation. Use when Codex is asked to compile, package, smoke-test, or validate the macOS desktop application or investigate a macOS WKWebView, Mach-O, Gatekeeper, app bundle, or DMG failure.
---

# macOS Tauri Build and Test

Use this procedure from the repository root for the supported Apple Silicon macOS path. Preserve
the first failing command and its output, reuse warm dependencies and Cargo targets, and separate
frontend, native compilation, packaging, integrity, and manual acceptance failures.

## Project Facts

- macOS support is Apple Silicon `arm64` only. Do not claim Intel or universal-binary support.
- The reproducible release baseline is the exact Node version in `.nvmrc` (`22.12.0` in this
  repository), and the GitHub release workflow installs that version with `setup-node`.
  `package.json` currently allows Node `>=22.12.0`, so Node 24 is engine-compatible and may be
  used for an explicitly labelled compatibility build, but it is not equivalent to the pinned
  Release candidate validation. Record the active Node version in every report and rerun the
  strict Release lane with the `.nvmrc` version before calling it release-validated.
  npm and Rust requirements are defined in `AGENTS.md` and `rust-toolchain.toml`.
- Tauri uses WKWebView and the `macos-private-api` feature for transparent click-through overlays.
- Production bundles are unsigned and not Developer ID notarized or stapled. They are distributed
  directly and are not eligible for Mac App Store submission.
- `npm run verify:macos-bundle` verifies the app architecture and can verify embedded runtime
  resources, DMG presence, and absence of the test-only `TAURI_WEBDRIVER_PORT` bridge.
- `npm run build:tauri:test` and `npm run test:tauri` are Windows-only continuous E2E workflows.
  Host-portable path helpers do not make the macOS WDIO lane supported.

Keep command and report paths repository-relative. Do not run data synchronization, icon caching,
publishing, release creation, signing, notarization, or destructive cleanup unless the user
explicitly requests that operation. This skill standardizes validation; it does not grant release
or credential authority.

## Choose a Workflow

| Need | Commands | Result |
| --- | --- | --- |
| Browser HMR and URL debugging | `npm run dev -- --host 127.0.0.1 --port 5173` | Vite at `http://127.0.0.1:5173/` |
| Browser check of a production bundle | `npm run build`, then `npm run preview -- --host 127.0.0.1 --port 4173` | Vite preview at `http://127.0.0.1:4173/` |
| Frontend tests | `npm test` | Vitest result only |
| Frontend typecheck and bundle | `npm run build` | `dist/` plus TypeScript validation |
| Portable repository checks | `npm test`, `npm run build`, `npm run verify:runtime` | Host-neutral validation |
| Tauri debug development | `npm run desktop:dev` | Persistent Vite, Cargo debug build, and native app |
| Apple Silicon app smoke build | `npm run desktop:build -- --bundles app`, then bundle verification | Unsigned `.app` |
| Release-candidate package | `npm run desktop:build`, then strict bundle verification | Unsigned `.app` and DMG |
| Final candidate acceptance | Verify downloaded DMG and complete the manual checklist | Recorded macOS acceptance evidence |

Do not run standalone Vite and `desktop:dev` together. `desktop:dev` owns port `5173` through
Tauri's `beforeDevCommand`.

## Preflight

Run before native work:

```sh
test -f package.json
test -d src-tauri
test -f package-lock.json
node --version
npm --version
rustc --version
cargo --version
rustup show active-toolchain
rustup target list --installed
xcode-select -p
xcrun --show-sdk-path
uname -m
git status --short
```

For the strict Release-candidate lane, also require the active Node version to match `.nvmrc`:

```sh
test "$(node --version)" = "v$(tr -d '[:space:]' < .nvmrc)"
```

If this check fails with Node 24, the build may continue only as a compatibility build and must be
reported as such; do not present it as a reproducible Release validation. Require `uname -m` to
report `arm64`, the active Rust toolchain to satisfy the repository version, and
`aarch64-apple-darwin` to be available for an explicit Apple Silicon target build. Xcode
Command Line Tools and a supported macOS SDK are sufficient for the unsigned release strategy;
do not require full Xcode, Apple credentials, `notarytool`, or Developer Program membership.

Reuse `node_modules/`, Cargo caches, and `src-tauri/target/` when valid. Run `npm ci` only when
dependencies are absent or the lockfile changed. Cold npm or Cargo downloads may require network
access; request permission only for the blocked command.

Before a persistent workflow, inspect fixed ports without stopping unrelated processes:

```sh
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:4173 -sTCP:LISTEN
lsof -nP -iTCP:4445 -sTCP:LISTEN
```

An empty result means the port is free. Inspect the owning PID and command before terminating any
process. Do not kill all Node, Cargo, or application processes.

## Vite URL Debugging

### Development URL

For browser-only HMR debugging, run:

```sh
npm run dev -- --host 127.0.0.1 --port 5173
```

Expect `http://127.0.0.1:5173/`. Verify the response before opening a browser:

```sh
curl --fail --silent --show-error http://127.0.0.1:5173/ | rg 'id="root"'
```

The command must exit successfully and print the application root element. Use the HTTP URL, not
a `file:///` URL; opening `index.html` directly bypasses Vite and does not validate module paths,
HMR, or runtime assets.

If `5173` is occupied and only browser debugging is needed, use an alternate port:

```sh
npm run dev -- --host 127.0.0.1 --port 5174
```

Do not use that alternate URL for `desktop:dev` unless both Tauri `devUrl` and
`beforeDevCommand` are changed consistently. Never silently substitute a port for a Tauri debug
run.

### Production Preview URL

Inspect the built frontend without starting Tauri:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Verify the preview response:

```sh
curl --fail --silent --show-error http://127.0.0.1:4173/ | rg 'id="root"'
```

`vite preview` serves `dist/`; it does not prove that the native WKWebView application can launch
or that Tauri IPC and macOS window behavior work. Stop each persistent Vite process with Ctrl+C,
then use `lsof` to confirm its port was released.

## Portable Checks

For a normal frontend validation pass, run commands separately and stop at the first failure:

```sh
npm test
npm run build
npm run verify:runtime
```

Add Rust checks when native Rust or Tauri configuration is in scope:

```sh
npm run format:rust:check
npm run lint:rust
```

`npm run build` runs `tsc -b` before Vite. Report Vite chunk-size warnings separately from build
failures. `npm run format:check` is repository-wide and may expose pre-existing formatting debt;
for a skill-only edit, validate the changed skill directly with Prettier instead.

## Tauri Debug Development

Run the complete debug shell as one persistent process:

```sh
npm run desktop:dev
```

Confirm that Tauri starts Vite at the configured URL, Cargo completes the debug build, and the
native WKWebView application launches. Test macOS-specific window behavior manually when relevant;
a successful Vite response does not prove WKWebView IPC, overlay transparency, click-through, or
Spaces behavior.

After stopping the command, confirm port `5173` is released and inspect any remaining process by
PID before stopping it. Do not delete `src-tauri/target/` as the first response to a stale process
or normal shutdown warning.

## Apple Silicon App Build

Build only the local `.app` bundle and verify it:

```sh
npm run desktop:build -- --bundles app
npm run verify:macos-bundle -- --require-arm64 --require-runtime-assets
```

Expected output is exactly one app beneath:

```text
src-tauri/target/release/bundle/macos/*.app
```

The verifier checks the Mach-O architecture, all generated frontend and runtime resources, and
that the production executable does not contain the WDIO bridge. Do not replace it with a filename
guess or a check of the unbundled release executable.

## DMG Release Candidate

Before handling a release candidate, read `docs/macos-build-test.md` completely. For manual
acceptance, also read `docs/macos-release-acceptance-template.md` completely.

Build and verify the local release-candidate artifacts:

```sh
npm run desktop:build
npm run verify:macos-bundle -- --require-arm64 --require-dmg --require-runtime-assets
```

Expected outputs are exactly one `.app` and one DMG beneath:

```text
src-tauri/target/release/bundle/macos/*.app
src-tauri/target/release/bundle/dmg/*.dmg
```

Verify the resolved DMG with:

```sh
hdiutil verify path/to/resolved-artifact.dmg
```

Enumerate the actual artifact and require exactly one match; do not hard-code a sample filename.
The protected `.github/workflows/release-macos.yml` workflow owns GitHub Release creation and
checksum publication. Do not invoke it, upload artifacts, or create a release without explicit
authorization.

Do not describe an unsigned or ad-hoc-signed build as Apple authenticated. `codesign`, `spctl`,
`notarytool`, and `stapler` are not release gates under the current strategy. A successful local
DMG build does not prove the downloaded candidate's checksum, quarantine, or first-open behavior.

## Release-Candidate Acceptance

Perform this lane on the final downloaded DMG outside a development directory, retaining its
quarantine metadata. Record results in `docs/macos-release-acceptance-template.md` without
overwriting an existing acceptance record.

At minimum verify:

1. `hdiutil verify` and the published SHA-256 both pass for the downloaded DMG.
2. Finder Control-click Open or Privacy & Security Open Anyway launches the unsigned app.
3. The main window, screenshot workflow, analysis views, persistence, and locale switching work.
4. Tier and recommendation overlays remain transparent, borderless, always on top, visible across
   Spaces, absent from the Dock, and mouse-transparent.
5. Overlay behavior is checked with a full-screen application and multiple Spaces when available.
6. The production executable exposes no `TAURI_WEBDRIVER_PORT` listener.

Record the macOS version, build, CPU architecture, display scaling, and Spaces configuration.
Do not remove quarantine automatically or make `xattr -dr` an installer step.

## Failure Triage

Classify the first failure before rebuilding.

- **Preflight:** wrong architecture, missing Rust target, invalid selected developer directory, or
  missing SDK. Fix that prerequisite before compiling.
- **Frontend:** TypeScript, Vitest, Vite, or runtime-asset errors. Diagnose these before Tauri.
- **Vite URL:** a non-successful `curl` or missing root element is a frontend/server failure. Check
  the Vite process and source error before compiling Tauri.
- **Rust/link:** preserve the first Cargo, linker, SDK, or framework error and its target triple.
- **WKWebView/runtime:** a native blank window, IPC failure, or launch crash is not a Vite build
  failure. Inspect native logs and Tauri configuration.
- **Bundle verification:** report the resolved app path, Mach-O slices, missing resource, or WDIO
  bridge finding. Rebuild a production bundle after any test-feature build.
- **DMG packaging:** Tauri's generated DMG flow uses `/Volumes`, disk-image services, and Finder
  placement. A managed or headless host can fail here even when the `.app` is valid. If the first
  failure is `Running bundle_dmg.sh` or `hdiutil: ... device not configured`, preserve that
  output, verify the `.app`, and rerun the same Release command in a permitted macOS environment
  with disk-image access; request approval before leaving a managed sandbox. A manually created
  plain DMG or a `--skip-jenkins` DMG is not equivalent
  to the configured Release artifact; if used for diagnosis, report that Finder layout was not
  validated and do not publish it as the normal candidate.
- **Gatekeeper:** expected unsigned-app blocking is handled only after checksum verification using
  the documented user-controlled first-open path.
- **Overlay behavior:** record the exact macOS version and native error when transparency,
  click-through, or Spaces behavior fails. Do not silently accept an input-blocking overlay.

Do not respond to a packaging, Gatekeeper, WKWebView, or manual acceptance failure by running the
Windows WDIO workflow.

## Validation and Reporting

Use the smallest complete set for the request:

- Browser-only change: relevant Vite check, `npm test`, and `npm run build`.
- Native source or configuration change: portable checks, Rust checks, app build, and strict app
  bundle verification.
- Release-candidate request: production DMG build, strict verification, `hdiutil verify`, and the
  documented manual acceptance scope when authorized.
- Skill-only change: skill validator and targeted Prettier check.

Always report the exact failed command, failure category, host architecture and target, resolved
artifact paths, whether warnings were non-fatal, and whether ports used by the run were released.
Do not claim native E2E success from a macOS build or manual smoke check, and do not claim release
acceptance from a locally built artifact that bypassed download, checksum, quarantine, or
Gatekeeper validation.
