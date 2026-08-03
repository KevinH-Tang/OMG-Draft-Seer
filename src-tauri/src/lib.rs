use std::{
    collections::{HashMap, HashSet},
    sync::{mpsc, Mutex},
};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::PageLoadEvent,
    Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState,
};

mod capture;

const MAX_LAYOUT_OVERLAY_DIMENSION: u32 = 16_384;
const AUTOSTART_ARG: &str = "--minimized";
const OVERLAY_VISIBILITY_EVENT: &str = "omg-draft-seer-overlay-visibility";
const OVERLAY_WINDOW_LABELS: [&str; 3] =
    ["overlay-recommendation", "overlay-tier", "overlay-layout"];
const FULLSCREEN_OVERLAY_KINDS: [(&str, &str); 2] = [
    ("recommendation", "overlay-recommendation"),
    ("layout", "overlay-layout"),
];

struct OverlayShortcutRegistration {
    shortcut: Shortcut,
    shortcut_text: String,
    registered: bool,
    state_machine: OverlayShortcutStateMachine,
}

struct OverlayShortcutRegistrationRequest {
    shortcut: Shortcut,
    shortcut_text: String,
    enabled: bool,
    mode: OverlayShortcutMode,
}

impl OverlayShortcutRegistration {
    fn status(&self) -> OverlayShortcutStatus {
        OverlayShortcutStatus {
            shortcut: self.shortcut_text.clone(),
            registered: self.registered,
            mode: self.state_machine.mode,
        }
    }
}

struct RegisteredOverlayShortcut(Mutex<OverlayShortcutRegistration>);
struct OverlayShortcutUpdateLock(Mutex<()>);

#[derive(Clone, Copy)]
struct OverlayShortcutWork {
    shortcut: Shortcut,
    event: ShortcutEvent,
}

struct OverlayShortcutWorker(mpsc::Sender<OverlayShortcutWork>);

#[cfg(target_os = "windows")]
struct WindowsShortcutCycles(Mutex<HashSet<u32>>);

#[cfg(any(test, target_os = "windows"))]
fn begin_windows_shortcut_cycle(active: &mut HashSet<u32>, id: u32) -> bool {
    active.insert(id)
}

