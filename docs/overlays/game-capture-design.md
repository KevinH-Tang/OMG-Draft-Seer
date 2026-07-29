# Cross-Platform Game Capture And Overlay Design

**Status:** Proposed phase-2 design. This document does not describe a shipped feature. The current
release target is the Desktop overlay documented in
[`lifecycle.md`](lifecycle.md).

## Purpose

Page 1 currently accepts a user-selected PNG or JPEG, creates an `ImageBitmap`, and transfers it
to `src/workers/recognizer.worker.ts`. The worker crops the versioned 60-slot layout and ranks
icons locally. This design adds an opt-in desktop source that refreshes that same input while a
Dota 2 Ability Draft window is open, plus an external read-only recommendation overlay.

This is the second stage of the overlay roadmap. Stage 1, Desktop overlay, positions the existing
windows in display/desktop coordinates and is the only current development, release, and acceptance
target. Its full-display recommendation/layout windows use the main application's target monitor;
the Tier window retains its desktop-coordinate behavior. Stage 2, Game-attached overlay, adds
verified game-window identity and geometry tracking without replacing the existing
content-readiness and revisioned visibility lifecycle.

The baseline analysis mode is one capture attempt per second (1 Hz). A separately profiled
low-latency video-frame mode may process the latest frame at display rate, but it is not the same
as persisted video recording. The user can turn each data source on or off, sees why it is waiting
or paused, and can always use manual upload. The supported native targets are Windows and Apple
Silicon macOS. Browser builds remain manual-upload only.

## Decision

Use a platform-native system window-capture API from the Tauri Rust process, targeting a verified
Dota 2 top-level window. Windows uses Windows Graphics Capture (WGC) by `HWND`; Apple Silicon
macOS uses ScreenCaptureKit (SCK) with a selected `CGWindowID`/content filter. Do not capture the
desktop, inject into the game, read process memory, send input, or use a global hotkey in the first
release.

In Valve official matchmaking, combine this visual source with an optional local Game State
Integration (GSI) HTTP listener. GSI is read-only client data explicitly selected by Valve for
exposure; it confirms final game state but does not replace visual recognition of an Ability Draft
candidate pool. Do not use `-dev`, developer-console control, Workshop Tools, renderer hooks,
memory reads, or network packet parsing in the production path.

WGC and SCK capture a specified window through their supported operating-system APIs and avoid
scanning another monitor or application. A GDI `BitBlt`, `PrintWindow`, Quartz desktop screenshot,
or monitor-capture fallback is intentionally excluded: those paths are less reliable for
hardware-accelerated/exclusive-fullscreen games and weaken the guarantee that automatic capture is
restricted to Dota 2.

The implementation targets Windows 10 version 1903 or newer with a supported D3D11 device, and
Apple Silicon macOS 13 Ventura or newer with ScreenCaptureKit available. When the corresponding
capture API, graphics device, or user permission is unavailable, the feature reports an unsupported
or permission-required state and leaves upload available.

## Production Data Channels

The application has two independent, user-controlled sources. Neither source can issue game
commands or simulate player input.

| Channel                   | Source and purpose                                                                              | Official-match role                                                                                                                       | Not a substitute for                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Video capture / recording | WGC or SCK obtains only the verified Dota window's rendered pixels.                             | Read the visible Ability Draft candidate grid, detect layout changes, and optionally retain an explicitly requested diagnostic recording. | Valve game state, hidden data, or an in-process overlay.                               |
| GSI API reading           | The Dota client POSTs a limited JSON game state to a localhost endpoint configured by the user. | Confirm current phase, hero, selected abilities, and other fields actually emitted by the client.                                         | The 60 visible candidate icons, exact UI geometry, or a latency guarantee below 50 ms. |

The product treats GSI as authoritative only for fields it has received in the current session. It
treats visual recognition as authoritative only for what is visible in the captured Dota window.
A disagreement becomes a user-visible `state-conflict`; it never silently replaces a confirmed
skill or click target.

### Video Capture And Recording

The default analysis profile is a 1 Hz snapshot: acquire one current frame, fingerprint the
candidate regions, and run recognition only when they materially change. It does not create a video
file. This is sufficient for a user reviewing an Ability Draft board and remains the baseline in
this document.

