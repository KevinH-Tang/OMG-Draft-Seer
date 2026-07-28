# Overlay Delivery Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the reviewed native overlay ordering, sizing, readiness, Hold-mode, cursor, validation, and documentation defects before committing the current worktree.

**Architecture:** Keep Rust as the owner of native overlay visibility and shortcut press cycles, route global shortcut events through one dedicated FIFO worker, and validate Windows releases against the physical main-key state. Create WebViews from background workers, gate native ready on a current content handshake and settled runtime snapshot, apply viewport changes to existing full-screen windows, and make Hold entry close recommendation overlays on both runtimes.

**Tech Stack:** Rust 1.90, Tauri 2.11, React 19, TypeScript 7, Vitest 4, GitHub Actions, Husky/lint-staged

---

### Task 1: Make Pre-Commit Fail Closed

**Files:**

- Modify: `.husky/pre-commit`

- [x] **Step 1: Reproduce the false-success exit code**

Run the hook with a temporary `npm` executable that returns `42` for `check:staged` and `0` for
`format:rust:check`:

```sh
PRECOMMIT_TEST_BIN="$(mktemp -d)"
env PATH="$PRECOMMIT_TEST_BIN" /bin/sh .husky/pre-commit
```

Expected before the fix: exit `0`, proving the second command masks the first failure.

- [x] **Step 2: Stop the hook on the first failure**

```sh
#!/usr/bin/env sh
set -e

npm run check:staged
npm run format:rust:check
```

- [x] **Step 3: Verify the regression command**

Run the same temporary-PATH command. Expected after the fix: exit `42`.

### Task 2: Order Native Shortcut And Lifecycle Operations

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs`

- [x] **Step 1: Add failing Rust tests for reviewed invariants**

Add tests that require entering Hold to close recommendation, failed ready display to clear ready and
close with a newer revision, and viewport updates to target both full-screen overlay labels:

```rust
#[test]
fn entering_hold_mode_closes_an_existing_recommendation_overlay() {
    let mut shortcut = OverlayShortcutStateMachine::new(OverlayShortcutMode::Trigger);
    assert_eq!(
        shortcut.set_mode(OverlayShortcutMode::Hold),
        OverlayShortcutAction::CloseRecommendation
    );
}

#[test]
fn ready_failure_closes_the_current_request() {
    let mut lifecycle = lifecycle_with_open_ready_recommendation();
    let previous = lifecycle.display_target("overlay-recommendation").revision;
    lifecycle.fail_display("overlay-recommendation");
    let current = lifecycle.display_target("overlay-recommendation");
    assert!(!current.show);
    assert!(current.revision > previous);
}

#[test]
fn viewport_updates_target_all_fullscreen_overlays() {
    assert_eq!(
        FULLSCREEN_OVERLAY_KINDS,
        [("recommendation", "overlay-recommendation"), ("layout", "overlay-layout")]
    );
}
```

- [x] **Step 2: Run Rust tests and confirm RED**

Run:

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: the new tests fail because Hold entry returns `None`, no display-failure rollback exists,
and live viewport targets are not defined.

- [x] **Step 3: Implement Hold entry and ready rollback**

Make `set_mode(Hold)` return `CloseRecommendation` even without an active press. Add a lifecycle
method that removes ready and closes a currently requested overlay, then use it when
`mark_overlay_ready` reconciliation fails before emitting the closed projection.

- [x] **Step 4: Dispatch global shortcut handling through a dedicated worker**

Split the current callback into queueing and processing. The callback sends a copied shortcut event
to one `mpsc` worker; the worker owns press-cycle mutation and the resulting overlay action. On
Windows it ignores Released while `GetAsyncKeyState` reports the main key is still down:

```rust
fn forward_global_shortcut(app: &tauri::AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if let Err(error) = app.state::<OverlayShortcutWorker>().0.send(OverlayShortcutWork {
        shortcut: *shortcut,
        event,
    }) {
        eprintln!("failed to queue overlay shortcut action: {error}");
    }
}
```

The processing function performs both press-cycle mutation and the resulting overlay request.

- [x] **Step 5: Resize existing full-screen overlays on viewport updates**

Validate dimensions first, save the viewport, then hide, resize, reposition, and reconcile any
existing recommendation/layout windows using the current monitor position and lifecycle state.
Return the first native error to the frontend.

- [x] **Step 6: Restore cursor pass-through on reload and hide**

In `PageLoadEvent::Started`, call `set_ignore_cursor_events(true)` before hiding. In the cursor
poller hidden branch, apply the same setter when the local tracker says interaction was enabled,
and update the tracker only after success.

- [x] **Step 7: Run Rust tests and confirm GREEN**

Run:

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all Rust tests pass.

### Task 3: Align Browser Hold And Gate Native Ready

**Files:**

- Modify: `src/platform/shortcuts.ts`
- Test: `src/platform/shortcuts.test.ts`
- Modify: `src/platform/overlays.ts`
- Test: `src/platform/overlays.test.ts`
- Modify: `src/components/OverlayViews.tsx`
- Modify: `src/App.tsx`

- [x] **Step 1: Add failing frontend tests**

Add pure contract tests:

```ts
expect(overlayShouldCloseOnModeEntry('hold')).toBe(true)
expect(overlayShouldCloseOnModeEntry('trigger')).toBe(false)
expect(canMarkOverlayReady(true, true)).toBe(true)
expect(canMarkOverlayReady(true, false)).toBe(false)
expect(canMarkOverlayReady(false, true)).toBe(false)
```

- [x] **Step 2: Run targeted Vitest and confirm RED**

Run:

```sh
npx vitest run src/platform/shortcuts.test.ts src/platform/overlays.test.ts
```

Expected: imports fail because the new contract helpers do not exist.

- [x] **Step 3: Implement the pure contracts and browser Hold close**

Export the two helpers. When a browser preference changes to Hold, request
`setOverlayOpen('recommendation', false)` before persisting the new mode. Desktop mode registration
continues to use the Rust action returned from `set_overlay_shortcut`.

- [x] **Step 4: Gate overlay ready on content and snapshot state**

Track `snapshotSettled` and `contentSynchronized` in `OverlayApp`. Set content synchronized only
after receiving the current `overlay-state` BroadcastChannel response. Schedule
`markNativeOverlayReady` only when both flags are true. Log a rejected ready IPC call with
`console.error` so the failure is observable while Rust publishes the closed rollback revision.

- [x] **Step 5: Run targeted Vitest and confirm GREEN**

Run the same targeted Vitest command. Expected: all shortcut and overlay bridge tests pass.

### Task 4: Enforce Rust Tests And Synchronize Documentation

**Files:**

- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/windows-build-test.md`
- Modify: `docs/overlay-lifecycle-state-machine.md`
- Modify: `docs/project-status.md`

