---
name: windows-tauri-build-test
description: Run and diagnose the OMG-Draft-Seer Windows Vite, Tauri debug, Release packaging, frontend test, and native WebdriverIO E2E workflows. Use when Codex is asked to run, compile, package, smoke-test, or validate the Windows desktop application.
---

# Windows Tauri Build Test

Use this procedure from the repository root for Windows validation. Keep the workflow
deterministic: reuse warm dependencies and Cargo targets, preserve the first failing command and
its output, and do not rebuild a native binary when the failure is only a browser, port, or test
synchronization problem.

## Project Facts

These values are part of the current checkout and are used by the commands below:

- Node is pinned by `.nvmrc` to `22.12.0` or newer; npm must be `10` or newer.
- Rust is pinned by `rust-toolchain.toml` to `1.90.0` MSVC with Rustfmt and Clippy.
- `src-tauri/tauri.conf.json` starts Vite at `http://127.0.0.1:5173` for `desktop:dev`.
- `vite.config.ts` ignores `src-tauri/target/**` so Cargo output does not trigger Vite rebuilds.
- `wdio.tauri.conf.ts` uses the embedded WebDriver provider on port `4445`.
- `scripts/build-tauri-test.ts` builds the test binary at the host-native release target path.
- `scripts/tauri-test-target.ts` derives binary paths. Do not hard-code an executable path in WDIO
  configuration or a command example.

All paths in commands and reports should be repository-relative. Do not run data synchronization,
icon caching, or external data refresh scripts as part of a build or test request.

## Choose One Workflow

| Need | Command | Result |
| --- | --- | --- |
| Browser HMR and URL debugging | `npm run dev -- --host 127.0.0.1 --port 5173` | Vite at `http://127.0.0.1:5173/` |
| Browser check of a production bundle | `npm run build`, then `npm run preview -- --host 127.0.0.1 --port 4173` | Vite preview at `http://127.0.0.1:4173/` |
| Tauri debug development | `npm run desktop:dev` | Persistent Vite plus `target\debug\omg-draft-seer.exe` |
| Frontend tests | `npm test` | Vitest result only |
| Frontend typecheck and bundle | `npm run build` | `dist/` plus TypeScript validation |
| Release package | `npm run desktop:build` | MSI and NSIS packages under `src-tauri/target/release/bundle/` |
| Native Tauri E2E | `npm run build:tauri:test`, then `npm run test:tauri` | WDIO test binary, then native E2E results |

Do not run standalone Vite and `desktop:dev` at the same time. `desktop:dev` owns port `5173`
through `beforeDevCommand`; a second Vite process creates misleading URL and lock errors.

## Preflight

Run these checks before native work:

```powershell
Test-Path package.json
Test-Path src-tauri
Test-Path package-lock.json
node --version
npm --version
rustc --version
cargo --version
rustup show active-toolchain
```

The repository root checks must return `True`. Confirm Node, npm, Rust, and the active MSVC
toolchain satisfy the versions in `AGENTS.md`. Native Tauri compilation also requires:

- Visual Studio 2022 Build Tools with Desktop development with C++, MSVC, and the Windows SDK.
- Microsoft WebView2 Runtime for launching the desktop application.

`Get-Command cl.exe` may be empty in a normal PowerShell even when Visual Studio is installed.
If Cargo reports that `cl.exe` or `link.exe` is missing, use a VS Developer PowerShell or repair
the C++ workload, then start a new terminal. If the application starts but WebView2 fails, repair
or install the WebView2 Runtime; rebuilding Rust will not fix that condition.

Reuse `node_modules/`, Cargo's cache, and `src-tauri/target/` when present. Run `npm ci` only when
dependencies are absent or `package-lock.json` changed. A cold `npm ci`, Cargo build, or first
EdgeDriver run can require network access; request permission only for that missing operation.

Before starting a persistent workflow, check the fixed ports:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 5173, 4173, 4445 } |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

If a port is occupied, inspect the owning PID and command line before stopping it. Do not use a
blanket `taskkill` against all `node.exe` processes because another task may own them.

