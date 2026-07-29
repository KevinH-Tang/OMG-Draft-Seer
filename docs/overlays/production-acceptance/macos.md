# macOS Overlay Production Acceptance Test Adapter Design

> Approved on 2026-07-29 as the macOS adapter for the shared phase-1 Desktop overlay production
> acceptance contract. Implementation is pending and does not create a second continuous native E2E
> suite.

## Goal

Implement the macOS-specific artifact, process, display, Spaces, Gatekeeper, and screenshot
operations required by `docs/overlays/production-acceptance/shared.md` for the supported Apple
Silicon direct-distribution path.

## Scope

This adapter accepts the current phase-1 Desktop overlay in a final arm64 application and in the
application installed from the final quarantined DMG. It applies the five shared Button, Trigger,
Hold, hidden-main Trigger, and hidden-main Hold scenarios.

It does not add WKWebView WebDriver automation, Developer ID signing, notarization, stapling, Mac
App Store support, universal binaries, Game-attached placement, capture, or a guarantee that an
external overlay can appear over every macOS full-screen Space.

## Interactive Harness

The planned macOS command accepts:

```text
--app <repository-relative-or-user-supplied-app-bundle>
--artifact app|dmg-installed
--dmg <required-for-dmg-installed>
--checksum <required-for-dmg-installed>
--output <optional-output-root>
```

The harness rejects a non-macOS host, Intel process, missing or ambiguous application bundle,
non-arm64 executable, missing runtime assets, test WebDriver marker/listener, already-running
OMG-Draft-Seer instance, invalid checksum, or incomplete DMG provenance. It launches the exact
bundle supplied by the operator and correlates shared JSONL events with that application instance.

The `dmg-installed` path does not mount, copy, remove, clear quarantine, or perform the first-open
flow on the operator's behalf. The operator first follows the documented Finder or Privacy &
Security flow, then supplies the installed application and final DMG. The harness may launch that
already accepted application for its scenarios without mutating Gatekeeper state.

## Artifact And Gatekeeper Provenance

Every run records:

- application bundle canonical path, bundle identifier, version, executable path, size, and SHA-256;
- Mach-O architectures, requiring exactly the supported arm64 path;
- embedded runtime verification and absence of `TAURI_WEBDRIVER_PORT`;
- code-signing inspection results without describing ad-hoc signing as Apple authentication;
- macOS version/build, hardware model, display topology/scaling, Spaces state, and clean-account
  attestation.

A `dmg-installed` run additionally records:

- DMG filename, size, SHA-256, published checksum identity, and `hdiutil verify` result;
- quarantine metadata retained on the downloaded DMG and installed application when observable;
- the operator's attestation that the documented Finder or Privacy & Security first-open path was
  used and the application did not clear its own quarantine;
- the GitHub Release tag and URL when available.

The adapter never invokes `xattr -d`, signing, notarization, stapling, release upload, or credential
commands.

## Native Evidence And Scenario Flow

The adapter applies the shared versioned JSONL event contract and requires the expected cause,
shortcut mode, press cycle, revision, ready state, native visibility, and monitor bounds for every
scenario. It records the configured shortcut and active keyboard layout.

The hidden-main scenarios use the application's normal close-to-hide behavior. Trigger and Hold use
real physical input; AppleScript, Quartz event injection, and synthetic DOM input cannot satisfy
them. In addition to the shared five scenarios, the release matrix records a Trigger check while the
main window is visible but unfocused, because focus-independent global delivery is a supported
Desktop behavior and a current macOS validation gap.

## System Screenshot And Window Evidence

A small Swift/CoreGraphics helper enumerates the relevant application windows and captures the
system desktop through the supported macOS screenshot mechanism. It records:

- CoreGraphics window identity, owner PID, bounds, layer, and on-screen state;
- display bounds and backing scale;
- active display arrangement and whether multiple Spaces are enabled;
- screenshot dimensions, time, size, and SHA-256.

The helper receives exact output paths and emits one structured result. It does not inspect the
WKWebView DOM, synthesize input, capture arbitrary application content separately, or change Space.
The harness applies the shared pre- and post-capture native-state bracket and operator attestation.

The run repeats overlay placement with multiple Spaces and a full-screen application. A platform
configuration that cannot present the external phase-1 Desktop overlay is recorded as unsupported
for that environment and fails release acceptance; it must not display the overlay on an unrelated
Space or silently claim success. This does not define the future Game-attached fallback policy.

## Components

### `scripts/macos-overlay-acceptance.ts`

Owns macOS argument validation, bundle and DMG inspection, process lifecycle, prompts, shared event
ingestion, screenshot orchestration, scenario sequencing, cleanup, and report writes.

### `scripts/overlay-acceptance-core.ts`

Implements the shared pure acceptance contract described in the parent design.

### `scripts/macos-overlay-capture.swift`

Enumerates CoreGraphics windows and displays, invokes the supported system screenshot path, and
returns one structured metadata result for an exact output path.

### `scripts/macos-overlay-acceptance.test.ts`

Tests macOS option and provenance reduction plus the orchestrator through injected bundle, process,
prompt, clock, and screenshot adapters. Tests use temporary host-native paths.

## Error Handling

- Existing matching application instances fail preflight and are never terminated automatically.
- Missing or changed quarantine state, checksum mismatch, non-arm64 executable, wrong bundle
  identity, missing runtime resources, screenshot failure, wrong Space, cursor interception, or any
  shared evidence failure returns nonzero.
- Ctrl+C records an interrupted run, requests only the launched application to close, and reports a
  remaining process without blanket termination.
- The default evidence root is `test-results/macos-overlay-acceptance/`; shared ignored-output,
  external-path, privacy, and traversal rules apply.

## Test And Environment Matrix

- Host-portable tests cover parsing and orchestration without requiring macOS frameworks.
- Apple Silicon integration validates bundle inspection, Mach-O identity, quarantine metadata,
  CoreGraphics enumeration, and screenshot capture.
- Manual coverage records supported macOS versions, Retina and non-Retina external displays,
  display scaling, negative/offset display arrangements, multiple Spaces, Stage Manager when
  enabled, full-screen Spaces, main-window monitor changes, and sleep/wake recovery.
- Release acceptance uses the final downloaded DMG and the repository-pinned Node 22 baseline; a
  development `.app` or earlier candidate is evidence only for that artifact.

## Acceptance Criteria

The macOS adapter is implemented when:

1. Shared core and macOS adapter tests pass without creating a second continuous WKWebView E2E suite.
2. An operator can produce complete `app` and `dmg-installed` evidence using final arm64 artifacts.
3. All shared scenarios plus the macOS unfocused Trigger check contain correlated native state,
   system screenshots, and positive visual attestations.
4. Bundle, checksum, architecture, runtime, quarantine, and first-open evidence is complete without
   Apple credentials or automated Gatekeeper mutation.
5. The generated report can be attached to the existing macOS release acceptance record without
   claiming Developer ID signing, notarization, or universal compatibility.