Low-latency mode is a separate performance feature. It accepts the most recent WGC/SCK frame at
60 fps or the source display rate, keeps a queue depth of one, crops/fingerprints on the native GPU
path, and drops stale frames. It must not PNG-encode, Base64-serialize, or send full raw frames
through Tauri IPC. Recognition results, not frames, are delivered to the React UI and overlay.

An optional persisted recording is off by default and is a distinct user command. It uses a
hardware encoder where available (Windows NVENC/AMF/Quick Sync; macOS VideoToolbox), with no B
frames in a low-latency profile. Recordings have an explicit destination, retention policy, and
stop indicator; they are never needed for normal recognition or GSI operation.

WGC/SCK may be suitable for a measured `p50` capture-to-result target below 50 ms when the native
pipeline avoids encoding and queues. They cannot promise a sub-50 ms game-present-to-overlay `p95`
because the operating-system compositor, display refresh, HDR, source mode, and capture callback
timing are outside the application. Steam-style render hooks are deliberately out of scope.

### GSI API Reading

GSI is configured in the user's Dota installation with a
`gamestate_integration_<name>.cfg` file, normally below
`game/dota/cfg/gamestate_integration/`. It POSTs JSON to an application-owned localhost endpoint.
The production listener binds only to `127.0.0.1` or `::1`, uses a per-install random auth token,
limits request size, and rejects requests without the expected token. It must never bind to every
network interface or expose its status endpoint remotely.

The exact schema and field availability are client-version, game-mode, player, and spectator
dependent. Expected useful groups include `provider`, `map`, `player`, `hero`, `abilities`,
`events`, and `draft`. The known `draft` representation describes hero draft state; it must not be
assumed to contain the Ability Draft 60-skill candidate pool. The `abilities` group may confirm
abilities after they become part of the player's exposed state, but must be validated in the target
Ability Draft flow before product use.

`buffer` and `throttle` in GSI configuration are intentional update buffering/rate controls.
Their common 0.1-second values already exceed a 50 ms budget. A development experiment may try
lower values against a local listener, but the app must measure received timestamps and never claim
GSI provides hard real-time latency. GSI is a structured state-confirmation channel, not the visual
low-latency path.

The user explicitly enables the integration and approves writing or selecting its configuration
file. Disabling tracking stops the listener but does not delete user configuration without a
separate explicit action. `-dev`, console commands, and Workshop Tools can validate a local
prototype, but they provide no external production API for Valve official matchmaking.

## Scope And Non-Goals

In scope:

- Attach only after the user explicitly enables `Track Dota 2 window` in the Tauri desktop app.
- Verify Dota 2's process and select its visible top-level render window; capture no faster than
  1 Hz in the default snapshot profile.
- Reuse the current scaled 60-slot layout and the existing recognition worker.
- Update suggestions only after a material candidate-area change and stable recognition.
- Keep frames in memory or a private short-lived cache; do not save screenshots by default.
- Optionally receive a user-configured localhost GSI stream and use only fields exposed by the
  current official-match client session.
- Show recommendations through an external, transparent, mouse-pass-through native overlay when
  the platform and display mode permit it.

Out of scope:

- Browser, monitor, desktop, or arbitrary-window capture.
- Global shortcuts, input automation, game memory access, DLL injection, and network interception.
- Automatic layout discovery; the user-calibrated layout remains authoritative.
- Steam-style renderer injection, API hooks, or a claim of pixel-perfect game HUD support.
- Production use of `-dev`, console control, Workshop Tools, arbitrary local-process control, or
  packet parsing.
- A claim of anti-cheat approval. Public APIs do not remove the need for Valve/Steam policy review.

## Target Verification

The game name alone is not enough: Dota can own several windows, and process IDs can be reused.
The shared `GameTargetResolver` returns a `TargetIdentity` with a platform process identity, an
approved game installation identity, and one eligible window identity. It must revalidate the
identity before every emitted frame. Dota exit, window recreation, minimization, lock-screen
transition, or a capture-device failure detaches the session; later reattachment repeats normal
verification.

