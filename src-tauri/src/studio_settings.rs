use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

fn directory() -> PathBuf {
    PathBuf::from(crate::library_settings::ROOT).join("config/studio/game-chooser")
}
fn latest() -> Result<Value, String> {
    let root = directory();
    if !root.exists() {
        return Ok(json!({"version":1,"revision":null,"defaults":{},"overrides":{}}));
    }
    let mut paths = fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect::<Vec<_>>();
    paths.sort();
    match paths.last() {
        Some(path) => serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string()),
        None => Ok(json!({"version":1,"revision":null,"defaults":{},"overrides":{}})),
    }
}
#[tauri::command]
pub fn load_studio_settings() -> Result<Value, String> {
    latest()
}

#[tauri::command]
pub fn save_studio_settings(
    mut document: Value,
    expected_revision: Option<String>,
) -> Result<Value, String> {
    if document["version"] != 1
        || !document["defaults"].is_object()
        || !document["overrides"].is_object()
        || serde_json::to_vec(&document)
            .map_err(|e| e.to_string())?
            .len()
            > 4_000_000
    {
        return Err("Invalid Studio settings document.".into());
    }
    for key in document["defaults"].as_object().unwrap().keys() {
        if !["handheld", "arcade", "console", "computer", "device-only"].contains(&key.as_str()) {
            return Err("Unknown Studio device type.".into());
        }
    }
    let root = directory();
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("write.lock"))
        .map_err(|e| e.to_string())?;
    lock.lock().map_err(|e| e.to_string())?;
    if latest()?["revision"].as_str() != expected_revision.as_deref() {
        return Err("Studio settings changed in another editor. Reload before saving.".into());
    }
    let revision = format!(
        "{:032}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    );
    document["revision"] = json!(revision);
    let bytes = serde_json::to_vec_pretty(&document).map_err(|e| e.to_string())?;
    let pending = root.join(format!("{revision}.pending"));
    let mut file = File::create(&pending).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&pending, root.join(format!("{revision}.json"))).map_err(|e| e.to_string())?;
    Ok(document)
}
