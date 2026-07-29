# Windows Overlay Production Acceptance Test Adapter Design

> Approved on 2026-07-29 as the Windows adapter for the shared phase-1 Desktop overlay production
> acceptance contract. Implementation is pending.

## Goal

Implement the Windows-specific application, artifact, process, display, and screenshot operations
required by `docs/overlays/production-acceptance/shared.md`. The shared design owns scenario and
evidence semantics; this document owns only Windows execution and completion requirements.

## Scope

This workflow accepts the phase-1 Desktop overlay only. The overlay targets the main application
window's monitor; it does not prove Dota process/window identity, client-area tracking, capture,
integrity-level compatibility, or supported game full-screen behavior. Those are separate phase-2
Game-attached overlay acceptance requirements.

The workflow validates one explicit Windows application executable per run. The operator identifies
the artifact as `production`, `msi`, or `nsis`; installed-package runs occur after the operator has
installed the package and supplies its resolved executable. The workflow does not install or
uninstall packages, publish artifacts, modify signing state, or treat a WDIO-enabled binary as a
production artifact.

The adapter collects the Windows evidence required by
`docs/overlays/incidents/windows-visual-validation.md` and applies every shared gate. It does not
redefine the native event schema, screenshot correlation, report model, privacy policy, or generic
failure rules.

## Decisions

### Interactive Production Harness

Add a Node/TypeScript command that runs only on Windows and accepts:

```text
--app <repository-relative-or-user-supplied-executable>
--artifact production|msi|nsis
--installer <required-for-msi-or-nsis>
--output <optional-output-root>
```

The command rejects a missing executable, an unsupported platform, an unknown artifact kind, an
output directory inside committed fixtures, or an already-running OMG-Draft-Seer process that could
receive the single-instance handoff. It launches the exact executable supplied by the operator and
records its resolved path, SHA-256, process ID, version metadata, and whether the executable exposes
the test-only WebDriver marker or listens on port `4445`.

The default output is a timestamped directory below
`test-results/windows-overlay-acceptance/`, which is already ignored by Git. All source and
documentation paths remain repository-relative; reports may record the operator-supplied executable
path because they are local evidence artifacts and are not committed.

### Windows Evidence Boundary

The harness consumes the shared versioned JSONL lifecycle contract. It correlates events with the
launched Windows process and application instance, verifies the expected action cause, shortcut
mode, press cycle, revision, visibility, and target-monitor bounds, and rejects unstructured or
incomplete status text as acceptance evidence.

The production application remains free of a WebDriver or diagnostic IPC bridge. Evidence comes
from the normal native lifecycle logs and operating-system screenshots, so the same harness applies
to the repository release executable and installed MSI/NSIS executables.

### Windows Operator Flow

The adapter presents the five scenarios defined by the shared design using Windows terminology,
including hiding the main window to the notification area. It records the configured shortcut text
and active keyboard layout and requires real physical press/release cycles. It never uses
WebDriver, PowerShell, or Win32 input synthesis to satisfy shortcut scenarios.

### System Screenshot Capture

A focused PowerShell helper declares per-monitor DPI awareness before using Windows .NET APIs to
enumerate the virtual desktop and monitors and capture the complete virtual desktop to PNG. It
supports negative virtual-desktop origins and mixed-DPI displays. The helper receives explicit
output paths from the Node harness and returns JSON metadata on stdout. It does not inspect the DOM,
switch WebDriver windows, synthesize input, or capture only a WebView surface.

Every scenario retains the three hash-verified images defined by the shared design:

- `before.png`, with the overlay closed;
- `open.png`, after native open evidence is satisfied;
- `closed.png`, after native close evidence is satisfied.

The report records image dimensions, byte length, SHA-256, and capture timestamp. The operator must
answer a yes/no prompt confirming that `open.png` contains the expected non-transparent panel and
that `before.png` and `closed.png` do not. A negative or missing attestation fails the scenario.

The adapter supplies the pre- and post-capture native observations required by the shared
correlation gate and records virtual desktop bounds, each monitor's physical bounds and scale,
Windows build, HDR state when observable, and capture-helper DPI awareness.

### Windows Artifact Provenance

The repository production run records the executable hash, version metadata, source commit, and
dirty-worktree state when it is a local build. An installed-package run additionally records:

- the MSI or NSIS installer path, SHA-256, size, and version;
- MSI ProductCode and PackageCode when applicable;
- the matching uninstall registry entry and resolved install location;
- the installed executable identity and hash.

The report rejects an `msi` or `nsis` label without matching installer and installation evidence.
MSI and NSIS may contain identical application executables, so installer provenance, rather than a
requirement for different executable hashes, distinguishes the matrix entries.

