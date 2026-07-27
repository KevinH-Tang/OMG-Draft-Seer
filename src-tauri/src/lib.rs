use std::sync::Mutex;

use tauri::{
    Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState,
};

const MAX_LAYOUT_OVERLAY_DIMENSION: u32 = 16_384;
const OVERLAY_GLOBAL_SHORTCUT_EVENT: &str = "omg-draft-seer-global-shortcut";

struct OverlayShortcutRegistration {
    shortcut: Shortcut,
    registered: bool,
}

struct RegisteredOverlayShortcut(Mutex<OverlayShortcutRegistration>);

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
        "recommendation" => Some(("overlay-recommendation", 520.0, 820.0, 24.0, 72.0)),
        "tier" => Some(("overlay-tier", 430.0, 760.0, 470.0, 72.0)),
        "layout" => Some(("overlay-layout", 2560.0, 1440.0, 0.0, 0.0)),
        _ => None,
    }
}

#[tauri::command]
async fn open_overlay(
    app: tauri::AppHandle,
    kind: String,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<(), String> {
    let (label, default_width, default_height, x, y) =
        overlay_window_config(&kind).ok_or_else(|| format!("unknown overlay kind: {kind}"))?;
    let physical_layout_size = if kind == "layout" {
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
    let physical_layout_position = if kind == "layout" {
        app.get_webview_window("main")
            .and_then(|window| window.current_monitor().ok().flatten())
            .map(|monitor| *monitor.position())
            .unwrap_or_else(|| PhysicalPosition::new(0, 0))
    } else {
        PhysicalPosition::new(0, 0)
    };

    if let Some(window) = app.get_webview_window(label) {
        if let Some(size) = physical_layout_size {
            window.hide().map_err(|error| error.to_string())?;
            window.set_size(size).map_err(|error| error.to_string())?;
            window
                .set_position(physical_layout_position)
                .map_err(|error| error.to_string())?;
        }
        window.show().map_err(|error| error.to_string())?;
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
        window
            .set_ignore_cursor_events(true)
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

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

    if let Some(size) = physical_layout_size {
        window.set_size(size).map_err(|error| error.to_string())?;
        window
            .set_position(physical_layout_position)
            .map_err(|error| error.to_string())?;
    }

    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())
}

#[tauri::command]
fn close_overlay(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    let (label, ..) =
        overlay_window_config(&kind).ok_or_else(|| format!("unknown overlay kind: {kind}"))?;
    if let Some(window) = app.get_webview_window(label) {
        window.close().map_err(|error| error.to_string())?;
    }
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
    let builder = tauri::Builder::default().setup(|app| {
        let default_shortcut = Shortcut::new(None, Code::Tab);
        app.manage(RegisteredOverlayShortcut(Mutex::new(
            OverlayShortcutRegistration {
                shortcut: default_shortcut,
                registered: false,
            },
        )));
        let shortcut_plugin = tauri_plugin_global_shortcut::Builder::new()
            .with_handler(forward_global_shortcut)
            .build();
        if let Err(error) = app.handle().plugin(shortcut_plugin) {
            eprintln!("global Tab shortcut unavailable: {error}");
        }
        Ok(())
    });

    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(tauri::generate_handler![
            open_overlay,
            close_overlay,
            resize_overlay,
            set_overlay_shortcut
        ])
        .run(tauri::generate_context!())
        .expect("error while running OMG-Draft-Seer")
}
