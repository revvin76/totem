use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn load(root: &Path, section: &str, initial: Value) -> Result<Value, String> {
    let dir = root.join("config").join(section).join("revisions");
    if !dir.exists() {
        return Ok(initial);
    }
    let mut files = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.len() == 32 && s.bytes().all(|b| b.is_ascii_digit()))
                && p.extension().is_some_and(|s| s == "json")
        })
        .collect::<Vec<_>>();
    files.sort();
    match files.last() {
        Some(path) => crate::library_settings::read_json(path),
        None => Ok(initial),
    }
}
pub fn save(
    root: &Path,
    section: &str,
    mut value: Value,
    expected: Option<&str>,
    initial: Value,
) -> Result<Value, String> {
    let dir = root.join("config").join(section).join("revisions");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join("write.lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock()
        .map_err(|_| "Another save is in progress. Retry shortly.")?;
    let current = load(root, section, initial)?;
    if current["revision"].as_str() != expected {
        return Err("Settings changed in another window. Reload before saving.".into());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos()
        .max(
            current["revision"]
                .as_str()
                .and_then(|s| s.parse::<u128>().ok())
                .unwrap_or(0)
                .saturating_add(1),
        );
    let revision = format!("{stamp:032}");
    value["revision"] = json!(revision);
    let bytes = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
    if bytes.len() > 4_000_000 {
        return Err("Settings exceed 4 MB.".into());
    }
    let pending = dir.join(format!("{revision}.pending"));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&pending)
        .map_err(|e| e.to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    if fs::read(&pending).map_err(|e| e.to_string())? != bytes {
        return Err("Could not verify saved settings.".into());
    }
    fs::rename(pending, dir.join(format!("{revision}.json"))).map_err(|e| e.to_string())?;
    Ok(value)
}
