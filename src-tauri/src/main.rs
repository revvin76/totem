#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::sync::Mutex;
use std::{
    collections::HashMap,
    fs::OpenOptions,
    io::Write,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
mod admin_storage;
#[cfg(windows)]
mod cinematic_capture;
mod cinematic_launch;
mod controller_mapping;
mod emulators;
mod igdb;
mod library_index;
mod library_settings;
mod loading_profile;
mod platform_editor;
mod platform_extensions;
mod protected_secret;
mod readiness;
mod studio_paths;
mod studio_settings;
mod universal_emulator_exit;
mod window_settings;
#[cfg(windows)]
use universal_emulator_exit::windows as emulator_exit;

#[tauri::command]
async fn scan_game_library(
    library: tauri::State<'_, std::sync::Arc<library_index::Service>>,
    carousel: tauri::State<'_, Carousel>,
) -> Result<library_index::Summary, String> {
    let ids = carousel
        .catalogue()?
        .into_iter()
        .map(|p| p.id)
        .collect::<Vec<_>>();
    let library = library.inner().clone();
    tauri::async_runtime::spawn_blocking(move || library.scan(&ids))
        .await
        .map_err(|_| "Library scanner unavailable.")?
}
#[tauri::command]
async fn load_cached_game_library(
    library: tauri::State<'_, std::sync::Arc<library_index::Service>>,
) -> Result<Option<library_index::Summary>, String> {
    let library = library.inner().clone();
    tauri::async_runtime::spawn_blocking(move || library.load_cached())
        .await
        .map_err(|_| "Library cache unavailable.")?
}
#[tauri::command]
async fn get_platform_games(
    platform_id: String,
    library: tauri::State<'_, std::sync::Arc<library_index::Service>>,
) -> Result<Vec<library_index::Game>, String> {
    library.games(&platform_id)
}
#[tauri::command]
async fn get_platform_readiness(
    library: tauri::State<'_, std::sync::Arc<library_index::Service>>,
    carousel: tauri::State<'_, Carousel>,
    app: tauri::AppHandle,
) -> Result<readiness::Snapshot, String> {
    let catalogue = carousel.catalogue()?;
    let bundled_ids = carousel
        .platforms
        .iter()
        .map(|platform| platform.id.clone())
        .collect();
    let editor_root = carousel.editor_root.clone();
    let controller_root = app
        .path()
        .app_data_dir()
        .ok()
        .map(|path| path.join("controller-mappings"));
    let library = library.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        readiness::evaluate(
            catalogue,
            bundled_ids,
            &editor_root,
            controller_root.as_deref(),
            &library,
        )
    })
    .await
    .map_err(|_| "Platform readiness worker unavailable.".to_owned())
}
#[tauri::command]
async fn get_indexed_game_diagnostics(
    game_id: String,
    library: tauri::State<'_, std::sync::Arc<library_index::Service>>,
    carousel: tauri::State<'_, Carousel>,
) -> Result<serde_json::Value, String> {
    let catalogue = carousel.catalogue()?;
    let library = library.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        library.diagnostics(&game_id, |id| {
            catalogue
                .into_iter()
                .find(|platform| platform.id == id)
                .map(|platform| platform.name)
        })
    })
    .await
    .map_err(|_| "Game diagnostics worker unavailable.")?
}
#[tauri::command]
async fn launch_game(
    game_id: String,
    library: tauri::State<'_, std::sync::Arc<library_index::Service>>,
    window: tauri::WebviewWindow,
) -> Result<String, String> {
    let library = library.inner().clone();
    #[cfg(windows)]
    let sessions = window
        .state::<std::sync::Arc<emulator_exit::Sessions>>()
        .inner()
        .clone();
    #[cfg(not(windows))]
    let _ = window;
    tauri::async_runtime::spawn_blocking(move || {
        let (platform_id, game_path) = library.game_launch_target(&game_id)?;
        let root = std::path::Path::new(library_settings::ROOT);
        #[cfg(windows)]
        {
            let prepared = emulator_exit::prepare(&sessions, root)?;
            let (name, child, session) =
                emulators::spawn_game(root, &platform_id, &game_path, |record| {
                    prepared.attach(record, &window)
                })?;
            if let Some(session) = session {
                session.watch(child, window);
            }
            Ok(name)
        }
        #[cfg(not(windows))]
        emulators::spawn_game(root, &platform_id, &game_path, |_| ()).map(|(name, _, ())| name)
    })
    .await
    .map_err(|_| "Game launcher worker failed.".to_owned())?
}
#[tauri::command]
async fn get_library_game_metadata(
    game_id: String,
    igdb: tauri::State<'_, std::sync::Arc<igdb::Service>>,
) -> Result<serde_json::Value, String> {
    let igdb = igdb.inner().clone();
    tauri::async_runtime::spawn_blocking(move || igdb.metadata(&game_id))
        .await
        .map_err(|_| "Library metadata worker unavailable.")?
}
#[tauri::command]
async fn get_cached_platform_genres(
    igdb: tauri::State<'_, std::sync::Arc<igdb::Service>>,
) -> Result<std::collections::BTreeMap<String, std::collections::BTreeSet<String>>, String> {
    let igdb = igdb.inner().clone();
    tauri::async_runtime::spawn_blocking(move || igdb.cached_platform_genres())
        .await
        .map_err(|_| "Cached metadata worker unavailable.")?
}
#[tauri::command]
async fn get_library_game_artwork(
    game_id: String,
    library: tauri::State<'_, std::sync::Arc<library_index::Service>>,
    igdb: tauri::State<'_, std::sync::Arc<igdb::Service>>,
) -> Result<serde_json::Value, String> {
    let library = library.inner().clone();
    let igdb = igdb.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut artwork = library.artwork(&game_id)?;
        let downloaded = igdb.artwork(&game_id)?;
        if artwork["cover"].is_null() {
            if let Some(url) = downloaded["assets"]["front"]["url"].as_str() {
                artwork["cover"] = serde_json::json!(url);
            }
        }
        if artwork["logo"].is_null() {
            if let Some(url) = downloaded["assets"]["logo"]["url"].as_str() {
                artwork["logo"] = serde_json::json!(url);
            }
        }
        Ok(artwork)
    })
    .await
    .map_err(|_| "Library artwork unavailable.")?
}
#[tauri::command]
async fn get_library_game_thumbnail(
    game_id: String,
    artwork_type: String,
    library: tauri::State<'_, std::sync::Arc<library_index::Service>>,
    igdb: tauri::State<'_, std::sync::Arc<igdb::Service>>,
) -> Result<Option<String>, String> {
    let library = library.inner().clone();
    let igdb = igdb.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(thumbnail) = library.thumbnail(&game_id, &artwork_type)? {
            return Ok(Some(thumbnail));
        }
        igdb.thumbnail(&game_id, &artwork_type)
    })
    .await
    .map_err(|_| "Library thumbnail worker unavailable.")?
}
#[tauri::command]
async fn get_library_game_video(
    game_id: String,
    app: tauri::AppHandle,
    library: tauri::State<'_, std::sync::Arc<library_index::Service>>,
) -> Result<String, String> {
    let library = library.inner().clone();
    let path = tauri::async_runtime::spawn_blocking(move || library.video_path(&game_id))
        .await
        .map_err(|_| "Library video unavailable.")??;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|_| "Could not authorize this library video.")?;
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
fn get_showcase_startup_video(
    platform_id: String,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    if let Some(path) = platform_presentation_file(&platform_id, "Branding/Startup.mp4")? {
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|_| "Could not authorize this startup clip.")?;
        return Ok(Some(path.to_string_lossy().into_owned()));
    }
    Ok(None)
}

