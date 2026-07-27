use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

const MAX_LAYOUT_OVERLAY_DIMENSION: u32 = 16_384;

fn overlay_window_config(kind: &str) -> Option<(&'static str, f64, f64, f64, f64)> {
    match kind {
        "recommendation" => Some(("overlay-recommendation", 430.0, 660.0, 24.0, 72.0)),
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

pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(tauri::generate_handler![open_overlay, close_overlay])
        .run(tauri::generate_context!())
        .expect("error while running OMG-Draft-Seer")
}
