use super::Platform;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MODEL_LIMIT: usize = 128 * 1024 * 1024;
const LOGO_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
pub struct AssetReference {
    id: String,
    name: String,
    kind: String,
    bytes: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryRevision {
    schema_version: u32,
    platforms: Vec<Platform>,
}

fn valid_asset_id(id: &str) -> bool {
    let Some((hash, extension)) = id.split_once('.') else {
        return false;
    };
    hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        && ["glb", "png", "jpg", "webp"].contains(&extension)
}

pub(crate) fn asset_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_asset_id(id) {
        return Err("Invalid asset ID".into());
    }
    Ok(root.join("assets").join(id))
}

fn inspect_glb(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 20
        || bytes.len() > MODEL_LIMIT
        || &bytes[..4] != b"glTF"
        || u32::from_le_bytes(bytes[4..8].try_into().unwrap()) != 2
        || u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize != bytes.len()
    {
        return Err("Use a self-contained GLB 2.0 model up to 128 MB".into());
    }
    let length = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    if &bytes[16..20] != b"JSON" || length > bytes.len() - 20 {
        return Err("Invalid GLB JSON chunk".into());
    }
    let json: serde_json::Value =
        serde_json::from_slice(&bytes[20..20 + length]).map_err(|e| e.to_string())?;
    for group in ["buffers", "images"] {
        if let Some(items) = json[group].as_array() {
            for item in items {
                if item["uri"]
                    .as_str()
                    .is_some_and(|uri| !uri.starts_with("data:"))
                {
                    return Err("GLB must embed every buffer and texture".into());
                }
            }
        }
    }
    if let Some(images) = json["images"].as_array() {
        for image in images {
            let supported = if let Some(uri) = image["uri"].as_str() {
                ["data:image/png;", "data:image/jpeg;", "data:image/webp;"]
                    .iter()
                    .any(|prefix| uri.to_ascii_lowercase().starts_with(prefix))
            } else {
                image["mimeType"]
                    .as_str()
                    .is_some_and(|mime| ["image/png", "image/jpeg", "image/webp"].contains(&mime))
            };
            if !supported {
                return Err("Model textures must be embedded PNG, JPEG or WebP images".into());
            }
        }
    }
    if let Some(items) = json["extensionsUsed"].as_array() {
        for item in items {
            if item.as_str().is_some_and(|name| {
                [
                    "KHR_draco_mesh_compression",
                    "KHR_texture_basisu",
                    "EXT_meshopt_compression",
                ]
                .contains(&name)
            }) {
                return Err("Export an uncompressed GLB without external decoders".into());
            }
        }
    }
    Ok(())
}