#[tauri::command]
fn get_showcase_gameplay_video(
    platform_id: String,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    if let Some(path) = showcase_gameplay_path(&platform_id)? {
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|_| "Could not authorize this gameplay clip.")?;
        return Ok(Some(path.to_string_lossy().into_owned()));
    }
    Ok(None)
}

fn showcase_gameplay_path(platform_id: &str) -> Result<Option<std::path::PathBuf>, String> {
    if platform_id.is_empty()
        || !platform_id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    {
        return Err("Invalid platform ID.".into());
    }
    let root = std::path::Path::new(library_settings::ROOT).join("Assets/Platforms");
    let canonical_root = match root.canonicalize() {
        Ok(root) => root,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let platform = root.join(platform_id);
    let videos = platform.join("Video");
    let allowed = |path: &std::path::Path| {
        let supported = path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("mp4") || ext.eq_ignore_ascii_case("webm"));
        supported
            && path.strip_prefix(&root).is_ok_and(|relative| {
                path.is_file()
                    && path
                        .canonicalize()
                        .is_ok_and(|resolved| resolved == canonical_root.join(relative))
            })
    };
    let choices: serde_json::Value =
        serde_json::from_str(include_str!("../../offscreen-demo-audio.json"))
            .map_err(|error| error.to_string())?;
    let authored = platform.join("Branding/Gameplay.mp4");
    let preferred = choices[platform_id]["clip"]
        .as_str()
        .map(|name| videos.join(name));
    let path = if allowed(&authored) {
        Some(authored)
    } else if let Some(preferred) = preferred.filter(|path| allowed(path)) {
        Some(preferred)
    } else {
        match std::fs::read_dir(videos) {
            Ok(files) => {
                let mut candidates: Vec<_> = files
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                    .collect();
                candidates.sort_unstable();
                candidates.into_iter().find(|path| allowed(path))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.to_string()),
        }
    };
    Ok(path)
}

#[tauri::command]
fn get_platform_chooser_button(
    platform_id: String,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    if let Some(path) = platform_presentation_file(&platform_id, "Artwork/UI/button.png")? {
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|_| "Could not authorize platform chooser artwork.")?;
        return Ok(Some(path.to_string_lossy().into_owned()));
    }
    Ok(None)
}

