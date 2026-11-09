use serde_json::{json, Value};
use std::{collections::HashSet, fs, io::Write, path::Path};

fn valid_id(id: &str) -> bool {
    id.len() == 40
        && id.starts_with("map-")
        && id.bytes().enumerate().skip(4).all(|(i, b)| {
            if [12, 17, 22, 27].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit() && !b.is_ascii_uppercase()
            }
        })
}

pub fn validate(profile: &Value, platform_ids: &[String]) -> Result<(), String> {
    let controllers: Vec<Value> =
        serde_json::from_str(include_str!("../../controller-profiles.json"))
            .map_err(|e| e.to_string())?;
    let controller = controllers
        .iter()
        .find(|c| c["id"] == profile["controllerId"])
        .ok_or("Unknown controller layout")?;
    if profile["schemaVersion"] != 1 || !profile["id"].as_str().is_some_and(valid_id) {
        return Err("Invalid mapping profile ID or version".into());
    }
    if !profile["name"]
        .as_str()
        .is_some_and(|s| !s.trim().is_empty() && s.chars().count() <= 100)
    {
        return Err("Give this mapping a name of 1–100 characters".into());
    }
    if !profile["platformId"]
        .as_str()
        .is_some_and(|s| platform_ids.iter().any(|id| id == s))
    {
        return Err("Unknown mapping platform".into());
    }
    if !profile["createdAt"]
        .as_str()
        .is_some_and(|s| s.len() >= 20 && s.len() <= 30 && s.ends_with('Z') && s.contains('T'))
    {
        return Err("Invalid mapping creation date".into());
    }
    let bindings = profile["bindings"]
        .as_object()
        .ok_or("Invalid assignments")?;
    let skipped = profile["skipped"]
        .as_array()
        .ok_or("Invalid skipped controls")?;
    if bindings.is_empty() {
        return Err("Map at least one control before saving".into());
    }
    let controls: HashSet<_> = controller["controls"]
        .as_array()
        .ok_or("Invalid controller layout")?
        .iter()
        .filter_map(|c| c["id"].as_str())
        .collect();
    let xbox = controllers
        .iter()
        .find(|c| c["id"] == "xbox-series")
        .ok_or("Xbox layout unavailable")?;
    let inputs: HashSet<_> = xbox["controls"]
        .as_array()
        .ok_or("Invalid Xbox layout")?
        .iter()
        .filter_map(|c| c["defaultInput"].as_str())
        .collect();
    let mut complete = HashSet::new();
    for (id, input) in bindings {
        if !controls.contains(id.as_str()) || !input.as_str().is_some_and(|v| inputs.contains(v)) {
            return Err("Unknown legacy control or Xbox input".into());
        }
        complete.insert(id.as_str());
    }
    for id in skipped {
        let id = id.as_str().ok_or("Invalid skipped control")?;
        if !controls.contains(id) || !complete.insert(id) {
            return Err("Control mapped and skipped, or skipped twice".into());
        }
    }
    if complete.len() != controls.len() {
        return Err("Finish the mapping run before saving".into());
    }
    if serde_json::to_vec(profile)
        .map_err(|e| e.to_string())?
        .len()
        > 65536
    {
        return Err("Mapping profile is too large".into());
    }
    Ok(())
}

pub fn load(root: &Path, platforms: &[String]) -> Result<Value, String> {
    if !root.exists() {
        return Ok(json!({"profiles":[],"errors":[]}));
    }
    let mut profiles = Vec::new();
    let mut errors = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().is_none_or(|x| x != "json") {
            continue;
        }
        let read = || -> Result<Value, String> {
            if !path
                .file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(valid_id)
            {
                return Err("Unrecognised mapping filename".into());
            }
            if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 65536 {
                return Err("Mapping file too large".into());
            }
            let value: Value = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            validate(&value, platforms)?;
            if value["id"].as_str() != path.file_stem().and_then(|s| s.to_str()) {
                return Err("Mapping filename and ID disagree".into());
            }
            Ok(value)
        };
        match read() {
            Ok(value) => profiles.push(value),
            Err(reason) => errors.push(format!(
                "{}: {reason}",
                path.file_name().unwrap_or_default().to_string_lossy()
            )),
        }
    }
    profiles.sort_by(|a, b| a["createdAt"].as_str().cmp(&b["createdAt"].as_str()));
    Ok(json!({"profiles":profiles,"errors":errors}))
}

