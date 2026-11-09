use serde_json::{json, Value};
use std::path::{Component, Path};

fn valid_sources(value: &Value) -> bool {
    matches!(value["mode"].as_str(), Some("add" | "replace"))
        && value["paths"].as_array().is_some_and(|paths| {
            paths.len() <= 64
                && (!paths.is_empty() || value["mode"] == "add")
                && paths.iter().all(|entry| {
                    entry.as_str().is_some_and(|entry| {
                        let path = Path::new(entry);
                        entry.len() <= 1024
                            && !entry.chars().any(char::is_control)
                            && path.is_absolute()
                            && !path.components().any(|part| part == Component::ParentDir)
                    })
                })
        })
}
pub fn initial() -> Value {
    json!({"version":1,"revision":null,"platforms":{}})
}
pub fn load(root: &Path) -> Result<Value, String> {
    let value = crate::admin_storage::load(root, "platform-extensions", initial())?;
    if value["version"] != 1
        || !value["platforms"].is_object()
        || value["platforms"].as_object().unwrap().values().any(|v| {
            !v.as_array().is_some_and(|a| {
                !a.is_empty()
                    && a.iter().all(|s| {
                        s.as_str().is_some_and(|s| {
                            !s.is_empty()
                                && s.len() <= 24
                                && s.bytes()
                                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
                        })
                    })
            })
        })
    {
        return Err(
            "Invalid saved platform extensions. Restore a valid revision before scanning.".into(),
        );
    }
    if let Some(sources) = value.get("sources") {
        if !sources
            .as_object()
            .is_some_and(|map| map.values().all(valid_sources))
        {
            return Err(
                "Invalid saved ROM sources. Restore a valid revision before scanning.".into(),
            );
        }
    }
    Ok(value)
}
#[cfg(test)]
pub fn save(
    root: &Path,
    id: &str,
    extensions: Vec<String>,
    expected: Option<&str>,
) -> Result<Value, String> {
    save_settings(root, id, Some(extensions), None, expected)
}

#[cfg(test)]
pub(crate) fn save_settings(
    root: &Path,
    id: &str,
    extensions: Option<Vec<String>>,
    sources: Option<Value>,
    expected: Option<&str>,
) -> Result<Value, String> {
    update(root, id, extensions, sources, None, expected)
}

fn update(
    root: &Path,
    id: &str,
    extensions: Option<Vec<String>>,
    sources: Option<Value>,
    folders: Option<Vec<std::path::PathBuf>>,
    expected: Option<&str>,
) -> Result<Value, String> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("Invalid platform ID.".into());
    }
    if extensions.as_ref().is_some_and(|extensions| {
        extensions.is_empty()
            || extensions.len() > 100
            || extensions.iter().any(|s| {
                s.is_empty()
                    || s.len() > 24
                    || !s
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            })
    }) {
        return Err("Enter one or more file extensions using letters and digits.".into());
    }
    let mut value = load(root)?;
    if let Some(extensions) = extensions {
        value["platforms"][id] = json!(extensions);
    }
    if let Some(sources) = sources {
        if !valid_sources(&sources) {
            return Err("Enter full folder paths without parent traversal. Replacement needs at least one folder.".into());
        }
        if sources["paths"].as_array().unwrap().iter().any(|entry| {
            let path = Path::new(entry.as_str().unwrap());
            path.exists() && !path.is_dir()
        }) {
            return Err("Each ROM source must be a folder.".into());
        }
        if sources["paths"].as_array().unwrap().is_empty() {
            if let Some(overrides) = value["sources"].as_object_mut() {
                overrides.remove(id);
            }
        } else {
            value["sources"][id] = sources;
        }
    }
    if let Some(folders) = folders {
        crate::library_index::edit_rom_folders(root, &mut value, id, folders)?;
    }
    persist(root, value, expected)
}

pub(crate) fn persist(root: &Path, value: Value, expected: Option<&str>) -> Result<Value, String> {
    crate::admin_storage::save(root, "platform-extensions", value, expected, initial())
}
#[tauri::command]
pub fn load_platform_extensions(
    carousel: tauri::State<'_, crate::Carousel>,
) -> Result<Value, String> {
    let root = Path::new(crate::library_settings::ROOT);
    let settings = crate::library_settings::load(root)?;
    let ids: Vec<_> = carousel.catalogue()?.into_iter().map(|p| p.id).collect();
    crate::library_index::load_rom_settings(root, &settings, &ids)
}
#[tauri::command]
pub fn save_platform_extensions(
    platform_id: String,
    extensions: Option<Vec<String>>,
    folders: Option<Vec<std::path::PathBuf>>,
    expected_revision: Option<String>,
) -> Result<Value, String> {
    update(
        Path::new(crate::library_settings::ROOT),
        &platform_id,
        extensions,
        None,
        folders,
        expected_revision.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extensions_persist_and_reject_stale_or_invalid_edits() {
        let root = std::env::temp_dir().join(format!(
            "totem-extensions-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let saved = save(&root, "nes", vec!["nes".into(), "zip".into()], None).unwrap();
        assert_eq!(
            load(&root).unwrap()["platforms"]["nes"],
            json!(["nes", "zip"])
        );
        assert!(save(&root, "nes", vec!["exe".into()], None).is_err());
        assert!(save(
            &root,
            "nes",
            vec!["../exe".into()],
            saved["revision"].as_str()
        )
        .is_err());
        assert_eq!(load(&root).unwrap(), saved);
        assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
        std::fs::remove_dir_all(root).unwrap();
    }
}