fn platform_presentation_file(
    platform_id: &str,
    file: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    if platform_id.is_empty()
        || !platform_id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    {
        return Err("Invalid platform ID.".into());
    }
    let root = std::path::Path::new(library_settings::ROOT).join("Assets/Platforms");
    let relative = std::path::Path::new(platform_id).join(file);
    let path = root.join(&relative);
    let resolved = match path.canonicalize() {
        Ok(resolved) => resolved,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    if resolved != canonical_root.join(relative) || !resolved.is_file() {
        return Err("Presentation asset must be a regular file in its platform folder.".into());
    }
    Ok(Some(resolved))
}

mod metadata_settings;

#[tauri::command]
async fn igdb_connection_status(
    service: tauri::State<'_, std::sync::Arc<igdb::Service>>,
) -> Result<serde_json::Value, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.status())
        .await
        .map_err(|_| "IGDB worker unavailable.")?
}
#[tauri::command]
async fn import_shared_igdb_credentials(
    service: tauri::State<'_, std::sync::Arc<igdb::Service>>,
) -> Result<serde_json::Value, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.import_shared())
        .await
        .map_err(|_| "IGDB worker unavailable.")?
}
#[tauri::command]
async fn save_igdb_credentials(
    client_id: String,
    client_secret: String,
    service: tauri::State<'_, std::sync::Arc<igdb::Service>>,
) -> Result<serde_json::Value, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.save_credentials(client_id, client_secret))
        .await
        .map_err(|_| "IGDB worker unavailable.")?
}
#[tauri::command]
async fn test_igdb_connection(
    service: tauri::State<'_, std::sync::Arc<igdb::Service>>,
) -> Result<serde_json::Value, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.test_connection())
        .await
        .map_err(|_| "IGDB worker unavailable.")?
}
#[tauri::command]
async fn lookup_igdb_artwork(
    game_id: String,
    service: tauri::State<'_, std::sync::Arc<igdb::Service>>,
) -> Result<serde_json::Value, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.lookup(&game_id))
        .await
        .map_err(|_| "IGDB worker unavailable.")?
}
#[tauri::command]
async fn fill_igdb_artwork(
    game_id: String,
    igdb_game_id: u64,
    service: tauri::State<'_, std::sync::Arc<igdb::Service>>,
) -> Result<serde_json::Value, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.fill(&game_id, igdb_game_id))
        .await
        .map_err(|_| "IGDB worker unavailable.")?
}
#[tauri::command]
async fn get_game_artwork(
    game_id: String,
    service: tauri::State<'_, std::sync::Arc<igdb::Service>>,
) -> Result<serde_json::Value, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.artwork(&game_id))
        .await
        .map_err(|_| "IGDB worker unavailable.")?
}

#[tauri::command]
fn get_metadata_settings(
    service: tauri::State<'_, std::sync::Arc<metadata_settings::Service>>,
) -> Result<serde_json::Value, String> {
    service.status()
}
#[tauri::command]
fn save_metadata_settings(
    api_key: String,
    preferences: serde_json::Value,
    service: tauri::State<'_, std::sync::Arc<metadata_settings::Service>>,
) -> Result<serde_json::Value, String> {
    service.save(api_key, preferences)
}
#[tauri::command]
async fn test_steamgriddb_connection(
    service: tauri::State<'_, std::sync::Arc<metadata_settings::Service>>,
) -> Result<serde_json::Value, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.test())
        .await
        .map_err(|_| "SteamGridDB worker unavailable.")?
}

#[tauri::command]
fn get_library_settings() -> Result<serde_json::Value, String> {
    library_settings::view(std::path::Path::new(library_settings::ROOT))
}

#[tauri::command]
fn save_library_settings(
    paths: serde_json::Value,
    expected_revision: String,
) -> Result<serde_json::Value, String> {
    library_settings::save(
        std::path::Path::new(library_settings::ROOT),
        paths,
        &expected_revision,
    )
}

fn error_log_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("errors.log"))
}

