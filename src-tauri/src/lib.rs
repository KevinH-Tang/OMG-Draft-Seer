use std::{collections::HashSet, sync::Mutex};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState,
};

const MAX_LAYOUT_OVERLAY_DIMENSION: u32 = 16_384;
const AUTOSTART_ARG: &str = "--minimized";
const OVERLAY_GLOBAL_SHORTCUT_EVENT: &str = "omg-draft-seer-global-shortcut";
const MAIN_WINDOW_HIDDEN_EVENT: &str = "omg-draft-seer-main-window-hidden";
const OVERLAY_WINDOW_LABELS: [&str; 3] =
    ["overlay-recommendation", "overlay-tier", "overlay-layout"];

struct OverlayShortcutRegistration {
    shortcut: Shortcut,
    registered: bool,
}

struct RegisteredOverlayShortcut(Mutex<OverlayShortcutRegistration>);
struct OverlayLifecycle {
    generation: u64,
    visible: HashSet<String>,
}
struct OverlayLifecycleState(Mutex<OverlayLifecycle>);

impl OverlayLifecycle {
    fn mark_visible(&mut self, label: &str, generation: u64) -> bool {
        if self.generation != generation {
            return false;
        }
        self.visible.insert(label.to_owned());
        true
    }

    fn invalidate_overlays(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.visible.clear();
    }
}
struct OverlayInteractionRegion {
    width: u32,
    height: u32,
}
struct RecommendationInteractionRegion(Mutex<OverlayInteractionRegion>);

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

fn forward_global_shortcut<R: Runtime>(
    app: &tauri::AppHandle<R>,
    _shortcut: &Shortcut,
    event: ShortcutEvent,
) {
    let state = match event.state {
        ShortcutState::Pressed => "pressed",
        ShortcutState::Released => "released",
    };
    let _ = app.emit(OVERLAY_GLOBAL_SHORTCUT_EVENT, state);
}

fn overlay_window_config(kind: &str) -> Option<(&'static str, f64, f64, f64, f64)> {
    match kind {
        "recommendation" => Some(("overlay-recommendation", 2560.0, 1440.0, 0.0, 0.0)),
        "tier" => Some(("overlay-tier", 430.0, 760.0, 470.0, 72.0)),
        "layout" => Some(("overlay-layout", 2560.0, 1440.0, 0.0, 0.0)),
        _ => None,
    }
}

#[tauri::command]
fn open_overlay(
    app: tauri::AppHandle,
    kind: String,
    width: Option<u32>,
    height: Option<u32>,
    lifecycle: tauri::State<'_, OverlayLifecycleState>,
) -> Result<bool, String> {
    let (label, default_width, default_height, x, y) =
        overlay_window_config(&kind).ok_or_else(|| format!("unknown overlay kind: {kind}"))?;
    let physical_overlay_size = if kind == "layout" || kind == "recommendation" {
        let requested_width = width.unwrap_or(default_width as u32);
        let requested_height = height.unwrap_or(default_height as u32);
        if requested_width == 0
            || requested_height == 0
            || requested_width > MAX_LAYOUT_OVERLAY_DIMENSION
            || requested_height > MAX_LAYOUT_OVERLAY_DIMENSION
        {
            return Err("invalid layout overlay dimensions".to_owned());
        }
        Some(PhysicalSize::new(requested_width, requested_height))
    } else {
        None
    };
    let physical_overlay_position = if kind == "layout" || kind == "recommendation" {
        app.get_webview_window("main")
            .and_then(|window| window.current_monitor().ok().flatten())
            .map(|monitor| *monitor.position())
            .unwrap_or_else(|| PhysicalPosition::new(0, 0))
    } else {
        PhysicalPosition::new(0, 0)
    };
    let generation = lifecycle
        .0
        .lock()
        .map_err(|_| "overlay visibility state is unavailable".to_owned())?
        .generation;

    let window = if let Some(window) = app.get_webview_window(label) {
        if let Some(size) = physical_overlay_size {
            window.hide().map_err(|error| error.to_string())?;
            window.set_size(size).map_err(|error| error.to_string())?;
            window
                .set_position(physical_overlay_position)
                .map_err(|error| error.to_string())?;
        }
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
        window
            .set_ignore_cursor_events(true)
            .map_err(|error| error.to_string())?;
        window
    } else {
        let builder = WebviewWindowBuilder::new(
            &app,
            label,
            WebviewUrl::App(format!("index.html?overlay={kind}").into()),
        )
        .title(match kind.as_str() {
            "tier" => "OMG Tier Overlay",
            "layout" => "OMG Layout Overlay",
            _ => "OMG Recommendation Overlay",
        })
        .inner_size(default_width, default_height)
        .position(x, y)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .transparent(true);

        let window = builder.build().map_err(|error| error.to_string())?;

        if let Some(size) = physical_overlay_size {
            window.set_size(size).map_err(|error| error.to_string())?;
            window
                .set_position(physical_overlay_position)
                .map_err(|error| error.to_string())?;
        }

        window
            .set_ignore_cursor_events(true)
            .map_err(|error| error.to_string())?;
        window
    };

    window.show().map_err(|error| error.to_string())?;
    let opened = {
        let mut current = lifecycle
            .0
            .lock()
            .map_err(|_| "overlay visibility state is unavailable".to_owned())?;
        current.mark_visible(label, generation)
    };
    if !opened {
        let _ = window.hide();
    }
    Ok(opened)
}