pub fn import_asset(
    root: &Path,
    name: String,
    kind: String,
    encoded: &str,
) -> Result<AssetReference, String> {
    let limit = match kind.as_str() {
        "model" => MODEL_LIMIT,
        "logo" => LOGO_LIMIT,
        _ => return Err("Unknown asset kind".into()),
    };
    if name.is_empty() || name.len() > 240 || encoded.len() > (limit / 3 + 1) * 4 {
        return Err("Asset name or file is too large".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err("Asset is too large".into());
    }
    let extension = if kind == "model" {
        inspect_glb(&bytes)?;
        "glb"
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "png"
    } else if bytes.starts_with(&[255, 216, 255]) {
        "jpg"
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "webp"
    } else {
        return Err("Use a PNG, JPEG or WebP logo".into());
    };
    let id = format!("{:x}.{extension}", Sha256::digest(&bytes));
    let path = asset_path(root, &id)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    if !path.exists() {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
    }
    if fs::read(&path).map_err(|e| e.to_string())? != bytes {
        return Err("Imported asset could not be verified".into());
    }
    Ok(AssetReference {
        id,
        name,
        kind,
        bytes: bytes.len(),
    })
}

pub fn read_asset(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    let path = asset_path(root, id)?;
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MODEL_LIMIT as u64 {
        return Err("Asset is too large".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    if !id.starts_with(&format!("{hash}.")) {
        return Err("Asset integrity check failed".into());
    }
    Ok(bytes)
}

pub fn validate_platform(
    root: &Path,
    platform: &Platform,
    base: &[Platform],
) -> Result<(), String> {
    if let Some(box_art) = platform.details.get("boxArt").filter(|v| !v.is_null()) {
        validate_box_art(root, box_art)?;
    }
    let id = &platform.id;
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        || (!base.iter().any(|p| p.id == *id) && !id.starts_with("user-"))
    {
        return Err("Invalid platform ID".into());
    }
    if platform.name.trim().is_empty()
        || platform.maker.trim().is_empty()
        || platform.name.chars().count() > 100
        || platform.maker.chars().count() > 100
    {
        return Err("Platform name and manufacturer must contain 1–100 characters".into());
    }
    if platform.color.len() != 7
        || !platform.color.starts_with('#')
        || !platform.color[1..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid accent colour".into());
    }
    if !platform
        .details
        .get("kind")
        .and_then(|v| v.as_str())
        .is_some_and(|v| ["console", "handheld", "hybrid", "arcade", "computer"].contains(&v))
    {
        return Err("Invalid hardware type".into());
    }
    let model = platform
        .details
        .get("model")
        .ok_or("Missing placeholder model")?;
    let profile = model["profile"]
        .as_str()
        .ok_or("Missing placeholder profile")?;
    if ![
        "bespoke",
        "cartridge",
        "disc",
        "tower",
        "vertical",
        "horizontal",
        "tablet",
        "clamshell",
        "dual",
        "controller",
        "keyboard",
        "visor",
        "arcade",
        "desktop",
    ]
    .contains(&profile)
        || (profile == "bespoke"
            && ![
                "gameboy",
                "nes",
                "megadrive",
                "playstation",
                "gamecube",
                "xbox",
                "wii",
            ]
            .contains(&id.as_str()))
    {
        return Err("Invalid placeholder profile".into());
    }
    if profile != "bespoke" {
        for field in ["width", "height", "depth"] {
            if !model[field]
                .as_f64()
                .is_some_and(|v| v.is_finite() && v > 0.0 && v <= 10.0)
            {
                return Err("Invalid placeholder dimensions".into());
            }
        }
    }
    for (key, kind) in [("logoFile", "logo"), ("modelFile", "model")] {
        if let Some(value) = platform.details.get(key).filter(|v| !v.is_null()) {
            let asset: AssetReference =
                serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
            if asset.kind != kind
                || !valid_asset_id(&asset.id)
                || (kind == "model") != asset.id.ends_with(".glb")
            {
                return Err("Invalid asset reference".into());
            }
            if fs::metadata(asset_path(root, &asset.id)?)
                .map_err(|e| e.to_string())?
                .len()
                != asset.bytes as u64
            {
                return Err("Missing or incomplete platform asset".into());
            }
        }
    }
    if serde_json::to_vec(platform)
        .map_err(|e| e.to_string())?
        .len()
        > 32768
    {
        return Err("Platform record is too large".into());
    }
    Ok(())
}

fn validate_box_art(root: &Path, value: &serde_json::Value) -> Result<(), String> {
    let defaults: serde_json::Value =
        serde_json::from_str(include_str!("../../box-art-defaults.json"))
            .map_err(|_| "Invalid Box Art defaults")?;
    let template = value["template"]
        .as_str()
        .ok_or("Missing Box Art template")?;
    if value["version"] != 1 || defaults["templates"].get(template).is_none() {
        return Err("Unsupported Box Art template".into());
    }
    fn vector(value: &serde_json::Value, count: usize, min: f64, max: f64) -> bool {
        value.as_array().is_some_and(|v| {
            v.len() == count
                && v.iter().all(|n| {
                    n.as_f64()
                        .is_some_and(|x| x.is_finite() && x >= min && x <= max)
                })
        })
    }
    if !vector(&value["rotation"], 3, -180.0, 180.0) {
        return Err("Invalid Box Art model rotation".into());
    }
    let materials = value["neutralMaterials"]
        .as_array()
        .ok_or("Invalid Box Art materials")?;
    if materials.len() > 16
        || materials
            .iter()
            .any(|v| !v.as_str().is_some_and(|s| s.chars().count() <= 100))
    {
        return Err("Invalid Box Art materials".into());
    }
    for slot in ["front", "back", "spine"] {
        let panel = &value["panels"][slot];
        if !panel["enabled"].is_boolean()
            || !vector(&panel["position"], 3, -5.0, 5.0)
            || !vector(&panel["rotation"], 3, -180.0, 180.0)
            || !vector(&panel["size"], 2, 0.01, 5.0)
        {
            return Err(format!("Invalid {slot} Box Art placement"));
        }
    }
    for key in ["source", "author", "license"] {
        if let Some(v) = value.get(key) {
            if !v.as_str().is_some_and(|s| s.chars().count() <= 2000) {
                return Err("Invalid Box Art credit".into());
            }
        }
    }
    if let Some(reference) = value.get("modelFile").filter(|v| !v.is_null()) {
        let asset: AssetReference = serde_json::from_value(reference.clone())
            .map_err(|_| "Invalid Box Art model reference")?;
        if asset.kind != "model" || !asset.id.ends_with(".glb") || !valid_asset_id(&asset.id) {
            return Err("Invalid Box Art model reference".into());
        }
        if read_asset(root, &asset.id)?.len() != asset.bytes {
            return Err("Incomplete Box Art model".into());
        }
    } else if template == "custom" {
        return Err("Choose a custom Box Art GLB".into());
    }
    Ok(())
}

pub fn load(root: &Path, base: &[Platform]) -> Result<Vec<Platform>, String> {
    let directory = root.join("revisions");
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut paths = fs::read_dir(directory)
        .map_err(|e| e.to_string())?
        .map(|entry| entry.map(|e| e.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    paths.retain(|p| p.extension().is_some_and(|e| e == "json"));
    paths.sort();
    let Some(path) = paths.last() else {
        return Ok(Vec::new());
    };
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > 16 * 1024 * 1024 {
        return Err("Platform registry is too large".into());
    }
    let revision: RegistryRevision =
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if revision.schema_version != 1 {
        return Err("Unsupported platform registry version".into());
    }
    let platforms = revision.platforms;
    let mut ids = std::collections::HashSet::new();
    for platform in &platforms {
        if !ids.insert(&platform.id) {
            return Err("Duplicate platform in registry".into());
        }
        validate_platform(root, platform, base)?;
    }
    Ok(platforms)
}

pub fn persist(root: &Path, platforms: &[Platform]) -> Result<(), String> {
    let bytes =
        serde_json::to_vec_pretty(&serde_json::json!({"schemaVersion": 1, "platforms": platforms}))
            .map_err(|e| e.to_string())?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("Platform registry is too large".into());
    }
    let directory = root.join("revisions");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let pending = directory.join(format!("{timestamp:032}.pending"));
    let committed = pending.with_extension("json");
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&pending)
        .map_err(|e| e.to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    drop(file);
    if fs::read(&pending).map_err(|e| e.to_string())? != bytes {
        return Err("Platform revision verification failed".into());
    }
    fs::rename(pending, &committed).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn commit(
    root: &Path,
    mut platform: Platform,
    base: &[Platform],
) -> Result<(Platform, Vec<Platform>), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("registry.lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock()
        .map_err(|_| "Another platform save is in progress. Try saving again.")?;
    validate_platform(root, &platform, base)?;
    let mut records = load(root, base)?;
    let existing = records.iter_mut().find(|p| p.id == platform.id);
    if existing
        .as_ref()
        .and_then(|p| p.details.get("recordRevision"))
        != platform.details.get("recordRevision")
    {
        return Err("This platform changed in another window. Reopen the application before editing it again.".into());
    }
    let revision = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos()
        .to_string();
    platform
        .details
        .insert("recordRevision".into(), serde_json::json!(revision));
    if let Some(record) = existing {
        *record = platform.clone();
    } else {
        records.push(platform.clone());
    }
    persist(root, &records)?;
    Ok((platform, records))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "horizon-editor-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn registry_revisions_restore_custom_platforms_without_mutating_the_baseline() {
        let root = temporary_root();
        let base = super::super::Carousel::new().platforms;
        let mut platform = base[0].clone();
        platform.id = "user-test-device".into();
        platform.name = "My own category".into();
        platform.details.insert("model".into(), serde_json::json!({"profile": "cartridge", "width": 3, "height": 0.4, "depth": 2, "color": "#778899"}));
        validate_platform(&root, &platform, &base).unwrap();
        persist(&root, &[platform.clone()]).unwrap();
        assert_eq!(load(&root, &base).unwrap()[0].name, "My own category");
        platform.name = "Edited category".into();
        persist(&root, &[platform.clone()]).unwrap();
        assert_eq!(load(&root, &base).unwrap()[0].name, "Edited category");
        assert_eq!(fs::read_dir(root.join("revisions")).unwrap().count(), 2);
        assert_eq!(base[0].name, "Game Boy");
        fs::write(
            root.join("revisions")
                .join("99999999999999999999999999999999.pending"),
            b"incomplete",
        )
        .unwrap();
        assert_eq!(load(&root, &base).unwrap()[0].name, "Edited category");
        platform.id = "unknown-bundled-id".into();
        assert!(validate_platform(&root, &platform, &base).is_err());
    }

    #[test]
    fn assets_are_content_addressed_verified_and_cannot_escape_storage() {
        let root = temporary_root();
        let bytes = b"\x89PNG\r\n\x1a\ntest-payload";
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        let asset = import_asset(&root, "logo.png".into(), "logo".into(), &encoded).unwrap();
        let again = import_asset(&root, "other-name.png".into(), "logo".into(), &encoded).unwrap();
        assert_eq!(asset.id, again.id);
        assert_eq!(read_asset(&root, &asset.id).unwrap(), bytes);
        assert!(read_asset(&root, "../../outside.glb").is_err());
        assert!(import_asset(&root, "wrong.glb".into(), "model".into(), &encoded).is_err());
        fs::write(asset_path(&root, &asset.id).unwrap(), b"changed").unwrap();
        assert!(read_asset(&root, &asset.id).is_err());
    }

    #[test]
    fn box_art_model_and_surface_placement_persist_and_invalid_changes_are_rejected() {
        let root = temporary_root();
        let base = super::super::Carousel::new().platforms;
        let mut platform = base.iter().find(|p| p.id == "playstation").unwrap().clone();
        let bytes = include_bytes!("../../public/games/models/templates/ps1-jewel.glb");
        let asset = import_asset(
            &root,
            "my-case.glb".into(),
            "model".into(),
            &base64::engine::general_purpose::STANDARD.encode(bytes),
        )
        .unwrap();
        let defaults: serde_json::Value =
            serde_json::from_str(include_str!("../../box-art-defaults.json")).unwrap();
        let mut value = serde_json::json!({"version":1,"template":"custom","modelFile":asset,"rotation":[0,90,0],"neutralMaterials":[],"panels":defaults["templates"]["ps1-jewel"]["panels"]});
        value["panels"]["front"]["position"] = serde_json::json!([0.2, 0.3, 0.4]);
        platform.details.insert("boxArt".into(), value.clone());
        let (mut saved, _) = commit(&root, platform, &base).unwrap();
        assert_eq!(load(&root, &base).unwrap()[0].details["boxArt"], value);
        saved.details.get_mut("boxArt").unwrap()["panels"]["front"]["size"] =
            serde_json::json!([0, 2]);
        assert!(commit(&root, saved, &base).is_err());
        assert_eq!(load(&root, &base).unwrap()[0].details["boxArt"], value);
        let mut bad = value.clone();
        bad["modelFile"]["id"] = serde_json::json!("../../outside.glb");
        assert!(validate_box_art(&root, &bad).is_err());
    }

    #[test]
    fn models_cannot_reference_external_files_or_network_resources() {
        let json = serde_json::to_vec(&serde_json::json!({"asset": {"version": "2.0"}, "buffers": [{"uri": "https://example.com/model.bin"}]})).unwrap();
        let mut bytes = b"glTF".to_vec();
        bytes.extend_from_slice(&2_u32.to_le_bytes());
        bytes.extend_from_slice(&((20 + json.len()) as u32).to_le_bytes());
        bytes.extend_from_slice(&(json.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"JSON");
        bytes.extend_from_slice(&json);
        assert!(inspect_glb(&bytes).is_err());
        bytes.truncate(12);
        assert!(inspect_glb(&bytes).is_err());
    }

    #[test]
    fn concurrent_editor_sessions_merge_unrelated_records_and_reject_stale_changes() {
        let root = temporary_root();
        let base = super::super::Carousel::new().platforms;
        let original = base[0].clone();
        let (saved, _) = commit(&root, original.clone(), &base).unwrap();
        let (_, records) = commit(&root, base[1].clone(), &base).unwrap();
        assert_eq!(records.len(), 2);
        assert!(commit(&root, original, &base).is_err());
        let mut edited = saved;
        edited.name = "Updated title".into();
        commit(&root, edited, &base).unwrap();
        let records = load(&root, &base).unwrap();
        assert_eq!(records[0].name, "Updated title");
        assert_eq!(records.len(), 2);
    }
}