The first time tracking is enabled, the UI displays the discovered game installation and asks the
user to approve it. That approval is stored as a user preference, not hard-coded: Steam library
locations vary. Window titles and classes can be diagnostic data but are never identity checks,
because Steam and Dota updates can change them. Multiple equally eligible game windows result in
`ambiguous-window`, never a silent arbitrary choice.

| Platform            | Process and installation identity                                                                                                                                                           | Window identity and eligibility                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows             | `dota2.exe` name, PID, `GetProcessTimes` creation time, and approved canonical executable path from `QueryFullProcessImageNameW`.                                                           | `HWND` from `EnumWindows` and `GetWindowThreadProcessId`; visible, not DWM-cloaked, not owned/tool, and above a conservative client-area minimum.                                         |
| Apple Silicon macOS | Dota's `NSRunningApplication` PID, launch identity, and canonical executable path from `proc_pidpath`; record application bundle URL/bundle identifier when the Steam launch provides them. | `SCShareableContent` window with `CGWindowID`, owning application PID, visible/on-screen state, and minimum content size. Exclude desktop, Dock, menu-bar, and app-owned utility windows. |

Windows attachment requires `dota2.exe` (case-insensitive), matching approved path and creation
time, and an eligible `HWND` that belongs to that PID. macOS attachment requires the approved
executable path (plus bundle identity when present), a current launch identity, and an eligible SCK
window owned by that PID. A captured frame is invalid if its window identity, source size, or
layout revision no longer matches the active session.

## Source And Fusion Pipeline

```text
user enables tracking
        |
        v
resolve approved Dota process/window every 2 s while detached
        |
        v
verify platform process identity + eligible native window
        |                                      \
        v                                       v
WGC (Windows) / SCK (macOS)                 localhost GSI listener
        |                                       |
snapshot 1 Hz or latest-frame mode          validate auth + JSON schema
        |                                       |
candidate fingerprint + recognition          phase/hero/ability state
        |                                       |
        +------------------ state fusion ------+
                              |
                              v
stable suggestions; confirmed fields protected; external overlay
```

### Windows Capture Backend

Use the Microsoft `windows` Rust bindings for Win32, WinRT, D3D11, and Windows.Graphics.Capture.
Create the capture item for the verified `HWND` through
`IGraphicsCaptureItemInterop::CreateForWindow`, then use a D3D11 free-threaded frame pool. Recreate
the capture object when the source content size changes; never reuse it across an `HWND` change.
Request Windows programmatic-capture access before creating the frame pool when the installed
Windows version requires it; surface a denied request as `access-denied` without attempting a
desktop fallback.

Use BGRA-compatible D3D11 textures, release every frame promptly, and have one owner task for the
frame pool. Capture callbacks retain only the newest usable frame or reject it when a capture is
already queued. They must not invoke Tauri or run recognition on the Direct3D callback thread.

Expose WGC/D3D11 failures as categorized states: `unsupported`, `access-denied`, `source-closed`,
`device-lost`, or `capture-failed`. Do not expose arbitrary window titles or image content in
errors. `source-closed` and `device-lost` permit controlled reattach after backoff; stop after
three consecutive failures and require Retry.

### Apple Silicon macOS Capture Backend

Use ScreenCaptureKit from the Tauri Rust process through an Objective-C/Swift bridge or mature Rust
bindings that expose the same lifecycle. Enumerate capture candidates with `SCShareableContent`,
select the verified `CGWindowID`, and create an `SCContentFilter` that includes that window only.
Use `SCStream` to receive BGRA frames and retain at most the most recent frame for the shared
scheduler. The callback must only hand off or drop the frame; PNG encoding, Tauri events, and
recognition run off the SCK delivery queue.

Before enumeration or capture, query Screen Recording authorization and request it only from the
explicit tracking action. A denied, restricted, or later-revoked permission produces
`permission-required`/`access-denied`, with instructions to enable Screen Recording for the app in
macOS Privacy & Security. Do not request Accessibility permission by default: SCK's capture source
is sufficient for 1 Hz frames. Request it only in a separately approved future enhancement if
event-driven window geometry tracking proves necessary.

