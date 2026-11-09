use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Component, Path},
    time::{SystemTime, UNIX_EPOCH},
};

pub const ROOT: &str = r"D:\Totem";
const KEYS: [&str; 8] = [
    "root",
    "platforms",
    "collections",
    "playlists",
    "models",
    "artworkCache",
    "legacy",
    "manifest",
];

pub(crate) fn read_json(path: &Path) -> Result<Value, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024 {
        return Err("Settings/manifest file exceeds 8 MB.".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
    serde_json::from_slice(bytes).map_err(|e| format!("Invalid settings/manifest: {e}"))
}

fn validate_paths(paths: &Value) -> Result<(), String> {
    let map = paths.as_object().ok_or("Folder paths must be an object.")?;
    if map.len() != KEYS.len() {
        return Err("Unexpected folder fields.".into());
    }
    for key in KEYS {
        let value = paths[key].as_str().ok_or("Missing folder path.")?;
        let path = Path::new(value);
        if value.len() > 1024
            || value.chars().any(char::is_control)
            || !path.is_absolute()
            || path.components().any(|c| matches!(c, Component::ParentDir))
        {
            return Err(format!(
                "{key}: enter a full absolute path without parent traversal."
            ));
        }
        if path.exists()
            && ((key == "manifest" && !path.is_file()) || (key != "manifest" && !path.is_dir()))
        {
            return Err(format!("{key}: the path has the wrong file/folder type."));
        }
    }
    Ok(())
}

pub fn load(root: &Path) -> Result<Value, String> {
    let directory = root.join("config/library-settings/revisions");
    let mut revisions = Vec::new();
    if directory.exists() {
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.len() == 37
                && name.ends_with(".json")
                && name[..32].bytes().all(|b| b.is_ascii_digit())
            {
                revisions.push(path);
            }
        }
    }
    revisions.sort();
    let value = if let Some(path) = revisions.last() {
        read_json(path)?
    } else {
        serde_json::from_str(include_str!("../../folder-settings.json"))
            .map_err(|e| e.to_string())?
    };
    if value["schemaVersion"] != 1 || !value["revision"].is_string() {
        return Err("Unsupported folder settings.".into());
    }
    validate_paths(&value["paths"])?;
    Ok(value)
}

