use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const SHARED_ENV: &str = r"C:\addarr\website\.env.shared.local";
const SLOTS: [&str; 5] = ["front", "back", "spine", "logo", "background"];
const IMAGE_LIMIT: u64 = 8 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Credentials {
    client_id: String,
    client_secret: String,
}
struct Token {
    access: String,
    expires: Instant,
    revision: String,
}
#[derive(Default)]
struct Session {
    token: Option<Token>,
    last_request: Option<Instant>,
    candidates: HashMap<String, Vec<u64>>,
}
pub struct Service {
    root: PathBuf,
    editor_root: Option<PathBuf>,
    library: Option<std::sync::Arc<crate::library_index::Service>>,
    session: Mutex<Session>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Asset {
    file: String,
    sha256: String,
    mime: String,
    width: u32,
    height: u32,
    image_id: String,
    source_url: String,
    igdb_game_id: u64,
    cache_root: String,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Artwork {
    schema_version: u32,
    game_id: String,
    igdb_game_id: Option<u64>,
    assets: BTreeMap<String, Asset>,
    #[serde(default)]
    metadata: Option<Value>,
}

fn latest(dir: &Path, extension: &str) -> Result<Option<PathBuf>, String> {
    if !dir.exists() {
        return Ok(None);
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(dir).map_err(|_| "Cannot read IGDB storage.")? {
        let path = entry.map_err(|_| "Cannot read IGDB storage.")?.path();
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if stem.len() == 32
            && stem.bytes().all(|b| b.is_ascii_digit())
            && path.extension().and_then(|s| s.to_str()) == Some(extension)
        {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths.pop())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "horizon-igdb-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }
    #[test]
    fn shared_parser_selects_only_required_keys_and_rejects_invalid_values() {
        let c=parse_shared("OTHER_SECRET=not-imported\nARRDASH_SHARED_IGDB_CLIENT_ID='testclient123456'\nexport ARRDASH_SHARED_IGDB_CLIENT_SECRET=\"testsecret123456\"\n").unwrap();
        assert_eq!(c.client_id, "testclient123456");
        assert_eq!(c.client_secret, "testsecret123456");
        assert!(parse_shared("ARRDASH_SHARED_IGDB_CLIENT_ID=short").is_err());
        assert!(!image_id("../../secret"));
        assert!(!image_id("https://another-host/image"));
        assert!(image_id("co_ab123"));
    }
    #[test]
    fn packaging_and_platform_rules_preserve_original_assets() {
        for id in ["duck-hunt", "tmnt-turtles-in-time", "left-4-dead-2"] {
            let g = game(id).unwrap();
            for slot in ["front", "back", "spine"] {
                assert!(existing_slot(&g, slot));
            }
        }
        assert!(existing_slot(&game("dino-crisis").unwrap(), "front"));
        assert!(!existing_slot(&game("agony").unwrap(), "front"));
        assert_eq!(classify("Artwork", "artworks"), Some("background"));
        assert_eq!(classify("Concept art", "artworks"), None);
        assert_eq!(classify("Main cover", "covers"), Some("front"));
        assert_eq!(classify("Historical cover", "covers"), None);
        assert_eq!(classify("Game logo (white)", "logos"), Some("logo"));
        assert_eq!(classify("Historical logo", "logos"), None);
        assert_eq!(platform(&game("agony").unwrap()).unwrap(), 16);
        assert!(game("../agony").is_err());
    }
    #[test]
    fn protected_credentials_survive_reload_without_plaintext_or_secret_ipc() {
        let root = fixture();
        let service = Service::new(root.clone());
        service
            .save_credentials("testclient123456".into(), "testsecret123456".into())
            .unwrap();
        let path = latest(&service.connection_dir(), "bin").unwrap().unwrap();
        let bytes = fs::read(path).unwrap();
        assert!(!bytes.windows(16).any(|b| b == b"testsecret123456"));
        let status = Service::new(root).status().unwrap();
        assert_eq!(status["configured"], true);
        assert!(!status.to_string().contains("testsecret123456"));
        assert!(!status.to_string().contains("testclient123456"));
    }
    #[test]
    fn revisions_reject_stale_writes_and_keep_previous_data() {
        let root = fixture();
        publish(&root, "json", b"first", None).unwrap();
        let first = latest(&root, "json").unwrap().unwrap();
        assert!(publish(&root, "json", b"stale", None).is_err());
        assert_eq!(fs::read(&first).unwrap(), b"first");
        publish(&root, "json", b"second", Some(&first)).unwrap();
        assert_eq!(fs::read(&first).unwrap(), b"first");
        assert_eq!(
            fs::read(latest(&root, "json").unwrap().unwrap()).unwrap(),
            b"second"
        );
    }
    #[test]
    fn corrupted_cached_art_is_isolated_and_becomes_a_missing_slot() {
        let root = fixture();
        let service = Service::new(root.clone());
        let cache = root.join("cache");
        let dir = cache.join("igdb/agony");
        fs::create_dir_all(&dir).unwrap();
        let mut output = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut output, image::ImageFormat::Png)
            .unwrap();
        let bytes = output.into_inner();
        let sha = format!("{:x}", Sha256::digest(&bytes));
        let file = format!("{sha}.png");
        fs::write(dir.join(&file), &bytes).unwrap();
        let mut record = Artwork {
            schema_version: 1,
            game_id: "agony".into(),
            ..Artwork::default()
        };
        record.assets.insert(
            "front".into(),
            Asset {
                file: file.clone(),
                sha256: sha,
                mime: "image/png".into(),
                width: 2,
                height: 2,
                image_id: "test123".into(),
                source_url: "https://images.igdb.com/example.png".into(),
                igdb_game_id: 1,
                cache_root: cache.to_string_lossy().into(),
            },
        );
        publish(
            &service.artwork_dir("agony"),
            "json",
            &serde_json::to_vec(&record).unwrap(),
            None,
        )
        .unwrap();
        assert!(service.artwork("agony").unwrap()["assets"]["front"]["url"].is_string());
        fs::write(dir.join(file), b"corrupted").unwrap();
        let data = service.artwork("agony").unwrap();
        assert!(data["assets"]["front"].is_null());
        assert!(data["missing"]
            .as_array()
            .unwrap()
            .contains(&json!("front")));
        assert_eq!(data["warnings"].as_array().unwrap().len(), 1);
        assert!(service.fill("agony", 1).is_err());
    }
    #[test]
    #[ignore = "Explicit live Xbox 360 cover acceptance using the configured connection"]
    fn live_xbox360_template_covers() {
        let service = Service::new(PathBuf::from(crate::library_settings::ROOT));
        for (game_id, title) in [("halo-3", "Halo 3"), ("gears-of-war-2", "Gears of War 2")] {
            assert!(!existing_slot(&game(game_id).unwrap(), "front"));
            let found = service.lookup(game_id).unwrap();
            let candidate = found["candidates"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["name"].as_str() == Some(title))
                .expect("Exact Xbox 360 match");
            let result = service
                .fill(game_id, candidate["id"].as_u64().unwrap())
                .unwrap();
            assert!(result["assets"]["front"]["url"].is_string());
            assert!(Service::new(PathBuf::from(crate::library_settings::ROOT))
                .artwork(game_id)
                .unwrap()["assets"]["front"]["url"]
                .is_string());
        }
    }
    #[test]
    #[ignore = "Explicit live Box Art sample acceptance using the configured connection"]
    fn live_box_art_sample_covers() {
        let service = Service::new(PathBuf::from(crate::library_settings::ROOT));
        for (game_id, title) in [
            ("super-mario-bros", "Super Mario Bros."),
            ("crash-bandicoot", "Crash Bandicoot"),
            ("gran-turismo", "Gran Turismo"),
        ] {
            let found = service.lookup(game_id).unwrap();
            let candidate = found["candidates"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["name"].as_str() == Some(title))
                .expect("Exact platform match");
            let result = service
                .fill(game_id, candidate["id"].as_u64().unwrap())
                .unwrap();
            assert!(result["assets"]["front"]["url"].is_string());
            assert!(Service::new(PathBuf::from(crate::library_settings::ROOT))
                .artwork(game_id)
                .unwrap()["assets"]["front"]["url"]
                .is_string());
        }
    }
    #[test]
    #[ignore = "Explicit live IGDB acceptance using the configured Windows connection"]
    fn live_provider_lookup_fill_and_reload_are_idempotent() {
        let service = Service::new(PathBuf::from(crate::library_settings::ROOT));
        assert_eq!(service.test_connection().unwrap()["connected"], true);
        let g = game("agony").unwrap();
        let source = Path::new(g["source"].as_str().unwrap());
        let original = Sha256::digest(fs::read(source).unwrap());
        let found = service.lookup("agony").unwrap();
        let candidate = found["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["name"].as_str() == Some("Agony"))
            .expect("Exact Amiga match");
        let id = candidate["id"].as_u64().unwrap();
        let first = service.fill("agony", id).unwrap();
        assert!(first["assets"]["front"]["url"].is_string());
        let revision = latest(&service.artwork_dir("agony"), "json").unwrap();
        let again = service.fill("agony", id).unwrap();
        assert!(again["added"].as_array().unwrap().is_empty());
        assert_eq!(
            latest(&service.artwork_dir("agony"), "json").unwrap(),
            revision
        );
        assert_eq!(Sha256::digest(fs::read(source).unwrap()), original);
        assert!(Service::new(PathBuf::from(crate::library_settings::ROOT))
            .artwork("agony")
            .unwrap()["assets"]["front"]["url"]
            .is_string());
    }
}
struct Lock(PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn publish(
    dir: &Path,
    extension: &str,
    bytes: &[u8],
    expected: Option<&Path>,
) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|_| "Cannot create IGDB storage.")?;
    let lock_path = dir.join("save.lock");
    let lock_file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&lock_path)
        .map_err(|_| "IGDB storage is busy in another window.")?;
    let _lock = Lock(lock_path);
    let previous = latest(dir, extension)?;
    if previous.as_deref() != expected {
        return Err("IGDB data changed in another window. Reload and retry.".into());
    }
    let minimum = previous
        .as_ref()
        .and_then(|p| p.file_stem()?.to_str()?.parse::<u128>().ok())
        .unwrap_or(0)
        .saturating_add(1);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "System clock unavailable.")?
        .as_nanos()
        .max(minimum);
    let pending = dir.join(format!("{stamp:032}.pending"));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&pending)
        .map_err(|_| "Cannot stage IGDB data.")?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Cannot write IGDB data.")?;
    drop(file);
    if fs::read(&pending).map_err(|_| "Cannot verify IGDB data.")? != bytes {
        return Err("IGDB write verification failed.".into());
    }
    fs::rename(pending, dir.join(format!("{stamp:032}.{extension}")))
        .map_err(|_| "Cannot publish IGDB data.")?;
    drop(lock_file);
    Ok(())
}
fn read_small(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    if fs::metadata(path)
        .map_err(|_| "IGDB data file unavailable.")?
        .len()
        > limit
    {
        return Err("IGDB data exceeds its size limit.".into());
    }
    fs::read(path).map_err(|_| "Cannot read IGDB data.".into())
}
fn valid_credentials(value: &Credentials) -> Result<(), String> {
    if [&value.client_id, &value.client_secret].iter().any(|v| {
        v.len() < 10
            || v.len() > 256
            || !v
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    }) {
        return Err("Enter a valid Twitch client ID and client secret.".into());
    }
    Ok(())
}
fn parse_shared(text: &str) -> Result<Credentials, String> {
    let mut id = None;
    let mut secret = None;
    for line in text.lines() {
        let line = line
            .trim()
            .trim_start_matches('\u{feff}')
            .strip_prefix("export ")
            .unwrap_or(line.trim().trim_start_matches('\u{feff}'));
        if let Some((key, value)) = line.split_once('=') {
            let value = value
                .trim()
                .trim_matches(|c| c == '\'' || c == '"')
                .to_string();
            match key.trim() {
                "ARRDASH_SHARED_IGDB_CLIENT_ID" => id = Some(value),
                "ARRDASH_SHARED_IGDB_CLIENT_SECRET" => secret = Some(value),
                _ => {}
            }
        }
    }
    let value = Credentials {
        client_id: id.ok_or("Shared IGDB client ID is missing.")?,
        client_secret: secret.ok_or("Shared IGDB client secret is missing.")?,
    };
    valid_credentials(&value)?;
    Ok(value)
}
fn platform(game: &Value) -> Result<u64, String> {
    let mappings: std::collections::HashMap<String, u64> =
        serde_json::from_str(include_str!("../../igdb-platforms.json"))
            .map_err(|_| "IGDB platform mappings unavailable.")?;
    game["platformId"]
        .as_str()
        .and_then(|id| mappings.get(id))
        .copied()
        .ok_or("IGDB platform mapping is not configured for this game.".into())
}