#[tauri::command]
fn get_error_log_location(app: tauri::AppHandle) -> Result<String, String> {
    Ok(error_log_path(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn record_error(context: String, detail: String, app: tauri::AppHandle) -> Result<(), String> {
    append_error(&error_log_path(&app)?, &context, &detail)
}

fn append_error(path: &std::path::Path, context: &str, detail: &str) -> Result<(), String> {
    static ERROR_LOG_LOCK: Mutex<()> = Mutex::new(());
    let record = serde_json::json!({
        "timestampUnixMs": SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis(),
        "context": context.chars().take(128).collect::<String>(),
        "detail": detail.chars().take(32_768).collect::<String>()
    });
    let mut line = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
    line.push(b'\n');
    let _guard = ERROR_LOG_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let parent = path.parent().ok_or("Error log directory unavailable")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(&line).map_err(|e| e.to_string())
}

#[derive(Clone, Deserialize, Serialize)]
struct Platform {
    id: String,
    name: String,
    maker: String,
    year: String,
    era: String,
    tagline: String,
    color: String,
    short: String,
    #[serde(flatten)]
    details: HashMap<String, serde_json::Value>,
}

struct Carousel {
    platforms: Vec<Platform>,
    selected: Mutex<String>,
    edits: Mutex<Option<Vec<Platform>>>,
    editor_root: std::path::PathBuf,
}

impl Carousel {
    fn new() -> Self {
        Self {
            // Shared with the browser preview; no competing platform catalogue.
            platforms: serde_json::from_str(include_str!("../../platforms.json"))
                .expect("bundled platform catalogue must be valid"),
            selected: Mutex::new("playstation".to_owned()),
            edits: Mutex::new(None),
            editor_root: std::path::PathBuf::new(),
        }
    }

    fn select(&self, id: &str) -> Result<Platform, String> {
        let platform = self
            .catalogue()?
            .into_iter()
            .find(|platform| platform.id == id)
            .ok_or_else(|| "Unknown platform".to_owned())?;
        *self.selected.lock().map_err(|_| "Selection unavailable")? = id.to_owned();
        Ok(platform)
    }

    fn catalogue(&self) -> Result<Vec<Platform>, String> {
        let mut edits = self
            .edits
            .lock()
            .map_err(|_| "Platform registry unavailable")?;
        let records = match &*edits {
            Some(records) => records,
            None => {
                let records = platform_editor::load(&self.editor_root, &self.platforms)
                    .map_err(|error| format!("Could not read the platform registry: {error}"))?;
                edits.insert(records)
            }
        };
        let mut result = self.platforms.clone();
        for platform in records {
            if let Some(existing) = result.iter_mut().find(|p| p.id == platform.id) {
                let bundled_model = existing.details.get("bundledModel").cloned();
                let priority = existing.details.get("upgradePriority").cloned();
                *existing = platform.clone();
                existing.details.remove("bundledModel");
                if let Some(model) = bundled_model {
                    existing.details.insert("bundledModel".into(), model);
                }
                if let Some(value) = priority {
                    existing.details.insert("upgradePriority".into(), value);
                }
            } else {
                result.push(platform.clone());
            }
        }
        Ok(result)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CarouselState {
    platforms: Vec<Platform>,
    selected: String,
    asset_library: String,
}

#[tauri::command]
async fn carousel_state(app: tauri::AppHandle) -> Result<CarouselState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Carousel>();
        let platforms = state.catalogue()?;
        let selected = state
            .selected
            .lock()
            .map_err(|_| "Selection unavailable")?
            .clone();
        Ok(CarouselState {
            asset_library: state.editor_root.to_string_lossy().into_owned(),
            platforms,
            selected,
        })
    })
    .await
    .map_err(|_| "Platform registry worker unavailable")?
}

#[tauri::command]
fn select_platform(id: String, state: tauri::State<'_, Carousel>) -> Result<Platform, String> {
    state.select(&id)
}

#[tauri::command]
fn list_controller_mappings(
    app: tauri::AppHandle,
    state: tauri::State<'_, Carousel>,
) -> Result<serde_json::Value, String> {
    let ids = state
        .catalogue()?
        .into_iter()
        .map(|p| p.id)
        .collect::<Vec<_>>();
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("controller-mappings");
    controller_mapping::load(&directory, &ids)
}

#[tauri::command]
fn save_controller_mapping(
    profile: serde_json::Value,
    app: tauri::AppHandle,
    state: tauri::State<'_, Carousel>,
) -> Result<serde_json::Value, String> {
    let ids = state
        .catalogue()?
        .into_iter()
        .map(|p| p.id)
        .collect::<Vec<_>>();
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("controller-mappings");
    controller_mapping::save(&directory, profile, &ids)
}

#[tauri::command]
fn save_platform(
    platform: Platform,
    state: tauri::State<'_, Carousel>,
) -> Result<Platform, String> {
    let mut edits = state
        .edits
        .lock()
        .map_err(|_| "Platform registry unavailable")?;
    let (platform, next) = platform_editor::commit(&state.editor_root, platform, &state.platforms)?;
    *edits = Some(next);
    Ok(platform)
}

#[tauri::command]
fn import_platform_asset(
    name: String,
    kind: String,
    encoded: String,
    state: tauri::State<'_, Carousel>,
) -> Result<platform_editor::AssetReference, String> {
    platform_editor::import_asset(&state.editor_root, name, kind, &encoded)
}

#[tauri::command]
fn read_platform_asset(
    id: String,
    state: tauri::State<'_, Carousel>,
) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(platform_editor::read_asset(
        &state.editor_root,
        &id,
    )?))
}

#[tauri::command]
async fn read_bundled_model(path: String, sha256: String) -> Result<tauri::ipc::Response, String> {
    // Preserve one active bundled read without blocking the WebView host thread.
    static READ: tauri::async_runtime::Mutex<()> = tauri::async_runtime::Mutex::const_new(());
    let guard = READ.lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        read_verified_bundled_model(&path, &sha256).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|_| "Bundled model reader unavailable.".to_owned())?
}

fn read_verified_bundled_model(path: &str, sha256: &str) -> Result<Vec<u8>, String> {
    let file = bundled_model_path(path, sha256)?;
    let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
    if format!("{:x}", sha2::Sha256::digest(&bytes)) != sha256.to_ascii_lowercase() {
        return Err("Bundled model integrity check failed".into());
    }
    Ok(bytes)
}