SCK capture is paused when the source is unavailable, its window leaves the shareable content list,
or the active full-screen Space no longer supplies the selected window. A source-size or window-ID
change creates a new content filter/stream and resets the stability gate. Do not substitute a
whole-display stream or `CGWindowListCreateImage` when a window is unavailable.

### External Overlay Placement

The existing `OverlayLifecycle` remains responsible for overlay kind, open/close intent, content
readiness, revisions, shortcut semantics, and the React content handoff. A separate
`OverlayPlacement` boundary owns target identity, physical bounds, display eligibility, geometry
updates, and detach. This roadmap names the current display-level policy
`DesktopMonitorPlacement` and the future platform adapters `GameWindowPlacement`; these names define
the intended extension boundary and do not claim that a same-named interface already exists.
Placement decisions must not leak into React content components or duplicate the lifecycle state
machine.

The resulting transparent, always-on-top, mouse-pass-through native window uses the existing
recommendation/tier content. It is an external companion window, not a renderer hook: it cannot
guarantee Steam-style pixel-perfect placement in exclusive fullscreen, and must report that
limitation in the UI.

On Windows, place a transparent topmost Tauri window against the Dota window's client bounds,
convert coordinates with the monitor's DPI, and update it when the target bounds or DPI changes.
On Apple Silicon macOS, configure a transparent `NSPanel`/`NSWindow` as non-activating and
mouse-pass-through, set an appropriate floating window level, and allow it to join the active
full-screen Space. It must track the selected game's screen and content frame without stealing
focus. If the game is in a display/full-screen configuration that blocks external overlays, hide
the overlay and keep capture/analysis available rather than placing it over another Space.

The placement contract reports at least the selected target identity, current physical client
bounds, eligibility, scale/DPI, and a detach reason. It produces geometry changes independently of
capture frames and invalidates the target on process relaunch, window recreation, minimize, source
loss, permission/integrity mismatch, or unsupported full-screen behavior. It must never silently
fall back to `DesktopMonitorPlacement`; switching back to Desktop overlay is an explicit user mode
change.

On Windows, normal process/window discovery, WGC capture, geometry observation, and an external
topmost window are designed to run without administrator privileges. If Dota is elevated while the
app is not, report an integrity-level mismatch and suspend attachment rather than requesting
elevation by default. DLL injection, process-memory reads, input synthesis, renderer hooks, and
kernel drivers remain outside the design.

Overlay geometry updates are event-driven or low-frequency geometry checks, independent of the
1 Hz frame-analysis timer. The overlay should show recommendations, not raw captured pixels. It is
hidden immediately when tracking is disabled, the target becomes invalid, or Page 1 has no stable
result.

### Snapshot Scheduler And Latest-Frame Mode

The scheduler is deadline based, not `setInterval`. Start an attempt only when no prior capture,
PNG encode, or recognition request is in flight. On completion, schedule the next deadline as
`last_start + 1 second`; missed ticks are dropped rather than queued. This prevents a backlog when
a high-resolution image or recognition is slow.

The detached process scan runs every two seconds. After attachment, capture only when the target
window is eligible. Focus is not required, since the user may consult the analysis window while
Dota remains visible. Minimized, hidden, cloaked, locked, and ambiguous states suspend output.

At 1 Hz, a 60-slot result is sufficiently fresh for a draft chooser while avoiding continuous
GPU/CPU load. Do not raise the default snapshot rate before profiling on 1080p, 1440p, 4K, and
mixed-DPI displays. Snapshot mode retains a hard limit of one capture/encode/recognition
transaction in flight.

Latest-frame mode replaces, rather than accelerates, the snapshot transaction. It owns a single
latest-frame slot, operates natively before frontend IPC, and only emits a new result after the
previous recognition completes or is superseded. It has separate latency instrumentation and must
be disabled automatically when its source or recognition budget is exceeded.

### Change And Stability Gates

Receiving a WGC/SCK frame does not imply that recognition must run. Native code derives a small
fingerprint from known candidate regions after scaling the active layout to the captured frame. It
samples only those regions, not the whole desktop. A frame within a defined perceptual-distance
threshold of the last accepted frame is discarded.