fn game(id: &str) -> Result<Value, String> {
    let games: Vec<Value> = serde_json::from_str(include_str!("../../games.json"))
        .map_err(|_| "Game catalogue unavailable.")?;
    games
        .into_iter()
        .find(|g| g["id"].as_str() == Some(id))
        .ok_or("Unknown game.".into())
}
fn normal_title(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
fn image_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn classify(category: &str, endpoint: &str) -> Option<&'static str> {
    let name = category.to_lowercase();
    if name.contains("back cover") {
        Some("back")
    } else if name.contains("spine") {
        Some("spine")
    } else if endpoint == "covers" && ["", "main cover", "front cover"].contains(&name.as_str()) {
        Some("front")
    } else if (name.contains("logo") && !name.contains("historical"))
        || (endpoint == "logos" && name.is_empty())
    {
        Some("logo")
    } else if endpoint == "artworks"
        && ["artwork", "key art without logo", "key art with logo"].contains(&name.as_str())
    {
        Some("background")
    } else {
        None
    }
}
fn existing_slot(g: &Value, slot: &str) -> bool {
    (g["model"].is_string() && ["front", "back", "spine"].contains(&slot))
        || (slot == "front" && g["coverKind"] == "front" && g["cover"].is_string())
}
fn image_info(bytes: &[u8]) -> Result<(u32, u32, &'static str, &'static str), String> {
    let format =
        image::guess_format(bytes).map_err(|_| "Provider did not return a supported image.")?;
    let (mime, extension) = match format {
        image::ImageFormat::Jpeg => ("image/jpeg", "jpg"),
        image::ImageFormat::Png => ("image/png", "png"),
        _ => return Err("Unsupported provider image format.".into()),
    };
    let (w, h) = image::ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|_| "Invalid provider image.")?;
    if w == 0 || h == 0 || w > 8192 || h > 8192 || u64::from(w) * u64::from(h) > 32_000_000 {
        return Err("Provider image dimensions exceed the display limit.".into());
    }
    image::load_from_memory_with_format(bytes, format)
        .map_err(|_| "Provider image is incomplete or invalid.")?;
    Ok((w, h, mime, extension))
}