fn bundled_model_path(path: &str, sha256: &str) -> Result<std::path::PathBuf, String> {
    let name = path
        .strip_prefix("assets/models/")
        .ok_or("Invalid bundled model path")?;
    let stem = name
        .strip_suffix(".glb")
        .ok_or("Invalid bundled model path")?;
    if name.is_empty()
        || name.bytes().any(|b| b == b'/' || b == b'\\' || b == b':')
        || !stem
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        || sha256.len() != 64
        || !sha256.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid bundled model reference".into());
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let app_directory = executable
        .parent()
        .ok_or("Application directory unavailable")?;
    let assets_directory = app_directory.join("assets");
    let assets_metadata =
        std::fs::symlink_metadata(&assets_directory).map_err(|e| e.to_string())?;
    if !assets_metadata.is_dir() || is_reparse(&assets_metadata) {
        return Err("Bundled asset directory is unavailable".into());
    }
    let directory = assets_directory.join("models");
    let directory_metadata = std::fs::symlink_metadata(&directory).map_err(|e| e.to_string())?;
    if !directory_metadata.is_dir() || is_reparse(&directory_metadata) {
        return Err("Bundled model directory is unavailable".into());
    }
    let file = directory.join(name);
    let metadata = std::fs::symlink_metadata(&file).map_err(|e| e.to_string())?;
    if !metadata.is_file() || is_reparse(&metadata) || metadata.len() > 128 * 1024 * 1024 {
        return Err("Bundled model is unavailable or too large".into());
    }
    Ok(file)
}