pub fn view(root: &Path) -> Result<Value, String> {
    let settings = load(root)?;
    let statuses: Vec<_> = KEYS
        .iter()
        .map(|&key| {
            let path = Path::new(settings["paths"][key].as_str().unwrap());
            json!({"key":key,"exists":path.exists(),"directory":path.is_dir()})
        })
        .collect();
    let manifest = Path::new(settings["paths"]["manifest"].as_str().unwrap());
    let collections = if manifest.is_file() {
        let data = read_json(manifest)?;
        data["collections"].as_array().ok_or("Invalid collection manifest.")?.iter().map(|c| {
            json!({"id":c["id"],"name":c["name"],"platformId":c["platformId"],"kind":c["kind"],"extensions":c["extensions"],"gameRoots":c["gameRoots"],"configuredGamePath":c["configuredGamePath"]})
        }).collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    Ok(
        json!({"settings":settings,"statuses":statuses,"collections":collections,"storage":root.join("config/library-settings/revisions").to_string_lossy()}),
    )
}

struct Lock(std::path::PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub fn save(root: &Path, paths: Value, expected_revision: &str) -> Result<Value, String> {
    validate_paths(&paths)?;
    let manifest = Path::new(paths["manifest"].as_str().unwrap());
    if manifest.is_file() && !read_json(manifest)?["collections"].is_array() {
        return Err("Choose a valid collection manifest.".into());
    }
    let directory = root.join("config/library-settings/revisions");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let lock_path = root.join("config/library-settings/save.lock");
    let lock_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
        .map_err(|_| {
            "Folder settings are being saved in another window. Retry after it finishes."
                .to_string()
        })?;
    let _lock = Lock(lock_path);
    let mut current = load(root)?;
    if current["revision"].as_str() != Some(expected_revision) {
        return Err(
            "Folder settings changed in another window. Reopen Settings before saving.".into(),
        );
    }
    let latest = fs::read_dir(&directory)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let name = entry.ok()?.file_name().to_str()?.to_owned();
            if name.len() == 37 && name.ends_with(".json") {
                name[..32].parse::<u128>().ok()
            } else {
                None
            }
        })
        .max()
        .unwrap_or(0);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos()
        .max(latest.saturating_add(1));
    current["paths"] = paths;
    current["revision"] = json!(stamp.to_string());
    let bytes = serde_json::to_vec_pretty(&current).map_err(|e| e.to_string())?;
    let pending = directory.join(format!("{stamp:032}.pending"));
    let target = directory.join(format!("{stamp:032}.json"));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&pending)
        .map_err(|e| e.to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    drop(file);
    if fs::read(&pending).map_err(|e| e.to_string())? != bytes {
        return Err("Could not verify saved folder settings.".into());
    }
    fs::rename(pending, target).map_err(|e| e.to_string())?;
    drop(lock_file);
    view(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "horizon-folders-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let dir = root.join("config/library-settings/revisions");
        fs::create_dir_all(&dir).unwrap();
        let paths: serde_json::Map<_, _> = KEYS
            .into_iter()
            .map(|key| (key.into(), json!(root.join(key).to_string_lossy())))
            .collect();
        fs::write(
            dir.join("00000000000000000000000000000001.json"),
            serde_json::to_vec(&json!({"schemaVersion":1,"revision":"initial","paths":paths}))
                .unwrap(),
        )
        .unwrap();
        root
    }
    #[test]
    fn saves_and_reloads_without_overwriting_prior_revision() {
        let root = fixture();
        let original = load(&root).unwrap();
        let mut paths = original["paths"].clone();
        paths["models"] = json!(root.join("new-models").to_string_lossy());
        let saved = save(&root, paths.clone(), "initial").unwrap();
        assert_eq!(load(&root).unwrap()["paths"], paths);
        assert_ne!(saved["settings"]["revision"], "initial");
        assert!(save(&root, paths, "initial").is_err());
        assert_eq!(
            read_json(
                &root.join(
                    "config/library-settings/revisions/00000000000000000000000000000001.json"
                )
            )
            .unwrap(),
            original
        );
    }
    #[test]
    fn invalid_paths_and_competing_writer_leave_settings_intact() {
        let root = fixture();
        let original = load(&root).unwrap();
        let mut paths = original["paths"].clone();
        paths["root"] = json!("relative/path");
        assert!(save(&root, paths, "initial").is_err());
        fs::write(
            root.join("config/library-settings/save.lock"),
            b"other writer",
        )
        .unwrap();
        assert!(save(&root, original["paths"].clone(), "initial").is_err());
        assert_eq!(load(&root).unwrap(), original);
    }
    #[test]
    fn malformed_latest_revision_is_reported_instead_of_silent_fallback() {
        let root = fixture();
        fs::write(
            root.join("config/library-settings/revisions/00000000000000000000000000000002.json"),
            b"{",
        )
        .unwrap();
        assert!(load(&root).is_err());
    }
    #[test]
    fn clock_rollback_does_not_hide_a_newly_saved_revision() {
        let root = fixture();
        let mut future = load(&root).unwrap();
        future["revision"] = json!("future");
        let stamp = 10u128.pow(24);
        fs::write(
            root.join(format!(
                "config/library-settings/revisions/{stamp:032}.json"
            )),
            serde_json::to_vec(&future).unwrap(),
        )
        .unwrap();
        let saved = save(&root, future["paths"].clone(), "future").unwrap();
        assert_eq!(
            saved["settings"]["revision"],
            json!((stamp + 1).to_string())
        );
    }
    #[test]
    fn invalid_manifest_is_rejected_before_publishing_a_revision() {
        let root = fixture();
        let original = load(&root).unwrap();
        fs::write(root.join("manifest"), b"{}").unwrap();
        assert!(save(&root, original["paths"].clone(), "initial").is_err());
        assert_eq!(load(&root).unwrap(), original);
    }
}