impl Service {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            editor_root: None,
            library: None,
            session: Mutex::new(Session::default()),
        }
    }
    pub fn with_editor_root(mut self, root: PathBuf) -> Self {
        self.editor_root = Some(root);
        self
    }
    pub fn with_library(mut self, library: std::sync::Arc<crate::library_index::Service>) -> Self {
        self.library = Some(library);
        self
    }
    fn game(&self, id: &str) -> Result<Value, String> {
        let mut value = if id.starts_with("library-") {
            self.library
                .as_ref()
                .ok_or("Library has not been scanned.")?
                .game(id)?
        } else {
            game(id)?
        };
        if let Some(root) = &self.editor_root {
            let base: Vec<crate::Platform> =
                serde_json::from_str(include_str!("../../platforms.json"))
                    .map_err(|_| "Invalid platform catalogue")?;
            let records = crate::platform_editor::load(root, &base)?;
            if records.iter().any(|p| {
                value["platformId"] == p.id
                    && p.details.get("boxArt").is_some_and(|v| v.is_object())
            }) {
                value.as_object_mut().unwrap().remove("model");
            }
        }
        Ok(value)
    }
    fn connection_dir(&self) -> PathBuf {
        self.root.join("config/connections/igdb/revisions")
    }
    fn credentials(&self) -> Result<(Credentials, String), String> {
        let path =
            latest(&self.connection_dir(), "bin")?.ok_or("Configure IGDB in Settings first.")?;
        let clear = crate::protected_secret::transform(&read_small(&path, 16_384)?, true)?;
        let credentials: Credentials =
            serde_json::from_slice(&clear).map_err(|_| "Invalid protected IGDB connection.")?;
        valid_credentials(&credentials)?;
        Ok((
            credentials,
            path.file_name().unwrap().to_string_lossy().into(),
        ))
    }
    pub fn status(&self) -> Result<Value, String> {
        if latest(&self.connection_dir(), "bin")?.is_none() {
            return Ok(json!({"configured":false}));
        }
        let (value, _) = self.credentials()?;
        Ok(
            json!({"configured":true,"clientIdSuffix":value.client_id.chars().rev().take(4).collect::<String>().chars().rev().collect::<String>(),"protection":"Windows user encryption"}),
        )
    }
    pub fn save_credentials(
        &self,
        client_id: String,
        client_secret: String,
    ) -> Result<Value, String> {
        let _guard = self
            .session
            .lock()
            .map_err(|_| "IGDB connection unavailable.")?;
        let value = Credentials {
            client_id: client_id.trim().into(),
            client_secret: client_secret.trim().into(),
        };
        valid_credentials(&value)?;
        let previous = latest(&self.connection_dir(), "bin")?;
        let clear = serde_json::to_vec(&value).map_err(|_| "Cannot encode connection.")?;
        publish(
            &self.connection_dir(),
            "bin",
            &crate::protected_secret::transform(&clear, false)?,
            previous.as_deref(),
        )?;
        self.status()
    }
    pub fn import_shared(&self) -> Result<Value, String> {
        let text = String::from_utf8(read_small(Path::new(SHARED_ENV), 1024 * 1024)?)
            .map_err(|_| "Shared connection file is not UTF-8.")?;
        let value = parse_shared(&text)?;
        self.save_credentials(value.client_id, value.client_secret)
    }
    fn client() -> Result<Client, String> {
        Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| "Cannot start IGDB network client.".into())
    }
    fn token(&self, session: &mut Session, client: &Client) -> Result<(String, String), String> {
        let (credentials, revision) = self.credentials()?;
        if session
            .token
            .as_ref()
            .is_none_or(|t| t.revision != revision || t.expires <= Instant::now())
        {
            let response = client
                .post("https://id.twitch.tv/oauth2/token")
                .form(&[
                    ("client_id", credentials.client_id.as_str()),
                    ("client_secret", credentials.client_secret.as_str()),
                    ("grant_type", "client_credentials"),
                ])
                .send()
                .map_err(|_| "Twitch authentication request failed.")?;
            if !response.status().is_success() {
                return Err(format!(
                    "Twitch authentication failed ({}).",
                    response.status().as_u16()
                ));
            }
            let value: Value = response
                .json()
                .map_err(|_| "Invalid Twitch authentication response.")?;
            let access = value["access_token"]
                .as_str()
                .ok_or("Twitch did not return an access token.")?
                .to_owned();
            let seconds = value["expires_in"]
                .as_u64()
                .unwrap_or(60)
                .clamp(1, 60 * 60 * 24 * 60)
                .saturating_sub(30)
                .max(1);
            session.token = Some(Token {
                access,
                expires: Instant::now() + Duration::from_secs(seconds),
                revision,
            });
        }
        Ok((
            credentials.client_id,
            session.token.as_ref().unwrap().access.clone(),
        ))
    }
    fn query(
        &self,
        session: &mut Session,
        client: &Client,
        endpoint: &str,
        body: &str,
    ) -> Result<Value, String> {
        let (id, token) = self.token(session, client)?;
        if let Some(last) = session.last_request {
            let elapsed = last.elapsed();
            if elapsed < Duration::from_millis(280) {
                std::thread::sleep(Duration::from_millis(280) - elapsed);
            }
        }
        session.last_request = Some(Instant::now());
        let response = client
            .post(format!("https://api.igdb.com/v4/{endpoint}"))
            .header("Client-ID", id)
            .bearer_auth(token)
            .header("Accept", "application/json")
            .body(body.to_owned())
            .send()
            .map_err(|_| "IGDB request failed. Check the connection and retry.")?;
        if response.status().as_u16() == 401 {
            session.token = None;
        }
        if !response.status().is_success() {
            return Err(format!(
                "IGDB request failed ({}).",
                response.status().as_u16()
            ));
        }
        let mut bytes = Vec::new();
        response
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read IGDB response.")?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("IGDB response exceeds its limit.".into());
        }
        serde_json::from_slice(&bytes).map_err(|_| "Invalid IGDB response.".into())
    }
    fn image(
        client: &Client,
        id: &str,
        logo: bool,
        thumbnail: bool,
    ) -> Result<(Vec<u8>, String), String> {
        if !image_id(id) {
            return Err("Invalid provider image ID.".into());
        }
        let url = format!(
            "https://images.igdb.com/igdb/image/upload/t_{}/{}.{}",
            if thumbnail { "thumb" } else { "1080p" },
            id,
            if logo { "png" } else { "jpg" }
        );
        let response = client
            .get(&url)
            .send()
            .map_err(|_| "Artwork download failed.")?;
        if !response.status().is_success() {
            return Err(format!(
                "Artwork download failed ({}).",
                response.status().as_u16()
            ));
        }
        let mut bytes = Vec::new();
        response
            .take(IMAGE_LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read artwork download.")?;
        if bytes.len() as u64 > IMAGE_LIMIT {
            return Err("Artwork exceeds 8 MB.".into());
        }
        image_info(&bytes)?;
        Ok((bytes, url))
    }
    pub fn test_connection(&self) -> Result<Value, String> {
        let mut session = self.session.lock().map_err(|_| "IGDB is busy.")?;
        let client = Self::client()?;
        self.query(&mut session, &client, "games/count", "where id = 1;")?;
        Ok(json!({"connected":true}))
    }
    pub fn lookup(&self, id: &str) -> Result<Value, String> {
        let g = self.game(id)?;
        let platform = platform(&g)?;
        let platform_id = g["platformId"]
            .as_str()
            .ok_or("Game platform unavailable.")?;
        if !crate::metadata_settings::Service::new(self.root.clone())
            .allows_igdb_search(platform_id)?
        {
            return Err(
                "Enable at least one IGDB artwork type and this platform in Settings → Metadata."
                    .into(),
            );
        }
        let mut session = self.session.lock().map_err(|_| "IGDB is busy.")?;
        let client = Self::client()?;
        let title = g["searchTitle"]
            .as_str()
            .or_else(|| g["title"].as_str())
            .ok_or("Game title unavailable.")?;
        let cover = crate::metadata_settings::Service::new(self.root.clone())
            .allows_igdb_type(platform_id, "cover")?;
        let cover_field = if cover { "cover.image_id," } else { "" };
        let query = format!("search {}; fields id,name,first_release_date,{cover_field}platforms; where platforms = ({platform}); limit 5;", serde_json::to_string(title).map_err(|_| "Invalid game title.")?);
        let values = self.query(&mut session, &client, "games", &query)?;
        let mut candidates: Vec<Value> = values
            .as_array()
            .ok_or("Invalid game search response.")?
            .iter()
            .filter(|c| {
                c["platforms"]
                    .as_array()
                    .is_some_and(|p| p.contains(&json!(platform)))
            })
            .cloned()
            .collect();
        candidates
            .sort_by_key(|c| normal_title(c["name"].as_str().unwrap_or("")) != normal_title(title));
        session.candidates.insert(
            id.into(),
            candidates.iter().filter_map(|c| c["id"].as_u64()).collect(),
        );
        let mut output = Vec::new();
        for c in candidates {
            let preview = c["cover"]["image_id"]
                .as_str()
                .and_then(|image| Self::image(&client, image, false, true).ok())
                .map(|(b, _)| format!("data:image/jpeg;base64,{}", STANDARD.encode(b)));
            output.push(json!({"id":c["id"],"name":c["name"],"firstReleaseDate":c["first_release_date"],"preview":preview}));
        }
        Ok(json!({"gameId":id,"candidates":output,"platformId":platform}))
    }
    fn artwork_dir(&self, id: &str) -> PathBuf {
        self.root
            .join("Assets/Metadata/IGDB")
            .join(id)
            .join("revisions")
    }
    fn load_artwork(&self, id: &str) -> Result<(Artwork, Option<PathBuf>), String> {
        let path = latest(&self.artwork_dir(id), "json")?;
        let record: Artwork = match &path {
            Some(p) => serde_json::from_slice(&read_small(p, 1024 * 1024)?)
                .map_err(|_| "Invalid saved artwork metadata.")?,
            None => Artwork {
                schema_version: 1,
                game_id: id.into(),
                ..Artwork::default()
            },
        };
        if record.schema_version != 1 || record.game_id != id {
            return Err("Saved artwork belongs to another game or schema.".into());
        }
        Ok((record, path))
    }
    pub(crate) fn cached_platform_genres(
        &self,
    ) -> Result<std::collections::BTreeMap<String, std::collections::BTreeSet<String>>, String> {
        let indexed = self
            .library
            .as_ref()
            .ok_or("Library index unavailable.")?
            .indexed_platforms()?;
        let mut genres = std::collections::BTreeMap::<_, std::collections::BTreeSet<_>>::new();
        let entries = match fs::read_dir(self.root.join("Assets/Metadata/IGDB")) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(genres),
            Err(error) => return Err(error.to_string()),
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(id) = name.to_str() else { continue };
            let Some(platform) = indexed.get(id) else { continue };
            if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                continue;
            }
            let Ok((artwork, _)) = self.load_artwork(id) else { continue };
            if let Some(metadata) = artwork.metadata {
                for genre in metadata["genres"].as_array().into_iter().flatten() {
                    if let Some(genre) = genre.as_str().filter(|value| !value.trim().is_empty()) {
                        genres.entry(platform.clone()).or_default().insert(genre.to_owned());
                    }
                }
            }
        }
        Ok(genres)
    }
    fn cached_bytes(&self, id: &str, asset: &Asset) -> Result<Vec<u8>, String> {
        let extension = if asset.mime == "image/png" {
            "png"
        } else if asset.mime == "image/jpeg" {
            "jpg"
        } else {
            return Err("Invalid cached artwork type.".into());
        };
        if asset.sha256.len() != 64
            || !asset.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            || asset.file != format!("{}.{}", asset.sha256, extension)
        {
            return Err("Invalid cached artwork reference.".into());
        }
        let stored = Path::new(&asset.cache_root);
        if (stored.starts_with("Assets/Platforms")
            || stored.starts_with("Assets/Metadata/IGDB/Unmapped"))
            && stored
                .components()
                .all(|part| matches!(part, std::path::Component::Normal(_)))
        {
            let bytes = read_small(&self.root.join(stored).join(&asset.file), IMAGE_LIMIT)?;
            if format!("{:x}", Sha256::digest(&bytes)) != asset.sha256 {
                return Err("Stored IGDB artwork hash mismatch.".into());
            }
            return Ok(bytes);
        }
        let mut cache_roots = Vec::new();
        if let Ok(settings) = crate::library_settings::load(&self.root) {
            if let Some(root) = settings["paths"]["artworkCache"].as_str() {
                cache_roots.push(PathBuf::from(root));
            }
        }
        let stored_root = PathBuf::from(&asset.cache_root);
        if !cache_roots.contains(&stored_root) {
            cache_roots.push(stored_root);
        }
        let mut last_error = "Cached artwork is unavailable.";
        for root in cache_roots {
            let path = root.join("igdb").join(id).join(&asset.file);
            let bytes = match read_small(&path, IMAGE_LIMIT) {
                Ok(bytes) => bytes,
                Err(_) => continue,
            };
            if format!("{:x}", Sha256::digest(&bytes)) != asset.sha256 {
                last_error = "Cached artwork hash mismatch.";
                continue;
            }
            image_info(&bytes)?;
            return Ok(bytes);
        }
        Err(last_error.into())
    }
    pub fn artwork(&self, id: &str) -> Result<Value, String> {
        let g = self.game(id)?;
        let (record, _) = self.load_artwork(id)?;
        let mut assets = serde_json::Map::new();
        let mut warnings = Vec::new();
        for (slot, asset) in &record.assets {
            if !SLOTS.contains(&slot.as_str()) || existing_slot(&g, slot) {
                continue;
            }
            match self.cached_bytes(id, asset) {
                Ok(bytes) => {
                    assets.insert(slot.clone(),json!({"url":format!("data:{};base64,{}",asset.mime,STANDARD.encode(bytes)),"sourceUrl":asset.source_url,"igdbGameId":asset.igdb_game_id}));
                }
                Err(_) => {
                    warnings.push(format!("Cached {slot} unavailable; lookup can repair it."))
                }
            }
        }
        let missing: Vec<_> = SLOTS
            .into_iter()
            .filter(|slot| !existing_slot(&g, slot) && !assets.contains_key(*slot))
            .collect();
        Ok(
            json!({"gameId":id,"assets":assets,"missing":missing,"warnings":warnings,"igdbGameId":record.igdb_game_id}),
        )
    }
    pub fn thumbnail(&self, id: &str, artwork_type: &str) -> Result<Option<String>, String> {
        let slot = match artwork_type {
            "front-cover" => "front",
            "back-cover" => "back",
            "3d-artwork" => "background",
            "logo" | "clear-logo" => "logo",
            _ => return Ok(None),
        };
        let artwork = self.artwork(id)?;
        Ok(artwork["assets"][slot]["url"].as_str().map(str::to_owned))
    }
    pub fn metadata(&self, id: &str) -> Result<Value, String> {
        let game = self.game(id)?;
        let (mut record, previous) = self.load_artwork(id)?;
        if let Some(metadata) = &record.metadata {
            if metadata.get("videos").is_some() {
                return Ok(metadata.clone());
            }
        }

        let selected = if let Some(selected) = record.igdb_game_id {
            Some(selected)
        } else {
            let platform = platform(&game)?;
            let title = game["searchTitle"]
                .as_str()
                .or_else(|| game["title"].as_str())
                .ok_or("Game title unavailable.")?;
            let mut session = self.session.lock().map_err(|_| "IGDB is busy.")?;
            let client = Self::client()?;
            let query = format!(
                "search {}; fields id,name,platforms; where platforms = ({platform}); limit 10;",
                serde_json::to_string(title).map_err(|_| "Invalid game title.")?
            );
            let values = self.query(&mut session, &client, "games", &query)?;
            values
                .as_array()
                .into_iter()
                .flatten()
                .find(|candidate| {
                    candidate["platforms"]
                        .as_array()
                        .is_some_and(|items| items.contains(&json!(platform)))
                        && normal_title(candidate["name"].as_str().unwrap_or(""))
                            == normal_title(title)
                })
                .and_then(|candidate| candidate["id"].as_u64())
        };

        let Some(selected) = selected else {
            let metadata = json!({"found":false,"videos":[]});
            record.metadata = Some(metadata.clone());
            let bytes =
                serde_json::to_vec_pretty(&record).map_err(|_| "Cannot encode IGDB metadata.")?;
            publish(&self.artwork_dir(id), "json", &bytes, previous.as_deref())?;
            return Ok(metadata);
        };

        let mut session = self.session.lock().map_err(|_| "IGDB is busy.")?;
        let client = Self::client()?;
        let values = self.query(&mut session, &client, "games", &format!(
            "fields name,summary,first_release_date,videos.video_id,genres.name,game_modes.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,multiplayer_modes.offlinecoopmax,multiplayer_modes.offlinemax,multiplayer_modes.onlinecoopmax,multiplayer_modes.onlinemax; where id = {selected}; limit 1;"
        ))?;
        let source = values
            .as_array()
            .and_then(|items| items.first())
            .ok_or("IGDB metadata is unavailable for this game.")?;
        let strings = |field: &str| -> Vec<String> {
            source[field]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|item| item["name"].as_str().map(str::to_owned))
                .collect()
        };
        let mut developers = Vec::new();
        let mut publishers = Vec::new();
        for company in source["involved_companies"]
            .as_array()
            .into_iter()
            .flatten()
        {
            let Some(name) = company["company"]["name"].as_str() else {
                continue;
            };
            if company["developer"] == true && !developers.iter().any(|entry| entry == name) {
                developers.push(name.to_owned());
            }
            if company["publisher"] == true && !publishers.iter().any(|entry| entry == name) {
                publishers.push(name.to_owned());
            }
        }
        let modes = strings("game_modes");
        let multiplayer = source["multiplayer_modes"].as_array().into_iter().flatten();
        let max_players = multiplayer
            .flat_map(|mode| {
                ["offlinecoopmax", "offlinemax", "onlinecoopmax", "onlinemax"]
                    .into_iter()
                    .filter_map(|key| mode[key].as_u64())
            })
            .max();
        let single_player = modes
            .iter()
            .any(|mode| normal_title(mode) == "singleplayer");
        let player_count = max_players
            .filter(|max| *max > 1)
            .map(|max| format!("{}–{max}", if single_player { 1 } else { 2 }))
            .or_else(|| single_player.then(|| "1".to_owned()));
        let videos: Vec<String> = source["videos"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|video| video["video_id"].as_str())
            .filter(|id| {
                id.len() == 11
                    && id
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
            })
            .map(str::to_owned)
            .collect();
        let metadata = json!({
            "found":true,
            "name":source["name"],
            "summary":source["summary"],
            "firstReleaseDate":source["first_release_date"],
            "genres":strings("genres"),
            "gameModes":modes,
            "developers":developers,
            "publishers":publishers,
            "playerCount":player_count,
            "videos":videos
        });
        record.igdb_game_id = Some(selected);
        record.metadata = Some(metadata.clone());
        let bytes =
            serde_json::to_vec_pretty(&record).map_err(|_| "Cannot encode IGDB metadata.")?;
        publish(&self.artwork_dir(id), "json", &bytes, previous.as_deref())?;
        Ok(metadata)
    }
    pub fn fill(&self, id: &str, selected: u64) -> Result<Value, String> {
        let g = self.game(id)?;
        let platform = platform(&g)?;
        let platform_id = g["platformId"]
            .as_str()
            .ok_or("Game platform unavailable.")?;
        if !crate::metadata_settings::Service::new(self.root.clone())
            .allows_igdb_search(platform_id)?
        {
            return Err(
                "Enable IGDB artwork types and this platform in Settings → Metadata.".into(),
            );
        }
        let mut session = self.session.lock().map_err(|_| "IGDB is busy.")?;
        if !session
            .candidates
            .get(id)
            .is_some_and(|ids| ids.contains(&selected))
        {
            return Err("Look up this game and choose one of its matches first.".into());
        }
        let client = Self::client()?;
        let verify = self.query(
            &mut session,
            &client,
            "games",
            &format!(
                "fields id,platforms; where id = {selected} & platforms = ({platform}); limit 1;"
            ),
        )?;
        if verify.as_array().is_none_or(|a| a.is_empty()) {
            return Err("That game no longer matches the selected platform.".into());
        }
        let (mut record, previous) = self.load_artwork(id)?;
        if record.igdb_game_id.is_some_and(|known| known != selected) {
            return Err("This game already has artwork matched to another IGDB entry. Existing artwork was preserved.".into());
        }
        let mut offered = BTreeMap::new();
        for (endpoint, kind) in [
            ("covers", "cover"),
            ("logos", "logo"),
            ("artworks", "artwork"),
        ] {
            if !crate::metadata_settings::Service::new(self.root.clone())
                .allows_igdb_type(platform_id, kind)?
            {
                continue;
            }
            let values = self.query(&mut session,&client,endpoint,&format!("fields image_id,image_type.name,width,height; where game = {selected}; limit 24;"))?;
            let mut images = values
                .as_array()
                .ok_or("Invalid artwork response.")?
                .clone();
            images.sort_by_key(|v| {
                let name = v["image_type"]["name"].as_str().unwrap_or("");
                if name == "Game logo (white)" {
                    0
                } else if name == "Game logo (color)" {
                    1
                } else {
                    2
                }
            });
            for item in images {
                if let (Some(slot), Some(image)) = (
                    classify(item["image_type"]["name"].as_str().unwrap_or(""), endpoint),
                    item["image_id"].as_str(),
                ) {
                    if image_id(image) {
                        offered.entry(slot.to_owned()).or_insert(image.to_owned());
                    }
                }
            }
        }
        if platform_id.is_empty()
            || !platform_id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err("Invalid platform ID for artwork storage.".into());
        }
        let mut added = Vec::new();
        let mut errors = Vec::new();
        for (slot, image) in offered {
            if existing_slot(&g, &slot)
                || record
                    .assets
                    .get(&slot)
                    .is_some_and(|a| self.cached_bytes(id, a).is_ok())
            {
                continue;
            }
            match Self::image(&client, &image, slot == "logo", false) {
                Ok((bytes, url)) => {
                    let (width, height, mime, extension) = image_info(&bytes)?;
                    let sha = format!("{:x}", Sha256::digest(&bytes));
                    let file = format!("{sha}.{extension}");
                    let category = match slot.as_str() {
                        "front" => "Box/Front",
                        "back" => "Box/Back",
                        "spine" => "Box/Spine",
                        "logo" => "Logo",
                        "background" => "Background",
                        _ => return Err("Unknown IGDB artwork slot.".into()),
                    };
                    let directory = PathBuf::from("Assets/Platforms")
                        .join(platform_id)
                        .join("Artwork")
                        .join(category)
                        .join("IGDB")
                        .join(id);
                    let path = self.root.join(&directory).join(&file);
                    fs::create_dir_all(path.parent().unwrap())
                        .map_err(|_| "Cannot create IGDB artwork folder.")?;
                    if path.exists() {
                        if fs::read(&path).map_err(|_| "Cannot read artwork cache.")? != bytes {
                            return Err("Existing cache file differs; it was preserved.".into());
                        }
                    } else {
                        let mut output = fs::OpenOptions::new()
                            .create_new(true)
                            .write(true)
                            .open(&path)
                            .map_err(|_| "Cannot write artwork cache.")?;
                        output
                            .write_all(&bytes)
                            .and_then(|_| output.sync_all())
                            .map_err(|_| "Cannot save artwork cache.")?;
                    }
                    record.assets.insert(
                        slot.clone(),
                        Asset {
                            file,
                            sha256: sha,
                            mime: mime.into(),
                            width,
                            height,
                            image_id: image,
                            source_url: url,
                            igdb_game_id: selected,
                            cache_root: directory.to_string_lossy().into(),
                        },
                    );
                    added.push(slot);
                }
                Err(error) => errors.push(format!("{slot}: {error}")),
            }
        }
        if !added.is_empty() {
            record.igdb_game_id = Some(selected);
            let bytes = serde_json::to_vec_pretty(&record)
                .map_err(|_| "Cannot encode artwork metadata.")?;
            publish(&self.artwork_dir(id), "json", &bytes, previous.as_deref())?;
        }
        let mut result = self.artwork(id)?;
        result["added"] = json!(added);
        result["errors"] = json!(errors);
        Ok(result)
    }
}