### Reports And Completion Matrix

Each run writes:

- `run.json`, the machine-readable environment, executable identity, parsed native transitions,
  screenshot metadata, operator attestations, retries, and result;
- `report.md`, a readable scenario table with relative links to screenshots;
- `native.log`, the unmodified stdout/stderr stream from the launched application;
- one directory per scenario containing its three screenshots.

Report generation is atomic: data is first written to temporary files in the run directory and
renamed only after serialization succeeds. An interrupted run remains marked incomplete and cannot
be merged into final acceptance.

A separate report command accepts completed `run.json` files and produces an artifact matrix. The
incident can be closed only when the matrix contains passing runs for the repository production EXE
and every package format selected for release. For the current repository, that means production,
MSI-installed, and NSIS-installed runs, each covering all five scenarios.

## Components

### `scripts/windows-overlay-acceptance.ts`

Owns argument validation, process lifecycle, operator prompts, native-event ingestion, platform
window observation, screenshot orchestration, scenario sequencing, cleanup, exit codes, and report
writes. Platform and process side effects are injected behind small interfaces so scenario behavior
can be tested on any host.

### `scripts/overlay-acceptance-core.ts`

Implements the shared pure acceptance contract described in the parent design.

### `scripts/windows-overlay-capture.ps1`

Declares DPI awareness, enumerates the Windows virtual desktop and monitors, captures a PNG using
`System.Drawing`, and prints one JSON result. It writes only to the exact file path supplied by the
harness and fails if the parent directory does not exist.

### `scripts/windows-overlay-acceptance.test.ts`

Tests the pure core and the orchestrator through injected fake process, prompt, clock, and screenshot
adapters. Tests use temporary directories and host-native `node:path`; they do not embed drive-rooted
or synthetic absolute paths.

## Error Handling And Cleanup

- Unsupported hosts fail before creating output or launching a process.
- Existing matching application processes fail preflight and are reported by PID; the tool never
  terminates them automatically.
- Application early exit, missing native status, visibility observation failure, out-of-bounds
  geometry, screenshot failure, negative visual attestation, or timeout produces a nonzero exit.
- Ctrl+C records an interrupted result, asks the launched process to close, and reports any process
  that remains. It does not use blanket `taskkill` or delete existing evidence.
- Port `4445` is checked before and after the run. The harness fails if the selected production
  process exposes the test bridge, while an unrelated listener is identified without being stopped.
- Screenshot and report paths are resolved beneath the selected output root and checked against
  traversal before use.
- Windows process matching uses canonical executable identity and product metadata rather than a
  name-only match. Ambiguous candidates fail preflight.
- Port ownership is mapped to the selected process or its child process before a listener is treated
  as the application's test bridge.
- A repository-internal custom output must be Git-ignored; an external or cloud-synchronized path
  requires the shared explicit override and privacy warning.

## Test Strategy

The implementation follows test-driven development:

- shared-core tests cover schema, scenarios, screenshot correlation, reports, and matrix behavior;
- path tests prove traversal and committed-fixture output are rejected using host-native paths;
- orchestrator tests prove exact executable selection, pre-existing-process refusal, interrupt
  cleanup, installer provenance, port ownership, and nonzero exit on every failed gate;
- PowerShell syntax and Windows integration are checked on a Windows host with a temporary output
  directory, negative virtual origin, and declared DPI awareness;
- repository validation runs focused Vitest, `npm run check`, and `git diff --check` on the current
  host, then production build, package build, and the complete acceptance matrix on Windows.
- Manual coverage records Windows 10/11, 100% and scaled DPI, mixed-DPI multi-monitor layouts,
  negative monitor coordinates, HDR/SDR where available, and main-window monitor changes.

## Acceptance Criteria

The design is implemented when:

1. The shared host-portable unit suite and Windows adapter tests pass.
2. A Windows operator can run one documented command against an explicit executable and receive a
   complete, reviewable evidence directory without using WDIO.
3. Windows artifact provenance distinguishes production, MSI, and NSIS matrix entries without
   automatic installer mutation.
4. Incomplete or visually rejected runs cannot be reported as passing.
5. The incident remains open until current production, MSI-installed, and NSIS-installed matrices
   contain all five passing scenarios with system screenshots and native state evidence.

## Non-Goals

- Validating Game-attached overlay target identity, game-window geometry tracking, capture, or
  exclusive-fullscreen compatibility.
- Fully unattended visual recognition of the recommendation panel.
- Automatic MSI/NSIS installation, elevation, signing, publishing, or release creation.
- Replacing the existing WDIO functional suite.
- Adding a production IPC endpoint solely for tests.
- Committing desktop screenshots or machine-specific report paths.