#[cfg(any(test, target_os = "windows"))]
fn finish_windows_shortcut_cycle(active: &mut HashSet<u32>, id: u32) {
    active.remove(&id);
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum OverlayShortcutMode {
    Trigger,
    Hold,
}

impl OverlayShortcutMode {
    fn parse(mode: &str) -> Result<Self, String> {
        match mode {
            "trigger" => Ok(Self::Trigger),
            "hold" => Ok(Self::Hold),
            _ => Err(format!("unknown overlay shortcut mode: {mode}")),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OverlayShortcutAction {
    None,
    ToggleRecommendation,
    OpenRecommendation,
    CloseRecommendation,
}

#[derive(Clone, Copy)]
struct OverlayShortcutStateMachine {
    mode: OverlayShortcutMode,
    pressed: bool,
}

impl OverlayShortcutStateMachine {
    fn new(mode: OverlayShortcutMode) -> Self {
        Self {
            mode,
            pressed: false,
        }
    }

    fn handle(&mut self, state: ShortcutState) -> OverlayShortcutAction {
        match state {
            ShortcutState::Pressed if self.pressed => OverlayShortcutAction::None,
            ShortcutState::Pressed => {
                self.pressed = true;
                match self.mode {
                    OverlayShortcutMode::Trigger => OverlayShortcutAction::ToggleRecommendation,
                    OverlayShortcutMode::Hold => OverlayShortcutAction::OpenRecommendation,
                }
            }
            ShortcutState::Released => self.cancel(),
        }
    }

    fn cancel(&mut self) -> OverlayShortcutAction {
        if !self.pressed {
            return OverlayShortcutAction::None;
        }
        self.pressed = false;
        match self.mode {
            OverlayShortcutMode::Trigger => OverlayShortcutAction::None,
            OverlayShortcutMode::Hold => OverlayShortcutAction::CloseRecommendation,
        }
    }

    fn set_mode(&mut self, mode: OverlayShortcutMode) -> OverlayShortcutAction {
        if self.mode == mode {
            return OverlayShortcutAction::None;
        }
        let action = self.cancel();
        self.mode = mode;
        if action != OverlayShortcutAction::None {
            action
        } else if mode == OverlayShortcutMode::Hold {
            OverlayShortcutAction::CloseRecommendation
        } else {
            OverlayShortcutAction::None
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayShortcutStatus {
    shortcut: String,
    registered: bool,
    mode: OverlayShortcutMode,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayVisibilityStatus {
    kind: String,
    open: bool,
    ready: bool,
    visible: bool,
    visibility_observed: bool,
    displayed: bool,
    revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<OverlayPosition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<OverlaySize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    monitor: Option<OverlayMonitor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_monitor: Option<OverlayMonitor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    within_monitor_bounds: Option<bool>,
}

#[derive(Clone, Copy, Serialize)]
struct OverlayPosition {
    x: i32,
    y: i32,
}

#[derive(Clone, Copy, Serialize)]
struct OverlaySize {
    width: u32,
    height: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayMonitor {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    position: OverlayPosition,
    size: OverlaySize,
    scale_factor: f64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct OverlayDisplayTarget {
    revision: u64,
    show: bool,
}

struct OverlayReconcileError {
    target: Option<OverlayDisplayTarget>,
    error: String,
}

struct OverlayLifecycle {
    requested_open: HashSet<String>,
    ready: HashSet<String>,
    revisions: HashMap<String, u64>,
    viewport: OverlayViewport,
}
struct OverlayLifecycleState(Mutex<OverlayLifecycle>);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct OverlayViewport {
    width: u32,
    height: u32,
}

impl Default for OverlayViewport {
    fn default() -> Self {
        Self {
            width: 2560,
            height: 1440,
        }
    }
}

impl OverlayLifecycle {
    fn next_revision(&mut self, label: &str) -> u64 {
        let revision = self.revisions.entry(label.to_owned()).or_default();
        *revision = revision.wrapping_add(1);
        *revision
    }

    fn request_open(&mut self, label: &str) -> u64 {
        let revision = self.next_revision(label);
        self.requested_open.insert(label.to_owned());
        revision
    }

    fn request_close(&mut self, label: &str) -> u64 {
        let revision = self.next_revision(label);
        self.requested_open.remove(label);
        revision
    }

    fn is_open_requested(&self, label: &str) -> bool {
        self.requested_open.contains(label)
    }

    fn is_current_open(&self, label: &str, revision: u64) -> bool {
        self.revisions.get(label).copied().unwrap_or_default() == revision
            && self.is_open_requested(label)
    }

    fn status(&self, kind: &str, label: &str) -> OverlayVisibilityStatus {
        let ready = self.ready.contains(label);
        OverlayVisibilityStatus {
            kind: kind.to_owned(),
            open: self.is_open_requested(label),
            ready,
            visible: false,
            visibility_observed: false,
            displayed: false,
            revision: self.revisions.get(label).copied().unwrap_or_default(),
            position: None,
            size: None,
            monitor: None,
            target_monitor: None,
            within_monitor_bounds: None,
        }
    }

    fn display_target(&self, label: &str) -> OverlayDisplayTarget {
        OverlayDisplayTarget {
            revision: self.revisions.get(label).copied().unwrap_or_default(),
            // Hidden WebViews may suspend JavaScript before the frontend can
            // report readiness. Keep requested overlays running; `displayed`
            // remains gated by `ready` in the public status.
            show: self.is_open_requested(label),
        }
    }

    fn invalidate_overlays(&mut self) {
        self.requested_open.clear();
        for revision in self.revisions.values_mut() {
            *revision = revision.wrapping_add(1);
        }
    }

    fn mark_ready(&mut self, label: &str) {
        self.ready.insert(label.to_owned());
    }

    fn mark_loading(&mut self, label: &str) {
        self.ready.remove(label);
    }

    fn remove_window(&mut self, label: &str) -> u64 {
        self.ready.remove(label);
        self.request_close(label)
    }

    fn fail_display_if_current(&mut self, label: &str, revision: u64) -> bool {
        if !self.is_current_open(label, revision) {
            return false;
        }
        self.ready.remove(label);
        self.request_close(label);
        true
    }

    #[cfg(test)]
    fn should_show(&self, label: &str) -> bool {
        self.is_open_requested(label) && self.ready.contains(label)
    }
}

fn all_overlay_statuses(
    app: &tauri::AppHandle,
    lifecycle: &OverlayLifecycle,
) -> Vec<OverlayVisibilityStatus> {
    ["recommendation", "tier", "layout"]
        .into_iter()
        .filter_map(|kind| {
            overlay_window_config(kind).map(|(label, ..)| {
                observe_overlay_status(app, label, lifecycle.status(kind, label))
            })
        })
        .collect()
}

struct OverlayInteractionRegion {
    width: u32,
    height: u32,
}
struct RecommendationInteractionRegion(Mutex<OverlayInteractionRegion>);

fn cursor_is_inside_interaction_region(
    window_position: (f64, f64),
    cursor_position: (f64, f64),
    region: &OverlayInteractionRegion,
    scale: f64,
) -> bool {
    let inset = 12.0 * scale;
    let left = window_position.0 + inset;
    let top = window_position.1 + inset;
    let right = left + f64::from(region.width) * scale;
    let bottom = top + f64::from(region.height) * scale;
    cursor_position.0 >= left
        && cursor_position.0 <= right
        && cursor_position.1 >= top
        && cursor_position.1 <= bottom
}

fn show_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn quit_app<R: Runtime>(app: &tauri::AppHandle<R>) -> ! {
    app.cleanup_before_exit();
    std::process::exit(0)
}

fn overlay_window_config(kind: &str) -> Option<(&'static str, f64, f64, f64, f64)> {
    match kind {
        "recommendation" => Some(("overlay-recommendation", 2560.0, 1440.0, 0.0, 0.0)),
        "tier" => Some(("overlay-tier", 430.0, 760.0, 470.0, 72.0)),
        "layout" => Some(("overlay-layout", 2560.0, 1440.0, 0.0, 0.0)),
        _ => None,
    }
}

fn overlay_label(kind: &str) -> Result<&'static str, String> {
    overlay_window_config(kind)
        .map(|(label, ..)| label)
        .ok_or_else(|| format!("unknown overlay kind: {kind}"))
}

fn overlay_kind(label: &str) -> Option<&'static str> {
    match label {
        "overlay-recommendation" => Some("recommendation"),
        "overlay-tier" => Some("tier"),
        "overlay-layout" => Some("layout"),
        _ => None,
    }
}

fn overlay_event_message(label: &str, revision: u64, event: &str, result: &str) -> String {
    format!("overlay label={label} revision={revision} event={event} result={result}")
}

fn overlay_fits_monitor(
    window_position: (i32, i32),
    window_size: (u32, u32),
    monitor_position: (i32, i32),
    monitor_size: (u32, u32),
) -> bool {
    let window_left = i64::from(window_position.0);
    let window_top = i64::from(window_position.1);
    let window_right = window_left + i64::from(window_size.0);
    let window_bottom = window_top + i64::from(window_size.1);
    let monitor_left = i64::from(monitor_position.0);
    let monitor_top = i64::from(monitor_position.1);
    let monitor_right = monitor_left + i64::from(monitor_size.0);
    let monitor_bottom = monitor_top + i64::from(monitor_size.1);

    window_left >= monitor_left
        && window_top >= monitor_top
        && window_right <= monitor_right
        && window_bottom <= monitor_bottom
}

fn overlay_display_confirmed(ready: bool, visibility_observed: bool, visible: bool) -> bool {
    ready && visibility_observed && visible
}

fn overlay_monitor(monitor: &tauri::Monitor) -> OverlayMonitor {
    OverlayMonitor {
        name: monitor.name().cloned(),
        position: OverlayPosition {
            x: monitor.position().x,
            y: monitor.position().y,
        },
        size: OverlaySize {
            width: monitor.size().width,
            height: monitor.size().height,
        },
        scale_factor: monitor.scale_factor(),
    }
}

fn target_overlay_monitor(app: &tauri::AppHandle) -> Option<tauri::Monitor> {
    app.get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
}

fn observe_overlay_status(
    app: &tauri::AppHandle,
    label: &str,
    mut status: OverlayVisibilityStatus,
) -> OverlayVisibilityStatus {
    let Some(window) = app.get_webview_window(label) else {
        return status;
    };

    match window.is_visible() {
        Ok(visible) => {
            status.visible = visible;
            status.visibility_observed = true;
        }
        Err(error) => eprintln!(
            "overlay label={label} revision={} event=is_visible error={error}",
            status.revision
        ),
    }
    status.position = window
        .outer_position()
        .ok()
        .map(|position| OverlayPosition {
            x: position.x,
            y: position.y,
        });
    status.size = window.inner_size().ok().map(|size| OverlaySize {
        width: size.width,
        height: size.height,
    });
    status.monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| overlay_monitor(&monitor));
    status.target_monitor = target_overlay_monitor(app).map(|monitor| overlay_monitor(&monitor));
    status.within_monitor_bounds = match (&status.position, &status.size, &status.target_monitor) {
        (Some(position), Some(size), Some(monitor)) => Some(overlay_fits_monitor(
            (position.x, position.y),
            (size.width, size.height),
            (monitor.position.x, monitor.position.y),
            (monitor.size.width, monitor.size.height),
        )),
        _ => None,
    };
    status.displayed = status.open
        && overlay_display_confirmed(status.ready, status.visibility_observed, status.visible);
    status
}

fn emit_overlay_visibility(
    app: &tauri::AppHandle,
    status: OverlayVisibilityStatus,
) -> OverlayVisibilityStatus {
    let observed = overlay_label(&status.kind)
        .map(|label| observe_overlay_status(app, label, status.clone()))
        .unwrap_or(status);
    eprintln!(
        "overlay label={} revision={} event=status requested={} ready={} visibility_observed={} visible={} displayed={} position={:?} size={:?} monitor={:?} target_monitor={:?} within_monitor_bounds={:?}",
        overlay_label(&observed.kind).unwrap_or("unknown"),
        observed.revision,
        observed.open,
        observed.ready,
        observed.visibility_observed,
        observed.visible,
        observed.displayed,
        observed.position.map(|value| (value.x, value.y)),
        observed.size.map(|value| (value.width, value.height)),
        observed.monitor.as_ref().map(|value| (
            value.name.as_deref(),
            value.position.x,
            value.position.y,
            value.size.width,
            value.size.height,
            value.scale_factor,
        )),
        observed.target_monitor.as_ref().map(|value| (
            value.name.as_deref(),
            value.position.x,
            value.position.y,
            value.size.width,
            value.size.height,
            value.scale_factor,
        )),
        observed.within_monitor_bounds,
    );
    if let Err(error) = app.emit(OVERLAY_VISIBILITY_EVENT, observed.clone()) {
        eprintln!("failed to emit overlay visibility: {error}");
    }
    observed
}

fn emit_current_status(
    app: &tauri::AppHandle,
    kind: &str,
    label: &str,
    lifecycle: &OverlayLifecycleState,
) -> Result<OverlayVisibilityStatus, String> {
    let status = lifecycle
        .0
        .lock()
        .map_err(|_| "overlay visibility state is unavailable".to_owned())?
        .status(kind, label);
    Ok(emit_overlay_visibility(app, status))
}

fn set_overlay_window_visibility(
    window: &WebviewWindow,
    label: &str,
    revision: u64,
    visible: bool,
) -> Result<(), String> {
    let (event, operation) = if visible {
        ("show", window.show())
    } else {
        ("hide", window.hide())
    };
    match operation {
        Ok(()) => {
            eprintln!("{}", overlay_event_message(label, revision, event, "ok"));
            Ok(())
        }
        Err(error) => {
            eprintln!(
                "{} error={error}",
                overlay_event_message(label, revision, event, "error")
            );
            Err(error.to_string())
        }
    }
}

fn requested_overlay_size(
    kind: &str,
    width: Option<u32>,
    height: Option<u32>,
    viewport: &mut OverlayViewport,
) -> Result<Option<PhysicalSize<u32>>, String> {
    overlay_window_config(kind).ok_or_else(|| format!("unknown overlay kind: {kind}"))?;
    if kind != "layout" && kind != "recommendation" {
        return Ok(None);
    }
    let requested_width = width.unwrap_or(viewport.width);
    let requested_height = height.unwrap_or(viewport.height);
    if requested_width == 0
        || requested_height == 0
        || requested_width > MAX_LAYOUT_OVERLAY_DIMENSION
        || requested_height > MAX_LAYOUT_OVERLAY_DIMENSION
    {
        return Err("invalid layout overlay dimensions".to_owned());
    }
    *viewport = OverlayViewport {
        width: requested_width,
        height: requested_height,
    };
    Ok(Some(PhysicalSize::new(requested_width, requested_height)))
}

fn fullscreen_overlay_position(app: &tauri::AppHandle) -> PhysicalPosition<i32> {
    app.get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .map(|monitor| *monitor.position())
        .unwrap_or_else(|| PhysicalPosition::new(0, 0))
}

fn fullscreen_overlay_bounds(
    app: &tauri::AppHandle,
) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    target_overlay_monitor(app).map(|monitor| (*monitor.position(), *monitor.size()))
}

fn main_webview_browser_args(windows: &[tauri::utils::config::WindowConfig]) -> Option<&str> {
    windows
        .iter()
        .find(|window| window.label == "main")
        .and_then(|window| window.additional_browser_args.as_deref())
        .filter(|args| !args.trim().is_empty())
}

fn wait_for_overlay_window_creation(window: &WebviewWindow) -> Result<(), String> {
    let (created_tx, created_rx) = mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let _ = created_tx.send(());
        })
        .map_err(|error| error.to_string())?;
    created_rx
        .recv()
        .map_err(|_| "overlay window creation barrier was cancelled".to_owned())?;
    window
        .is_visible()
        .map(|_| ())
        .map_err(|error| format!("overlay window was not created by the native runtime: {error}"))
}

fn prepare_overlay_window(app: &tauri::AppHandle, kind: &str) -> Result<WebviewWindow, String> {
    let (label, default_width, default_height, x, y) =
        overlay_window_config(kind).ok_or_else(|| format!("unknown overlay kind: {kind}"))?;
    if let Some(window) = app.get_webview_window(label) {
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
        eprintln!("overlay label={label} event=reuse");
        return Ok(window);
    }

    let mut window_builder = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(format!("index.html?overlay={kind}").into()),
    )
    .title(match kind {
        "tier" => "OMG Tier Overlay",
        "layout" => "OMG Layout Overlay",
        _ => "OMG Recommendation Overlay",
    })
    .inner_size(default_width, default_height)
    .position(x, y)
    .decorations(false)
    .shadow(false)
    .always_on_top(true);
    #[cfg(target_os = "macos")]
    {
        window_builder = window_builder.visible_on_all_workspaces(true);
    }
    #[cfg(target_os = "windows")]
    {
        window_builder = window_builder.skip_taskbar(true);
    }
    if let Some(browser_args) = main_webview_browser_args(&app.config().app.windows) {
        // WebView2 requires every environment sharing a data directory to use
        // the same CoreWebView2EnvironmentOptions as the configured main window.
        window_builder = window_builder.additional_browser_args(browser_args);
    }
    let window = window_builder
        .focused(false)
        // The window is only created for an open request. Starting WebView2 hidden
        // can suspend its bootstrap script before it reports overlay readiness.
        .visible(true)
        .transparent(true)
        .on_page_load(|window, payload| {
            let Some(kind) = overlay_kind(window.label()) else {
                return;
            };
            let Some(lifecycle) = window.app_handle().try_state::<OverlayLifecycleState>() else {
                return;
            };
            if matches!(payload.event(), PageLoadEvent::Started) {
                let loading_status = lifecycle.0.lock().ok().map(|mut current| {
                    current.mark_loading(window.label());
                    current.status(kind, window.label())
                });
                if let Some(status) = &loading_status {
                    eprintln!(
                        "overlay label={} revision={} event=page_load_started",
                        window.label(),
                        status.revision
                    );
                }
                if let Err(error) = window.set_ignore_cursor_events(true) {
                    eprintln!(
                        "failed to restore cursor pass-through for {}: {error}",
                        window.label()
                    );
                }
                let loading_target = loading_status
                    .as_ref()
                    .map(|status| (status.revision, status.open))
                    .unwrap_or_default();
                if let Err(error) = set_overlay_window_visibility(
                    &window,
                    window.label(),
                    loading_target.0,
                    loading_target.1,
                ) {
                    eprintln!(
                        "failed to reconcile loading overlay {}: {error}",
                        window.label()
                    );
                }
                if let Some(status) = loading_status {
                    emit_overlay_visibility(window.app_handle(), status);
                }
                return;
            }
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let revision = lifecycle
                    .0
                    .lock()
                    .ok()
                    .map(|current| current.display_target(window.label()).revision)
                    .unwrap_or_default();
                eprintln!(
                    "overlay label={} revision={} event=page_load_finished",
                    window.label(),
                    revision
                );
                if let Err(error) =
                    emit_current_status(window.app_handle(), kind, window.label(), &lifecycle)
                {
                    eprintln!(
                        "failed to report loaded overlay {}: {error}",
                        window.label()
                    );
                }
            }
        })
        .build()
        .map_err(|error| error.to_string())?;

    // Building through a RuntimeHandle only queues `CreateWindow`. Tauri adds
    // the detached handle to its manager immediately, before Tao/Wry adds the
    // real window to the event-loop store. Keep all later setters, getters and
    // WDIO window discovery behind a same-producer main-thread barrier.
    wait_for_overlay_window_creation(&window)?;

    let revision = app
        .try_state::<OverlayLifecycleState>()
        .and_then(|lifecycle| {
            lifecycle
                .0
                .lock()
                .ok()
                .map(|current| current.display_target(label).revision)
        })
        .unwrap_or_default();
    eprintln!(
        "{}",
        overlay_event_message(label, revision, "created", "ok")
    );

    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    Ok(window)
}

fn reconcile_overlay_window(
    window: &WebviewWindow,
    lifecycle: &OverlayLifecycleState,
    label: &str,
) -> Result<OverlayDisplayTarget, OverlayReconcileError> {
    loop {
        let target = lifecycle
            .0
            .lock()
            .map_err(|_| OverlayReconcileError {
                target: None,
                error: "overlay visibility state is unavailable".to_owned(),
            })?
            .display_target(label);
        set_overlay_window_visibility(window, label, target.revision, target.show).map_err(
            |error| OverlayReconcileError {
                target: Some(target),
                error,
            },
        )?;
        let current = lifecycle
            .0
            .lock()
            .map_err(|_| OverlayReconcileError {
                target: Some(target),
                error: "overlay visibility state is unavailable".to_owned(),
            })?
            .display_target(label);
        if current == target {
            return Ok(current);
        }
    }
}

fn reconcile_and_emit_status(
    app: &tauri::AppHandle,
    kind: &str,
    label: &str,
    lifecycle: &OverlayLifecycleState,
) -> Result<OverlayVisibilityStatus, String> {
    if let Some(window) = app.get_webview_window(label) {
        reconcile_overlay_window(&window, lifecycle, label).map_err(|failure| failure.error)?;
    }
    emit_current_status(app, kind, label, lifecycle)
}

#[derive(Clone, Copy)]
enum OverlayRequest {
    Open,
    Close,
    Toggle,
}

struct OverlayRequestTransition {
    label: &'static str,
    open_revision: Option<u64>,
    physical_size: Option<PhysicalSize<u32>>,
}

fn transition_overlay_request(
    kind: &str,
    width: Option<u32>,
    height: Option<u32>,
    request: OverlayRequest,
    lifecycle: &OverlayLifecycleState,
) -> Result<OverlayRequestTransition, String> {
    let label = overlay_label(kind)?;
    let mut current = lifecycle
        .0
        .lock()
        .map_err(|_| "overlay visibility state is unavailable".to_owned())?;
    let should_open = match request {
        OverlayRequest::Open => true,
        OverlayRequest::Close => false,
        OverlayRequest::Toggle => !current.is_open_requested(label),
    };
    if should_open {
        let physical_size = requested_overlay_size(kind, width, height, &mut current.viewport)?;
        let revision = current.request_open(label);
        Ok(OverlayRequestTransition {
            label,
            open_revision: Some(revision),
            physical_size,
        })
    } else {
        current.request_close(label);
        Ok(OverlayRequestTransition {
            label,
            open_revision: None,
            physical_size: None,
        })
    }
}

fn complete_overlay_open(
    app: &tauri::AppHandle,
    kind: &str,
    physical_overlay_size: Option<PhysicalSize<u32>>,
    revision: u64,
    lifecycle: &OverlayLifecycleState,
) -> Result<OverlayVisibilityStatus, String> {
    let label = overlay_label(kind)?;
    let fullscreen_bounds = (kind == "layout" || kind == "recommendation")
        .then(|| fullscreen_overlay_bounds(app))
        .flatten();

    let operation = (|| {
        let window = prepare_overlay_window(app, kind).map_err(|error| OverlayReconcileError {
            target: None,
            error,
        })?;
        if let Some(size) = fullscreen_bounds
            .map(|(_, size)| size)
            .or(physical_overlay_size)
        {
            let position = fullscreen_bounds
                .map(|(position, _)| position)
                .unwrap_or_else(|| fullscreen_overlay_position(app));
            window
                .set_size(size)
                .map_err(|error| OverlayReconcileError {
                    target: None,
                    error: error.to_string(),
                })?;
            window
                .set_position(position)
                .map_err(|error| OverlayReconcileError {
                    target: None,
                    error: error.to_string(),
                })?;
        }

        reconcile_overlay_window(&window, lifecycle, label)
    })();

    if let Err(error) = operation {
        let status = {
            let mut current = lifecycle
                .0
                .lock()
                .map_err(|_| "overlay visibility state is unavailable".to_owned())?;
            if current.is_current_open(label, revision) {
                current.request_close(label);
            }
            current.status(kind, label)
        };
        emit_overlay_visibility(app, status);
        return Err(error.error);
    }

    emit_current_status(app, kind, label, lifecycle)
}

fn apply_overlay_request(
    app: &tauri::AppHandle,
    kind: &str,
    width: Option<u32>,
    height: Option<u32>,
    request: OverlayRequest,
    lifecycle: &OverlayLifecycleState,
) -> Result<OverlayVisibilityStatus, String> {
    let transition = transition_overlay_request(kind, width, height, request, lifecycle)?;
    if let Some(revision) = transition.open_revision {
        complete_overlay_open(app, kind, transition.physical_size, revision, lifecycle)
    } else {
        reconcile_and_emit_status(app, kind, transition.label, lifecycle)
    }
}

#[tauri::command]
async fn open_overlay(
    app: tauri::AppHandle,
    kind: String,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<OverlayVisibilityStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let lifecycle = app.state::<OverlayLifecycleState>();
        apply_overlay_request(&app, &kind, width, height, OverlayRequest::Open, &lifecycle)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn fail_overlay_ready(
    app: &tauri::AppHandle,
    kind: &str,
    label: &str,
    window: &WebviewWindow,
    lifecycle: &OverlayLifecycleState,
    expected_revision: u64,
    error: String,
) -> Result<bool, String> {
    {
        let mut current = lifecycle
            .0
            .lock()
            .map_err(|_| "overlay visibility state is unavailable".to_owned())?;
        current.fail_display_if_current(label, expected_revision);
    }
    if let Err(hide_error) = reconcile_overlay_window(window, lifecycle, label) {
        eprintln!(
            "failed to hide {label} after ready failure: {}",
            hide_error.error
        );
    }
    emit_current_status(app, kind, label, lifecycle)?;
    Err(error)
}

#[tauri::command]
fn mark_overlay_ready(
    app: tauri::AppHandle,
    kind: String,
    lifecycle: tauri::State<'_, OverlayLifecycleState>,
) -> Result<bool, String> {
    let label = overlay_label(&kind)?;
    let Some(window) = app.get_webview_window(label) else {
        let status = {
            let mut current = lifecycle
                .0
                .lock()
                .map_err(|_| "overlay visibility state is unavailable".to_owned())?;
            let target = current.display_target(label);
            if !target.show {
                return Ok(false);
            }
            current.fail_display_if_current(label, target.revision);
            current.status(&kind, label)
        };
        emit_overlay_visibility(&app, status);
        return Err(format!(
            "overlay window {label} is unavailable after frontend ready"
        ));
    };
    lifecycle
        .0
        .lock()
        .map_err(|_| "overlay visibility state is unavailable".to_owned())
        .map(|mut current| current.mark_ready(label))?;
    let revision = lifecycle
        .0
        .lock()
        .map_err(|_| "overlay visibility state is unavailable".to_owned())?
        .display_target(label)
        .revision;
    eprintln!("overlay label={label} revision={revision} event=frontend_ready");
    match reconcile_overlay_window(&window, &lifecycle, label) {
        Ok(target) => {
            let status = emit_current_status(&app, &kind, label, &lifecycle)?;
            if target.show && !status.displayed {
                return fail_overlay_ready(
                    &app,
                    &kind,
                    label,
                    &window,
                    &lifecycle,
                    target.revision,
                    format!("overlay {label} did not become OS-visible after frontend ready"),
                );
            }
            Ok(status.displayed)
        }
        Err(error) => {
            let failed_revision = error
                .target
                .map(|target| target.revision)
                .unwrap_or(revision);
            fail_overlay_ready(
                &app,
                &kind,
                label,
                &window,
                &lifecycle,
                failed_revision,
                error.error,
            )
        }
    }
}

#[tauri::command]
async fn close_overlay(
    app: tauri::AppHandle,
    kind: String,
) -> Result<OverlayVisibilityStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let lifecycle = app.state::<OverlayLifecycleState>();
        apply_overlay_request(&app, &kind, None, None, OverlayRequest::Close, &lifecycle)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn toggle_overlay(
    app: tauri::AppHandle,
    kind: String,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<OverlayVisibilityStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let lifecycle = app.state::<OverlayLifecycleState>();
        apply_overlay_request(
            &app,
            &kind,
            width,
            height,
            OverlayRequest::Toggle,
            &lifecycle,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn get_overlay_visibility(
    app: tauri::AppHandle,
    lifecycle: tauri::State<'_, OverlayLifecycleState>,
) -> Result<Vec<OverlayVisibilityStatus>, String> {
    let current = lifecycle
        .0
        .lock()
        .map_err(|_| "overlay visibility state is unavailable".to_owned())?;
    Ok(all_overlay_statuses(&app, &current))
}

fn apply_overlay_shortcut_action(
    app: &tauri::AppHandle,
    action: OverlayShortcutAction,
) -> Result<(), String> {
    let lifecycle = app.state::<OverlayLifecycleState>();
    let request = match action {
        OverlayShortcutAction::None => return Ok(()),
        OverlayShortcutAction::ToggleRecommendation => OverlayRequest::Toggle,
        OverlayShortcutAction::OpenRecommendation => OverlayRequest::Open,
        OverlayShortcutAction::CloseRecommendation => OverlayRequest::Close,
    };
    apply_overlay_request(app, "recommendation", None, None, request, &lifecycle).map(|_| ())
}

#[cfg(any(test, target_os = "windows"))]
fn windows_virtual_key(code: Code) -> Option<i32> {
    Some(match code {
        Code::KeyA => 0x41,
        Code::KeyB => 0x42,
        Code::KeyC => 0x43,
        Code::KeyD => 0x44,
        Code::KeyE => 0x45,
        Code::KeyF => 0x46,
        Code::KeyG => 0x47,
        Code::KeyH => 0x48,
        Code::KeyI => 0x49,
        Code::KeyJ => 0x4a,
        Code::KeyK => 0x4b,
        Code::KeyL => 0x4c,
        Code::KeyM => 0x4d,
        Code::KeyN => 0x4e,
        Code::KeyO => 0x4f,
        Code::KeyP => 0x50,
        Code::KeyQ => 0x51,
        Code::KeyR => 0x52,
        Code::KeyS => 0x53,
        Code::KeyT => 0x54,
        Code::KeyU => 0x55,
        Code::KeyV => 0x56,
        Code::KeyW => 0x57,
        Code::KeyX => 0x58,
        Code::KeyY => 0x59,
        Code::KeyZ => 0x5a,
        Code::Digit0 => 0x30,
        Code::Digit1 => 0x31,
        Code::Digit2 => 0x32,
        Code::Digit3 => 0x33,
        Code::Digit4 => 0x34,
        Code::Digit5 => 0x35,
        Code::Digit6 => 0x36,
        Code::Digit7 => 0x37,
        Code::Digit8 => 0x38,
        Code::Digit9 => 0x39,
        Code::Equal => 0xbb,
        Code::Comma => 0xbc,
        Code::Minus => 0xbd,
        Code::Period => 0xbe,
        Code::Semicolon => 0xba,
        Code::Slash => 0xbf,
        Code::Backquote => 0xc0,
        Code::BracketLeft => 0xdb,
        Code::Backslash => 0xdc,
        Code::BracketRight => 0xdd,
        Code::Quote => 0xde,
        Code::Backspace => 0x08,
        Code::Tab => 0x09,
        Code::Space => 0x20,
        Code::Enter | Code::NumpadEnter => 0x0d,
        Code::CapsLock => 0x14,
        Code::Escape => 0x1b,
        Code::PageUp => 0x21,
        Code::PageDown => 0x22,
        Code::End => 0x23,
        Code::Home => 0x24,
        Code::ArrowLeft => 0x25,
        Code::ArrowUp => 0x26,
        Code::ArrowRight => 0x27,
        Code::ArrowDown => 0x28,
        Code::PrintScreen => 0x2c,
        Code::Insert => 0x2d,
        Code::Delete => 0x2e,
        Code::F1 => 0x70,
        Code::F2 => 0x71,
        Code::F3 => 0x72,
        Code::F4 => 0x73,
        Code::F5 => 0x74,
        Code::F6 => 0x75,
        Code::F7 => 0x76,
        Code::F8 => 0x77,
        Code::F9 => 0x78,
        Code::F10 => 0x79,
        Code::F11 => 0x7a,
        Code::F12 => 0x7b,
        Code::F13 => 0x7c,
        Code::F14 => 0x7d,
        Code::F15 => 0x7e,
        Code::F16 => 0x7f,
        Code::F17 => 0x80,
        Code::F18 => 0x81,
        Code::F19 => 0x82,
        Code::F20 => 0x83,
        Code::F21 => 0x84,
        Code::F22 => 0x85,
        Code::F23 => 0x86,
        Code::F24 => 0x87,
        Code::NumLock => 0x90,
        Code::Numpad0 => 0x60,
        Code::Numpad1 => 0x61,
        Code::Numpad2 => 0x62,
        Code::Numpad3 => 0x63,
        Code::Numpad4 => 0x64,
        Code::Numpad5 => 0x65,
        Code::Numpad6 => 0x66,
        Code::Numpad7 => 0x67,
        Code::Numpad8 => 0x68,
        Code::Numpad9 => 0x69,
        Code::NumpadAdd => 0x6b,
        Code::NumpadDecimal => 0x6e,
        Code::NumpadDivide => 0x6f,
        Code::NumpadEqual => 0x45,
        Code::NumpadMultiply => 0x6a,
        Code::NumpadSubtract => 0x6d,
        Code::ScrollLock => 0x91,
        Code::AudioVolumeDown => 0xae,
        Code::AudioVolumeUp => 0xaf,
        Code::AudioVolumeMute => 0xad,
        Code::MediaPlay => 0xfa,
        Code::MediaPause | Code::Pause => 0x13,
        Code::MediaPlayPause => 0xb3,
        Code::MediaStop => 0xb2,
        Code::MediaTrackNext => 0xb0,
        Code::MediaTrackPrevious => 0xb1,
        _ => return None,
    })
}

#[cfg(target_os = "windows")]
fn shortcut_key_is_down(code: Code) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

    windows_virtual_key(code)
        .map(|virtual_key| unsafe { GetAsyncKeyState(virtual_key) < 0 })
        .unwrap_or(false)
}

fn process_global_shortcut(app: &tauri::AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    let Some(update_lock) = app.try_state::<OverlayShortcutUpdateLock>() else {
        eprintln!("shortcut update state is unavailable");
        return;
    };
    let Ok(_update) = update_lock.0.lock() else {
        eprintln!("shortcut update state is unavailable");
        return;
    };
    let Some(registered) = app.try_state::<RegisteredOverlayShortcut>() else {
        eprintln!("shortcut registration state is unavailable");
        return;
    };
    let action = match registered.0.lock() {
        Ok(mut current) if current.registered && current.shortcut == *shortcut => {
            current.state_machine.handle(event.state)
        }
        Ok(_) => OverlayShortcutAction::None,
        Err(_) => {
            eprintln!("shortcut registration state is unavailable");
            OverlayShortcutAction::None
        }
    };
    if let Err(error) = apply_overlay_shortcut_action(app, action) {
        eprintln!("overlay shortcut action failed: {error}");
    }
}

fn queue_overlay_shortcut(app: &tauri::AppHandle, shortcut: Shortcut, event: ShortcutEvent) {
    let Some(worker) = app.try_state::<OverlayShortcutWorker>() else {
        eprintln!("overlay shortcut worker is unavailable");
        return;
    };
    if let Err(error) = worker.0.send(OverlayShortcutWork { shortcut, event }) {
        eprintln!("failed to queue overlay shortcut action: {error}");
    }
}

#[cfg(target_os = "windows")]
fn forward_global_shortcut(app: &tauri::AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let Some(cycles) = app.try_state::<WindowsShortcutCycles>() else {
        eprintln!("Windows shortcut cycle state is unavailable");
        return;
    };
    let Ok(mut active) = cycles.0.lock() else {
        eprintln!("Windows shortcut cycle state is unavailable");
        return;
    };
    if !begin_windows_shortcut_cycle(&mut active, event.id) {
        return;
    }
    drop(active);

    queue_overlay_shortcut(app, *shortcut, event);
    let shortcut_app = app.clone();
    let shortcut = *shortcut;
    std::thread::spawn(move || {
        while shortcut_key_is_down(shortcut.key) {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        queue_overlay_shortcut(
            &shortcut_app,
            shortcut,
            ShortcutEvent {
                id: shortcut.id(),
                state: ShortcutState::Released,
            },
        );
        if let Some(cycles) = shortcut_app.try_state::<WindowsShortcutCycles>() {
            if let Ok(mut active) = cycles.0.lock() {
                finish_windows_shortcut_cycle(&mut active, shortcut.id());
            }
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn forward_global_shortcut(app: &tauri::AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    queue_overlay_shortcut(app, *shortcut, event);
}

#[tauri::command]
fn resize_overlay(app: tauri::AppHandle, kind: String, height: u32) -> Result<(), String> {
    let label = overlay_label(&kind)?;
    if height == 0 || height > MAX_LAYOUT_OVERLAY_DIMENSION {
        return Err("invalid overlay height".to_owned());
    }
    let Some(window) = app.get_webview_window(label) else {
        return Ok(());
    };
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let physical_height = (f64::from(height) * scale_factor).ceil() as u32;
    let width = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .width;
    window
        .set_size(PhysicalSize::new(width, physical_height))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_overlay_interaction_region(
    kind: String,
    width: u32,
    height: u32,
    region: tauri::State<'_, RecommendationInteractionRegion>,
) -> Result<(), String> {
    if kind != "recommendation" {
        return Err("only the recommendation overlay has an interaction region".to_owned());
    }
    if width == 0
        || height == 0
        || width > MAX_LAYOUT_OVERLAY_DIMENSION
        || height > MAX_LAYOUT_OVERLAY_DIMENSION
    {
        return Err("invalid overlay interaction region".to_owned());
    }
    let mut current = region
        .0
        .lock()
        .map_err(|_| "overlay interaction region is unavailable".to_owned())?;
    current.width = width;
    current.height = height;
    Ok(())
}

#[tauri::command]
fn set_overlay_viewport(
    app: tauri::AppHandle,
    width: u32,
    height: u32,
    lifecycle: tauri::State<'_, OverlayLifecycleState>,
) -> Result<(), String> {
    let physical_size = {
        let mut current = lifecycle
            .0
            .lock()
            .map_err(|_| "overlay visibility state is unavailable".to_owned())?;
        let mut next_viewport = current.viewport;
        let physical_size = requested_overlay_size(
            "recommendation",
            Some(width),
            Some(height),
            &mut next_viewport,
        )?
        .expect("recommendation overlays always use the screenshot viewport");
        current.viewport = next_viewport;
        physical_size
    };
    let (position, physical_size) = fullscreen_overlay_bounds(&app)
        .unwrap_or_else(|| (fullscreen_overlay_position(&app), physical_size));
    for (_, label) in FULLSCREEN_OVERLAY_KINDS {
        let Some(window) = app.get_webview_window(label) else {
            continue;
        };
        window.hide().map_err(|error| error.to_string())?;
        window
            .set_size(physical_size)
            .map_err(|error| error.to_string())?;
        window
            .set_position(position)
            .map_err(|error| error.to_string())?;
        reconcile_overlay_window(&window, &lifecycle, label).map_err(|failure| failure.error)?;
    }
    Ok(())
}

fn update_overlay_shortcut_registration(
    registration: &Mutex<OverlayShortcutRegistration>,
    request: OverlayShortcutRegistrationRequest,
    mut apply: impl FnMut(OverlayShortcutAction) -> Result<(), String>,
    mut unregister: impl FnMut(Shortcut) -> Result<(), String>,
    mut register: impl FnMut(Shortcut) -> Result<(), String>,
) -> Result<OverlayShortcutStatus, String> {
    let (previous, mut next_state_machine) = {
        let current = registration
            .lock()
            .map_err(|_| "shortcut registration state is unavailable".to_owned())?;
        if current.registered && current.shortcut == request.shortcut && request.enabled {
            return Ok(current.status());
        }
        (
            current.registered.then_some(current.shortcut),
            current.state_machine,
        )
    };

    let action = next_state_machine.cancel();
    apply(action)?;
    registration
        .lock()
        .map_err(|_| "shortcut registration state is unavailable".to_owned())?
        .state_machine = next_state_machine;

    if let Some(previous) = previous {
        unregister(previous)?;
    }

    if request.enabled {
        if let Err(registration_error) = register(request.shortcut) {
            if let Some(previous) = previous.filter(|previous| *previous != request.shortcut) {
                if let Err(restore_error) = register(previous) {
                    if let Ok(mut current) = registration.lock() {
                        current.registered = false;
                    }
                    return Err(format!(
                        "{registration_error}; failed to restore the previous shortcut: {restore_error}"
                    ));
                }
            }
            return Err(registration_error);
        }
    }

    let mut current = registration
        .lock()
        .map_err(|_| "shortcut registration state is unavailable".to_owned())?;
    current.shortcut = request.shortcut;
    current.shortcut_text = request.shortcut_text;
    current.registered = request.enabled;
    current.state_machine.mode = request.mode;
    let status = current.status();
    Ok(status)
}

fn update_overlay_shortcut_mode(
    registration: &Mutex<OverlayShortcutRegistration>,
    requested: Shortcut,
    enabled: bool,
    requested_mode: OverlayShortcutMode,
    mut apply: impl FnMut(OverlayShortcutAction) -> Result<(), String>,
) -> Result<Option<OverlayShortcutStatus>, String> {
    let mut current = registration
        .lock()
        .map_err(|_| "shortcut registration state is unavailable".to_owned())?;
    if !current.registered || current.shortcut != requested || !enabled {
        return Ok(None);
    }
    if current.state_machine.mode == requested_mode {
        return Ok(Some(current.status()));
    }

    let mut next = current.state_machine;
    let action = next.set_mode(requested_mode);
    apply(action)?;
    current.state_machine = next;
    Ok(Some(current.status()))
}

#[tauri::command]
fn set_overlay_shortcut(
    app: tauri::AppHandle,
    shortcut: String,
    enabled: bool,
    mode: String,
    registered: tauri::State<'_, RegisteredOverlayShortcut>,
    update_lock: tauri::State<'_, OverlayShortcutUpdateLock>,
) -> Result<OverlayShortcutStatus, String> {
    let requested = shortcut
        .parse::<Shortcut>()
        .map_err(|error| error.to_string())?;
    let requested_mode = OverlayShortcutMode::parse(&mode)?;
    if app
        .try_state::<tauri_plugin_global_shortcut::GlobalShortcut<tauri::Wry>>()
        .is_none()
    {
        return Err("global shortcut support is unavailable".to_owned());
    }
    let update = update_lock
        .0
        .lock()
        .map_err(|_| "shortcut update state is unavailable".to_owned())?;
    if let Some(status) = update_overlay_shortcut_mode(
        &registered.0,
        requested,
        enabled,
        requested_mode,
        |action| apply_overlay_shortcut_action(&app, action),
    )? {
        return Ok(status);
    }
    let global_shortcut = app.global_shortcut();
    let status = update_overlay_shortcut_registration(
        &registered.0,
        OverlayShortcutRegistrationRequest {
            shortcut: requested,
            shortcut_text: shortcut,
            enabled,
            mode: requested_mode,
        },
        |action| apply_overlay_shortcut_action(&app, action),
        |previous| {
            global_shortcut
                .unregister(previous)
                .map_err(|error| error.to_string())
        },
        |next| {
            global_shortcut
                .register(next)
                .map_err(|error| error.to_string())
        },
    )?;
    drop(update);
    Ok(status)
}

#[tauri::command]
fn get_overlay_shortcut_status(
    registered: tauri::State<'_, RegisteredOverlayShortcut>,
) -> Result<OverlayShortcutStatus, String> {
    let current = registered
        .0
        .lock()
        .map_err(|_| "shortcut registration state is unavailable".to_owned())?;
    Ok(current.status())
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args([AUTOSTART_ARG])
                .build(),
        )
        .on_window_event(|window, event| {
            if window.label() != "main" {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    let Some(kind) = overlay_kind(window.label()) else {
                        return;
                    };
                    let Some(lifecycle) = window.app_handle().try_state::<OverlayLifecycleState>()
                    else {
                        return;
                    };
                    let status = match lifecycle.0.lock() {
                        Ok(mut current) => {
                            current.remove_window(window.label());
                            current.status(kind, window.label())
                        }
                        Err(_) => {
                            eprintln!("overlay visibility state is unavailable");
                            return;
                        }
                    };
                    eprintln!(
                        "overlay label={} revision={} event=destroyed",
                        window.label(),
                        status.revision
                    );
                    emit_overlay_visibility(window.app_handle(), status);
                }
                return;
            }
            let tauri::WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            api.prevent_close();
            if let Err(error) = window.hide() {
                eprintln!("failed to hide main window: {error}");
            }
            if let Ok(mut shortcut) = window
                .app_handle()
                .state::<RegisteredOverlayShortcut>()
                .0
                .lock()
            {
                shortcut.state_machine.cancel();
            }
            let statuses = if let Ok(mut lifecycle) = window
                .app_handle()
                .state::<OverlayLifecycleState>()
                .0
                .lock()
            {
                lifecycle.invalidate_overlays();
                all_overlay_statuses(window.app_handle(), &lifecycle)
            } else {
                eprintln!("overlay visibility state is unavailable");
                Vec::new()
            };
            let lifecycle = window.app_handle().state::<OverlayLifecycleState>();
            for label in OVERLAY_WINDOW_LABELS {
                if let Some(overlay) = window.app_handle().get_webview_window(label) {
                    if let Err(error) = reconcile_overlay_window(&overlay, &lifecycle, label) {
                        eprintln!("failed to reconcile {label}: {}", error.error);
                    }
                }
            }
            for status in statuses {
                emit_overlay_visibility(window.app_handle(), status);
            }
        })
        .setup(|app| {
            let default_shortcut = Shortcut::new(None, Code::Tab);
            app.manage(RegisteredOverlayShortcut(Mutex::new(
                OverlayShortcutRegistration {
                    shortcut: default_shortcut,
                    shortcut_text: "Tab".to_owned(),
                    registered: false,
                    state_machine: OverlayShortcutStateMachine::new(OverlayShortcutMode::Trigger),
                },
            )));
            app.manage(OverlayShortcutUpdateLock(Mutex::new(())));
            #[cfg(target_os = "windows")]
            app.manage(WindowsShortcutCycles(Mutex::new(HashSet::new())));
            app.manage(OverlayLifecycleState(Mutex::new(OverlayLifecycle {
                requested_open: HashSet::new(),
                ready: HashSet::new(),
                revisions: HashMap::new(),
                viewport: OverlayViewport::default(),
            })));
            app.manage(RecommendationInteractionRegion(Mutex::new(
                OverlayInteractionRegion {
                    width: 372,
                    height: 720,
                },
            )));
            let (shortcut_tx, shortcut_rx) = mpsc::channel::<OverlayShortcutWork>();
            app.manage(OverlayShortcutWorker(shortcut_tx));
            let shortcut_app = app.handle().clone();
            std::thread::spawn(move || {
                while let Ok(work) = shortcut_rx.recv() {
                    process_global_shortcut(&shortcut_app, &work.shortcut, work.event);
                }
            });
            let overlay_app = app.handle().clone();
            std::thread::spawn(move || {
                let mut ignoring_cursor = true;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(40));
                    let Some(window) = overlay_app.get_webview_window("overlay-recommendation")
                    else {
                        ignoring_cursor = true;
                        continue;
                    };
                    if !window.is_visible().unwrap_or(false) {
                        if !ignoring_cursor && window.set_ignore_cursor_events(true).is_ok() {
                            ignoring_cursor = true;
                        }
                        continue;
                    }
                    let inside_panel = (|| {
                        let position = window.outer_position().ok()?;
                        let cursor = window.cursor_position().ok()?;
                        let scale = window.scale_factor().ok()?;
                        #[cfg(target_os = "macos")]
                        let (window_position, cursor_position, coordinate_scale) = {
                            let primary_scale =
                                window.primary_monitor().ok().flatten()?.scale_factor();
                            let position = position.to_logical::<f64>(scale);
                            let cursor = cursor.to_logical::<f64>(primary_scale);
                            ((position.x, position.y), (cursor.x, cursor.y), 1.0)
                        };
                        #[cfg(not(target_os = "macos"))]
                        let (window_position, cursor_position, coordinate_scale) = (
                            (f64::from(position.x), f64::from(position.y)),
                            (cursor.x, cursor.y),
                            scale,
                        );
                        let region_state = overlay_app.state::<RecommendationInteractionRegion>();
                        let region = region_state.0.lock().ok()?;
                        Some(cursor_is_inside_interaction_region(
                            window_position,
                            cursor_position,
                            &region,
                            coordinate_scale,
                        ))
                    })()
                    .unwrap_or(false);
                    let should_ignore = !inside_panel;
                    if should_ignore != ignoring_cursor
                        && window.set_ignore_cursor_events(should_ignore).is_ok()
                    {
                        ignoring_cursor = should_ignore;
                    }
                }
            });
            let shortcut_plugin = tauri_plugin_global_shortcut::Builder::new()
                .with_handler(forward_global_shortcut)
                .build();
            if let Err(error) = app.handle().plugin(shortcut_plugin) {
                eprintln!("global Tab shortcut unavailable: {error}");
            }

            let show_item =
                MenuItem::with_id(app, "show", "Show OMG-Draft-Seer", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let tray_icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| std::io::Error::other("default application icon is unavailable"))?;
            TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("OMG-Draft-Seer")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => quit_app(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            if std::env::args().any(|argument| argument == AUTOSTART_ARG) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        });

    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    let app = builder
        .invoke_handler(tauri::generate_handler![
            open_overlay,
            toggle_overlay,
            get_overlay_visibility,
            mark_overlay_ready,
            close_overlay,
            resize_overlay,
            set_overlay_interaction_region,
            set_overlay_viewport,
            set_overlay_shortcut,
            get_overlay_shortcut_status,
            capture::capture_dota2_screenshot
        ])
        .build(tauri::generate_context!())
        .expect("error while building OMG-Draft-Seer");

    #[cfg(target_os = "macos")]
    app.run(|app, event| {
        if let tauri::RunEvent::Reopen { .. } = event {
            show_main_window(app);
        }
    });

    #[cfg(not(target_os = "macos"))]
    app.run(|_, _| {});
}

#[cfg(test)]
mod tests {
    use super::{
        begin_windows_shortcut_cycle, cursor_is_inside_interaction_region,
        finish_windows_shortcut_cycle, overlay_display_confirmed, overlay_event_message,
        overlay_fits_monitor, overlay_kind, requested_overlay_size, update_overlay_shortcut_mode,
        update_overlay_shortcut_registration, windows_virtual_key, OverlayDisplayTarget,
        OverlayInteractionRegion, OverlayLifecycle, OverlayReconcileError, OverlayShortcutAction,
        OverlayShortcutMode, OverlayShortcutRegistration, OverlayShortcutRegistrationRequest,
        OverlayShortcutStateMachine, OverlayViewport, FULLSCREEN_OVERLAY_KINDS,
    };
    use std::cell::Cell;
    use std::collections::{HashMap, HashSet};
    use std::sync::Mutex;
    use tauri::PhysicalSize;
    use tauri_plugin_global_shortcut::{Code, Shortcut, ShortcutState};

    #[test]
    fn window_creating_commands_run_on_blocking_workers() {
        let source = include_str!("lib.rs");
        for command in ["open_overlay", "close_overlay", "toggle_overlay"] {
            let signature = format!("async fn {command}");
            assert!(source.contains(&signature), "{command} must be async");
            let body = source
                .split_once(&signature)
                .expect("async command should exist")
                .1
                .split_once("#[tauri::command]")
                .map(|(body, _)| body)
                .unwrap_or_default();
            assert!(
                body.contains("spawn_blocking"),
                "{command} must create windows from a blocking worker"
            );
        }
    }

    #[test]
    fn shortcut_overlay_open_reuses_the_latest_screenshot_viewport() {
        let mut viewport = OverlayViewport::default();

        let uploaded_size =
            requested_overlay_size("recommendation", Some(1920), Some(1080), &mut viewport)
                .expect("uploaded screenshot viewport should be valid")
                .expect("recommendation overlays should have a viewport");
        let shortcut_size = requested_overlay_size("recommendation", None, None, &mut viewport)
            .expect("saved screenshot viewport should remain valid")
            .expect("recommendation overlays should have a viewport");

        assert_eq!(uploaded_size, PhysicalSize::new(1920, 1080));
        assert_eq!(shortcut_size, uploaded_size);
    }

    #[test]
    fn viewport_updates_target_all_fullscreen_overlays() {
        assert_eq!(
            FULLSCREEN_OVERLAY_KINDS,
            [
                ("recommendation", "overlay-recommendation"),
                ("layout", "overlay-layout"),
            ]
        );
    }

    #[test]
    fn viewport_command_resizes_existing_fullscreen_windows() {
        let source = include_str!("lib.rs");
        let command = source
            .split_once("fn set_overlay_viewport")
            .expect("viewport command should exist")
            .1
            .split_once("fn update_overlay_shortcut_registration")
            .expect("shortcut registration should follow the viewport command")
            .0;

        assert!(command.contains("FULLSCREEN_OVERLAY_KINDS"));
        assert!(command.contains("set_size"));
        assert!(command.contains("set_position"));
        assert!(command.contains("reconcile_overlay_window"));
    }

    #[test]
    fn shortcut_plugin_calls_do_not_hold_the_registration_mutex() {
        let previous = Shortcut::new(None, Code::Tab);
        let requested = Shortcut::new(None, Code::F8);
        let registration = Mutex::new(OverlayShortcutRegistration {
            shortcut: previous,
            shortcut_text: "Tab".to_owned(),
            registered: true,
            state_machine: OverlayShortcutStateMachine::new(OverlayShortcutMode::Trigger),
        });

        let status = update_overlay_shortcut_registration(
            &registration,
            OverlayShortcutRegistrationRequest {
                shortcut: requested,
                shortcut_text: "F8".to_owned(),
                enabled: true,
                mode: OverlayShortcutMode::Trigger,
            },
            |action| {
                assert!(registration.try_lock().is_ok());
                assert_eq!(action, OverlayShortcutAction::None);
                Ok(())
            },
            |shortcut| {
                assert!(registration.try_lock().is_ok());
                assert_eq!(shortcut, previous);
                Ok(())
            },
            |shortcut| {
                assert!(registration.try_lock().is_ok());
                assert_eq!(shortcut, requested);
                Ok(())
            },
        )
        .expect("shortcut replacement should succeed");

        assert_eq!(status.shortcut, "F8");
        assert!(status.registered);
    }

    #[test]
    fn shortcut_replacement_stops_before_plugin_changes_when_hold_cancel_fails() {
        let previous = Shortcut::new(None, Code::Tab);
        let requested = Shortcut::new(None, Code::F8);
        let mut state_machine = OverlayShortcutStateMachine::new(OverlayShortcutMode::Hold);
        state_machine.handle(ShortcutState::Pressed);
        let registration = Mutex::new(OverlayShortcutRegistration {
            shortcut: previous,
            shortcut_text: "Tab".to_owned(),
            registered: true,
            state_machine,
        });
        let unregister_called = Cell::new(false);
        let register_called = Cell::new(false);

        let error = update_overlay_shortcut_registration(
            &registration,
            OverlayShortcutRegistrationRequest {
                shortcut: requested,
                shortcut_text: "F8".to_owned(),
                enabled: true,
                mode: OverlayShortcutMode::Hold,
            },
            |action| {
                assert_eq!(action, OverlayShortcutAction::CloseRecommendation);
                Err("hide failed".to_owned())
            },
            |_| {
                unregister_called.set(true);
                Ok(())
            },
            |_| {
                register_called.set(true);
                Ok(())
            },
        )
        .expect_err("a failed hold close must reject the shortcut replacement");

        let current = registration.lock().unwrap();
        assert_eq!(error, "hide failed");
        assert_eq!(current.shortcut, previous);
        assert_eq!(current.shortcut_text, "Tab");
        assert!(current.registered);
        assert!(current.state_machine.pressed);
        assert!(!unregister_called.get());
        assert!(!register_called.get());
    }

    #[test]
    fn shortcut_mode_commits_only_after_its_overlay_action_succeeds() {
        let requested = Shortcut::new(None, Code::F8);
        let registration = Mutex::new(OverlayShortcutRegistration {
            shortcut: requested,
            shortcut_text: "F8".to_owned(),
            registered: true,
            state_machine: OverlayShortcutStateMachine::new(OverlayShortcutMode::Trigger),
        });

        let error = update_overlay_shortcut_mode(
            &registration,
            requested,
            true,
            OverlayShortcutMode::Hold,
            |action| {
                assert_eq!(action, OverlayShortcutAction::CloseRecommendation);
                Err("hide failed".to_owned())
            },
        )
        .expect_err("a failed close must reject the mode update");
        assert_eq!(error, "hide failed");
        assert_eq!(
            registration.lock().unwrap().state_machine.mode,
            OverlayShortcutMode::Trigger
        );

        let status = update_overlay_shortcut_mode(
            &registration,
            requested,
            true,
            OverlayShortcutMode::Hold,
            |action| {
                assert_eq!(action, OverlayShortcutAction::CloseRecommendation);
                Ok(())
            },
        )
        .expect("a successful close should allow the mode update")
        .expect("the matching registration should handle the mode update");
        assert_eq!(status.mode, OverlayShortcutMode::Hold);
    }

    #[test]
    fn global_shortcut_handler_sends_work_to_a_dedicated_worker() {
        let source = include_str!("lib.rs");
        let queue = source
            .split_once("fn queue_overlay_shortcut")
            .expect("shortcut queue should exist")
            .1
            .split_once("fn forward_global_shortcut")
            .expect("global shortcut handler should follow the queue")
            .0;

        assert!(queue.contains("OverlayShortcutWorker"));
        assert!(queue.contains(".send("));
        assert!(!queue.contains("run_on_main_thread"));
    }

    #[test]
    fn windows_shortcut_cycle_filters_repeated_pressed_events() {
        let mut active = HashSet::new();

        assert!(begin_windows_shortcut_cycle(&mut active, 7));
        assert!(!begin_windows_shortcut_cycle(&mut active, 7));
        finish_windows_shortcut_cycle(&mut active, 7);
        assert!(begin_windows_shortcut_cycle(&mut active, 7));
    }

    #[test]
    fn windows_virtual_keys_cover_registered_shortcut_main_keys() {
        assert_eq!(windows_virtual_key(Code::KeyQ), Some(0x51));
        assert_eq!(windows_virtual_key(Code::F8), Some(0x77));
        assert_eq!(windows_virtual_key(Code::PageDown), Some(0x22));
        assert_eq!(windows_virtual_key(Code::NumpadAdd), Some(0x6b));
        assert_eq!(windows_virtual_key(Code::IntlRo), None);
    }

    #[test]
    fn trigger_shortcut_toggles_once_per_press_cycle() {
        let mut shortcut = OverlayShortcutStateMachine::new(OverlayShortcutMode::Trigger);

        assert_eq!(
            shortcut.handle(ShortcutState::Pressed),
            OverlayShortcutAction::ToggleRecommendation
        );
        assert_eq!(
            shortcut.handle(ShortcutState::Pressed),
            OverlayShortcutAction::None
        );
        assert_eq!(
            shortcut.handle(ShortcutState::Released),
            OverlayShortcutAction::None
        );
        assert_eq!(
            shortcut.handle(ShortcutState::Pressed),
            OverlayShortcutAction::ToggleRecommendation
        );
    }

    #[test]
    fn hold_shortcut_opens_on_press_and_closes_on_release_or_cancel() {
        let mut shortcut = OverlayShortcutStateMachine::new(OverlayShortcutMode::Hold);

        assert_eq!(
            shortcut.handle(ShortcutState::Pressed),
            OverlayShortcutAction::OpenRecommendation
        );
        assert_eq!(
            shortcut.handle(ShortcutState::Released),
            OverlayShortcutAction::CloseRecommendation
        );
        assert_eq!(shortcut.cancel(), OverlayShortcutAction::None);

        assert_eq!(
            shortcut.handle(ShortcutState::Pressed),
            OverlayShortcutAction::OpenRecommendation
        );
        assert_eq!(
            shortcut.cancel(),
            OverlayShortcutAction::CloseRecommendation
        );
    }

    #[test]
    fn changing_shortcut_mode_cancels_an_active_hold() {
        let mut shortcut = OverlayShortcutStateMachine::new(OverlayShortcutMode::Hold);
        shortcut.handle(ShortcutState::Pressed);

        assert_eq!(
            shortcut.set_mode(OverlayShortcutMode::Trigger),
            OverlayShortcutAction::CloseRecommendation
        );
        assert_eq!(
            shortcut.handle(ShortcutState::Released),
            OverlayShortcutAction::None
        );
    }

    #[test]
    fn entering_hold_mode_closes_an_existing_recommendation_overlay() {
        let mut shortcut = OverlayShortcutStateMachine::new(OverlayShortcutMode::Trigger);

        assert_eq!(
            shortcut.set_mode(OverlayShortcutMode::Hold),
            OverlayShortcutAction::CloseRecommendation
        );
    }

    #[test]
    fn invalidating_overlays_rejects_an_older_open_request() {
        let mut lifecycle = OverlayLifecycle {
            requested_open: HashSet::new(),
            ready: HashSet::new(),
            revisions: HashMap::new(),
            viewport: OverlayViewport::default(),
        };
        let old_request = lifecycle.request_open("overlay-recommendation");

        lifecycle.invalidate_overlays();

        assert!(lifecycle.requested_open.is_empty());
        assert!(!lifecycle.is_current_open("overlay-recommendation", old_request));
        let current_request = lifecycle.request_open("overlay-recommendation");
        assert!(lifecycle.is_current_open("overlay-recommendation", current_request));
    }

    #[test]
    fn closing_an_overlay_rejects_its_in_flight_open_without_affecting_others() {
        let mut lifecycle = OverlayLifecycle {
            requested_open: HashSet::new(),
            ready: HashSet::new(),
            revisions: HashMap::new(),
            viewport: OverlayViewport::default(),
        };
        let recommendation_request = lifecycle.request_open("overlay-recommendation");
        let tier_request = lifecycle.request_open("overlay-tier");

        lifecycle.request_close("overlay-recommendation");

        assert!(!lifecycle.is_current_open("overlay-recommendation", recommendation_request));
        assert!(lifecycle.is_current_open("overlay-tier", tier_request));
        assert!(!lifecycle.should_show("overlay-recommendation"));
    }

    #[test]
    fn display_target_identifies_a_newer_request_that_supersedes_a_hide() {
        let mut lifecycle = OverlayLifecycle {
            requested_open: HashSet::new(),
            ready: HashSet::from(["overlay-recommendation".to_owned()]),
            revisions: HashMap::new(),
            viewport: OverlayViewport::default(),
        };
        lifecycle.request_close("overlay-recommendation");
        let stale_hide = lifecycle.display_target("overlay-recommendation");

        lifecycle.request_open("overlay-recommendation");
        let latest_open = lifecycle.display_target("overlay-recommendation");

        assert!(!stale_hide.show);
        assert!(latest_open.show);
        assert!(latest_open.revision > stale_hide.revision);
    }

    #[test]
    fn interaction_region_hit_test_respects_its_coordinate_scale() {
        let region = OverlayInteractionRegion {
            width: 372,
            height: 720,
        };

        assert!(cursor_is_inside_interaction_region(
            (200.0, 100.0),
            (224.0, 124.0),
            &region,
            2.0,
        ));
        assert!(!cursor_is_inside_interaction_region(
            (200.0, 100.0),
            (223.0, 124.0),
            &region,
            2.0,
        ));
    }

    #[test]
    fn page_load_keeps_frontend_ready_separate_and_restores_cursor_pass_through() {
        let source = include_str!("lib.rs");
        let page_load = source
            .split_once(".on_page_load")
            .expect("overlay page-load handler should exist")
            .1
            .split_once(".build()")
            .expect("window build should follow the page-load handler")
            .0;
        let hidden_branch = source
            .split_once("if !window.is_visible().unwrap_or(false)")
            .expect("cursor poller hidden branch should exist")
            .1
            .split_once("let inside_panel")
            .expect("hit testing should follow the hidden branch")
            .0;

        assert!(page_load.contains("set_ignore_cursor_events(true)"));
        assert!(page_load.contains("PageLoadEvent::Finished"));
        assert!(!page_load.contains("mark_ready"));
        assert!(hidden_branch.contains("set_ignore_cursor_events(true)"));
    }

    #[test]
    fn overlay_webview_environment_uses_the_main_window_browser_args() {
        let mut main = tauri::utils::config::WindowConfig::default();
        main.additional_browser_args = Some("--shared-webview-option".to_owned());
        let mut secondary = tauri::utils::config::WindowConfig::default();
        secondary.label = "secondary".to_owned();
        secondary.additional_browser_args = Some("--unrelated-option".to_owned());

        assert_eq!(
            super::main_webview_browser_args(&[secondary, main]),
            Some("--shared-webview-option")
        );
        assert_eq!(super::main_webview_browser_args(&[]), None);
    }

    #[test]
    fn overlay_lifecycle_logs_include_revision_and_native_operation_results() {
        assert_eq!(
            overlay_event_message("overlay-tier", 7, "created", "ok"),
            "overlay label=overlay-tier revision=7 event=created result=ok"
        );
        assert_eq!(
            overlay_event_message("overlay-tier", 8, "show", "error"),
            "overlay label=overlay-tier revision=8 event=show result=error"
        );
    }

    #[test]
    fn overlay_geometry_must_fit_inside_its_monitor() {
        assert!(overlay_fits_monitor(
            (-1920, 0),
            (1920, 1080),
            (-1920, 0),
            (1920, 1080)
        ));
        assert!(!overlay_fits_monitor(
            (-1920, 0),
            (2560, 1440),
            (-1920, 0),
            (1920, 1080)
        ));
        assert!(!overlay_fits_monitor(
            (0, 0),
            (1920, 1080),
            (-1920, 0),
            (1920, 1080)
        ));
    }

    #[test]
    fn displayed_state_requires_a_successful_os_visibility_observation() {
        assert!(overlay_display_confirmed(true, true, true));
        assert!(!overlay_display_confirmed(true, false, false));
        assert!(!overlay_display_confirmed(true, true, false));
        assert!(!overlay_display_confirmed(false, true, true));
    }

    #[test]
    fn preparing_an_existing_overlay_preserves_cursor_interaction_state() {
        let source = include_str!("lib.rs");
        let existing_window = source
            .split_once("if let Some(window) = app.get_webview_window(label)")
            .expect("existing overlay branch should exist")
            .1
            .split_once("return Ok(window)")
            .expect("existing overlay branch should return the window")
            .0;

        assert!(existing_window.contains("set_always_on_top(true)"));
        assert!(!existing_window.contains("set_ignore_cursor_events"));
    }

    #[test]
    fn overlay_ready_state_gates_visibility_and_does_not_resurrect_closed_overlay() {
        let mut lifecycle = OverlayLifecycle {
            requested_open: HashSet::new(),
            ready: HashSet::new(),
            revisions: HashMap::new(),
            viewport: OverlayViewport::default(),
        };

        lifecycle.request_open("overlay-tier");
        assert!(!lifecycle.should_show("overlay-tier"));
        assert!(lifecycle.display_target("overlay-tier").show);

        lifecycle.mark_ready("overlay-tier");
        assert!(lifecycle.should_show("overlay-tier"));

        lifecycle.requested_open.remove("overlay-tier");
        assert!(!lifecycle.should_show("overlay-tier"));
    }

    #[test]
    fn destroyed_overlay_window_clears_requested_and_ready_state() {
        let label = "overlay-tier";
        let mut lifecycle = OverlayLifecycle {
            requested_open: HashSet::new(),
            ready: HashSet::new(),
            revisions: HashMap::new(),
            viewport: OverlayViewport::default(),
        };
        lifecycle.request_open(label);
        lifecycle.mark_ready(label);
        let previous = lifecycle.display_target(label).revision;

        lifecycle.remove_window(label);

        let current = lifecycle.display_target(label);
        assert!(!lifecycle.requested_open.contains(label));
        assert!(!lifecycle.ready.contains(label));
        assert!(!current.show);
        assert!(current.revision > previous);
    }

    #[test]
    fn overlay_window_labels_map_back_to_public_kinds() {
        assert_eq!(
            overlay_kind("overlay-recommendation"),
            Some("recommendation")
        );
        assert_eq!(overlay_kind("overlay-tier"), Some("tier"));
        assert_eq!(overlay_kind("overlay-layout"), Some("layout"));
        assert_eq!(overlay_kind("main"), None);
    }

    #[test]
    fn a_new_page_load_invalidates_ready_without_clearing_the_open_request() {
        let mut lifecycle = OverlayLifecycle {
            requested_open: HashSet::from(["overlay-recommendation".to_owned()]),
            ready: HashSet::from(["overlay-recommendation".to_owned()]),
            revisions: HashMap::new(),
            viewport: OverlayViewport::default(),
        };

        lifecycle.mark_loading("overlay-recommendation");

        assert!(lifecycle.requested_open.contains("overlay-recommendation"));
        assert!(!lifecycle.should_show("overlay-recommendation"));
    }

    #[test]
    fn a_new_open_request_reuses_ready_content() {
        let mut lifecycle = OverlayLifecycle {
            requested_open: HashSet::new(),
            ready: HashSet::from(["overlay-recommendation".to_owned()]),
            revisions: HashMap::new(),
            viewport: OverlayViewport::default(),
        };

        lifecycle.request_open("overlay-recommendation");

        assert!(lifecycle.should_show("overlay-recommendation"));
    }

    #[test]
    fn frontend_ready_marks_a_requested_overlay_ready_for_display() {
        let mut lifecycle = OverlayLifecycle {
            requested_open: HashSet::from(["overlay-tier".to_owned()]),
            ready: HashSet::new(),
            revisions: HashMap::new(),
            viewport: OverlayViewport::default(),
        };

        lifecycle.mark_ready("overlay-tier");

        assert!(lifecycle.should_show("overlay-tier"));
    }

    #[test]
    fn ready_failure_closes_the_current_request() {
        let label = "overlay-recommendation";
        let mut lifecycle = OverlayLifecycle {
            requested_open: HashSet::new(),
            ready: HashSet::new(),
            revisions: HashMap::new(),
            viewport: OverlayViewport::default(),
        };
        lifecycle.request_open(label);
        lifecycle.mark_ready(label);
        let previous = lifecycle.display_target(label).revision;

        assert!(lifecycle.fail_display_if_current(label, previous));

        let current = lifecycle.display_target(label);
        assert!(!current.show);
        assert!(!lifecycle.ready.contains(label));
        assert!(!lifecycle.requested_open.contains(label));
        assert!(current.revision > previous);
    }

    #[test]
    fn stale_ready_failure_does_not_close_a_newer_open_request() {
        let label = "overlay-recommendation";
        let mut lifecycle = OverlayLifecycle {
            requested_open: HashSet::new(),
            ready: HashSet::new(),
            revisions: HashMap::new(),
            viewport: OverlayViewport::default(),
        };
        let stale_revision = lifecycle.request_open(label);
        lifecycle.mark_ready(label);
        lifecycle.request_close(label);
        let current_revision = lifecycle.request_open(label);

        let failure = OverlayReconcileError {
            target: Some(OverlayDisplayTarget {
                revision: stale_revision,
                show: true,
            }),
            error: "show failed".to_owned(),
        };
        let failed_revision = failure
            .target
            .expect("a native show failure should retain its target revision")
            .revision;

        assert!(!lifecycle.fail_display_if_current(label, failed_revision));
        assert!(lifecycle.is_current_open(label, current_revision));
    }
}
