use std::{
    fs,
    io::Write,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

#[tauri::command]
pub fn loading_benchmark_config(
    app: tauri::AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    if !cfg!(debug_assertions) {
        return Ok(None);
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("loading-benchmark.json");
    if !path.exists() {
        return Ok(None);
    }
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > 1024 {
        return Err("Invalid loading benchmark configuration".into());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if value["version"] != 1
        || value["label"].as_str().is_none_or(|s| s.len() > 80)
        || value["reloads"].as_u64().is_none_or(|n| n > 5)
    {
        return Err("Invalid loading benchmark configuration".into());
    }
    Ok(Some(value))
}

#[tauri::command]
pub fn finish_loading_benchmark(app: tauri::AppHandle) -> Result<(), String> {
    if loading_benchmark_config(app.clone())?.is_some() {
        if let Some(window) = app.get_webview_window("main") {
            window.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_loading_profile(
    app: tauri::AppHandle,
    profile: serde_json::Value,
) -> Result<String, String> {
    let bytes = profile_bytes(&profile)?;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("loading-profiles");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let path = directory.join(format!("loading-{}-{stamp}.json", std::process::id()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn profile_bytes(profile: &serde_json::Value) -> Result<Vec<u8>, String> {
    let entries = profile["entries"]
        .as_array()
        .ok_or("Invalid loading profile")?;
    if entries.len() > 512 {
        return Err("Loading profile has too many entries".into());
    }
    if let Some(samples) = profile.get("frames").and_then(|f| f.get("samples")) {
        if samples.as_array().is_none_or(|s| s.len() > 512) {
            return Err("Invalid loading frame samples".into());
        }
    }
    let bytes = serde_json::to_vec_pretty(&profile).map_err(|e| e.to_string())?;
    if bytes.len() > 256 * 1024 {
        return Err("Loading profile is too large".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn profile_limits_cover_entries_and_frame_samples() {
        assert!(profile_bytes(&json!({"entries":[],"frames":{"samples":[]}})).is_ok());
        assert!(profile_bytes(&json!({"entries":vec![json!({});513]})).is_err());
        assert!(
            profile_bytes(&json!({"entries":[],"frames":{"samples":vec![json!({});513]}})).is_err()
        );
        assert!(profile_bytes(&json!({"entries":[],"frames":{"samples":"invalid"}})).is_err());
    }
}
