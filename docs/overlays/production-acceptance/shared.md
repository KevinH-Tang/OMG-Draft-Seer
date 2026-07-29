# Overlay Production Acceptance Test Design

> Approved on 2026-07-29 as the shared evidence contract for phase-1 Desktop overlay production
> acceptance. Platform harnesses remain implementation-pending designs.

## Goal

Define one platform-neutral acceptance model that proves a production Desktop application displays
and hides the recommendation overlay through the button, Trigger, Hold, and hidden-main-window
shortcut paths. Windows and macOS adapters collect platform-native artifact, process, display, and
screenshot evidence without adding a production WebDriver or diagnostic IPC bridge.

## Scope And Boundaries

This design accepts the current phase-1 Desktop overlay. It covers the shared Rust lifecycle,
content readiness, request revisions, shortcut press cycles, target-monitor placement, native
visibility, compositor screenshots, and operator visual attestation.

It does not accept phase-2 Game-attached overlay behavior. Dota process/window identity,
client-area following, capture, integrity-level compatibility, protected content, and supported game
full-screen modes remain governed by `docs/overlays/game-capture-design.md`.

Windows and macOS share acceptance semantics, not identical operating-system mechanisms:

- Windows validates production, MSI-installed, and NSIS-installed executables with a Windows
  process adapter and virtual-desktop screenshot helper.
- macOS validates the final Apple Silicon application and the quarantined DMG-installed application
  with bundle, Gatekeeper, CoreGraphics, and system-screenshot evidence.
- Windows remains the continuous native E2E target. Production acceptance on both platforms is an
  interactive release activity and is not inferred from build or WebDriver success.

## Shared Scenario Contract

One run executes these scenarios in order:

1. **Button:** open and close the recommendation overlay from the Database page.
2. **Trigger:** one physical shortcut press opens it and the next physical press closes it; each
   press cycle produces exactly one transition.
3. **Hold:** the shortcut press opens it and release closes it.
4. **Hidden-main Trigger:** hide the main window, then repeat the Trigger open/close path.
5. **Hidden-main Hold:** hide the main window, then repeat the Hold press/release path.

Before each action, the harness presents one unambiguous instruction and waits for the operator. It
does not synthesize shortcut input. A retry creates a new attempt record and never overwrites prior
evidence.

## Native Evidence Contract

Human-oriented stderr is not an acceptance interface. Acceptance consumes newline-delimited JSON
events with a stable prefix and an explicit schema version. Adding these normal lifecycle events
does not add a command, state mutation path, WebDriver feature, or diagnostic IPC bridge.

Every relevant transition or status event contains:

```text
schemaVersion
timestamp
instanceId
event
overlayKind
label
revision
cause
shortcutMode
pressCycleId
requested
ready
visibilityObserved
visible
displayed
position
size
monitor
targetMonitor
withinMonitorBounds
```

`cause` distinguishes at least `button`, `shortcut`, `mode-change`, `main-window-hide`, and
`lifecycle`. `shortcutMode` and `pressCycleId` are required for shortcut-caused events. Values that
do not apply are encoded as JSON `null`, not omitted or inferred as false.

The parser rejects unknown schema versions, malformed events, missing required fields, events from
another application instance, stale revisions, and shortcut transitions that cannot be associated
with the expected physical press cycle. It may retain unknown additive fields but cannot use them
to satisfy a gate until the schema is updated.

Open passes only when the expected cause and scenario identity lead to a newer revision with
`requested`, `ready`, `visibilityObserved`, `visible`, `displayed`, and `withinMonitorBounds` all
true. Close passes only when a later expected transition reports `requested=false`,
`visibilityObserved=true`, `visible=false`, and `displayed=false`.

## Screenshot Correlation

Every scenario retains `before.png`, `open.png`, and `closed.png`. A screenshot is accepted only
when it is bracketed by native observations for the same instance and revision:

1. Observe the required stable native state.
2. Allow the platform compositor stabilization interval.
3. Capture the system desktop through the platform adapter.
4. Confirm immediately afterward through the platform window adapter that the process/window state
   did not change, and observe no newer lifecycle revision before the next scenario action.
5. Reject and retry the attempt if the state changed, the application exited, or either observation
   is missing.