For a changed frame, frontend code reuses the same `handleUpload` recognition transaction used for
a manual file. A capture increments the existing request token and invalidates an older worker
result. New automatic suggestions become visible only after two consecutive recognition passes
agree on each changed slot's top candidate, avoiding transitions during UI animation.

Confirmed candidates are never overwritten. A changed confirmed slot is marked `capture-conflict`
for user review. An explicit later action may replace confirmations, but that action is outside the
tracker loop.

## Tauri And Frontend Boundary

Keep native capture and overlay placement behind platform adapters rather than adding capture
mechanics to `App.tsx`. A shared `GameCaptureController` owns target tracking, frame mode, layout
revision, fingerprint contract, frame acknowledgement, and cleanup. A separate
`GameStateController` owns GSI configuration, localhost listening, authentication, schema decoding,
and state freshness. A `DraftStateFusion` policy combines their typed outputs. Windows and macOS
implement only target resolution, frame production, permissions, and `GameWindowPlacement`. The
shared existing overlay lifecycle remains authoritative for display intent and readiness. The
browser adapter reports `unsupported`; upload remains unchanged.

| Layer                              | Responsibility                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/capture/mod.rs`     | Platform-neutral `GameCaptureBackend` contract, state machine, scheduler, frame validation, and serializable status types. |
| `src-tauri/src/capture/windows.rs` | Win32 target resolver, WGC/D3D11 session, and the Windows `GameWindowPlacement` adapter.                                   |
| `src-tauri/src/capture/macos.rs`   | ScreenCaptureKit bridge, macOS permission checks, and the macOS `GameWindowPlacement` adapter.                             |
| `src-tauri/src/gsi/mod.rs`         | Localhost HTTP listener, configuration inspection, auth validation, bounded JSON decoding, and source freshness.           |
| `src/platform/game-capture.ts`     | Tauri/browser adapter, status subscription, explicit start/stop/retry, and layout updates.                                 |
| `src/platform/game-state.ts`       | Tauri/browser adapter for GSI status and validated state updates.                                                          |
| Page 1 controller                  | Fuse accepted visual/GSI state, preserve confirmations, and render independent source status.                              |
| `src/workers/recognizer.worker.ts` | Unchanged matching algorithm and image ownership rules.                                                                    |

When tracking starts, and whenever the user recalibrates the layout, Page 1 sends the native
session a layout revision, source dimensions, and the 60 normalized slot rectangles. Native code
uses that revision solely for the change fingerprint; recognition itself still uses the existing
frontend `buildScaledLayout` path. A frame emitted with an older layout revision is discarded.

Initial command surface:

```ts
type CaptureState =
  | 'disabled'
  | 'waiting-for-process'
  | 'waiting-for-window'
  | 'capturing'
  | 'paused-minimized'
  | 'ambiguous-window'
  | 'permission-required'
  | 'unsupported'
  | 'error'

type GameStateState =
  | 'disabled'
  | 'configuration-required'
  | 'waiting-for-client'
  | 'receiving'
  | 'stale'
  | 'auth-rejected'
  | 'error'

interface GameCaptureStatus {
  state: CaptureState
  platform?: 'windows' | 'macos'
  processId?: number
  sourceSize?: { width: number; height: number }
  lastFrameAt?: string
  reason?: string
}

interface GameStateStatus {
  state: GameStateState
  lastUpdateAt?: string
  lastLatencyMs?: number
  availableGroups: string[]
  reason?: string
}

