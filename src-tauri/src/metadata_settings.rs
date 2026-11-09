use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const TYPES_IGDB: &[&str] = &["cover", "logo", "artwork"];
const TYPES_SGDB: &[&str] = &["grid", "hero", "logo"];

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default)]
    api_key: String,
    igdb_types: Vec<String>,
    steamgriddb_types: Vec<String>,
    platforms: Vec<String>,
}

struct Lock(PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub struct Service {
    root: PathBuf,
}

impl Service {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn directory(&self) -> PathBuf {
        self.root.join("config/connections/metadata/revisions")
    }

    fn platform_ids() -> Result<Vec<String>, String> {
        let values: Vec<Value> = serde_json::from_str(include_str!("../../platforms.json"))
            .map_err(|_| "Platform catalogue is unavailable.")?;
        Ok(values
            .into_iter()
            .filter_map(|row| row["id"].as_str().map(str::to_owned))
            .collect())
    }

    fn defaults() -> Result<Settings, String> {
        Ok(Settings {
            api_key: String::new(),
            igdb_types: TYPES_IGDB.iter().map(|x| (*x).to_owned()).collect(),
            steamgriddb_types: TYPES_SGDB.iter().map(|x| (*x).to_owned()).collect(),
            platforms: Self::platform_ids()?,
        })
    }

    fn latest(&self) -> Result<Option<PathBuf>, String> {
        let dir = self.directory();
        if !dir.exists() {
            return Ok(None);
        }
        let mut paths = Vec::new();
        for entry in fs::read_dir(dir).map_err(|_| "Cannot read metadata settings.")? {
            let path = entry.map_err(|_| "Cannot read metadata settings.")?.path();
            let name = path.file_name().and_then(|x| x.to_str()).unwrap_or("");
            if name.len() == 36
                && name.ends_with(".bin")
                && name[..32].bytes().all(|b| b.is_ascii_digit())
            {
                paths.push(path);
            }
        }
        paths.sort();
        Ok(paths.pop())
    }

    fn read(&self) -> Result<Settings, String> {
        let Some(path) = self.latest()? else {
            return Self::defaults();
        };
        let bytes = fs::read(path).map_err(|_| "Cannot read protected metadata settings.")?;
        let clear = crate::protected_secret::transform(&bytes, true)?;
        serde_json::from_slice(&clear)
            .map_err(|_| "Protected metadata settings are invalid.".to_owned())
    }

    fn validate(value: &Settings) -> Result<(), String> {
        if !value.api_key.is_empty()
            && (value.api_key.len() < 10
                || value.api_key.len() > 256
                || value
                    .api_key
                    .bytes()
                    .any(|b| b.is_ascii_whitespace() || b.is_ascii_control()))
        {
            return Err("Enter a valid SteamGridDB API key.".into());
        }
        fn valid_types(values: &[String], allowed: &[&str]) -> bool {
            values.len() <= allowed.len()
                && values.iter().all(|v| allowed.contains(&v.as_str()))
                && values
                    .iter()
                    .collect::<std::collections::HashSet<_>>()
                    .len()
                    == values.len()
        }
        if !valid_types(&value.igdb_types, TYPES_IGDB)
            || !valid_types(&value.steamgriddb_types, TYPES_SGDB)
        {
            return Err("Choose only the listed metadata types.".into());
        }
        let platforms = Self::platform_ids()?;
        if value.platforms.iter().any(|v| !platforms.contains(v))
            || value
                .platforms
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != value.platforms.len()
        {
            return Err("Choose only the listed platforms.".into());
        }
        Ok(())
    }

    fn view(&self) -> Result<Value, String> {
        let settings = self.read()?;
        Ok(
            json!({"configured": !settings.api_key.is_empty(), "igdbTypes": settings.igdb_types,
            "steamgriddbTypes": settings.steamgriddb_types, "platforms": settings.platforms,
            "availablePlatforms": Self::platform_ids()?, "protection": "Windows user encryption"}),
        )
    }

    pub fn status(&self) -> Result<Value, String> {
        self.view()
    }

    pub fn allows_igdb_search(&self, platform_id: &str) -> Result<bool, String> {
        let settings = self.read()?;
        Ok(settings
            .platforms
            .iter()
            .any(|platform| platform == platform_id)
            && !settings.igdb_types.is_empty())
    }

    pub fn allows_igdb_type(&self, platform_id: &str, kind: &str) -> Result<bool, String> {
        let settings = self.read()?;
        Ok(settings
            .platforms
            .iter()
            .any(|platform| platform == platform_id)
            && settings.igdb_types.iter().any(|item| item == kind))
    }

    pub fn save(&self, api_key: String, preferences: Value) -> Result<Value, String> {
        let mut next: Settings =
            serde_json::from_value(preferences).map_err(|_| "Metadata settings are invalid.")?;
        if api_key.trim().is_empty() {
            next.api_key = self.read()?.api_key;
        } else {
            next.api_key = api_key.trim().to_owned();
        }
        Self::validate(&next)?;
        let dir = self.directory();
        fs::create_dir_all(&dir).map_err(|_| "Cannot create metadata settings.")?;
        let lock_path = dir.join("save.lock");
        let _lock_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
            .map_err(|_| {
                "Metadata settings are being saved in another window. Retry after it finishes."
            })?;
        let _lock = Lock(lock_path);
        let current = self.latest()?;
        let minimum = current
            .as_ref()
            .and_then(|p| p.file_stem()?.to_str()?.parse::<u128>().ok())
            .unwrap_or(0)
            .saturating_add(1);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "System clock unavailable.")?
            .as_nanos()
            .max(minimum);
        let bytes = crate::protected_secret::transform(
            &serde_json::to_vec(&next).map_err(|_| "Cannot encode metadata settings.")?,
            false,
        )?;
        let pending = dir.join(format!("{stamp:032}.pending"));
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&pending)
            .map_err(|_| "Cannot stage metadata settings.")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot write metadata settings.")?;
        drop(file);
        if fs::read(&pending).map_err(|_| "Cannot verify metadata settings.")? != bytes {
            return Err("Metadata settings verification failed.".into());
        }
        fs::rename(pending, dir.join(format!("{stamp:032}.bin")))
            .map_err(|_| "Cannot publish metadata settings.")?;
        self.view()
    }

    pub fn test(&self) -> Result<Value, String> {
        let value = self.read()?;
        if value.api_key.is_empty() {
            return Err("Save a SteamGridDB API key first.".into());
        }
        let http = Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(12))
            .build()
            .map_err(|_| "Cannot start SteamGridDB connection.")?;
        let response = http
            .get("https://www.steamgriddb.com/api/v2/search/autocomplete/Mario")
            .bearer_auth(&value.api_key)
            .send()
            .map_err(|_| "Could not reach SteamGridDB. Check the connection and retry.")?;
        if response.status().as_u16() == 401 {
            return Err("SteamGridDB rejected this API key. Check it and save again.".into());
        }
        if !response.status().is_success() {
            return Err(format!(
                "SteamGridDB connection failed (HTTP {}).",
                response.status().as_u16()
            ));
        }
        let result: Value = response
            .json()
            .map_err(|_| "SteamGridDB returned an invalid response.")?;
        if result["success"].as_bool() != Some(true) || !result["data"].is_array() {
            return Err("SteamGridDB did not confirm the API key.".into());
        }
        Ok(json!({"connected": true}))
    }
}