#[tauri::command]
fn close_overlay(
    app: tauri::AppHandle,
    kind: String,
    lifecycle: tauri::State<'_, OverlayLifecycleState>,
) -> Result<(), String> {
    let (label, ..) =
        overlay_window_config(&kind).ok_or_else(|| format!("unknown overlay kind: {kind}"))?;
    if let Some(window) = app.get_webview_window(label) {
        window.hide().map_err(|error| error.to_string())?;
    }
    lifecycle
        .0
        .lock()
        .map_err(|_| "overlay visibility state is unavailable".to_owned())?
        .visible
        .remove(label);
    Ok(())
}

#[tauri::command]
fn resize_overlay(app: tauri::AppHandle, kind: String, height: u32) -> Result<(), String> {
    let (label, ..) =
        overlay_window_config(&kind).ok_or_else(|| format!("unknown overlay kind: {kind}"))?;
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
fn set_overlay_shortcut(
    app: tauri::AppHandle,
    shortcut: String,
    enabled: bool,
    registered: tauri::State<'_, RegisteredOverlayShortcut>,
) -> Result<(), String> {
    let requested = shortcut
        .parse::<Shortcut>()
        .map_err(|error| error.to_string())?;
    let mut current = registered
        .0
        .lock()
        .map_err(|_| "shortcut registration state is unavailable".to_owned())?;
    if app
        .try_state::<tauri_plugin_global_shortcut::GlobalShortcut<tauri::Wry>>()
        .is_none()
    {
        return Err("global shortcut support is unavailable".to_owned());
    }

    if current.registered && current.shortcut == requested && enabled {
        return Ok(());
    }

    let global_shortcut = app.global_shortcut();
    let previous = current.registered.then_some(current.shortcut);
    if let Some(previous) = previous {
        global_shortcut
            .unregister(previous)
            .map_err(|error| error.to_string())?;
        current.registered = false;
    }

    if enabled {
        if let Err(error) = global_shortcut.register(requested) {
            let registration_error = error.to_string();
            if let Some(previous) = previous.filter(|previous| *previous != requested) {
                if let Err(restore_error) = global_shortcut.register(previous) {
                    return Err(format!(
                        "{registration_error}; failed to restore the previous shortcut: {restore_error}"
                    ));
                }
                current.registered = true;
            }
            return Err(registration_error);
        }
        current.registered = true;
    }
    current.shortcut = requested;
    Ok(())
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
                return;
            }
            let tauri::WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            api.prevent_close();
            let _ = window.emit(MAIN_WINDOW_HIDDEN_EVENT, ());
            let _ = window.hide();
            if let Ok(mut lifecycle) = window
                .app_handle()
                .state::<OverlayLifecycleState>()
                .0
                .lock()
            {
                lifecycle.invalidate_overlays();
            }
            for label in OVERLAY_WINDOW_LABELS {
                if let Some(overlay) = window.app_handle().get_webview_window(label) {
                    let _ = overlay.hide();
                }
            }
        })
        .setup(|app| {
            let default_shortcut = Shortcut::new(None, Code::Tab);
            app.manage(RegisteredOverlayShortcut(Mutex::new(
                OverlayShortcutRegistration {
                    shortcut: default_shortcut,
                    registered: false,
                },
            )));
            app.manage(OverlayLifecycleState(Mutex::new(OverlayLifecycle {
                generation: 0,
                visible: HashSet::new(),
            })));
            app.manage(RecommendationInteractionRegion(Mutex::new(
                OverlayInteractionRegion {
                    width: 372,
                    height: 720,
                },
            )));
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
                        ignoring_cursor = true;
                        continue;
                    }
                    let inside_panel = (|| {
                        let position = window.outer_position().ok()?;
                        let cursor = window.cursor_position().ok()?;
                        let scale = window.scale_factor().ok()?;
                        let region_state = overlay_app.state::<RecommendationInteractionRegion>();
                        let region = region_state.0.lock().ok()?;
                        let inset = 12.0 * scale;
                        let left = f64::from(position.x) + inset;
                        let top = f64::from(position.y) + inset;
                        let right = left + f64::from(region.width) * scale;
                        let bottom = top + f64::from(region.height) * scale;
                        Some(
                            cursor.x >= left
                                && cursor.x <= right
                                && cursor.y >= top
                                && cursor.y <= bottom,
                        )
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
            close_overlay,
            resize_overlay,
            set_overlay_interaction_region,
            set_overlay_shortcut
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
    use super::OverlayLifecycle;
    use std::collections::HashSet;

    #[test]
    fn invalidating_overlays_rejects_an_older_open_request() {
        let mut lifecycle = OverlayLifecycle {
            generation: 7,
            visible: HashSet::from(["overlay-tier".to_owned()]),
        };

        lifecycle.invalidate_overlays();

        assert!(lifecycle.visible.is_empty());
        assert!(!lifecycle.mark_visible("overlay-recommendation", 7));
        assert!(lifecycle.mark_visible("overlay-recommendation", 8));
    }
}
