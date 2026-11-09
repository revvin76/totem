use base64::{engine::general_purpose::STANDARD, Engine};
mod rom_folders;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Instant,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub platform_id: String,
    pub title: String,
    pub search_title: String,
    pub release_year: Option<u16>,
    pub region: Option<String>,
    pub file_details: Vec<String>,
    pub description: String,
    pub artwork: String,
    pub cover_kind: String,
    pub video_mime: Option<String>,
    #[serde(skip)]
    path: Option<PathBuf>,
    #[serde(skip)]
    provenance: Option<Provenance>,
    #[serde(skip)]
    cover: Option<PathBuf>,
    #[serde(skip)]
    cartridge_front: Option<PathBuf>,
    #[serde(skip)]
    logo: Option<PathBuf>,
    #[serde(skip)]
    video: Option<PathBuf>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Timings {
    pub settings_manifest_ms: u128,
    pub fingerprint_ms: u128,
    pub indexing_ms: u128,
    pub snapshot_build_ms: u128,
    pub cache_serialization_ms: u128,
    pub cache_write_ms: u128,
    pub total_scan_ms: u128,
    pub cache_load_fingerprint_ms: u128,
    pub cache_read_ms: u128,
    pub cache_deserialize_ms: u128,
    pub cache_restore_ms: u128,
    pub total_cache_load_ms: u128,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub platform_counts: BTreeMap<String, usize>,
    pub total_games: usize,
    pub scanned_roots: usize,
    pub missing_roots: usize,
    pub warnings: Vec<String>,
    pub elapsed_ms: u128,
    #[serde(default)]
    pub directory_walk_ms: u128,
    #[serde(default)]
    pub path_sort_ms: u128,
    #[serde(default)]
    pub cached: bool,
    #[serde(default)]
    pub timings: Timings,
}
#[derive(Clone, Default)]
struct Snapshot {
    games: HashMap<String, Game>,
    platforms: HashMap<String, Vec<String>>,
    summary: Summary,
    fingerprint: Option<String>,
}

#[derive(Default)]
pub(crate) struct IndexedReadiness {
    pub count: usize,
    pub covers: usize,
    pub logos: usize,
    pub videos: usize,
    pub provenance: usize,
    pub command_files: usize,
    pub example_command_file: Option<PathBuf>,
}

pub(crate) struct SourceReadiness {
    pub path: PathBuf,
    pub availability: Option<bool>,
    pub optional: bool,
    pub extensions: Vec<String>,
    pub rules: Vec<String>,
}