- [x] **Step 1: Add the named Rust test command**

Add:

```json
"test:rust": "cargo test --manifest-path src-tauri/Cargo.toml"
```

Insert `npm run test:rust` into `npm run check` after Rustfmt and into the Windows Tauri and macOS
desktop CI jobs after Rust setup.

- [x] **Step 2: Correct maintained behavior records**

Update the Windows guide to state that the desktop app registers the configurable global
recommendation shortcut, supports Trigger/Hold, and still does not capture or follow the game
window. Record Hold-entry close, worker dispatch, content-gated ready, live viewport resize,
and cursor recovery in the lifecycle document and current project status.

- [x] **Step 3: Format and run focused checks**

Run:

```sh
npm run format:rust
npx prettier --write package.json .github/workflows/ci.yml docs/windows-build-test.md docs/overlay-lifecycle-state-machine.md docs/project-status.md src/App.tsx src/components/OverlayViews.tsx src/platform/overlays.ts src/platform/overlays.test.ts src/platform/shortcuts.ts src/platform/shortcuts.test.ts
```

Expected: both commands exit `0`.

### Task 5: Resolve Final Review Concurrency Regressions

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Test: `src-tauri/src/lib.rs`
- Modify: `src/platform/shortcuts.ts`
- Test: `src/platform/shortcuts.test.ts`
- Modify: `src/App.tsx`

- [x] **Step 1: Claim already-open browser overlays during Hold**

Add a pure Hold-cycle transition test. Press claims an already-open recommendation overlay without
opening it again; release ends the claimed cycle and closes it.

- [x] **Step 2: Move WebView creation off the main thread**

Run startup prewarm directly from its background thread. Make `prepare_overlay`, `open_overlay`, and
`toggle_overlay` async and execute their possibly window-creating operations with `spawn_blocking`.

- [x] **Step 3: Serialize shortcuts and reject stale Windows releases**

Send every global shortcut event through one `mpsc` worker. Add target-specific `windows-sys
0.61.2` support and accept Windows Released only after `GetAsyncKeyState` confirms the shortcut's
main key is physically up.

- [x] **Step 4: Make Hold mode changes transactional**

Apply the forced recommendation close before committing the new mode. If native close or
reconciliation fails, retain the previous Rust mode so frontend state and retries remain coherent.

- [x] **Step 5: Preserve live cursor interaction state**

Do not force cursor pass-through when `prepare_overlay_window` reuses an existing visible window;
the cursor poller remains the owner of that live state. Keep page-load and hidden-window resets.

- [x] **Step 6: Confirm focused RED/GREEN evidence**

Run the new Vitest and Rust tests through their failing and passing states, then run the complete
Rust suite. Expected: 26 Rust unit tests and 125 Vitest tests after the additional regressions.

### Task 6: Verify And Deliver The Unified Change

**Files:**

- Verify: all modified and added files in `git status --short`

- [x] **Step 1: Run complete portable validation**

```sh
npm run check
```

Expected: formatting, Rust tests, TypeScript/Vite build, 25+ Vitest files, Clippy, and runtime assets
all pass; the existing Vite chunk-size warning may remain non-fatal.

- [x] **Step 2: Build the Apple Silicon application**

```sh
npm run desktop:build -- --bundles app
```

Expected: one arm64 `.app` at
`src-tauri/target/release/bundle/macos/OMG-Draft-Seer.app`.

- [ ] **Step 3: Run actual staged pre-commit**

Stage the complete intended worktree and run:

```sh
sh .husky/pre-commit
```

Expected: lint-staged and Rustfmt both pass with exit `0`.

- [ ] **Step 4: Review and commit once**

```sh
git diff --cached --check
git diff --cached --stat
git commit -m "fix: stabilize desktop overlay delivery"
```

Expected: one Conventional Commit containing the current overlay, icon, documentation, and
pre-commit changes, with no ignored build outputs.

- [ ] **Step 5: Push the current branch**

```sh
git push origin dev
```

Expected: `origin/dev` advances to the new commit without force-push.
