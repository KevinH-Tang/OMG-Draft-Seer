use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn overlay_window_config(kind: &str) -> Option<(&'static str, f64, f64, f64, f64)> {
    match kind {
        "recommendation" => Some(("overlay-recommendation", 430.0, 660.0, 24.0, 72.0)),
        "tier" => Some(("overlay-tier", 430.0, 760.0, 470.0, 72.0)),
        _ => None,
    }
}

#[tauri::command]
async fn open_overlay(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    let (label, width, height, x, y) =
        overlay_window_config(&kind).ok_or_else(|| format!("unknown overlay kind: {kind}"))?;

    if let Some(window) = app.get_webview_window(label) {
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
    .title(if kind == "tier" {
        "OMG Tier Overlay"
    } else {
        "OMG Recommendation Overlay"
    })
    .inner_size(width, height)
    .position(x, y)
    .decorations(false)
    .shadow(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .focused(false)
    .transparent(true);

    let window = builder.build().map_err(|error| error.to_string())?;

    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())
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
