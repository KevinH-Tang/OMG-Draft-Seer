# Overlay Delivery Stability Design

> Approved on 2026-07-29 for the current desktop overlay delivery changes.

## Goal

Make native overlay visibility, content readiness, sizing, shortcut behavior, and cursor
pass-through deterministic across Windows and macOS before committing the current worktree.

## Scope

This design covers the three internal native overlay kinds (`recommendation`, `tier`, and
`layout`), the user-facing recommendation Trigger/Hold shortcut, the React-to-overlay content
handoff, and the repository checks that protect this behavior. It does not add game capture,
automatic game-window tracking, new overlay controls, or release automation.

## Decisions

### Ordered Native Shortcut Delivery

`tauri-plugin-global-shortcut` delivers Windows Pressed from `WM_HOTKEY` but Released from a polling
thread. The global shortcut callback therefore sends every event to one dedicated `mpsc` worker;
shortcut press-cycle mutation, lifecycle revision mutation, and the resulting window request run
serially there. Before accepting Windows Released, the worker confirms through `GetAsyncKeyState`
that the registered shortcut's main key is physically up.

The worker also keeps first-time shortcut window creation off the Windows event-loop thread.
Startup prewarm creates directly from its background thread, while `prepare_overlay`,
`open_overlay`, and `toggle_overlay` are async commands that use `spawn_blocking` for operations
that may create a WebView. Their frontend IPC names and result types remain unchanged.

### Hold Mode Contract

Entering Hold mode closes the recommendation overlay immediately, regardless of whether it was
opened by Trigger, a button, or a prior Hold press. While Hold mode is active:

- Pressed requests open once per physical press cycle.
- Repeated Pressed events are ignored.
- Released requests close.
- Pressed claims an already-open browser overlay without opening it twice; Released still closes it.
- Mode changes, shortcut changes, main-window hiding, and controller cleanup cancel the cycle and
  close the overlay.

The browser and desktop implementations must use this same contract.

### Live Viewport Updates

After a screenshot with different dimensions is accepted, `set_overlay_viewport` updates the saved
viewport and immediately resizes and repositions any existing recommendation and layout windows.
The command preserves each overlay's requested/ready state: an open ready window is shown again at
the new size, while a hidden or loading window remains hidden. Invalid dimensions are rejected
before mutating the saved viewport.

### Content-Gated Readiness

An overlay WebView may mark itself native-ready only after both conditions are true:

1. The bundled runtime snapshot request has settled, using the bundled demo only as the existing
   failure fallback.
2. The overlay has received the current `overlay-state` response from the main WebView through the
   BroadcastChannel handshake.

Restored local storage can render an initial hidden frame but cannot by itself authorize native
display. The main WebView continues writing storage for recovery and responds to each
`overlay-ready` request with its latest in-memory state.

If `mark_overlay_ready` cannot reconcile the native window, Rust removes ready, closes the current
request with a newer revision, emits the closed visibility projection, and returns the error. The
overlay WebView logs the rejected IPC call instead of silently swallowing it.

### Cursor Pass-Through Recovery

Every overlay page-load start reasserts `set_ignore_cursor_events(true)` before hiding the window.
The recommendation cursor poller also performs the native reset when it observes a hidden window
after having enabled interaction. It updates its local tracker only after the native setter accepts
the request. Preparing an already-existing visible window does not overwrite pass-through behind
the poller's cached state. A reloaded or hidden full-screen overlay must default to pass-through.

### Validation And Documentation

The pre-commit script must stop on the first failed command. Rust unit tests become a named npm
script and run from `npm run check` and both CI platforms. Windows documentation must describe the
implemented global recommendation shortcut and distinguish user-facing Tier/recommendation
windows from the internal layout overlay kind.

## Error Handling

- Failure to queue shortcut work is written to native stderr and does not
  mutate shortcut or overlay state.
- A mode transition is committed only after its close action succeeds; a failed native close keeps
  the previous mode so the frontend and a later retry remain consistent.
- Invalid viewport dimensions leave the saved viewport and existing windows unchanged.
- A failed resize or display reconciliation is returned to the invoking WebView; visibility state
  remains revisioned and recoverable by a later request.
- Content handoff or snapshot delay keeps the native window hidden rather than displaying stale or
  incomplete content.
- Ready failures close the requested overlay and publish the newer closed revision.

## Test Strategy

- Rust unit tests cover Hold mode entry and transactionality, worker dispatch, Windows physical-key
  release filtering and VK mapping, background WebView creation, viewport target selection, ready
  failure rollback, cursor state preservation, revision ordering, and lifecycle invariants.
- Vitest covers the browser Hold transition including an already-open overlay, the two-part
  content-ready predicate, handshake state updates, stale visibility projection rejection, and
  ready scheduling cleanup.
- A deterministic shell regression proves that pre-commit returns the first failed command.
- `npm run check`, direct Rust tests, an Apple Silicon app build, the actual staged pre-commit hook,
  and final Git diff checks form the local delivery gate.
- Windows native Hold, hidden-main-window, reload, and queued-release behavior remain explicit
  target-platform smoke/E2E requirements before release.