pub(crate) struct LibraryReadiness {
    pub sources: HashMap<String, Vec<SourceReadiness>>,
    pub current: bool,
    pub counts: Option<HashMap<String, IndexedReadiness>>,
    pub summary: Summary,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedGame {
    id: String,
    platform_id: String,
    title: String,
    search_title: String,
    #[serde(default)]
    release_year: Option<u16>,
    #[serde(default)]
    region: Option<String>,
    #[serde(default)]
    file_details: Vec<String>,
    description: String,
    artwork: String,
    cover_kind: String,
    #[serde(default)]
    video_mime: Option<String>,
    #[serde(default)]
    path: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provenance: Option<Provenance>,
    cover: Option<PathBuf>,
    #[serde(default)]
    cartridge_front: Option<PathBuf>,
    logo: Option<PathBuf>,
    #[serde(default)]
    video: Option<PathBuf>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedSnapshot {
    version: u32,
    fingerprint: String,
    games: Vec<SavedGame>,
    platforms: HashMap<String, Vec<String>>,
    summary: Summary,
}
pub struct Service {
    root: PathBuf,
    cache_path: Option<PathBuf>,
    snapshot: Mutex<Snapshot>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Provenance {
    root: PathBuf,
    extension: String,
    admissions: Vec<Admission>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Admission {
    kind: String,
    collection_id: Option<String>,
    collection_name: Option<String>,
    rule: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct Root {
    platform: String,
    path: PathBuf,
    identity_path: Option<PathBuf>,
    extensions: HashSet<String>,
    admissions: Vec<(Admission, HashSet<String>)>,
    covers: Option<PathBuf>,
    cartridge_fronts: Option<PathBuf>,
    logos: Option<PathBuf>,
    videos: Option<PathBuf>,
    named_boxarts: Option<PathBuf>,
    reconstructed_box_fronts: Option<PathBuf>,
    family_covers: Option<PathBuf>,
    family_logos: Option<PathBuf>,
    family_videos: Option<PathBuf>,
    exclude_alternate_sources: bool,
    optional: bool,
    // Retain the original root for game identity and collection media while
    // limiting traversal to the replacement folders.
    scan_paths: Option<Vec<PathBuf>>,
    explicit: bool,
}

fn key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_lowercase()
}
fn identity_root(path: &Path) -> PathBuf {
    // Keep the canonical volume prefix even when the former ROM folder is gone.
    for ancestor in path.ancestors() {
        if let Ok(canonical) = fs::canonicalize(ancestor) {
            return canonical.join(path.strip_prefix(ancestor).unwrap());
        }
    }
    path.to_owned()
}
fn configuration_fingerprint(
    settings: &Value,
    manifest: &Value,
    overrides: &Value,
) -> Result<String, String> {
    let bytes = serde_json::to_vec(&(settings, manifest, overrides))
        .map_err(|_| "Cannot fingerprint library configuration.")?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_lowercase()
}
fn image_extension(path: &Path) -> bool {
    ["jpg", "jpeg", "png", "webp"].contains(&extension(path).as_str())
}
fn video_mime(path: &Path) -> Option<&'static str> {
    match extension(path).as_str() {
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        _ => None,
    }
}
fn stem(path: &Path) -> String {
    path.file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}
fn collection_extensions(collection: &Value) -> HashSet<String> {
    let values = collection["extensions"]
        .as_array()
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .or_else(|| {
            collection["extensions"]
                .as_str()
                .map(|value| value.split([',', ' ']).map(str::to_owned).collect())
        })
        .or_else(|| {
            collection["values"]["list.extensions"]
                .as_str()
                .map(|value| value.split([',', ' ']).map(str::to_owned).collect())
        })
        .unwrap_or_default();
    values
        .into_iter()
        .map(|value| value.trim().trim_start_matches('.').to_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}
fn collection_game_roots(collection: &Value) -> Vec<(PathBuf, Option<PathBuf>, &'static str)> {
    let game_roots = &collection["gameRoots"];
    let entries = game_roots
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_else(|| std::slice::from_ref(game_roots));
    let mut paths: Vec<_> = entries
        .iter()
        .filter(|entry| entry["active"] != false)
        .filter_map(|entry| {
            let path = PathBuf::from(entry["path"].as_str()?);
            let identity = entry["identityPath"]
                .as_str()
                .map(PathBuf::from)
                .filter(|p| {
                    p.is_absolute() && !p.components().any(|c| c == std::path::Component::ParentDir)
                });
            Some((path, identity, "imported"))
        })
        .collect();
    if let Some(path) = collection["configuredGamePath"]["resolved"].as_str() {
        paths.push((path.into(), None, "configured"));
    }
    paths
}

fn platform_asset_root(settings: &Value, manifest: &Value, platform: &str) -> Option<PathBuf> {
    if manifest["platformMediaLayouts"][platform] != "asset-tree-v1" {
        return None;
    }
    Some(
        Path::new(settings["paths"]["root"].as_str()?)
            .join("Assets/Platforms")
            .join(platform),
    )
}

#[derive(Default)]
struct FilenameMetadata {
    release_year: Option<u16>,
    region: Option<String>,
    details: Vec<String>,
}

fn filename_metadata_and_title(file_stem: &str) -> (String, FilenameMetadata) {
    let mut metadata = FilenameMetadata::default();
    let mut end = file_stem.trim_end().len();
    let mut boundary = end;
    let mut details = Vec::new();
    let mut pending_parenthetical = Vec::new();
    let mut year_boundary = None;

    loop {
        while end > 0 && file_stem[..end].chars().next_back().is_some_and(char::is_whitespace) {
            end -= file_stem[..end].chars().next_back().unwrap().len_utf8();
        }
        if end == 0 {
            break;
        }
        let closing = file_stem[..end].chars().next_back().unwrap();
        let opening = match closing {
            ']' => '[',
            ')' => '(',
            _ => break,
        };
        let Some(start) = file_stem[..end].rfind(opening) else {
            break;
        };
        let value = file_stem[start + opening.len_utf8()..end - closing.len_utf8()].trim();
        let lowered = value.to_ascii_lowercase();
        let year = (value.len() == 4)
            .then(|| value.parse::<u16>().ok())
            .flatten()
            .filter(|year| (1970..=2099).contains(year));
        let region = matches!(
            lowered.as_str(),
            "us" | "usa" | "u" | "united states" | "e" | "eu" | "eur" | "europe"
                | "uk" | "ukv" | "j" | "jp" | "japan" | "w" | "world" | "pal" | "ntsc"
                | "australia" | "au" | "korea" | "asia" | "canada" | "brazil" | "france"
                | "germany" | "italy" | "spain" | "china" | "taiwan"
        )
        .then(|| value.to_owned());
        let storage_tag = lowered.ends_with(" gb") || lowered.ends_with(" mb");
        let recognized = year.is_some() || region.is_some() || storage_tag;
        if opening == '[' {
            boundary = start;
            end = start;
            details.push(value.to_owned());
        } else if recognized {
            boundary = start;
            end = start;
            if let Some(year) = year {
                metadata.release_year.get_or_insert(year);
                year_boundary.get_or_insert(start);
            } else if let Some(region) = region {
                metadata.region.get_or_insert(region);
            } else {
                details.push(value.to_owned());
            }
        } else {
            pending_parenthetical.push((start, value.to_owned()));
            end = start;
        }
    }
    if let Some(year_boundary) = year_boundary {
        for (start, value) in pending_parenthetical {
            if start > year_boundary {
                details.push(value);
            }
        }
    }
    details.reverse();
    metadata.details = details;
    let mut title = file_stem[..boundary].trim().replace('_', " ");
    title = title.trim().to_owned();
    (title, metadata)
}

fn display_title(platform: &str, file_stem: &str) -> (String, FilenameMetadata) {
    let (mut title, metadata) = filename_metadata_and_title(file_stem);
    if ["switch", "switch2"].contains(&platform) {
        title = title.trim().to_owned();
    }
    match title.to_ascii_lowercase().as_str() {
        "super mario 3d world bowsers fury" => title = "Super Mario 3D World + Bowser's Fury".into(),
        "yoshis crafted world" => title = "Yoshi's Crafted World".into(),
        "luigi’s mansion 3" => title = "Luigi's Mansion 3".into(),
        _ => {}
    }
    (title, metadata)
}
fn artwork_base(stem: &str) -> String {
    let mut value = stem.to_lowercase();
    if value
        .rsplit_once('-')
        .is_some_and(|(_, suffix)| suffix == "01")
    {
        value.truncate(value.len() - 3);
    }
    value
}
fn artwork_title(stem: &str) -> String {
    let mut value = artwork_base(stem);
    if let Some(index) = value.rfind('(').filter(|_| value.ends_with(')')) {
        value.truncate(index);
    }
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}
fn artwork_region(stem: &str) -> Option<String> {
    let value = artwork_base(stem);
    let value = value.trim();
    let start = value.rfind('(')?;
    value.ends_with(')').then(|| {
        value[start + 1..value.len() - 1]
            .trim()
            .to_ascii_lowercase()
    })
}
fn named_boxart_index(
    directory: Option<&Path>,
    summary: &mut Summary,
) -> HashMap<String, Vec<PathBuf>> {
    let mut result: HashMap<String, Vec<PathBuf>> = HashMap::new();
    if let Some(directory) = directory.filter(|p| p.is_dir()) {
        for path in files(directory, summary, image_extension) {
            let title = artwork_title(&stem(&path));
            if !title.is_empty() {
                result.entry(title).or_default().push(path);
            }
        }
    }
    result
}
fn match_named_boxart(game_stem: &str, index: &HashMap<String, Vec<PathBuf>>) -> Option<PathBuf> {
    let candidates = index.get(&artwork_title(game_stem))?;
    let game_region = artwork_region(game_stem);
    let matching: Vec<_> = if let Some(region) = game_region {
        let regional: Vec<_> = candidates
            .iter()
            .filter(|path| artwork_region(&stem(path)).as_deref() == Some(region.as_str()))
            .collect();
        if !regional.is_empty() {
            regional
        } else {
            let unlabelled: Vec<_> = candidates
                .iter()
                .filter(|path| artwork_region(&stem(path)).is_none())
                .collect();
            if !unlabelled.is_empty() {
                unlabelled
            } else {
                candidates.iter().collect()
            }
        }
    } else {
        let unlabelled: Vec<_> = candidates
            .iter()
            .filter(|path| artwork_region(&stem(path)).is_none())
            .collect();
        if !unlabelled.is_empty() {
            unlabelled
        } else {
            candidates.iter().collect()
        }
    };
    matching
        .into_iter()
        .min_by_key(|path| {
            let name = stem(path).to_lowercase();
            let reconstructed_rank = if path
                .to_string_lossy()
                .to_lowercase()
                .contains("box-front-reconstructed")
            {
                0
            } else {
                1
            };
            let front_rank = if name.ends_with("-01") { 0 } else { 1 };
            let format_rank = if extension(path) == "png" { 0 } else { 1 };
            (
                reconstructed_rank,
                front_rank,
                format_rank,
                name.len(),
                name,
            )
        })
        .cloned()
}
fn search_title(file_stem: &str) -> String {
    let base = file_stem
        .split(['[', '('])
        .next()
        .unwrap_or(file_stem)
        .replace('_', " ");
    let mut result = String::with_capacity(base.len() + 2);
    let mut previous = None;
    for current in base.chars() {
        if previous.is_some_and(|c: char| c.is_ascii_lowercase()) && current.is_ascii_digit() {
            result.push(' ');
        }
        result.push(current);
        previous = Some(current);
    }
    result.trim().to_owned()
}
fn standalone_game(platform: &str, path: &Path) -> bool {
    if !["switch", "switch2"].contains(&platform) {
        return true;
    }
    if path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy().to_ascii_lowercase();
        name == "updates and dlc" || name.starts_with("nsz_v")
    }) {
        return false;
    }
    let name = stem(path).to_lowercase();
    if name.contains("[dlc]") || name.contains("[update]") {
        return false;
    }
    // Switch application title IDs end in 000; update/DLC packages use other offsets.
    for part in name.split('[').skip(1).filter_map(|v| v.split(']').next()) {
        if part.len() == 16
            && part.starts_with("0100")
            && part.bytes().all(|b| b.is_ascii_hexdigit())
            && !part.ends_with("000")
        {
            return false;
        }
    }
    true
}
fn warning(summary: &mut Summary, message: String) {
    if summary.warnings.len() < 100 {
        summary.warnings.push(message);
    }
}
fn is_reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}
fn files(root: &Path, summary: &mut Summary, include: impl Fn(&Path) -> bool) -> Vec<PathBuf> {
    let walk_started = Instant::now();
    let mut result = Vec::new();
    let mut pending = vec![(root.to_path_buf(), 0_usize)];
    while let Some((directory, depth)) = pending.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(v) => v,
            Err(_) => {
                warning(
                    summary,
                    format!("Cannot read folder: {}", directory.display()),
                );
                continue;
            }
        };
        for entry in entries {
            let Ok(entry) = entry else { continue };
            let path = entry.path();
            // DirEntry caches Windows metadata without following links. Keep
            // the reparse-point exclusion while avoiding a syscall per file.
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if is_reparse(&metadata) {
                continue;
            }
            if metadata.is_dir() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if depth < 32
                    && !["bios", "saves", "savestates", "screenshots", ".git"]
                        .contains(&name.as_str())
                {
                    pending.push((path, depth + 1));
                }
            } else if metadata.is_file() && include(&path) {
                result.push(path);
            }
        }
    }
    summary.directory_walk_ms += walk_started.elapsed().as_millis();
    let sort_started = Instant::now();
    result.sort_by_cached_key(|p| key(p));
    summary.path_sort_ms += sort_started.elapsed().as_millis();
    result
}
fn media_index(directory: Option<&Path>, summary: &mut Summary) -> HashMap<String, PathBuf> {
    let mut result = HashMap::new();
    if let Some(directory) = directory.filter(|p| p.is_dir()) {
        for path in files(directory, summary, image_extension) {
            // Exact, case-insensitive filename matching avoids borrowing another edition's art.
            result.entry(stem(&path).to_lowercase()).or_insert(path);
        }
    }
    result
}
fn video_index(directory: &Path, summary: &mut Summary) -> HashMap<String, PathBuf> {
    let mut result = HashMap::new();
    if directory.is_dir() {
        for path in files(directory, summary, |path| video_mime(path).is_some()) {
            result.entry(stem(&path).to_lowercase()).or_insert(path);
        }
    }
    result
}
fn companion_paths(path: &Path) -> Vec<String> {
    if !["m3u", "cue"].contains(&extension(path).as_str()) {
        return Vec::new();
    }
    let Ok(metadata) = fs::metadata(path) else {
        return Vec::new();
    };
    if metadata.len() > 128 * 1024 {
        return Vec::new();
    }
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&bytes);
    let mut result = Vec::new();
    for raw in text.lines() {
        let line = raw.trim().trim_start_matches('\u{feff}');
        let file = if extension(path) == "m3u" {
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            line.trim_matches('"').to_owned()
        } else {
            if !line.to_ascii_uppercase().starts_with("FILE ") {
                continue;
            }
            let rest = line[5..].trim();
            if let Some(quoted) = rest.strip_prefix('"') {
                quoted.split('"').next().unwrap_or("").to_owned()
            } else {
                rest.split_whitespace().next().unwrap_or("").to_owned()
            }
        };
        if !file.is_empty() {
            let reference = path.parent().unwrap_or(Path::new("")).join(file);
            if let Ok(resolved) = fs::canonicalize(reference) {
                result.push(key(&resolved));
            }
        }
    }
    result
}
fn roots(settings: &Value, manifest: &Value, ids: &[String]) -> Vec<Root> {
    let known: HashSet<_> = ids.iter().map(String::as_str).collect();
    let libraries = Path::new(settings["paths"]["platforms"].as_str().unwrap());
    let mut roots = Vec::new();
    let fallback_extensions: HashSet<String> = [
        "zip", "7z", "nes", "fds", "sfc", "smc", "gb", "gbc", "gba", "nds", "3ds", "n64", "z64",
        "v64", "md", "gen", "sms", "gg", "chd", "cue", "iso", "cso", "pbp", "m3u", "gdi", "cdi",
        "rvz", "wbfs", "wad", "wud", "wux", "rpx", "xci", "nsp", "adf", "lha", "uae", "d64", "tap",
        "tzx", "dsk", "rom", "a26", "a52", "a78", "jag", "lnx", "bat", "lnk", "exe",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    let collections = manifest["collections"].as_array().unwrap();
    let mut declared: HashMap<String, HashSet<String>> = HashMap::new();
    for collection in collections {
        let Some(platform) = collection["platformId"]
            .as_str()
            .filter(|p| known.contains(p))
        else {
            continue;
        };
        let extensions = collection_extensions(collection);
        declared
            .entry(platform.into())
            .or_default()
            .extend(extensions.clone());
        let (extensions, rule) = if extensions.is_empty() {
            (fallback_extensions.clone(), "fallback")
        } else {
            (extensions, "collection")
        };
        let covers = collection["media"]["covers"].as_str().map(PathBuf::from);
        let logos = collection["media"]["logos"].as_str().map(PathBuf::from);
        let videos = collection["media"]["videos"].as_str().map(PathBuf::from);
        let paths = collection_game_roots(collection);
        let family = libraries.join(platform).join("media");
        let asset_root = platform_asset_root(settings, manifest, platform);
        let family_path = |legacy: &str, migrated: &str| {
            Some(
                asset_root
                    .as_ref()
                    .map_or_else(|| family.join(legacy), |base| base.join(migrated)),
            )
        };
        for (path, identity_path, kind) in paths {
            roots.push(Root {
                platform: platform.into(),
                path,
                identity_path,
                extensions: extensions.clone(),
                admissions: vec![(
                    Admission {
                        kind: kind.into(),
                        collection_id: collection["id"].as_str().map(str::to_owned),
                        collection_name: collection["name"].as_str().map(str::to_owned),
                        rule: rule.into(),
                    },
                    extensions.clone(),
                )],
                covers: covers.clone(),
                cartridge_fronts: family_path("artwork/cart-front", "Artwork/Cart/Front"),
                logos: logos.clone(),
                videos: videos.clone(),
                named_boxarts: family_path(
                    "artwork/named-boxarts",
                    "Artwork/Box/Front/Variants/named-boxarts",
                ),
                reconstructed_box_fronts: family_path(
                    "artwork/box-front-reconstructed",
                    "Artwork/Box/Front/Variants/box-front-reconstructed",
                ),
                family_covers: family_path("covers", "Artwork/Box/Front"),
                family_logos: family_path("logos", "Artwork/Logo"),
                family_videos: family_path("videos", "Video"),
                exclude_alternate_sources: false,
                optional: false,
                scan_paths: None,
                explicit: false,
            });
        }
    }
    for id in ids {
        let base = libraries.join(id);
        let (extensions, rule) = match declared.get(id).filter(|v| !v.is_empty()) {
            Some(extensions) => (extensions.clone(), "platformCollections"),
            None => (fallback_extensions.clone(), "fallback"),
        };
        let media = base.join("media");
        let legacy_games = base.join("games");
        let asset_root = platform_asset_root(settings, manifest, id);
        let previous_games = manifest["romIdentityLibrary"]
            .as_str()
            .map(Path::new)
            .filter(|path| {
                path.is_absolute()
                    && !path
                        .components()
                        .any(|part| part == std::path::Component::ParentDir)
            })
            .map_or_else(|| legacy_games.clone(), |path| path.join(id).join("games"));
        let games = asset_root.as_ref().map_or_else(
            || legacy_games.clone(),
            |_| {
                Path::new(settings["paths"]["root"].as_str().unwrap())
                    .join("Roms")
                    .join(id)
            },
        );
        let family_path = |legacy: &str, migrated: &str| {
            Some(
                asset_root
                    .as_ref()
                    .map_or_else(|| media.join(legacy), |base| base.join(migrated)),
            )
        };
        roots.push(Root {
            platform: id.clone(),
            path: games,
            identity_path: asset_root.as_ref().map(|_| previous_games),
            admissions: vec![(
                Admission {
                    kind: "conventional".into(),
                    collection_id: None,
                    collection_name: None,
                    rule: rule.into(),
                },
                extensions.clone(),
            )],
            extensions,
            covers: family_path("covers", "Artwork/Box/Front"),
            cartridge_fronts: family_path("artwork/cart-front", "Artwork/Cart/Front"),
            logos: family_path("logos", "Artwork/Logo"),
            videos: family_path("videos", "Video"),
            named_boxarts: family_path(
                "artwork/named-boxarts",
                "Artwork/Box/Front/Variants/named-boxarts",
            ),
            reconstructed_box_fronts: family_path(
                "artwork/box-front-reconstructed",
                "Artwork/Box/Front/Variants/box-front-reconstructed",
            ),
            family_covers: family_path("covers", "Artwork/Box/Front"),
            family_logos: family_path("logos", "Artwork/Logo"),
            family_videos: family_path("videos", "Video"),
            exclude_alternate_sources: asset_root.is_some(),
            optional: true,
            scan_paths: None,
            explicit: false,
        });
    }
    roots
}

fn effective_roots(
    settings: &Value,
    manifest: &Value,
    overrides: &Value,
    ids: &[String],
) -> Vec<Root> {
    let mut configured_roots = roots(settings, manifest, ids);
    for id in ids {
        let source = &overrides["sources"][id];
        let Some(paths) = source["paths"].as_array() else {
            continue;
        };
        let paths: Vec<_> = paths
            .iter()
            .filter_map(Value::as_str)
            .map(PathBuf::from)
            .collect();
        let mut template = configured_roots
            .iter()
            .find(|root| root.platform == *id && root.optional)
            .expect("every platform has a conventional root")
            .clone();
        template.identity_path = None;
        template.exclude_alternate_sources = false;
        template.optional = false;
        template.explicit = true;
        template.admissions[0].0.kind = "explicit".into();
        if source["mode"] == "replace" {
            let canonical: Vec<_> = paths
                .iter()
                .filter_map(|path| fs::canonicalize(path).ok())
                .collect();
            for root in configured_roots
                .iter_mut()
                .filter(|root| root.platform == *id)
            {
                root.scan_paths = Some(canonical.clone());
            }
        }
        configured_roots.extend(paths.into_iter().map(|path| Root {
            path,
            ..template.clone()
        }));
    }
    apply_extension_overrides(&mut configured_roots, overrides);
    configured_roots
}

fn apply_extension_overrides(configured_roots: &mut [Root], overrides: &Value) {
    for root in configured_roots {
        if let Some(extensions) = overrides["platforms"][&root.platform].as_array() {
            root.extensions = extensions
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            for (admission, admitted_extensions) in &mut root.admissions {
                admission.rule = "override".into();
                admitted_extensions.clone_from(&root.extensions);
            }
        }
    }
}

fn read_import_manifest(settings: &Value) -> Result<Value, String> {
    let manifest = crate::library_settings::read_json(Path::new(
        settings["paths"]["manifest"].as_str().unwrap(),
    ))?;
    if !manifest["collections"].is_array() {
        return Err("Invalid library collection manifest.".into());
    }
    Ok(manifest)
}

pub(crate) fn load_rom_settings(
    root: &Path,
    settings: &Value,
    ids: &[String],
) -> Result<Value, String> {
    let mut overrides = crate::platform_extensions::load(root)?;
    if overrides.get("romFolders").is_some() {
        return Ok(overrides);
    }
    let manifest = read_import_manifest(settings)?;
    let expected = overrides["revision"].as_str().map(str::to_owned);
    let folders = rom_folders::migrate(settings, &manifest, &overrides, ids);
    overrides["romFolders"] = folders;
    overrides.as_object_mut().unwrap().remove("sources");
    match crate::platform_extensions::persist(root, overrides, expected.as_deref()) {
        Ok(saved) => Ok(saved),
        Err(error) => {
            let current = crate::platform_extensions::load(root)?;
            if current.get("romFolders").is_some() {
                Ok(current)
            } else {
                Err(error)
            }
        }
    }
}

pub(crate) fn edit_rom_folders(
    root: &Path,
    document: &mut Value,
    id: &str,
    folders: Vec<PathBuf>,
) -> Result<(), String> {
    let settings = crate::library_settings::load(root)?;
    let rom_settings = document
        .get_mut("romFolders")
        .ok_or("Reload ROM folder settings before saving.")?;
    rom_folders::edit(rom_settings, &settings, id, folders)
}

fn saved_scan_roots(overrides: &Value, ids: &[String]) -> Result<Vec<Root>, String> {
    let mut roots = rom_folders::configured(&overrides["romFolders"], ids)?;
    apply_extension_overrides(&mut roots, overrides);
    Ok(roots)
}

impl Service {
    #[cfg(test)]
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            cache_path: None,
            snapshot: Mutex::new(Snapshot::default()),
        }
    }
    pub fn new_with_cache(root: PathBuf, cache_path: PathBuf) -> Self {
        Self {
            root,
            cache_path: Some(cache_path),
            snapshot: Mutex::new(Snapshot::default()),
        }
    }
    fn configuration_fingerprint(&self) -> Result<String, String> {
        let settings = crate::library_settings::load(&self.root)?;
        let overrides = crate::platform_extensions::load(&self.root)?;
        let manifest = if overrides.get("romFolders").is_some() {
            Value::Null
        } else {
            read_import_manifest(&settings)?
        };
        configuration_fingerprint(&settings, &manifest, &overrides)
    }
    pub fn load_cached(&self) -> Result<Option<Summary>, String> {
        let started = Instant::now();
        let mut timings = Timings::default();
        let Some(path) = &self.cache_path else {
            return Ok(None);
        };
        let fingerprint = self.configuration_fingerprint()?;
        timings.cache_load_fingerprint_ms = started.elapsed().as_millis();
        let phase = Instant::now();
        match fs::metadata(path) {
            Ok(v) if v.is_file() && v.len() <= 64 * 1024 * 1024 => (),
            _ => return Ok(None),
        }
        let bytes = match fs::read(path) {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };
        timings.cache_read_ms = phase.elapsed().as_millis();
        let phase = Instant::now();
        let Ok(saved) = serde_json::from_slice::<SavedSnapshot>(&bytes) else {
            return Ok(None);
        };
        if saved.version != 3 || saved.fingerprint != fingerprint {
            return Ok(None);
        }
        timings.cache_deserialize_ms = phase.elapsed().as_millis();
        let phase = Instant::now();
        let games: HashMap<_, _> = saved
            .games
            .into_iter()
            .map(|g| {
                let (title, filename_metadata) = match g.path.as_deref() {
                    Some(path) => display_title(&g.platform_id, &stem(path)),
                    None => display_title(&g.platform_id, &g.title),
                };
                let search_title = search_title(&title);
                (
                    g.id.clone(),
                    Game {
                        id: g.id,
                        platform_id: g.platform_id,
                        title,
                        search_title,
                        release_year: g.release_year.or(filename_metadata.release_year),
                        region: g.region.or(filename_metadata.region),
                        file_details: if g.file_details.is_empty() {
                            filename_metadata.details
                        } else {
                            g.file_details
                        },
                        description: g.description,
                        artwork: g.artwork,
                        cover_kind: g.cover_kind,
                        video_mime: g.video_mime,
                        path: g.path,
                        provenance: g.provenance,
                        cover: g.cover,
                        cartridge_front: g.cartridge_front,
                        logo: g.logo,
                        video: g.video,
                    },
                )
            })
            .collect();
        if saved
            .platforms
            .values()
            .flatten()
            .any(|id| !games.contains_key(id))
        {
            return Ok(None);
        }
        let mut snapshot = Snapshot {
            games,
            platforms: saved.platforms,
            summary: saved.summary,
            fingerprint: Some(fingerprint),
        };
        timings.cache_restore_ms = phase.elapsed().as_millis();
        timings.total_cache_load_ms = started.elapsed().as_millis();
        snapshot.summary.timings = timings;
        snapshot.summary.cached = true;
        let summary = snapshot.summary.clone();
        *self
            .snapshot
            .lock()
            .map_err(|_| "Library index unavailable.")? = snapshot;
        Ok(Some(summary))
    }
    pub fn scan(&self, ids: &[String]) -> Result<Summary, String> {
        let started = Instant::now();
        let settings = crate::library_settings::load(&self.root)?;
        let overrides = load_rom_settings(&self.root, &settings, ids)?;
        let settings_manifest_ms = started.elapsed().as_millis();
        let phase = Instant::now();
        let fingerprint = configuration_fingerprint(&settings, &Value::Null, &overrides)?;
        let fingerprint_ms = phase.elapsed().as_millis();
        let phase = Instant::now();
        let configured_roots = saved_scan_roots(&overrides, ids)?;
        let mut snapshot = scan_roots(configured_roots);
        snapshot.fingerprint = Some(fingerprint.clone());
        snapshot.summary.timings.settings_manifest_ms = settings_manifest_ms;
        snapshot.summary.timings.fingerprint_ms = fingerprint_ms;
        snapshot.summary.timings.indexing_ms = phase.elapsed().as_millis();
        snapshot.summary.elapsed_ms = started.elapsed().as_millis();
        let mut snapshot = snapshot;
        snapshot.summary.cached = false;
        if let Some(path) = &self.cache_path {
            let phase = Instant::now();
            let saved = SavedSnapshot {
                version: 3,
                fingerprint,
                games: snapshot
                    .games
                    .values()
                    .map(|g| SavedGame {
                        id: g.id.clone(),
                        platform_id: g.platform_id.clone(),
                        title: g.title.clone(),
                        search_title: g.search_title.clone(),
                        release_year: g.release_year,
                        region: g.region.clone(),
                        file_details: g.file_details.clone(),
                        description: g.description.clone(),
                        artwork: g.artwork.clone(),
                        cover_kind: g.cover_kind.clone(),
                        video_mime: g.video_mime.clone(),
                        path: g.path.clone(),
                        provenance: g.provenance.clone(),
                        cover: g.cover.clone(),
                        cartridge_front: g.cartridge_front.clone(),
                        logo: g.logo.clone(),
                        video: g.video.clone(),
                    })
                    .collect(),
                platforms: snapshot.platforms.clone(),
                summary: snapshot.summary.clone(),
            };
            snapshot.summary.timings.snapshot_build_ms = phase.elapsed().as_millis();
            if let Err(error) = write_cache(path, &saved, &mut snapshot.summary.timings) {
                warning(
                    &mut snapshot.summary,
                    format!("Could not save library index cache: {error}"),
                );
            }
        }
        snapshot.summary.timings.total_scan_ms = started.elapsed().as_millis();
        let summary = snapshot.summary.clone();
        *self
            .snapshot
            .lock()
            .map_err(|_| "Library index unavailable.")? = snapshot;
        Ok(summary)
    }

    pub(crate) fn readiness(&self, ids: &[String]) -> Result<LibraryReadiness, String> {
        let settings = crate::library_settings::load(&self.root)?;
        let overrides = load_rom_settings(&self.root, &settings, ids)?;
        let fingerprint = configuration_fingerprint(&settings, &Value::Null, &overrides)?;
        let mut sources: HashMap<String, Vec<_>> = HashMap::new();
        for root in saved_scan_roots(&overrides, ids)?
            .into_iter()
            .filter(|root| root.scan_paths.is_none())
        {
            let availability = if !root.path.is_absolute()
                || root
                    .path
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                Some(false)
            } else {
                match fs::metadata(&root.path) {
                    Ok(metadata) => Some(metadata.is_dir()),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(false),
                    Err(_) => None,
                }
            };
            let mut extensions: Vec<_> = root.extensions.into_iter().collect();
            extensions.sort_unstable();
            let mut rules: Vec<_> = root
                .admissions
                .into_iter()
                .map(|(admission, _)| admission.rule)
                .collect();
            rules.sort_unstable();
            rules.dedup();
            sources
                .entry(root.platform)
                .or_default()
                .push(SourceReadiness {
                    path: root.path,
                    availability,
                    optional: root.optional,
                    extensions,
                    rules,
                });
        }

        let snapshot = self
            .snapshot
            .lock()
            .map_err(|_| "Library index unavailable.")?;
        let current = snapshot.fingerprint.as_ref() == Some(&fingerprint);
        let counts = snapshot.fingerprint.as_ref().map(|_| {
            let mut counts: HashMap<String, IndexedReadiness> = HashMap::new();
            for game in snapshot.games.values() {
                let entry = counts.entry(game.platform_id.clone()).or_default();
                entry.count += 1;
                entry.covers += usize::from(game.cover.is_some());
                entry.logos += usize::from(game.logo.is_some());
                entry.videos += usize::from(game.video.is_some());
                entry.provenance += usize::from(game.provenance.is_some());
                if let Some(path) = game
                    .path
                    .as_deref()
                    .filter(|path| matches!(extension(path).as_str(), "cmd" | "bat"))
                {
                    entry.command_files += 1;
                    if entry
                        .example_command_file
                        .as_deref()
                        .is_none_or(|current| path < current)
                    {
                        entry.example_command_file = Some(path.to_owned());
                    }
                }
            }
            counts
        });
        Ok(LibraryReadiness {
            sources,
            current,
            counts,
            summary: snapshot.summary.clone(),
        })
    }

    pub fn games(&self, platform: &str) -> Result<Vec<Game>, String> {
        let snapshot = self
            .snapshot
            .lock()
            .map_err(|_| "Library index unavailable.")?;
        Ok(snapshot
            .platforms
            .get(platform)
            .into_iter()
            .flatten()
            .filter_map(|id| snapshot.games.get(id))
            .cloned()
            .collect())
    }
    pub(crate) fn indexed_platforms(&self) -> Result<HashMap<String, String>, String> {
        let snapshot = self
            .snapshot
            .lock()
            .map_err(|_| "Library index unavailable.")?;
        Ok(snapshot
            .games
            .values()
            .map(|game| (game.id.clone(), game.platform_id.clone()))
            .collect())
    }
    pub fn video_path(&self, id: &str) -> Result<PathBuf, String> {
        let path = self
            .snapshot
            .lock()
            .map_err(|_| "Library index unavailable.")?
            .games
            .get(id)
            .and_then(|game| game.video.clone())
            .ok_or("No local video is available for this game.")?;
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !metadata.is_file() || is_reparse(&metadata) || metadata.len() > 100 * 1024 * 1024 {
            return Err("Local game video is unavailable or exceeds 100 MB.".into());
        }
        Ok(path)
    }
    pub fn game(&self, id: &str) -> Result<Value, String> {
        let snapshot = self
            .snapshot
            .lock()
            .map_err(|_| "Library index unavailable.")?;
        let game = snapshot
            .games
            .get(id)
            .ok_or("Game is not present in the current library index.")?;
        serde_json::to_value(game).map_err(|_| "Cannot read game entry.".into())
    }
    fn indexed_game(&self, id: &str) -> Result<Game, String> {
        if id.len() != 72
            || !id.strip_prefix("library-").is_some_and(|hash| {
                hash.bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            })
        {
            return Err("Invalid indexed game ID.".into());
        }
        self.snapshot
            .lock()
            .map_err(|_| "Library index unavailable.")?
            .games
            .get(id)
            .cloned()
            .ok_or_else(|| "Game is not present in the current library index.".into())
    }

    pub fn game_launch_target(&self, id: &str) -> Result<(String, PathBuf), String> {
        // Launch already restricts callers to entries in the current snapshot.
        let game = self
            .snapshot
            .lock()
            .map_err(|_| "Library index unavailable.")?
            .games
            .get(id)
            .cloned()
            .ok_or("Game is not present in the current library index.")?;
        let (status, reason) = game_file_status(game.path.as_deref());
        if status != "regularFile" {
            return Err(reason.into());
        }
        Ok((game.platform_id, game.path.unwrap()))
    }

    pub fn diagnostics(
        &self,
        id: &str,
        platform_name: impl FnOnce(&str) -> Option<String>,
    ) -> Result<Value, String> {
        let game = self.indexed_game(id)?;
        let (status, reason) = game_file_status(game.path.as_deref());
        let launch = crate::emulators::diagnostics(
            &self.root,
            &game.platform_id,
            game.path.as_deref(),
            (status != "regularFile").then_some(reason),
        );
        Ok(json!({
            "id": game.id,
            "title": game.title,
            "platformId": game.platform_id,
            "platformName": platform_name(&game.platform_id),
            "originalPath": game.path,
            "extension": game.path.as_deref().map(extension),
            "provenance": game.provenance,
            "fileStatus": status,
            "launch": launch,
        }))
    }
    pub fn thumbnail(&self, id: &str, artwork_type: &str) -> Result<Option<String>, String> {
        let game = self
            .snapshot
            .lock()
            .map_err(|_| "Library index unavailable.")?
            .games
            .get(id)
            .cloned()
            .ok_or("Unknown indexed game.")?;
        let directories: &[&str] = match artwork_type {
            "front-cover" => &["artwork-front", "artwork/box-front-reconstructed"],
            "back-cover" => &["artwork-back"],
            "3d-artwork" => &["covers"],
            "cartridge" => &["artwork/cart-front", "medium-front"],
            "disc" => &["medium-front"],
            "medium-back" => &["medium-back"],
            "logo" | "clear-logo" => &["logos"],
            "screenshot" => &["screenshot"],
            "title-screen" => &["screentitle"],
            "banner" => &["marquee"],
            "cabinet" => &["cabinets"],
            "bezel" => &["bezel"],
            "vertical" => &["vert"],
            _ => return Err("Unknown thumbnail artwork type.".into()),
        };
        if artwork_type == "front-cover" && game.cover.is_some() {
            return Ok(thumbnail_image(game.cover));
        }
        if artwork_type == "cartridge" && game.cartridge_front.is_some() {
            return Ok(thumbnail_image(game.cartridge_front));
        }
        if ["logo", "clear-logo"].contains(&artwork_type) && game.logo.is_some() {
            return Ok(thumbnail_image(game.logo));
        }
        if !game
            .platform_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err("Invalid platform ID.".into());
        }
        let settings = crate::library_settings::load(&self.root)?;
        let overrides = crate::platform_extensions::load(&self.root)?;
        let import_manifest;
        let media_layouts = match overrides.get("romFolders") {
            Some(folders) => folders,
            None => {
                import_manifest = read_import_manifest(&settings)?;
                &import_manifest
            }
        };
        let media = Path::new(
            settings["paths"]["platforms"]
                .as_str()
                .ok_or("Missing platform library root.")?,
        )
        .join(&game.platform_id)
        .join("media");
        let migrated: &[&str] = match artwork_type {
            "front-cover" => &["Artwork/Box/Front"],
            "back-cover" => &["Artwork/Box/Back"],
            "3d-artwork" => &["Artwork/Box/3D", "Artwork/Box/Front"],
            "cartridge" => &["Artwork/Cart/Front"],
            "disc" => &["Artwork/Disc"],
            "medium-back" => &["Artwork/Cart/Back"],
            "logo" | "clear-logo" => &["Artwork/Logo"],
            "screenshot" => &["Artwork/Screenshots/Gameplay"],
            "title-screen" => &["Artwork/Screenshots/Title"],
            "banner" => &["Artwork/Arcade/Marquee", "Artwork/Banner"],
            "cabinet" => &["Artwork/Arcade/Cabinet"],
            "bezel" => &["Artwork/Arcade/Bezel"],
            "vertical" => &["Artwork/Arcade/Vertical"],
            _ => &[],
        };
        let assets = platform_asset_root(&settings, media_layouts, &game.platform_id);
        let roots = assets
            .iter()
            .flat_map(|base| migrated.iter().map(|directory| base.join(directory)))
            .chain(directories.iter().map(|directory| media.join(directory)));
        for root in roots {
            let index = named_boxart_index(Some(&root), &mut Summary::default());
            if let Some(path) = match_named_boxart(&game.title, &index) {
                if let Some(image) = thumbnail_image(Some(path)) {
                    return Ok(Some(image));
                }
            }
        }
        Ok(None)
    }
    pub fn artwork(&self, id: &str) -> Result<Value, String> {
        let game = self
            .snapshot
            .lock()
            .map_err(|_| "Library index unavailable.")?
            .games
            .get(id)
            .cloned()
            .ok_or("Unknown indexed game.")?;
        Ok(
            json!({"cover":thumbnail_image(game.cover),"cartridgeFront":thumbnail_image(game.cartridge_front),"logo":thumbnail_image(game.logo)}),
        )
    }
}
fn game_file_status(path: Option<&Path>) -> (&'static str, &'static str) {
    let Some(path) = path else {
        return (
            "unrecorded",
            "Game path is unavailable. Rescan the library and try again.",
        );
    };
    match fs::symlink_metadata(path) {
        Ok(metadata) if is_reparse(&metadata) => {
            ("link", "Game file is unavailable or is not a regular file.")
        }
        Ok(metadata) if metadata.is_file() => ("regularFile", ""),
        Ok(metadata) if metadata.is_dir() => (
            "directory",
            "Game file is unavailable or is not a regular file.",
        ),
        Ok(_) => (
            "other",
            "Game file is unavailable or is not a regular file.",
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            ("missing", "Game file is unavailable.")
        }
        Err(_) => ("unavailable", "Game file is unavailable."),
    }
}