#[cfg(windows)]
fn is_reparse(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn is_reparse(metadata: &std::fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[derive(Deserialize)]
struct LayoutControl {
    key: String,
    min: f64,
    max: f64,
    step: f64,
    default: f64,
}

fn validate_control_values(
    values: &serde_json::Map<String, serde_json::Value>,
    controls: &[LayoutControl],
    group: &str,
) -> Result<(), String> {
    if values.len() != controls.len() {
        return Err(format!("Incomplete {group} controls"));
    }
    for control in controls {
        let value = values
            .get(&control.key)
            .and_then(|value| value.as_f64())
            .ok_or("Missing numeric control")?;
        let steps = (value - control.min) / control.step;
        if !value.is_finite()
            || value < control.min
            || value > control.max
            || (steps - steps.round()).abs() > 1e-6
        {
            return Err(format!("Invalid {group} {} value", control.key));
        }
    }
    Ok(())
}

fn validate_layout_snapshot(
    snapshot: &serde_json::Value,
    platforms: &[Platform],
) -> Result<Vec<u8>, String> {
    let version = snapshot["schemaVersion"].as_u64();
    if !matches!(version, Some(1 | 2 | 3 | 4 | 5)) {
        return Err("Unsupported layout snapshot version".into());
    }
    if matches!(version, Some(2 | 3 | 4 | 5)) {
        let enabled = snapshot["enabledPlatformIds"]
            .as_array()
            .ok_or("Missing enabled systems")?;
        let mut ids = std::collections::HashSet::new();
        for value in enabled {
            let id = value.as_str().ok_or("Invalid enabled system")?;
            if !platforms.iter().any(|platform| platform.id == id) || !ids.insert(id) {
                return Err("Enabled systems must be unique known platform IDs".into());
            }
        }
        if ids.is_empty() {
            if !snapshot
                .get("selectedPlatform")
                .is_some_and(|value| value.is_null())
            {
                return Err("Empty carousel must have no selected platform".into());
            }
        } else if !snapshot["selectedPlatform"]
            .as_str()
            .is_some_and(|id| ids.contains(id))
        {
            return Err("Selected platform must be enabled".into());
        }
    } else {
        let selected = snapshot["selectedPlatform"]
            .as_str()
            .ok_or("Missing selected platform")?;
        if !platforms.iter().any(|platform| platform.id == selected) {
            return Err("Unknown selected platform".into());
        }
    }
    let definitions: HashMap<String, Vec<LayoutControl>> =
        serde_json::from_str(include_str!("../../layout-controls.json"))
            .map_err(|error| error.to_string())?;
    let mut normalized = snapshot.clone();
    let layout = normalized["layout"]
        .as_object_mut()
        .ok_or("Missing layout")?;
    if !layout.contains_key("inactive") && matches!(version, Some(1 | 2 | 3)) {
        let neutral: serde_json::Map<String, serde_json::Value> = definitions["inactive"]
            .iter()
            .map(|control| (control.key.clone(), serde_json::json!(control.default)))
            .collect();
        layout.insert("inactive".into(), serde_json::Value::Object(neutral));
    }
    if layout.len() != definitions.len() {
        return Err("Invalid layout groups".into());
    }
    for (group, controls) in &definitions {
        let values = layout
            .get(group)
            .and_then(|value| value.as_object())
            .ok_or("Missing control group")?;
        validate_control_values(values, controls, group)?;
    }
    if matches!(version, Some(3 | 4 | 5)) {
        let overrides = normalized["deviceOverrides"]
            .as_object()
            .ok_or("Missing device overrides")?;
        for (id, value) in overrides {
            if !platforms.iter().any(|platform| platform.id == *id) {
                return Err("Unknown device override".into());
            }
            let values = value.as_object().ok_or("Invalid device controls")?;
            validate_control_values(values, &definitions["consoles"], "device")?;
        }
    }
    if version == Some(5) {
        let inactive_overrides = normalized["inactiveDeviceOverrides"]
            .as_object()
            .ok_or("Missing inactive device overrides")?;
        for (id, value) in inactive_overrides {
            if !platforms.iter().any(|platform| platform.id == *id) {
                return Err("Unknown inactive device override".into());
            }
            let values = value
                .as_object()
                .ok_or("Invalid inactive device controls")?;
            validate_control_values(values, &definitions["consoles"], "inactive device")?;
        }
        let open_when_active = normalized["openWhenActive"]
            .as_object()
            .ok_or("Missing open-when-active settings")?;
        for (id, value) in open_when_active {
            if !platforms.iter().any(|platform| platform.id == *id) || !value.is_boolean() {
                return Err("Invalid open-when-active setting".into());
            }
        }
    }
    let bytes = serde_json::to_vec_pretty(&normalized).map_err(|error| error.to_string())?;
    if bytes.len() > 65536 {
        return Err("Layout snapshot is too large".into());
    }
    Ok(bytes)
}

#[tauri::command]
fn save_layout_snapshot(
    app: tauri::AppHandle,
    snapshot: serde_json::Value,
    state: tauri::State<'_, Carousel>,
) -> Result<String, String> {
    let bytes = validate_layout_snapshot(&snapshot, &state.catalogue()?)?;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("layout-snapshots");
    write_layout_snapshot(&directory, &bytes)
}

#[tauri::command]
fn save_default_layout(
    app: tauri::AppHandle,
    snapshot: serde_json::Value,
    state: tauri::State<'_, Carousel>,
) -> Result<String, String> {
    let bytes = validate_layout_snapshot(&snapshot, &state.catalogue()?)?;
    let directory = studio_paths::home_data_directory(&app)?.join("layout-defaults");
    write_layout_snapshot(&directory, &bytes)
}

#[tauri::command]
fn load_default_layout(
    app: tauri::AppHandle,
    state: tauri::State<'_, Carousel>,
) -> Result<Option<serde_json::Value>, String> {
    let directory = studio_paths::home_data_directory(&app)?.join("layout-defaults");
    let entries = match std::fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut paths = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("horizon-layout-") && name.ends_with(".json"))
        })
        .collect::<Vec<_>>();
    paths.sort();
    let Some(path) = paths.last() else {
        return Ok(None);
    };
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    let snapshot: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    let validated = validate_layout_snapshot(&snapshot, &state.catalogue()?)?;
    serde_json::from_slice(&validated)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn write_layout_snapshot(directory: &std::path::Path, bytes: &[u8]) -> Result<String, String> {
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let path = directory.join(format!("horizon-layout-{timestamp}.json"));
    // Unique, append-only files: an existing snapshot is never overwritten.
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| error.to_string())?;
    drop(file);
    if std::fs::read(&path).map_err(|error| error.to_string())? != bytes {
        return Err("Could not verify saved snapshot".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

const STUDIO_IDENTIFIER: &str = "dev.horizon.totem.lightstudy";

#[cfg(windows)]
fn mute_studio_webview(view: tauri::webview::PlatformWebview, muted: bool) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
    use windows_core::Interface;

    // Tauri runs this closure on the WebView2 controller's UI thread.
    unsafe {
        view.controller()
            .CoreWebView2()
            .and_then(|webview| webview.cast::<ICoreWebView2_8>())
            .and_then(|webview| webview.SetIsMuted(muted))
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_studio_audio_muted(window: tauri::WebviewWindow, muted: bool) -> Result<bool, String> {
    if window.app_handle().config().identifier != STUDIO_IDENTIFIER {
        return Err("System audio control is available in Totem Studio.".into());
    }
    #[cfg(windows)]
    {
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        window
            .with_webview(move |view| {
                let _ = sender.try_send(mute_studio_webview(view, muted));
            })
            .map_err(|error| error.to_string())?;
        receiver
            .recv()
            .await
            .ok_or("Studio audio control is unavailable.")??;
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        let _ = muted;
        Ok(false)
    }
}

fn main() {
    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder.manage(std::sync::Arc::new(emulator_exit::Sessions::default()));
    builder
        .manage(std::sync::Arc::new(cinematic_launch::Sessions::default()))
        .setup(|app| {
            #[cfg(windows)]
            if app.config().identifier == STUDIO_IDENTIFIER {
                if let Some(window) = app.get_webview_window("main") {
                    window.with_webview(|view| {
                        let _ = mute_studio_webview(view, true);
                    })?;
                }
            }
            if let Ok(path) = error_log_path(app.handle()) {
                let previous = std::panic::take_hook();
                std::panic::set_hook(Box::new(move |panic| {
                    let _ = append_error(&path, "native.panic", &panic.to_string());
                    previous(panic);
                }));
            }
            let mut carousel = Carousel::new();
            let home_data =
                studio_paths::home_data_directory(app.handle()).map_err(std::io::Error::other)?;
            carousel.editor_root = home_data.join("platform-editor");
            // The launcher reads the registry after its WebView can display a retry.
            // Studio keeps loading the shared registry during its existing setup.
            if app.config().identifier == STUDIO_IDENTIFIER {
                *carousel
                    .edits
                    .get_mut()
                    .map_err(|_| std::io::Error::other("Platform registry unavailable"))? = Some(
                    platform_editor::load(&carousel.editor_root, &carousel.platforms)
                        .map_err(std::io::Error::other)?,
                );
            }
            let editor_root = carousel.editor_root.clone();
            let library_cache = home_data.join("library-index.json");
            let library = std::sync::Arc::new(library_index::Service::new_with_cache(
                std::path::PathBuf::from(library_settings::ROOT),
                library_cache,
            ));
            app.manage(library.clone());
            app.manage(carousel);
            app.manage(std::sync::Arc::new(
                igdb::Service::new(std::path::PathBuf::from(library_settings::ROOT))
                    .with_editor_root(editor_root)
                    .with_library(library),
            ));
            app.manage(std::sync::Arc::new(metadata_settings::Service::new(
                std::path::PathBuf::from(library_settings::ROOT),
            )));
            if app.config().identifier != STUDIO_IDENTIFIER {
                for config in app.config().app.windows.iter().filter(|window| !window.create) {
                    let fullscreen = window_settings::load(&home_data)
                        .map(|settings| settings["fullscreen"].as_bool().unwrap_or(config.fullscreen))
                        .unwrap_or(config.fullscreen);
                    tauri::WebviewWindowBuilder::from_config(app.handle(), config)?
                        .fullscreen(fullscreen)
                        .build()?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window_settings::load_window_settings,
            window_settings::save_window_settings,
            set_studio_audio_muted,
            loading_profile::save_loading_profile,
            loading_profile::loading_benchmark_config,
            loading_profile::finish_loading_benchmark,
            studio_settings::load_studio_settings,
            studio_settings::save_studio_settings,
            scan_game_library,
            load_cached_game_library,
            get_platform_games,
            get_platform_readiness,
            launch_game,
            universal_emulator_exit::load_emulator_exit_settings,
            universal_emulator_exit::save_emulator_exit_settings,
            cinematic_launch::cinematic_capability,
            cinematic_launch::cinematic_start,
            cinematic_launch::cinematic_control,
            cinematic_launch::cinematic_frame,
            get_indexed_game_diagnostics,
            get_library_game_metadata,
            get_cached_platform_genres,
            get_library_game_artwork,
            get_library_game_thumbnail,
            get_library_game_video,
            get_showcase_startup_video,
            get_showcase_gameplay_video,
            get_platform_chooser_button,
            carousel_state,
            select_platform,
            save_layout_snapshot,
            save_default_layout,
            load_default_layout,
            save_platform,
            import_platform_asset,
            read_platform_asset,
            read_bundled_model,
            list_controller_mappings,
            save_controller_mapping,
            get_library_settings,
            emulators::load_emulators,
            emulators::save_emulators,
            emulators::scan_emulators,
            emulators::launch_emulator,
            emulators::emulator_update,
            emulators::install_emulator,
            emulators::open_emulator_website,
            platform_extensions::load_platform_extensions,
            platform_extensions::save_platform_extensions,
            save_library_settings,
            get_error_log_location,
            record_error,
            igdb_connection_status,
            import_shared_igdb_credentials,
            save_igdb_credentials,
            test_igdb_connection,
            lookup_igdb_artwork,
            fill_igdb_artwork,
            get_game_artwork,
            get_metadata_settings,
            save_metadata_settings,
            test_steamgriddb_connection
        ])
        .build(tauri::generate_context!())
        .expect("could not start Totem")
        .run(|_app, _event| {
            #[cfg(windows)]
            if matches!(_event, tauri::RunEvent::Exit) {
                _app.state::<std::sync::Arc<emulator_exit::Sessions>>()
                    .stop();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_snapshots_validate_the_bundled_baseline_and_reject_bad_overrides() {
        let carousel = Carousel::new();
        let snapshot: serde_json::Value =
            serde_json::from_str(include_str!("../../startup-layout.json")).unwrap();
        assert!(validate_layout_snapshot(&snapshot, &carousel.platforms).is_ok());
        for value in [
            serde_json::json!(null),
            serde_json::json!([]),
            serde_json::json!({"unknown": {}}),
            serde_json::json!({"wii": {"panY": 0}}),
        ] {
            let mut invalid = snapshot.clone();
            invalid["deviceOverrides"] = value;
            assert!(validate_layout_snapshot(&invalid, &carousel.platforms).is_err());
        }
        let mut invalid = snapshot.clone();
        invalid["deviceOverrides"]["wii"]["zoom"] = serde_json::json!(99);
        assert!(validate_layout_snapshot(&invalid, &carousel.platforms).is_err());
    }

    #[test]
    fn a_failed_initial_registry_read_can_be_retried() {
        let mut carousel = Carousel::new();
        carousel.editor_root = std::env::temp_dir().join(format!(
            "totem-startup-registry-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        let revisions = carousel.editor_root.join("revisions");
        std::fs::create_dir_all(&revisions).unwrap();
        let revision = revisions.join("1.json");
        std::fs::write(&revision, b"{ invalid registry }").unwrap();
        assert!(carousel
            .catalogue()
            .err()
            .unwrap()
            .starts_with("Could not read the platform registry"));
        assert!(carousel.edits.lock().unwrap().is_none());

        std::fs::write(&revision, br#"{"schemaVersion":1,"platforms":[]}"#).unwrap();
        assert_eq!(
            carousel.catalogue().unwrap().len(),
            carousel.platforms.len()
        );
        std::fs::remove_file(revision).unwrap();
        std::fs::remove_dir(revisions).unwrap();
        std::fs::remove_dir(carousel.editor_root).unwrap();
    }

    #[test]
    fn selection_is_validated_before_state_changes() {
        let carousel = Carousel::new();
        assert_eq!(carousel.select("gamecube").unwrap().name, "GameCube");
        assert_eq!(*carousel.selected.lock().unwrap(), "gamecube");
        assert!(carousel.select("unknown").is_err());
        assert_eq!(*carousel.selected.lock().unwrap(), "gamecube");
    }

    #[test]
    fn catalogue_has_unique_ids_and_valid_initial_selection() {
        let carousel = Carousel::new();
        let ids: std::collections::HashSet<_> = carousel.platforms.iter().map(|p| &p.id).collect();
        assert_eq!(ids.len(), carousel.platforms.len());
        assert!(ids.len() > 100);
        let aliases: HashMap<String, String> =
            serde_json::from_str(include_str!("../../platform-aliases.json")).unwrap();
        for (variant, canonical) in aliases {
            assert!(!ids.contains(&variant));
            assert!(ids.contains(&canonical));
        }
        assert!(carousel
            .platforms
            .iter()
            .all(|platform| platform.details["model"].is_object()));
        assert!(ids.contains(&*carousel.selected.lock().unwrap()));
    }

    #[test]
    fn snapshot_files_persist_and_never_replace_a_previous_snapshot() {
        let directory = std::env::temp_dir().join(format!(
            "horizon-layout-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let first = write_layout_snapshot(&directory, br#"{"layout":"first"}"#).unwrap();
        let second = write_layout_snapshot(&directory, br#"{"layout":"second"}"#).unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(&first).unwrap(), br#"{"layout":"first"}"#);
        assert_eq!(std::fs::read(&second).unwrap(), br#"{"layout":"second"}"#);
        // These two files and this unique directory belong only to this fixture.
        std::fs::remove_file(first).unwrap();
        std::fs::remove_file(second).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn snapshot_validation_uses_shared_control_limits_and_rejects_invalid_data() {
        let carousel = Carousel::new();
        let definitions: serde_json::Value =
            serde_json::from_str(include_str!("../../layout-controls.json")).unwrap();
        let mut layout = serde_json::Map::new();
        for (group, controls) in definitions.as_object().unwrap() {
            let values: serde_json::Map<String, serde_json::Value> = controls
                .as_array()
                .unwrap()
                .iter()
                .map(|control| {
                    (
                        control["key"].as_str().unwrap().to_owned(),
                        control["default"].clone(),
                    )
                })
                .collect();
            layout.insert(group.clone(), serde_json::Value::Object(values));
        }
        let snapshot =
            serde_json::json!({"schemaVersion":1,"selectedPlatform":"playstation","layout":layout});
        let bytes = validate_layout_snapshot(&snapshot, &carousel.platforms).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
            snapshot
        );
        let mut dynamic = snapshot.clone();
        dynamic["schemaVersion"] = serde_json::json!(2);
        dynamic["enabledPlatformIds"] = serde_json::json!(["playstation", "arcade"]);
        assert!(validate_layout_snapshot(&dynamic, &carousel.platforms).is_ok());
        dynamic["enabledPlatformIds"] = serde_json::json!(["arcade"]);
        assert!(validate_layout_snapshot(&dynamic, &carousel.platforms).is_err());
        dynamic["enabledPlatformIds"] = serde_json::json!(["playstation", "playstation"]);
        assert!(validate_layout_snapshot(&dynamic, &carousel.platforms).is_err());
        dynamic["enabledPlatformIds"] = serde_json::json!([]);
        dynamic["selectedPlatform"] = serde_json::Value::Null;
        assert!(validate_layout_snapshot(&dynamic, &carousel.platforms).is_ok());
        let mut invalid = snapshot.clone();
        invalid["layout"]["consoles"]["zoom"] = serde_json::json!(100);
        assert!(validate_layout_snapshot(&invalid, &carousel.platforms).is_err());
        invalid = snapshot.clone();
        invalid["selectedPlatform"] = serde_json::json!("unknown");
        assert!(validate_layout_snapshot(&invalid, &carousel.platforms).is_err());
        invalid = snapshot;
        invalid["layout"]["orbit"]
            .as_object_mut()
            .unwrap()
            .remove("panZ");
        assert!(validate_layout_snapshot(&invalid, &carousel.platforms).is_err());
    }
}