startGameCapture(): Promise<GameCaptureStatus>
stopGameCapture(): Promise<void>
retryGameCapture(): Promise<GameCaptureStatus>
getGameCaptureStatus(): Promise<GameCaptureStatus>
updateGameCaptureLayout(layout: GameCaptureLayout): Promise<void>
startGameStateListener(): Promise<GameStateStatus>
stopGameStateListener(): Promise<void>
getGameStateStatus(): Promise<GameStateStatus>
```

For v1, transfer an accepted PNG as a bounded base64 data URL with actual dimensions and a
monotonic frame ID. Page 1 converts it to a `Blob`/`File`, uses an object URL for preview, and
revokes the prior URL as it does for manual uploads. This preserves the current transferable
`ImageBitmap` worker contract without adding a filesystem or protocol dependency.

Scale images larger than a capture-output bound set during the spike (initial target: 2560 x 1440)
before PNG encoding while preserving aspect ratio, and report the actual dimensions so
`buildScaledLayout` remains the sole layout scaling authority. Do not send raw BGRA buffers through
JSON IPC. Record payload size and encode latency: if 4K/HDR profiling makes base64 too expensive,
replace only this transport with a scoped private URI or streaming protocol.

Do not emit a new frame while Page 1 has an active recognition transaction. The frontend
acknowledges an accepted frame ID after it creates the `ImageBitmap`, allowing native code to
discard the encoded buffer; a five-second watchdog drops unacknowledged data.

Latest-frame mode bypasses this v1 PNG/base64 path: its crop, fingerprint, and recognition output
remain in native memory until only a small `RecognizedSlot[]`-equivalent result crosses the Tauri
boundary. Persisted recording has a separate encoder and file lifecycle; it never shares the
recognition transport or delays a live result.

## UI, Privacy, And Failure Behavior

Page 1 contains `Upload screenshot`, `Track Dota 2 window`, and an optional `Read Dota game state`
toggle. Recording, if implemented, is a separate explicit command rather than a side effect of
tracking. Status is actionable: `Waiting for Dota 2`, `Screen Recording permission required`,
`Waiting for Dota GSI`, `Capturing Dota 2 (2560 x 1440)`, `Paused because the game is minimized`,
or an error with Retry/Stop. It must not show either source as active merely because a matching
process exists.

The user approves the discovered Dota installation before automatic capture begins. On macOS, the
toggle then requests Screen Recording permission from the operating system. The GSI toggle explains
the localhost endpoint, config-file location, and data groups before the user enables it. Captures
stay in RAM unless the user invokes a diagnostic `Save current capture` or explicit recording
action. Logging records state changes, timings, dimensions, frame IDs, GSI group names, and platform
error codes, but no screenshot/video content or raw GSI payloads.

Release notes must say that the app observes a user-approved game window with a standard platform
capture API, does not read game memory or synthesize input, and still requires the user to comply
with Dota 2, Steam, tournament, and anti-cheat rules. They must also disclose that external
overlays can be unavailable in protected or exclusive full-screen modes.

## Delivery Plan

1. Add platform-neutral capture, GSI, fusion, recording, target, frame, layout, and
   `OverlayPlacement` contracts plus browser no-op adapters. Reuse the current overlay lifecycle;
   do not create a second open/ready/revision state machine. Unit-test independent source
   transitions and fusion policy.
2. Implement fakeable Windows and macOS target resolvers. Test approval, multiple windows, process
   relaunch/PID reuse, process exit, stale `HWND`/`CGWindowID`, and permission denial without Dota.
3. Build independent 1 Hz spikes against controlled test windows: WGC/D3D11 on Windows and
   ScreenCaptureKit on Apple Silicon macOS. Measure attachment time, frame time, PNG size, CPU/GPU
   impact, resize, minimize/full-screen Space transitions, and device/source loss.
4. Implement a localhost-only GSI spike using a manually enabled configuration file. Capture raw
   fixture payloads from a permitted development session, verify field freshness/auth rejection,
   and specifically record what Ability Draft emits for `draft` and `abilities`.
5. Connect one accepted PNG from either backend to the existing Page 1 transaction. Add
   cancellation and frame acknowledgement before repeated capture.
6. Add the fingerprint, two-frame stability gate, and GSI/visual conflict policy. Verify that
   confirmed slots cannot change automatically.
7. Add external-overlay geometry spikes for Windows DPI/multi-monitor behavior and macOS
   full-screen Space behavior. Keep capture working when overlay placement is unavailable.
8. Profile latest-frame mode separately from snapshot mode. Only add hardware-backed recording
   after its explicit privacy, output, and retention controls are tested.
9. Add fake-window native integration tests and manual acceptance evidence on both platforms. Dota
   itself must not be a CI dependency.

Do not add capture wrapper crates until each spike proves the target platform version support,
license, threading model, permission behavior, and source-loss cleanup. Direct `windows` bindings
are the lowest-assumption Windows baseline. ScreenCaptureKit may use a small Swift/Objective-C
bridge if Rust bindings do not expose its stream lifecycle cleanly; that bridge must keep the
native API ownership and callback boundaries explicit.

## Acceptance Criteria

- A user-approved Dota process attaches within five seconds of its eligible window appearing.
- No frame is captured before platform process identity, approved installation, required user
  permission, and eligible Dota native window identity exist.
- No more than one capture/encode/recognition transaction runs concurrently, at no higher than 1 Hz.
- GSI listens only on loopback, rejects unauthenticated/oversized input, reports freshness, and
  starts only after the user enables its configuration.
- GSI fields affect the UI only after they are received in the active session; unknown or stale
  fields cannot replace visual suggestions or user confirmations.
- Ability Draft candidate-pool support is demonstrated by captured payload evidence before it is
  used in product logic; otherwise candidate recognition remains visual-only.
- Exit, restart, minimize, hide, or window replacement stops output within two seconds and cannot
  transfer a stale frame into a new process session.
- Resize recreates the capture pool and retains the current layout scaling/calibration behavior.
- Unchanged frames do not repeat recognition; transient frames do not overwrite stable suggestions
  or confirmations.
- Browser builds remain manual-upload only and compile without native capture dependencies.
- Windows manual testing covers borderless/windowed/fullscreen where supported, 1080p/1440p,
  mixed-DPI, HDR, Steam overlay, minimize/restore, restart, device loss, and tracking toggles.
- Apple Silicon macOS manual testing covers Screen Recording allow/deny/revoke, windowed and
  full-screen Space behavior, Retina and non-Retina displays, external-display changes, source
  restart, overlay focus/pass-through, and unavailable-overlay fallback.
- Instrumentation reports p50/p95 capture-to-result latency, encode size, dropped ticks, and state
  transition errors per platform without persisting screenshots. It records GSI receipt latency
  separately and never aggregates that value into the visual capture latency claim.
- Recording is off by default, has an explicit output destination and stop action, and cannot block
  snapshot/latest-frame recognition.

## Known Risks

| Risk                                                                                          | Mitigation                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exclusive fullscreen, protected content, or a macOS full-screen Space blocks capture/overlay. | Show the applicable capture/overlay state, retain upload, and never fall back to desktop capture. Validate supported Dota display modes before release. |
| Dota UI, resolution, HDR, or DPI change invalidates the fixed layout.                         | Preserve calibration per captured dimensions, require review on low confidence, and test representative modes.                                          |
| PNG/base64 IPC is expensive at 4K.                                                            | Downscale before encoding, skip unchanged frames, retain 1 Hz, measure payloads, then replace transport only if required.                               |
| GSI lacks an Ability Draft candidate field or changes schema between client updates.          | Treat GSI as confirmation only, capture raw permitted fixtures by mode/version, version the decoder, and retain visual candidate recognition.           |
| GSI localhost endpoint is exposed or spoofed.                                                 | Bind loopback only, use a random auth token, limit request size/rate, and accept no remote network traffic.                                             |
| Recording unexpectedly stores sensitive screen content.                                       | Keep it off by default, require explicit start/destination, disclose retention, and separate it from diagnostic snapshots.                              |
| Process name spoofing or stale handles select a wrong source.                                 | Require installation approval, launch identity, per-frame HWND/CGWindowID and process validation, and pause on ambiguity.                               |
| macOS Screen Recording permission is denied or revoked.                                       | Request it only from the user toggle, explain the System Settings remediation, and keep manual upload available.                                        |
| Cross-platform abstraction leaks platform-specific lifetime rules.                            | Keep target resolution, frame streams, permissions, and overlay placement behind separate backends; share only typed contracts and policy.              |
| Game/anti-cheat policy changes.                                                               | Keep the feature opt-in and observational; require product/legal review before compatibility claims.                                                    |

## Validation Commands

After implementation, run the normal repository checks:

```powershell
npm test
npm run build
npm run format:rust:check
npm run lint:rust
npm run verify:runtime
```

Record Windows and Apple Silicon macOS capture measurements and manual acceptance results in the
respective platform build guides and project status only after they have actually been run.