fn thumbnail_image(path: Option<PathBuf>) -> Option<String> {
    let path = path?;
    let metadata = fs::metadata(&path).ok()?;
    if metadata.len() > 8 * 1024 * 1024 {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    let format = image::guess_format(&bytes).ok()?;
    let mime = match format {
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::WebP => "image/webp",
        _ => return None,
    };
    let (w, h) = image::ImageReader::with_format(std::io::Cursor::new(&bytes), format)
        .into_dimensions()
        .ok()?;
    if w > 8192 || h > 8192 || (w as u64) * (h as u64) > 32_000_000 {
        return None;
    }
    image::load_from_memory_with_format(&bytes, format).ok()?;
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn write_cache(path: &Path, saved: &SavedSnapshot, timings: &mut Timings) -> Result<(), String> {
    let phase = Instant::now();
    let encoded = serde_json::to_vec(saved).map_err(|e| format!("{e}"));
    timings.cache_serialization_ms = phase.elapsed().as_millis();
    let bytes = encoded?;
    let phase = Instant::now();
    let result = write_cache_bytes(path, bytes);
    timings.cache_write_ms = phase.elapsed().as_millis();
    result
}
fn write_cache_bytes(path: &Path, bytes: Vec<u8>) -> Result<(), String> {
    let parent = path.parent().ok_or("Library cache path is invalid.")?;
    fs::create_dir_all(parent).map_err(|e| format!("{e}"))?;
    let temp = parent.join(format!("library-index-{}.pending", std::process::id()));
    fs::write(&temp, bytes).map_err(|e| format!("{e}"))?;
    fs::rename(&temp, path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("{e}")
    })
}
fn scan_roots(roots: Vec<Root>) -> Snapshot {
    let mut snapshot = Snapshot::default();
    let mut merged: BTreeMap<(bool, String, String), Root> = BTreeMap::new();
    let mut seen_games = HashSet::new();
    let mut media = HashMap::new();
    let mut named_boxart_media = HashMap::new();
    let mut video_media = HashMap::new();
    for mut root in roots {
        if !root.path.is_absolute()
            || root
                .path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            warning(
                &mut snapshot.summary,
                "A game folder has an invalid absolute path; it was skipped.".into(),
            );
            continue;
        }
        if !root.path.is_dir() {
            if !root.optional && root.scan_paths.is_none() {
                snapshot.summary.missing_roots += 1;
            }
            continue;
        }
        let Ok(canonical) = fs::canonicalize(&root.path) else {
            continue;
        };
        let group = (root.explicit, root.platform.clone(), key(&canonical));
        if root.scan_paths.as_ref().is_some_and(|paths| {
            !paths
                .iter()
                .any(|path| path.starts_with(&canonical) || canonical.starts_with(path))
        }) {
            continue;
        }
        if let Some(previous) = &root.identity_path {
            root.identity_path = Some(identity_root(previous));
        }
        root.path = canonical;
        if let Some(existing) = merged.get_mut(&group) {
            existing.extensions.extend(root.extensions);
            existing.admissions.extend(root.admissions);
            existing.exclude_alternate_sources |= root.exclude_alternate_sources;
            if existing.identity_path.is_none() {
                existing.identity_path = root.identity_path;
            }
            if existing.covers.as_ref().is_none_or(|p| !p.is_dir()) {
                existing.covers = root.covers;
            }
            if existing.logos.as_ref().is_none_or(|p| !p.is_dir()) {
                existing.logos = root.logos;
            }
            if existing.videos.as_ref().is_none_or(|p| !p.is_dir()) {
                existing.videos = root.videos;
            }
        } else {
            merged.insert(group, root);
        }
    }
    for root in merged.into_values() {
        if root.scan_paths.is_none() {
            snapshot.summary.scanned_roots += 1;
        }
        let mut named_boxarts = HashMap::new();
        for directory in [&root.named_boxarts, &root.reconstructed_box_fronts]
            .into_iter()
            .flatten()
        {
            let media_key = key(directory);
            if !named_boxart_media.contains_key(&media_key) {
                named_boxart_media.insert(
                    media_key.clone(),
                    named_boxart_index(Some(directory), &mut snapshot.summary),
                );
            }
            for (title, paths) in named_boxart_media.get(&media_key).into_iter().flatten() {
                named_boxarts
                    .entry(title.clone())
                    .or_insert_with(Vec::new)
                    .extend(paths.iter().cloned());
            }
        }
        let cartridge_fronts =
            named_boxart_index(root.cartridge_fronts.as_deref(), &mut snapshot.summary);
        let mut image_map = |folder: Option<&PathBuf>| {
            folder
                .map(|p| {
                    let k = key(p);
                    media
                        .entry(k)
                        .or_insert_with(|| media_index(Some(p), &mut snapshot.summary))
                        .clone()
                })
                .unwrap_or_default()
        };
        let mut covers = image_map(root.family_covers.as_ref());
        covers.extend(image_map(root.covers.as_ref()));
        let mut logos = image_map(root.family_logos.as_ref());
        logos.extend(image_map(root.logos.as_ref()));
        for directory in [&root.family_videos, &root.videos].into_iter().flatten() {
            // Preserve the configured path spelling in the returned media paths.
            let spelling = directory.as_os_str();
            if !video_media.contains_key(spelling) {
                video_media.insert(
                    spelling.to_owned(),
                    video_index(directory, &mut snapshot.summary),
                );
            }
        }
        let family_videos = root
            .family_videos
            .as_ref()
            .and_then(|path| video_media.get(path.as_os_str()));
        let videos = root
            .videos
            .as_ref()
            .and_then(|path| video_media.get(path.as_os_str()));
        // Alternate collections have their own extension rules and ID roots.
        let alternates = root.path.join("sources");
        let mut scan_paths = vec![root.path.as_path()];
        if let Some(paths) = &root.scan_paths {
            if !paths.iter().any(|path| root.path.starts_with(path)) {
                scan_paths = paths
                    .iter()
                    .filter(|path| path.starts_with(&root.path) && path.is_dir())
                    .map(PathBuf::as_path)
                    .collect();
            }
        }
        let candidates: Vec<_> = scan_paths
            .into_iter()
            .flat_map(|scan_path| {
                files(scan_path, &mut snapshot.summary, |path| {
                    !(root.exclude_alternate_sources && path.starts_with(&alternates))
                        && root.extensions.contains(&extension(path))
                        && standalone_game(&root.platform, path)
                })
            })
            .collect();
        let companions: HashSet<_> = candidates.iter().flat_map(|p| companion_paths(p)).collect();
        for path in candidates {
            let path_key = key(&path);
            if companions.contains(&path_key)
                || !seen_games.insert((root.platform.clone(), path_key.clone()))
            {
                continue;
            }
            let file_stem = stem(&path);
            let name = file_stem.to_lowercase();
            if ["neogeo", "pgm", "bios", "firmware"].contains(&name.as_str()) {
                continue;
            }
            let identity_key = root
                .identity_path
                .as_ref()
                .and_then(|previous| {
                    path.strip_prefix(&root.path)
                        .ok()
                        .map(|relative| key(&previous.join(relative)))
                })
                .unwrap_or(path_key);
            let id = format!(
                "library-{:x}",
                Sha256::digest(format!("{}\0{}", root.platform, identity_key).as_bytes())
            );
            let video = videos
                .and_then(|index| index.get(&name))
                .or_else(|| family_videos.and_then(|index| index.get(&name)))
                .cloned();
            let cover = covers
                .get(&name)
                .cloned()
                .or_else(|| match_named_boxart(&file_stem, &named_boxarts));
            let (title, filename_metadata) = display_title(&root.platform, &file_stem);
            let search_title = search_title(&title);
            let admitted_extension = extension(&path);
            let replacement_source = root
                .scan_paths
                .as_ref()
                .and_then(|paths| paths.iter().find(|source| path.starts_with(source)));
            let mut admissions: Vec<_> = root
                .admissions
                .iter()
                .filter(|(_, extensions)| extensions.contains(&admitted_extension))
                .map(|(admission, _)| admission.clone())
                .collect();
            if replacement_source.is_some() {
                admissions.push(Admission {
                    kind: "explicit".into(),
                    collection_id: None,
                    collection_name: None,
                    rule: admissions
                        .first()
                        .map_or("fallback", |entry| entry.rule.as_str())
                        .into(),
                });
            }
            let provenance = Provenance {
                root: replacement_source.unwrap_or(&root.path).clone(),
                admissions,
                extension: admitted_extension,
            };
            let game = Game {
                id: id.clone(),
                platform_id: root.platform.clone(),
                title,
                search_title,
                release_year: filename_metadata.release_year,
                region: filename_metadata.region,
                file_details: filename_metadata.details,
                description: "Game entry found in your configured library.".into(),
                artwork: if cover.is_some() {
                    "Local game artwork · generic back and spine"
                } else {
                    "Artwork missing · use Find missing artwork to fill available gaps"
                }
                .into(),
                cover_kind: "artwork".into(),
                video_mime: video.as_deref().and_then(video_mime).map(str::to_owned),
                path: Some(path.clone()),
                provenance: Some(provenance),
                cover,
                cartridge_front: match_named_boxart(&file_stem, &cartridge_fronts),
                logo: logos.get(&name).cloned(),
                video,
            };
            snapshot
                .platforms
                .entry(root.platform.clone())
                .or_default()
                .push(id.clone());
            snapshot.games.insert(id, game);
        }
    }
    for (id, games) in &mut snapshot.platforms {
        games.sort_by(|a, b| {
            snapshot.games[a]
                .title
                .to_lowercase()
                .cmp(&snapshot.games[b].title.to_lowercase())
                .then(a.cmp(b))
        });
        snapshot
            .summary
            .platform_counts
            .insert(id.clone(), games.len());
    }
    snapshot.summary.total_games = snapshot.games.len();
    snapshot
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("horizon-library-index-{stamp}"));
        fs::create_dir_all(&root).unwrap();
        root
    }
    fn root(platform: &str, path: PathBuf, extensions: &[&str]) -> Root {
        Root {
            platform: platform.into(),
            path,
            identity_path: None,
            extensions: extensions.iter().map(|v| v.to_string()).collect(),
            admissions: Vec::new(),
            covers: None,
            cartridge_fronts: None,
            logos: None,
            videos: None,
            named_boxarts: None,
            reconstructed_box_fronts: None,
            family_covers: None,
            family_logos: None,
            family_videos: None,
            exclude_alternate_sources: false,
            optional: false,
            scan_paths: None,
            explicit: false,
        }
    }
    #[test]
    fn scan_prefers_collection_video_and_falls_back_to_shared_family_video() {
        let base = fixture();
        let first = base.join("first");
        let second = base.join("second");
        let family = base.join("family-videos");
        let collection = base.join("collection-videos");
        for directory in [&first, &second, &family, &collection] {
            fs::create_dir_all(directory).unwrap();
        }
        for file in [
            first.join("Primary.nes"),
            first.join("Family.nes"),
            second.join("Shared.nes"),
            family.join("Primary.webm"),
            family.join("Family.webm"),
            family.join("Shared.webm"),
            collection.join("Primary.mp4"),
            collection.join("Shared.txt"),
        ] {
            fs::write(file, []).unwrap();
        }
        let mut first = root("nes", first, &["nes"]);
        let mut second = root("nes", second, &["nes"]);
        first.family_videos = Some(family.clone());
        second.family_videos = Some(family.clone());
        first.videos = Some(collection.clone());
        second.videos = Some(collection.clone());
        let snapshot = scan_roots(vec![first, second]);
        assert_eq!(snapshot.summary.total_games, 3);
        for (title, video) in [
            ("Primary", collection.join("Primary.mp4")),
            ("Family", family.join("Family.webm")),
            ("Shared", family.join("Shared.webm")),
        ] {
            let game = snapshot.games.values().find(|game| game.title == title).unwrap();
            assert_eq!(game.video.as_deref(), Some(video.as_path()));
        }
    }
    #[test]
    fn diagnostics_distinguish_imported_cmd_roots_and_report_a_configured_windows_executable() {
        let base = fixture();
        let left = base.join("imported/left");
        let right = base.join("imported/right");
        let configured = base.join("configured");
        for path in [&left, &right, &configured] {
            fs::create_dir_all(path).unwrap();
        }
        fs::write(left.join("Same.cmd"), b"fixture left").unwrap();
        fs::write(right.join("Same.cmd"), b"fixture right").unwrap();
        fs::write(configured.join("Tool.exe"), b"fixture executable").unwrap();
        let settings = json!({"paths":{"root":base,"platforms":base.join("platforms")}});
        let manifest = json!({"collections":[
            {"id":"left","name":"Left collection","platformId":"windows","extensions":["cmd"],
                "gameRoots":{"path":left}},
            {"id":"right","name":"Right collection","platformId":"windows","extensions":["cmd"],
                "gameRoots":{"path":right}},
            {"id":"windows-tools","platformId":"windows","extensions":["exe"],
                "configuredGamePath":{"resolved":configured}},
            {"id":"unrelated-rule","platformId":"windows","extensions":["bat"],
                "gameRoots":{"path":left}}
        ]});
        let service = Service::new(base.clone());
        *service.snapshot.lock().unwrap() =
            scan_roots(roots(&settings, &manifest, &["windows".into()]));
        let games = service.games("windows").unwrap();
        assert_eq!(games.len(), 3);
        for (path, collection, kind, ext) in [
            (left.join("Same.cmd"), "left", "imported", "cmd"),
            (right.join("Same.cmd"), "right", "imported", "cmd"),
            (
                configured.join("Tool.exe"),
                "windows-tools",
                "configured",
                "exe",
            ),
        ] {
            let canonical = fs::canonicalize(&path).unwrap();
            let expected_id = format!(
                "library-{:x}",
                Sha256::digest(format!("windows\0{}", key(&canonical)).as_bytes())
            );
            let game = games.iter().find(|game| game.id == expected_id).unwrap();
            let dto = serde_json::to_value(game).unwrap();
            assert!(dto.get("path").is_none() && dto.get("provenance").is_none());
            let data = service
                .diagnostics(&game.id, |_| Some("Edited Windows name".into()))
                .unwrap();
            assert_eq!(data["platformName"], "Edited Windows name");
            assert_eq!(data["originalPath"], json!(canonical));
            assert_eq!(data["fileStatus"], "regularFile");
            assert_eq!(
                data["provenance"]["root"],
                json!(canonical.parent().unwrap())
            );
            assert_eq!(data["provenance"]["extension"], ext);
            assert_eq!(
                data["provenance"]["admissions"].as_array().unwrap().len(),
                1
            );
            assert_eq!(
                data["provenance"]["admissions"][0]["collectionId"],
                collection
            );
            assert_eq!(data["provenance"]["admissions"][0]["kind"], kind);
            assert_eq!(data["provenance"]["admissions"][0]["rule"], "collection");
            assert_eq!(data["launch"]["status"], "noEnabledEmulator");
        }
        assert_eq!(games.iter().filter(|game| game.title == "Same").count(), 2);
        let missing = games
            .iter()
            .find(|game| game.path.as_ref().unwrap().ends_with("Tool.exe"))
            .unwrap();
        let path = missing.path.as_ref().unwrap();
        fs::remove_file(path).unwrap();
        let data = service.diagnostics(&missing.id, |_| None).unwrap();
        assert_eq!(data["fileStatus"], "missing");
        assert_eq!(data["launch"]["status"], "gameFileUnavailable");
        fs::create_dir(path).unwrap();
        assert_eq!(
            service.diagnostics(&missing.id, |_| None).unwrap()["fileStatus"],
            "directory"
        );
        assert!(service
            .diagnostics("C:/arbitrary/file.exe", |_| None)
            .is_err());
        assert!(service
            .diagnostics(&format!("library-{}", "0".repeat(64)), |_| None)
            .is_err());
        assert!(!base.join("config").exists());
        assert_eq!(fs::read(left.join("Same.cmd")).unwrap(), b"fixture left");
        assert_eq!(fs::read(right.join("Same.cmd")).unwrap(), b"fixture right");
    }

    #[test]
    fn asset_tree_move_preserves_game_ids_and_fallback_extensions() {
        let base = fixture();
        let libraries = base.join("library/platforms");
        let old = libraries.join("arcade/games");
        let old_roms = old.join("roms");
        fs::create_dir_all(&old_roms).unwrap();
        fs::write(old_roms.join("game.zip"), b"data").unwrap();
        fs::write(old_roms.join("disc.chd"), b"data").unwrap();
        let mut settings = json!({"paths":{"root":base,"platforms":libraries}});
        let old_alternate = libraries.join("arcade/sources/alternate/games/roms");
        fs::create_dir_all(&old_alternate).unwrap();
        fs::write(old_alternate.join("game.zip"), b"alternate data").unwrap();
        let mut manifest = json!({"collections":[
            {"platformId":"arcade","extensions":"zip","gameRoots":{"path":old_roms}},
            {"platformId":"arcade","extensions":"chd"},
            {"platformId":"arcade","extensions":"zip","gameRoots":{"path":old_alternate}}
        ]});
        let ids = ["arcade".to_owned()];
        let before = scan_roots(roots(&settings, &manifest, &ids));
        assert_eq!(before.platforms["arcade"].len(), 3);

        let roms = base.join("Roms/arcade");
        fs::create_dir_all(roms.parent().unwrap()).unwrap();
        fs::rename(&old, &roms).unwrap();
        let alternate = roms.join("sources/alternate/roms");
        fs::create_dir_all(alternate.parent().unwrap()).unwrap();
        fs::rename(&old_alternate, &alternate).unwrap();
        settings["paths"]["platforms"] = json!(roms.parent().unwrap());
        manifest["platformMediaLayouts"] = json!({"arcade":"asset-tree-v1"});
        manifest["romIdentityLibrary"] = json!(libraries);
        manifest["collections"][0]["gameRoots"] =
            json!({"path":roms.join("roms"),"identityPath":old_roms});
        manifest["collections"][2]["gameRoots"] =
            json!({"path":alternate,"identityPath":old_alternate});

        let after = scan_roots(roots(&settings, &manifest, &ids));
        assert_eq!(after.platforms["arcade"], before.platforms["arcade"]);
        for game in after.games.values() {
            assert!(game
                .path
                .as_ref()
                .unwrap()
                .starts_with(fs::canonicalize(&roms).unwrap()));
        }
    }
    #[test]
    fn old_summary_loads_with_default_phase_timings() {
        let mut old = serde_json::to_value(Summary::default()).unwrap();
        old.as_object_mut().unwrap().remove("timings");
        old.as_object_mut().unwrap().remove("directoryWalkMs");
        old.as_object_mut().unwrap().remove("pathSortMs");
        let summary: Summary = serde_json::from_value(old).unwrap();
        assert_eq!(summary.timings.total_scan_ms, 0);
        assert_eq!(summary.timings.total_cache_load_ms, 0);
    }
    #[test]
    fn explicit_sources_preserve_existing_identity_and_media_and_leave_other_platforms_alone() {
        let base = fixture();
        let platforms = base.join("platforms");
        let imported = base.join("imported");
        let host = imported.join("Host");
        let other = platforms.join("nes/games");
        let added = base.join("added");
        let covers = base.join("covers");
        for folder in [&host, &other, &added, &covers] {
            fs::create_dir_all(folder).unwrap();
        }
        for file in [
            host.join("Game.uae"),
            host.join("Support.adf"),
            imported.join("Outside.uae"),
            other.join("Other.nes"),
            added.join("Added.uae"),
            covers.join("Game.png"),
        ] {
            fs::write(file, b"fixture").unwrap();
        }
        let settings = json!({"paths":{"root": base, "platforms": platforms}});
        let manifest = json!({"collections":[{
            "id":"fixture", "platformId":"amiga500", "extensions":["uae", "adf"],
            "gameRoots":[{"path":imported,"identityPath":base.join("old")}],
            "media":{"covers":covers}
        }]});
        let ids = ["amiga500".into(), "nes".into()];
        let mut overrides = crate::platform_extensions::initial();
        let scan =
            |overrides: &Value| scan_roots(effective_roots(&settings, &manifest, overrides, &ids));
        let before = scan(&overrides);
        let before_game = before
            .games
            .values()
            .find(|game| game.title == "Game")
            .unwrap();
        overrides = crate::platform_extensions::save_settings(
            &base,
            "amiga500",
            None,
            Some(json!({"mode":"add","paths":[added]})),
            None,
        )
        .unwrap();
        assert_eq!(scan(&overrides).summary.total_games, 5);
        overrides = crate::platform_extensions::save_settings(
            &base,
            "amiga500",
            Some(vec!["uae".into()]),
            Some(json!({"mode":"replace","paths":[host]})),
            overrides["revision"].as_str(),
        )
        .unwrap();
        let replaced = scan(&crate::platform_extensions::load(&base).unwrap());
        assert_eq!(replaced.summary.total_games, 2);
        let retained = &replaced.games[&before_game.id];
        assert_eq!(retained.cover, before_game.cover);
        assert!(retained.cover.is_some());
        assert_eq!(
            retained.provenance.as_ref().unwrap().root,
            fs::canonicalize(&host).unwrap()
        );
        assert!(host.join("Support.adf").is_file());
        assert!(imported.join("Outside.uae").is_file());
        assert!(added.join("Added.uae").is_file());
        assert!(crate::platform_extensions::save_settings(
            &base,
            "amiga500",
            None,
            Some(json!({"mode":"add","paths":[]})),
            None
        )
        .is_err());
        let restored = crate::platform_extensions::save_settings(
            &base,
            "amiga500",
            None,
            Some(json!({"mode":"add","paths":[]})),
            overrides["revision"].as_str(),
        )
        .unwrap();
        assert_eq!(scan(&restored).summary.total_games, 3);
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn edited_platform_extensions_control_scanning_and_invalidate_cached_games() {
        let base = fixture();
        let revisions = base.join("config/library-settings/revisions");
        fs::create_dir_all(&revisions).unwrap();
        let manifest = base.join("manifest.json");
        fs::write(&manifest, br#"{"collections":[]}"#).unwrap();
        let mut paths = serde_json::Map::new();
        for name in [
            "root",
            "platforms",
            "collections",
            "playlists",
            "models",
            "artworkCache",
            "legacy",
        ] {
            paths.insert(name.into(), json!(base.join(name)));
        }
        paths.insert("manifest".into(), json!(manifest));
        fs::write(
            revisions.join("00000000000000000000000000000001.json"),
            serde_json::to_vec(&json!({"schemaVersion":1,"revision":"fixture","paths":paths}))
                .unwrap(),
        )
        .unwrap();
        let games = base.join("platforms/nes/games");
        fs::create_dir_all(&games).unwrap();
        fs::write(games.join("NES game.nes"), b"fixture").unwrap();
        fs::write(games.join("ZIP game.zip"), b"fixture").unwrap();
        let cache = base.join("index.json");
        let ids = vec!["nes".to_owned()];
        let service = Service::new_with_cache(base.clone(), cache.clone());
        assert!(service.readiness(&ids).unwrap().counts.is_none());
        assert!(!cache.exists());
        assert_eq!(service.scan(&ids).unwrap().total_games, 2);
        let indexed = service.readiness(&ids).unwrap();
        assert!(indexed.current);
        assert_eq!(indexed.counts.unwrap()["nes"].count, 2);
        let cache_before = fs::read(&cache).unwrap();
        let ids_before: Vec<_> = service
            .games("nes")
            .unwrap()
            .into_iter()
            .map(|game| game.id)
            .collect();
        let migrated = crate::platform_extensions::load(&base).unwrap();
        crate::platform_extensions::save(
            &base,
            "nes",
            vec!["nes".to_owned()],
            migrated["revision"].as_str(),
        )
        .unwrap();
        let stale = service.readiness(&ids).unwrap();
        assert!(!stale.current);
        assert_eq!(stale.counts.unwrap()["nes"].count, 2);
        assert_eq!(stale.sources["nes"][0].extensions, ["nes"]);
        assert_eq!(fs::read(&cache).unwrap(), cache_before);
        assert_eq!(
            service
                .games("nes")
                .unwrap()
                .into_iter()
                .map(|game| game.id)
                .collect::<Vec<_>>(),
            ids_before,
        );
        assert_eq!(fs::read(games.join("NES game.nes")).unwrap(), b"fixture");
        assert_eq!(fs::read(games.join("ZIP game.zip")).unwrap(), b"fixture");
        assert!(service.load_cached().unwrap().is_none());
        assert_eq!(service.scan(&ids).unwrap().total_games, 1);
        let reopened = Service::new_with_cache(base.clone(), cache);
        assert_eq!(reopened.load_cached().unwrap().unwrap().total_games, 1);
        assert_eq!(base.parent(), Some(std::env::temp_dir().as_path()));
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn saved_cache_uses_the_same_extension_configuration_as_its_reader() {
        let base = fixture();
        let revisions = base.join("config/library-settings/revisions");
        fs::create_dir_all(&revisions).unwrap();
        let manifest = base.join("manifest.json");
        fs::write(&manifest, br#"{"collections":[]}"#).unwrap();
        let mut paths = serde_json::Map::new();
        for name in [
            "root",
            "platforms",
            "collections",
            "playlists",
            "models",
            "artworkCache",
            "legacy",
        ] {
            paths.insert(name.into(), json!(base.join(name)));
        }
        paths.insert("manifest".into(), json!(manifest));
        fs::write(
            revisions.join("00000000000000000000000000000001.json"),
            serde_json::to_vec(&json!({"schemaVersion":1,"revision":"initial","paths":paths}))
                .unwrap(),
        )
        .unwrap();
        let games = base.join("platforms").join("nes").join("games");
        fs::create_dir_all(&games).unwrap();
        fs::write(games.join("NES game.nes"), b"fixture").unwrap();
        fs::write(games.join("ZIP game.zip"), b"fixture").unwrap();
        let cache_path = base.join("cache.json");
        let service = Service::new_with_cache(base.clone(), cache_path.clone());
        let ids = vec!["nes".into()];
        assert_eq!(service.scan(&ids).unwrap().total_games, 2);
        let saved: SavedSnapshot = serde_json::from_slice(&fs::read(&cache_path).unwrap()).unwrap();
        assert_eq!(
            saved.fingerprint,
            service.configuration_fingerprint().unwrap()
        );
        assert_eq!(
            service.configuration_fingerprint().unwrap(),
            service.configuration_fingerprint().unwrap()
        );
        assert!(service.load_cached().unwrap().unwrap().cached);
        let migrated = crate::platform_extensions::load(&base).unwrap();
        assert_eq!(
            migrated["romFolders"]["platforms"]["nes"]["paths"],
            json!([games])
        );
        fs::remove_file(manifest).unwrap();
        let overridden = crate::platform_extensions::save(
            &base,
            "nes",
            vec!["nes".into()],
            migrated["revision"].as_str(),
        )
        .unwrap();
        assert!(service.load_cached().unwrap().is_none());
        assert_eq!(service.scan(&ids).unwrap().total_games, 1);
        assert_eq!(service.games("nes").unwrap()[0].title, "NES game");
        let reloaded = Service::new_with_cache(base.clone(), cache_path.clone());
        assert_eq!(reloaded.load_cached().unwrap().unwrap().total_games, 1);
        let id = reloaded.games("nes").unwrap()[0].id.clone();
        let cache_bytes = fs::read(&cache_path).unwrap();
        let data = reloaded.diagnostics(&id, |_| None).unwrap();
        assert_eq!(data["provenance"]["admissions"][0]["rule"], "override");
        assert_eq!(data["provenance"]["admissions"][0]["kind"], "conventional");
        assert_eq!(fs::read(&cache_path).unwrap(), cache_bytes);

        // Exercise a version-3 cache created before provenance was recorded.
        let mut old: Value = serde_json::from_slice(&cache_bytes).unwrap();
        for game in old["games"].as_array_mut().unwrap() {
            game.as_object_mut().unwrap().remove("provenance");
        }
        let old_bytes = serde_json::to_vec(&old).unwrap();
        fs::write(&cache_path, &old_bytes).unwrap();
        assert!(reloaded.load_cached().unwrap().unwrap().cached);
        let data = reloaded.diagnostics(&id, |_| None).unwrap();
        assert!(data["provenance"].is_null());
        assert_eq!(data["extension"], "nes");
        assert_eq!(data["fileStatus"], "regularFile");
        assert_eq!(fs::read(&cache_path).unwrap(), old_bytes);
        crate::platform_extensions::save(
            &base,
            "nes",
            vec!["zip".into()],
            overridden["revision"].as_str(),
        )
        .unwrap();
        assert!(reloaded.load_cached().unwrap().is_none());
        assert_eq!(reloaded.scan(&ids).unwrap().total_games, 1);
        assert_eq!(reloaded.games("nes").unwrap()[0].title, "ZIP game");
        assert!(reloaded.load_cached().unwrap().is_some());
    }
    #[test]
    fn failed_cache_write_warning_is_returned_without_losing_scan() {
        let base = fixture();
        let revisions = base.join("config/library-settings/revisions");
        fs::create_dir_all(&revisions).unwrap();
        let manifest = base.join("manifest.json");
        fs::write(&manifest, br#"{"collections":[]}"#).unwrap();
        let mut paths = serde_json::Map::new();
        for name in [
            "root",
            "platforms",
            "collections",
            "playlists",
            "models",
            "artworkCache",
            "legacy",
        ] {
            paths.insert(name.into(), json!(base.join(name)));
        }
        paths.insert("manifest".into(), json!(manifest));
        fs::write(
            revisions.join("00000000000000000000000000000001.json"),
            serde_json::to_vec(&json!({"schemaVersion":1,"revision":"initial","paths":paths}))
                .unwrap(),
        )
        .unwrap();
        let blocked = base.join("blocked");
        fs::write(&blocked, b"file cannot be a cache parent directory").unwrap();
        let service = Service::new_with_cache(base, blocked.join("library.json"));
        let summary = service.scan(&[]).unwrap();
        assert_eq!(summary.total_games, 0);
        assert!(summary
            .warnings
            .iter()
            .any(|w| w.contains("Could not save library index cache")));
        assert!(summary.timings.total_scan_ms >= summary.elapsed_ms);
        assert_eq!(
            service.snapshot.lock().unwrap().summary.warnings,
            summary.warnings
        );
    }
    #[test]
    fn only_present_supported_game_files_enable_platforms_and_duplicate_roots_merge_extensions() {
        let base = fixture();
        let games = base.join("games");
        let empty = base.join("empty");
        fs::create_dir_all(games.join("nested")).unwrap();
        fs::create_dir_all(&empty).unwrap();
        fs::write(games.join("Alpha.NES"), b"user-game-fixture").unwrap();
        fs::write(games.join("nested/Beta.zip"), b"game-fixture").unwrap();
        fs::write(games.join("readme.txt"), b"notes").unwrap();
        fs::write(games.join("cover.png"), b"art").unwrap();
        let scan = scan_roots(vec![
            root("nes", games.clone(), &["nes"]),
            root("nes", games.clone(), &["zip"]),
            root("wii", empty, &["iso"]),
            root("ps3", base.join("missing"), &["iso"]),
        ]);
        assert_eq!(scan.summary.total_games, 2);
        assert_eq!(scan.summary.platform_counts.get("nes"), Some(&2));
        assert!(!scan.summary.platform_counts.contains_key("wii"));
        assert!(!scan.summary.platform_counts.contains_key("ps3"));
        assert_eq!(scan.summary.scanned_roots, 2);
        assert_eq!(scan.summary.missing_roots, 1);
        let ids: HashSet<_> = scan.games.keys().cloned().collect();
        let again = scan_roots(vec![root("nes", games.clone(), &["nes", "zip"])]);
        assert_eq!(ids, again.games.keys().cloned().collect());
        fs::remove_file(games.join("Alpha.NES")).unwrap();
        let removed = scan_roots(vec![root("nes", games, &["nes"])]);
        assert_eq!(removed.summary.total_games, 0);
    }
    #[test]
    fn playlists_and_cue_tracks_are_single_game_entries() {
        let base = fixture();
        fs::write(base.join("Game.m3u"), "#EXTM3U\nDisc 1.cue\nDisc 2.chd\n").unwrap();
        fs::write(
            base.join("Disc 1.cue"),
            "FILE \"Track 1.bin\" BINARY\n TRACK 01 MODE2/2352",
        )
        .unwrap();
        fs::write(base.join("Track 1.bin"), b"data").unwrap();
        fs::write(base.join("Disc 2.chd"), b"data").unwrap();
        let scan = scan_roots(vec![root(
            "playstation",
            base,
            &["m3u", "cue", "bin", "chd"],
        )]);
        assert_eq!(scan.summary.total_games, 1);
        assert_eq!(scan.games.values().next().unwrap().title, "Game");
    }
    #[test]
    fn switch_updates_and_dlc_do_not_count_as_standalone_games() {
        let base = fixture();
        fs::write(base.join("Game [0100DCF013740800][v1].nsp"), b"update").unwrap();
        fs::write(base.join("Game [DLC][01009aa000fab001].nsp"), b"dlc").unwrap();
        assert_eq!(
            scan_roots(vec![root("switch", base.clone(), &["nsp"])])
                .summary
                .total_games,
            0
        );
        fs::write(base.join("Game [0100DCF013740000][v0].nsp"), b"base").unwrap();
        let scan = scan_roots(vec![root("switch", base, &["nsp"])]);
        assert_eq!(scan.summary.total_games, 1);
        assert_eq!(scan.games.values().next().unwrap().search_title, "Game");
    }
    #[test]
    fn artwork_access_is_limited_to_indexed_matches_and_does_not_read_rom_bytes() {
        let base = fixture();
        let games = base.join("games");
        let covers = base.join("covers");
        fs::create_dir_all(&games).unwrap();
        fs::create_dir_all(&covers).unwrap();
        fs::write(games.join("Test.nes"), b"not opened as a ROM").unwrap();
        let image = image::RgbImage::new(4, 4);
        image.save(covers.join("Test.png")).unwrap();
        fs::write(covers.join("Other.png"), b"unmatched").unwrap();
        let mut source = root("nes", games, &["nes"]);
        source.covers = Some(covers.clone());
        let snapshot = scan_roots(vec![source]);
        let id = snapshot.games.keys().next().unwrap().clone();
        let service = Service {
            root: base,
            cache_path: None,
            snapshot: Mutex::new(snapshot),
        };
        assert!(service.artwork("../../secret").is_err());
        let art = service.artwork(&id).unwrap();
        assert!(art["cover"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert!(service.game(&id).unwrap().get("path").is_none());
        assert!(service.thumbnail("../../secret", "front-cover").is_err());
        assert!(service.thumbnail(&id, "../../secret").is_err());
        assert_eq!(
            service.thumbnail(&id, "front-cover").unwrap().as_deref(),
            art["cover"].as_str()
        );
        fs::write(covers.join("Test.png"), b"corrupt").unwrap();
        assert!(service.artwork(&id).unwrap()["cover"].is_null());
    }
    #[test]
    #[ignore = "Explicit read-only scan of the configured user library"]
    fn live_library_scan() {
        let root = Path::new(crate::library_settings::ROOT);
        let ids = crate::Carousel::new()
            .platforms
            .into_iter()
            .map(|p| p.id)
            .collect::<Vec<_>>();
        let settings = crate::library_settings::load(root).unwrap();
        let mut overrides = crate::platform_extensions::load(root).unwrap();
        let expected = if overrides.get("romFolders").is_none() {
            let manifest = read_import_manifest(&settings).unwrap();
            let before = scan_roots(effective_roots(&settings, &manifest, &overrides, &ids));
            overrides["romFolders"] = rom_folders::migrate(&settings, &manifest, &overrides, &ids);
            Some(before)
        } else {
            None
        };
        let snapshot = scan_roots(saved_scan_roots(&overrides, &ids).unwrap());
        if let Some(before) = expected {
            assert_eq!(
                snapshot.summary.platform_counts,
                before.summary.platform_counts
            );
            for (id, game) in &snapshot.games {
                let old = &before.games[id];
                assert_eq!(
                    (&game.path, &game.cover, &game.logo, &game.video),
                    (&old.path, &old.cover, &old.logo, &old.video)
                );
            }
            println!("Migrated folders preserve the live game IDs and media paths.");
        }
        let summary = &snapshot.summary;
        assert!(summary.total_games > 0);
        println!("{}", serde_json::to_string(&summary).unwrap());
        let mut games: Vec<_> = snapshot.games.values().collect();
        games.sort_by(|a, b| a.id.cmp(&b.id));
        let mut digest = Sha256::new();
        for game in games {
            digest.update(serde_json::to_vec(game).unwrap());
            digest.update(
                serde_json::to_vec(&(&game.cover, &game.cartridge_front, &game.logo, &game.video))
                    .unwrap(),
            );
        }
        println!("library-content-sha256={:x}", digest.finalize());
        let mut platforms: Vec<_> = snapshot.platforms.keys().map(String::as_str).collect();
        platforms.sort_unstable();
        for platform in platforms {
            let mut ids = snapshot
                .platforms
                .get(platform)
                .cloned()
                .unwrap_or_default();
            ids.sort();
            let mut digest = Sha256::new();
            let (mut covers, mut logos, mut videos) = (0, 0, 0);
            for id in &ids {
                digest.update(id.as_bytes());
                let game = &snapshot.games[id];
                covers += usize::from(game.cover.is_some());
                logos += usize::from(game.logo.is_some());
                videos += usize::from(game.video.is_some());
            }
            println!("{platform}: {} games, {covers} covers, {logos} logos, {videos} videos; IDs SHA-256 {:x}", ids.len(), digest.finalize());
        }
        for (platform, count) in &summary.platform_counts {
            assert_eq!(snapshot.platforms[platform].len(), *count);
        }
    }
}