## Vite URL Debugging

### Development URL

For browser-only HMR debugging, run:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
```

The expected URL is `http://127.0.0.1:5173/`. Verify the server before opening a browser:

```powershell
$response = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/
$response.StatusCode
$response.Content.Contains('root')
```

Expected values are `200` and `True`. Use the URL in a browser, not a `file:///` URL. Directly
opening `index.html` bypasses Vite and cannot validate module paths, HMR, or the application's
runtime assets.

If port `5173` is busy and only browser debugging is needed, an alternate Vite port is valid:

```powershell
npm run dev -- --host 127.0.0.1 --port 5174
```

That alternate URL is not valid for `desktop:dev` unless the Tauri `devUrl` and
`beforeDevCommand` are changed consistently. Do not silently use an alternate port for a Tauri
debug run.

### Production Preview URL

Use this lane to inspect the built frontend without starting Tauri:

```powershell
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Verify `http://127.0.0.1:4173/` with the same `Invoke-WebRequest` check. `vite preview` serves
`dist/`; it does not prove that the native Tauri bundle or WebView2 can launch.

When a persistent Vite or preview process is no longer needed, stop it with Ctrl+C and then check
the port again. Ctrl+C can print `STATUS_CONTROL_C_EXIT`, a Chrome window-class warning, or
`Terminate batch job (Y/N)?` on Windows. Those messages are expected shutdown noise when the
process, child application, and port have actually exited.

## Frontend Tests and Compile

For a normal frontend validation pass, run the commands separately and preserve the first failure:

```powershell
npm test
npm run build
```

`npm run build` performs `tsc -b` before Vite. A chunk-size warning from Vite is not a failed
build; report it separately from TypeScript or bundler errors. `desktop:build` and
`build:tauri:test` already invoke the Tauri frontend build with `--base ./`, so do not add an
unrelated second frontend build when only the native package is requested.

For the broader repository gate, run only the checks relevant to the requested scope. The usual
platform-neutral set is:

```powershell
npm run format:rust:check
npm run lint:rust
npm run verify:runtime
```

`npm run format:check` is a repository-wide gate and can expose pre-existing formatting debt. If
it fails, report the file count and distinguish baseline files from files changed for the current
task. For a skill-only change, validate the skill directly instead of formatting unrelated source:

```powershell
npx prettier --check .agents/skills/windows-tauri-build-test/SKILL.md
```

## Tauri Debug Development

Run the complete debug shell as one persistent process:

```powershell
npm run desktop:dev
```

The command starts `npm run dev -- --host 127.0.0.1 --port 5173`, waits for the configured Vite
URL, compiles the Rust debug target, and launches `src-tauri/target/debug/omg-draft-seer.exe`.
Use this lane for manual native smoke checks and live frontend changes. Do not separately start
Vite on `5173` first.

At minimum, confirm from the terminal output that all three stages occur:

1. `beforeDevCommand` starts Vite and prints the configured URL.
2. Cargo finishes the `dev` profile without a linker or Windows SDK error.
3. The debug executable is launched.

After stopping debug, verify that no listener remains on `5173` and that no
`omg-draft-seer.exe` or Cargo child from this run remains. If a process is stale, inspect its PID
and command line, then stop that exact process before retrying. Do not delete `src-tauri/target/`
as a first response to a normal debug shutdown warning.

The Vite watch rule must contain `src-tauri/target/**`. If Cargo reports `EBUSY`, `resource busy`,
or `resource locked` for a file below that directory:

1. Stop the Tauri and Vite processes and confirm port `5173` is free.
2. Confirm the ignore rule in `vite.config.ts` is still present.
3. Check for another process holding the exact file.
4. Retry `npm run desktop:dev` before considering any targeted generated-output cleanup.

## Release Package

Run:

```powershell
npm run desktop:build
```

This invokes the configured frontend build, compiles the normal-feature Tauri release binary, and
creates the local packages:

```text
src-tauri/target/release/bundle/msi/*.msi
src-tauri/target/release/bundle/nsis/*.exe
```

