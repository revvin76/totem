use super::{effective_roots, key, roots, Root};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
};

pub(super) fn migrate(
    settings: &Value,
    manifest: &Value,
    overrides: &Value,
    ids: &[String],
) -> Value {
    let mut sources = json!({});
    // Preserve source-specific extension rules. Platform overrides are still
    // applied at scan time, so changing one does not rewrite the folder data.
    let source_overrides = json!({"sources": overrides["sources"]});
    for mut root in effective_roots(settings, manifest, &source_overrides, ids) {
        let platform = &root.platform;
        if sources[platform].is_null() {
            sources[platform] = json!({"paths": [], "roots": []});
        }
        let source = &mut sources[platform];
        if root.optional {
            source["template"] = json!(root);
        }
        if root.scan_paths.is_some() {
            // Resolve the saved folder paths at scan time, including drives
            // that may be disconnected during migration.
            root.scan_paths = Some(
                serde_json::from_value(overrides["sources"][platform]["paths"].clone())
                    .expect("validated saved replacement folders"),
            );
        } else {
            let paths = source["paths"].as_array_mut().unwrap();
            if !paths.iter().any(|path| {
                path.as_str()
                    .is_some_and(|path| key(Path::new(path)) == key(&root.path))
            }) {
                paths.push(json!(root.path));
            }
        }
        source["roots"].as_array_mut().unwrap().push(json!(root));
    }
    json!({
        "version": 1,
        "platforms": sources,
        "platformMediaLayouts": manifest["platformMediaLayouts"]
    })
}

fn read_roots(source: &Value) -> Result<Vec<Root>, String> {
    serde_json::from_value(source["roots"].clone()).map_err(|error| {
        format!("Saved ROM folder metadata is invalid. Restore a valid revision. {error}")
    })
}

pub(super) fn configured(document: &Value, ids: &[String]) -> Result<Vec<Root>, String> {
    if document["version"] != 1 || !document["platforms"].is_object() {
        return Err("Unsupported ROM folder settings. Restore a valid revision.".into());
    }
    let mut result = Vec::new();
    for id in ids {
        if let Some(source) = document["platforms"].get(id) {
            for mut root in read_roots(source)? {
                if let Some(paths) = &mut root.scan_paths {
                    *paths = paths
                        .iter()
                        .filter_map(|path| std::fs::canonicalize(path).ok())
                        .collect();
                }
                result.push(root);
            }
        }
    }
    Ok(result)
}

pub(super) fn edit(
    document: &mut Value,
    settings: &Value,
    id: &str,
    paths: Vec<PathBuf>,
) -> Result<(), String> {
    let mut selected = HashSet::new();
    for path in &paths {
        let text = path.to_string_lossy();
        if text.len() > 1024
            || text.chars().any(char::is_control)
            || !path.is_absolute()
            || path.components().any(|part| part == Component::ParentDir)
            || (path.exists() && !path.is_dir())
        {
            return Err(format!(
                "Enter a full folder path without parent traversal. Check {text:?}."
            ));
        }
        if !selected.insert(key(path)) {
            return Err(format!(
                "Each folder can only be listed once. Check {text:?}."
            ));
        }
    }

    let source = &document["platforms"][id];
    let mut records = if source.is_null() {
        Vec::new()
    } else {
        read_roots(source)?
    };
    let saved: HashSet<_> = records
        .iter()
        .filter(|root| root.scan_paths.is_none())
        .map(|root| key(&root.path))
        .collect();
    // Older saved replacements may have scoped original roots to preserve IDs
    // and artwork. Keep those recipes only for folders retained in the list.
    let template: Root = if let Some(template) = source.get("template") {
        serde_json::from_value(template.clone())
            .map_err(|_| "Invalid saved ROM folder template.")?
    } else {
        roots(
            settings,
            &json!({"collections": [], "platformMediaLayouts": document["platformMediaLayouts"]}),
            &[id.to_owned()],
        )
        .pop()
        .expect("a platform has a conventional root template")
    };
    records.retain_mut(|root| {
        if let Some(scope) = &mut root.scan_paths {
            scope.retain(|path| selected.contains(&key(path)));
            !scope.is_empty()
        } else {
            selected.contains(&key(&root.path))
        }
    });
    let mut added = template.clone();
    added.identity_path = None;
    added.exclude_alternate_sources = false;
    added.optional = false;
    added.scan_paths = None;
    added.explicit = true;
    if let Some((admission, _)) = added.admissions.first_mut() {
        admission.kind = "explicit".into();
    }
    for path in paths.iter().filter(|path| !saved.contains(&key(path))) {
        records.push(Root {
            path: path.clone(),
            ..added.clone()
        });
    }
    document["platforms"][id] = json!({"paths": paths, "roots": records, "template": template});
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_index::scan_roots;
    use std::fs;

    #[test]
    fn migrated_paths_drive_scans_and_can_all_be_removed() {
        let base = std::env::temp_dir().join(format!(
            "totem-rom-folders-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let imported = base.join("imported");
        let conventional = base.join("nes").join("games");
        let added = base.join("added");
        for (folder, game) in [
            (&imported, "Imported.nes"),
            (&conventional, "Conventional.nes"),
            (&added, "Added.nes"),
        ] {
            fs::create_dir_all(folder).unwrap();
            fs::write(folder.join(game), b"fixture").unwrap();
        }
        let settings = json!({"paths": {"root": base, "platforms": base}});
        let manifest = json!({"collections": [{
            "platformId": "nes", "extensions": "nes", "gameRoots": {"path": imported}
        }]});
        let ids = ["nes".to_owned()];
        let mut document = migrate(&settings, &manifest, &json!({}), &ids);
        let scan = |document: &Value| scan_roots(configured(document, &ids).unwrap());
        assert_eq!(
            document["platforms"]["nes"]["paths"],
            json!([imported, conventional])
        );
        let original = scan(&document);
        assert_eq!(original.summary.total_games, 2);

        edit(&mut document, &settings, "nes", vec![conventional, added]).unwrap();
        let updated = scan(&document);
        assert_eq!(updated.summary.total_games, 2);
        assert_eq!(
            original
                .games
                .values()
                .find(|game| game.title == "Conventional")
                .unwrap()
                .id,
            updated
                .games
                .values()
                .find(|game| game.title == "Conventional")
                .unwrap()
                .id,
        );

        edit(&mut document, &settings, "nes", Vec::new()).unwrap();
        assert_eq!(scan(&document).summary.total_games, 0);
        assert!(imported.join("Imported.nes").is_file());
        fs::remove_dir_all(base).unwrap();
    }
}