The report records lifecycle and platform-window observation timestamps, screenshot timestamp,
dimensions, byte length, and SHA-256. Images are described as hash-verified evidence, not immutable
files. The operator must
attest that `open.png` contains the expected non-transparent recommendation panel and that
`before.png` and `closed.png` do not. A negative or missing attestation fails the scenario; a generic
pixel-difference threshold cannot replace it.

## Artifact Identity And Provenance

Each run identifies the exact launched application and its source artifact. Shared fields include:

- artifact kind, canonical path, byte length, SHA-256, and application version;
- process ID and application instance ID;
- source commit and build/run identifier when available;
- test-only WebDriver marker and listener checks;
- platform-specific installer, bundle, signature, quarantine, or package identity;
- acceptance-tool version and evidence schema version.

An operator-supplied artifact label alone is insufficient for an installed-artifact matrix entry.
The platform adapter must collect its defined provenance fields. Report aggregation revalidates the
run schema, result, image hashes, artifact identity, and scenario completeness and rejects duplicate
or incomplete matrix entries.

## Reports And Storage

Each run writes:

- `run.json`, containing environment, artifact identity, native events, screenshot metadata,
  attestations, retries, and result;
- `report.md`, with relative evidence links and a readable scenario table;
- `native.log`, retaining the unmodified process output;
- one directory per scenario and attempt containing its screenshots.

Metadata files are written to temporary paths and atomically renamed after validation. Interrupted
runs remain explicitly incomplete. The harness never uploads evidence.

The default output is a platform-specific directory below `test-results/`. A repository-internal
custom output must be verified as Git-ignored. An external or cloud-synchronized output requires an
explicit operator override. Before desktop capture, the tool warns that screenshots and logs can
contain private content and recommends a clean test account, disabled notifications, and no private
windows on other displays.

## Architecture

The planned shared core owns pure types and functions for schema validation, event reduction,
revision and press-cycle ordering, screenshot correlation, path containment, report-model
validation, matrix completion, and Markdown rendering. It has no dependency on operating-system
APIs or the filesystem.

Platform harnesses own application launch, process identity, artifact provenance, environment
inventory, screenshot capture, cleanup, and platform-specific gates. Side effects are injected
behind small interfaces so the orchestrators can be tested on any host.

Planned entry points are exposed through `package.json`, not undocumented direct script commands:

```text
npm run accept:overlay:windows -- ...
npm run accept:overlay:macos -- ...
npm run report:overlay-acceptance -- ...
```

These commands are design names, not current instructions, until their implementation and focused
tests exist.

## Error Handling

- Unsupported hosts fail before creating output or launching an application.
- Existing application instances that could receive a single-instance handoff fail preflight and
  are reported; the harness never terminates them automatically.
- Early exit, missing or malformed evidence, cause/cycle mismatch, stale state, screenshot failure,
  changed state during capture, negative attestation, provenance failure, or timeout returns nonzero.
- Ctrl+C records an interrupted result, requests the launched process to close, and reports any
  process that remains. It does not use blanket process termination or delete evidence.
- Paths are resolved beneath the selected output root and checked against traversal before use.
- A production application exposing the test-only WebDriver bridge fails the run.

## Test Strategy

- Schema tests reject partial, malformed, unknown-version, cross-instance, and stale events.
- Reducer tests cover all five scenarios, causes, modes, press cycles, retries, cancellation, and
  out-of-order delivery.
- Screenshot tests cover stable bracketing, changed revisions, missing post-capture observation,
  hashes, and negative attestations.
- Artifact tests reject incomplete provenance and duplicate matrix entries.
- Path tests use host-native `node:path` and temporary directories without hard-coded absolute paths.
- Orchestrator tests inject fake process, prompt, clock, screenshot, environment, and artifact
  adapters and require a nonzero exit for every failed gate.
- Platform integration tests run only on their target hosts and exercise the real screenshot and
  artifact-inspection helpers.

## Acceptance Criteria

The shared design is implemented when:

1. The host-portable suite proves schema, scenario, screenshot-correlation, provenance, reporting,
   and failure behavior.
2. Each platform adapter produces a complete reviewable evidence directory from an explicit final
   artifact without WebDriver.
3. No production command bridge, hidden test feature, automatic installer mutation, or evidence
   upload is introduced.
4. Incomplete, uncorrelated, wrong-source, or visually rejected runs cannot be reported as passing.
5. Platform completion matrices enforce every artifact and scenario required by that platform's
   design.