Inspect the generated package files and report their names. Do not use a WDIO-enabled binary as a
production artifact. The production package must not depend on the embedded WebDriver port or
the WDIO frontend bridge.

The normal release build and the E2E test build write the same release executable path. Therefore:

- `build:tauri:test` replaces the release executable with a `custom-protocol,wdio` test binary.
- `desktop:build` should be run last when the checkout must be left with a normal release binary.
- Never publish or install a package based only on the executable left by `build:tauri:test`.

## Native WebdriverIO E2E

Native E2E has a strict two-command order:

```powershell
npm run build:tauri:test
npm run test:tauri
```

The first command:

- Builds the frontend with `VITE_WDIO_E2E=true` and `--base ./`.
- Compiles Cargo with `custom-protocol,wdio` features.
- Resolves the release executable using host-native path semantics.
- Uses `cmd.exe` to launch `npm.cmd` on Windows; this avoids `spawn EINVAL` before frontend
  compilation.

The second command launches the derived executable through `@wdio/tauri-service` with the
embedded provider. Do not substitute Chromium Playwright, an external `tauri-driver`, or a
manually copied binary.

If an explicit Cargo target is required, set the same environment variable for both commands:

```powershell
$env:TAURI_TEST_TARGET = 'x86_64-pc-windows-msvc'
npm run build:tauri:test
npm run test:tauri
Remove-Item Env:TAURI_TEST_TARGET
```

`TAURI_TEST_TARGET` takes precedence over `CARGO_BUILD_TARGET` in the shared target helper. A
target mismatch between the two commands causes a false "binary missing" error even when the
build succeeded. Remove the temporary environment variable after the run, including after a
failed run, before starting another workflow.

Before `npm run test:tauri`, confirm:

- `src-tauri/target/release/omg-draft-seer.exe` exists, or the target-specific release path exists.
- Port `4445` is free. The embedded driver owns it during the test process.
- WebView2 is installed and EdgeDriver can be downloaded or is already cached.
- The newest `logs/wdio-*.log` file is available if the test fails. The WDIO config captures
  frontend and backend logs.

On the first Windows E2E run, WebdriverIO may download a compatible EdgeDriver. Treat that as the
expected test-time network dependency after npm and Cargo caches are warm. If the download fails,
report the proxy/network failure and do not rebuild the Rust binary repeatedly. If port `4445` is
occupied, identify and stop the stale embedded-driver process before rerunning.

## Failure Triage

Classify the failure before retrying a build.

### Toolchain and dependency failures

- `npm` or `prettier` is not recognized: verify `node_modules/` and run `npm ci` only if the lockfile
  or installation is missing.
- `cl.exe`, `link.exe`, or Windows SDK errors: fix the Visual Studio C++ environment.
- WebView2 startup errors: repair the WebView2 Runtime.
- Cargo registry or npm registry download errors: preserve the exact command and request network
  permission only for that operation.

### Frontend and Vite failures

- `http://127.0.0.1:5173/` returning non-200: diagnose the Vite process and source error first;
  do not compile Tauri.
- A browser is blank when `index.html` is opened directly: use the Vite dev or preview URL.
- `EBUSY` under `src-tauri/target/`: follow the watch-rule and exact-process steps above.
- A Vite URL works but the native app is blank: check Tauri `devUrl`, `beforeDevCommand`, CSP,
  WebView2, and native logs separately. A successful HTTP response alone does not prove native
  IPC or WebView startup.

### Tauri build failures

- `spawn EINVAL` before frontend compilation: inspect `scripts/build-tauri-test.ts` and confirm
  Windows `.cmd` commands are launched through `ComSpec`.
- `Tauri test binary is missing or not executable`: rerun `build:tauri:test` with the exact same
  `TAURI_TEST_TARGET`/`CARGO_BUILD_TARGET` environment, then verify the derived path. Do not paste
  an absolute path into WDIO configuration.
- Cargo compiles successfully but packaging fails: keep this separate from frontend and E2E
  failures; inspect the MSI/NSIS tool output and installed bundler prerequisites.

