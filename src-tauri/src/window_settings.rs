use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, Manager, WebviewWindow};

const SECTION: &str = "window-settings";

fn defaults() -> Value {
    json!({"fullscreen": true, "revision": null})
}

pub fn load(root: &Path) -> Result<Value, String> {
    crate::admin_storage::load(root, SECTION, defaults())
}

#[tauri::command]
pub fn load_window_settings(app: AppHandle) -> Result<Value, String> {
    if app.config().identifier == crate::STUDIO_IDENTIFIER {
        return Err("The fullscreen preference is available in Totem.".into());
    }
    load(&crate::studio_paths::home_data_directory(&app)?)
}

#[tauri::command]
pub async fn save_window_settings(
    window: WebviewWindow,
    fullscreen: bool,
    expected_revision: Option<String>,
) -> Result<Value, String> {
    let app = window.app_handle();
    if app.config().identifier == crate::STUDIO_IDENTIFIER {
        return Err("The fullscreen preference is available in Totem.".into());
    }
    let root = crate::studio_paths::home_data_directory(app)?;
    let mut saved = tauri::async_runtime::spawn_blocking(move || {
        crate::admin_storage::save(
            &root,
            SECTION,
            json!({"fullscreen": fullscreen}),
            expected_revision.as_deref(),
            defaults(),
        )
    })
    .await
    .map_err(|_| "Window settings worker unavailable.")??;
    saved["applied"] = json!(window.set_fullscreen(fullscreen).is_ok());
    Ok(saved)
}