pub fn save(root: &Path, profile: Value, platforms: &[String]) -> Result<Value, String> {
    validate(&profile, platforms)?;
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("mapping-save.lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock()
        .map_err(|_| "Another mapping save is in progress. Try saving again.")?;
    let id = profile["id"].as_str().ok_or("Missing mapping ID")?;
    let target = root.join(format!("{id}.json"));
    if target.exists() {
        return Err(
            "This profile is already saved. Start a new run to create another mapping.".into(),
        );
    }
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let pending = root.join(format!("{id}-{timestamp}.pending"));
    let bytes = serde_json::to_vec_pretty(&profile).map_err(|e| e.to_string())?;
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
        return Err("Mapping readback verification failed".into());
    }
    // The process-safe lock guards the existence check and atomic publication.
    // A new pending filename lets failed saves be retried without losing data.
    fs::rename(pending, target).map_err(|e| e.to_string())?;
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Value {
        json!({"id":"map-00000000-0000-0000-0000-000000000000","schemaVersion":1,"name":"My NES","platformId":"nes","controllerId":"nes","createdAt":"2026-11-02T12:00:00.000Z","bindings":{"a":"b0","b":"b2","up":"b12","down":"b13","left":"b14","right":"b15","select":"b8","start":"b9"},"skipped":[]})
    }
    #[test]
    fn validates_shared_controller_controls_and_complete_assignments() {
        let ids = vec!["nes".into()];
        let good = fixture();
        assert!(validate(&good, &ids).is_ok());
        for (key, value) in [
            ("id", json!("../../escape")),
            ("controllerId", json!("missing")),
            ("platformId", json!("missing")),
            ("bindings", json!({"a":"b99"})),
            ("skipped", json!(["a"])),
        ] {
            let mut bad = good.clone();
            bad[key] = value;
            assert!(validate(&bad, &ids).is_err());
        }
        let mut incomplete = good.clone();
        incomplete["bindings"].as_object_mut().unwrap().remove("a");
        assert!(validate(&incomplete, &ids).is_err());
        incomplete["skipped"] = json!(["a"]);
        assert!(validate(&incomplete, &ids).is_ok());
    }
    #[test]
    fn immutable_profiles_survive_reload_and_corruption_is_isolated() {
        let root = std::env::temp_dir().join(format!(
            "horizon-mapping-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let ids = vec!["nes".into()];
        let profile = fixture();
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("map-00000000-0000-0000-0000-000000000000-previous.pending"),
            b"interrupted save",
        )
        .unwrap();
        let held = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join("mapping-save.lock"))
            .unwrap();
        held.try_lock().unwrap();
        assert!(save(&root, profile.clone(), &ids).is_err());
        drop(held);
        save(&root, profile.clone(), &ids).unwrap();
        assert_eq!(load(&root, &ids).unwrap()["profiles"][0], profile);
        assert!(save(&root, profile.clone(), &ids).is_err());
        fs::write(
            root.join("map-11111111-1111-1111-1111-111111111111.json"),
            b"broken",
        )
        .unwrap();
        fs::write(root.join("ignored.pending"), b"unfinished").unwrap();
        let loaded = load(&root, &ids).unwrap();
        assert_eq!(loaded["profiles"].as_array().unwrap().len(), 1);
        assert_eq!(loaded["errors"].as_array().unwrap().len(), 1);
        // Disposable test directory is removed by the task's PowerShell cleanup.
    }
}