### E2E startup and DOM failures

- If `test:tauri` cannot connect, check the binary path, port `4445`, WebView2, and EdgeDriver
  before rebuilding. A stale driver or wrong target is not fixed by `npm test`.
- If a test opens Settings and then reports that a `nav-*` element is missing before any reload,
  this is expected application structure: the Settings page intentionally hides the main
  navigation. Assert the Settings page or selected locale there, then use `settings-back` before
  asserting a main navigation element.
- If the first WDIO test passes but a later test reports `element ... was not found` after
  `browser.refresh()`, treat it as an application/WebView readiness or test synchronization
  failure. Check the newest `logs/wdio-*.log` and the first frontend error before rebuilding. The
  later missing-navigation errors are usually cascade failures from the first refresh failure.
- Use the existing `[data-testid="app-shell"]` readiness check as the startup boundary. A test
  that needs a reload must wait for that boundary again before querying navigation elements.
- Repeated `IPC custom protocol failed, Tauri will now use the postMessage interface instead` and
  the WDIO invoke-interception fallback are service diagnostics, not Cargo compile errors. Keep
  them in the report, but do not rebuild solely because they repeat.
- `JSON error: invalid type: null, expected u32` is a runtime/service warning observed in this
  checkout. Preserve its first timestamp and surrounding log lines. Do not call an E2E run green
  while the application behavior is broken, and do not call it a compile failure without a Rust
  or frontend build error.
- `Failed to clear mock store: ... sessionId` after a failed session is cleanup fallout. Diagnose
  the first WebView or test assertion failure instead.

For a focused E2E diagnosis, keep the same build artifact and target environment, then run the
existing spec with WDIO's normal filtering options. Do not change the app binary, driver provider,
or port while trying to reproduce the failure; otherwise the result is not comparable.

## Standard Validation and Reporting

Use the smallest complete set for the request:

- Browser-only UI change: Vite URL check, `npm test`, and `npm run build`.
- Tauri debug change: `npm run desktop:dev`, manual smoke check, and port/process cleanup.
- Release request: `npm run desktop:build`, inspect MSI/NSIS output, and report package paths.
- Native E2E request: `npm run build:tauri:test` followed by `npm run test:tauri`; report pass/fail
  counts, target, binary path, port, and whether EdgeDriver was downloaded or reused.
- Broad Windows validation: `npm test`, `npm run build`, Rustfmt check, Clippy, runtime asset
  verification, then the requested native lane.

Always report:

1. The exact command that failed, if any.
2. Whether the failure is preflight, Vite, Rust/Cargo, packaging, WebView, driver, or test logic.
3. The relevant generated artifact path and environment target.
4. Whether ports `5173`, `4173`, and `4445` were released.
5. Warnings that did not fail the command, such as Vite chunk-size output or WDIO service logs.

Do not claim native E2E success from a successful test-binary build. Do not claim a Release
artifact from a WDIO-enabled executable. A skill standardizes the commands; it does not grant
sandbox, network, installation, or external signing permissions.

## Observed Checkout Baseline

The following was verified locally on 2026-07-25 and should be updated when the underlying project
behavior changes:

- Node `24.16.0`, npm `11.13.0`, Rust/Cargo `1.90.0` satisfy the pinned requirements.
- `npm test`: 21 files and 92 tests passed.
- `npm run build`: passed; Vite emitted only the existing large-chunk warning.
- `npm run desktop:dev`: Vite URL, Cargo debug compile, and debug executable launch passed.
- `npm run desktop:build`: passed; x64 MSI and NSIS packages were generated.
- `npm run build:tauri:test`: passed; the release test binary was generated.
- `npm run test:tauri`: passed; all 5 native E2E cases passed. WDIO still printed an
  after-session `Failed to clear mock store: ... sessionId` warning, but the session exited with
  code 0 and no validation case failed.
- `npm run format:rust:check`, `npm run lint:rust`, and `npm run verify:runtime`: passed.
- `npm run format:check`: blocked by the existing workspace formatting baseline; it reported 95
  files and was not treated as a native compile failure.
