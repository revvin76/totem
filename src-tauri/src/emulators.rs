use serde_json::{json, Value};
use std::{
    fs::{self, Metadata},
    io::{ErrorKind, Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
const SECTION: &str = "emulators";
static OPERATIONS: std::sync::Mutex<()> = std::sync::Mutex::new(());
fn catalogue() -> Vec<Value> {
    serde_json::from_str(include_str!("../../emulator-catalogue.json"))
        .expect("valid emulator catalogue")
}
fn initial() -> Value {
    let records = catalogue()
        .into_iter()
        .map(default_record)
        .collect::<Vec<_>>();
    json!({"version":1,"revision":null,"emulators":records})
}
fn default_record(mut record: Value) -> Value {
    record["enabled"] = json!(false);
    record["workingFolder"] = json!("");
    record["executable"] = json!("");
    record["installedVersion"] = json!("");
    record["autoUpdate"] = json!(false);
    record["switches"] = json!(record["switches"]
        .as_array()
        .unwrap()
        .iter()
        .map(|switch| json!({"argument":switch,"enabled":false}))
        .collect::<Vec<_>>());
    record
}
fn add_catalogue_defaults(document: &mut Value) -> Result<(), String> {
    let records = document["emulators"]
        .as_array_mut()
        .ok_or("Invalid emulator list.")?;
    let known_ids = records
        .iter()
        .filter_map(|record| record["id"].as_str().map(str::to_owned))
        .collect::<std::collections::HashSet<_>>();
    records.extend(
        catalogue()
            .into_iter()
            .filter(|record| !known_ids.contains(record["id"].as_str().unwrap_or_default()))
            .map(default_record),
    );
    Ok(())
}
fn validate(doc: &Value) -> Result<(), String> {
    if doc["version"] != 1 {
        return Err("Unsupported emulator settings version.".into());
    }
    let records = doc["emulators"]
        .as_array()
        .filter(|r| r.len() <= 300)
        .ok_or("Invalid emulator list.")?;
    let mut ids = std::collections::HashSet::new();
    for e in records {
        let id = e["id"].as_str().ok_or("Missing emulator ID.")?;
        if id.is_empty()
            || id.len() > 100
            || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || !ids.insert(id)
        {
            return Err("Invalid or duplicate emulator ID.".into());
        }
        for (key, limit) in [
            ("name", 100),
            ("workingFolder", 1024),
            ("executable", 1024),
            ("installedVersion", 100),
            ("website", 2000),
        ] {
            let text = e[key].as_str().ok_or("Missing emulator field.")?;
            if text.len() > limit || text.chars().any(char::is_control) {
                return Err(format!("Invalid {key}."));
            }
        }
        if e["name"].as_str().unwrap().trim().is_empty() {
            return Err("Enter an emulator name.".into());
        }
        let website = e["website"].as_str().unwrap();
        if !website.is_empty() {
            let url = reqwest::Url::parse(website).map_err(|_| "Enter a valid HTTPS website.")?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err("Use an HTTPS website without credentials.".into());
            }
        }
        for key in ["enabled", "autoUpdate"] {
            if !e[key].is_boolean() {
                return Err("Invalid emulator toggle.".into());
            }
        }
        let folder = e["workingFolder"].as_str().unwrap();
        let executable = e["executable"].as_str().unwrap();
        if (!folder.is_empty() && !Path::new(folder).is_absolute())
            || [folder, executable].iter().any(|s| {
                Path::new(s)
                    .components()
                    .any(|c| matches!(c, Component::ParentDir))
            })
        {
            return Err("Use an absolute working folder without parent traversal.".into());
        }
        if e["enabled"] == true
            && (folder.is_empty() || !executable.to_lowercase().ends_with(".exe"))
        {
            return Err("Enabled emulators need a working folder and an .exe executable.".into());
        }
        if !e["platforms"].as_array().is_some_and(|v| {
            v.len() <= 300
                && v.iter().all(|x| {
                    x.as_str().is_some_and(|s| {
                        s.len() <= 100
                            && s.bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                    })
                })
        }) {
            return Err("Invalid supported platforms.".into());
        }
        if !e["switches"].as_array().is_some_and(|v| {
            v.len() <= 100
                && v.iter().all(|s| {
                    s["enabled"].is_boolean()
                        && s["argument"].as_str().is_some_and(|s| {
                            !s.is_empty() && s.len() <= 1000 && !s.chars().any(char::is_control)
                        })
                })
        }) {
            return Err("Invalid launch switch.".into());
        }
        if e["autoUpdate"] == true
            && !catalogue()
                .iter()
                .any(|c| c["id"] == e["id"] && c["wingetId"].is_string())
        {
            return Err("Automatic updates are not supported for this emulator.".into());
        }
    }
    Ok(())
}
pub fn load(root: &Path) -> Result<Value, String> {
    let mut doc = crate::admin_storage::load(root, SECTION, initial())?;
    add_catalogue_defaults(&mut doc)?;
    validate(&doc)?;
    Ok(doc)
}
pub fn save(root: &Path, mut doc: Value, expected: Option<&str>) -> Result<Value, String> {
    let _guard = OPERATIONS
        .try_lock()
        .map_err(|_| "An emulator update or save is already running.")?;
    add_catalogue_defaults(&mut doc)?;
    validate(&doc)?;
    doc.as_object_mut().unwrap().remove("availability");
    crate::admin_storage::save(root, SECTION, doc, expected, initial())
}
fn view(root: &Path) -> Result<Value, String> {
    let mut doc = load(root)?;
    let mut availability = serde_json::Map::new();
    for e in doc["emulators"].as_array().unwrap() {
        let folder = Path::new(e["workingFolder"].as_str().unwrap());
        availability.insert(e["id"].as_str().unwrap().to_owned(),json!({"folderExists":folder.is_dir(),"executableExists":configured_executable_exists(e)}));
    }
    doc["availability"] = Value::Object(availability);
    Ok(doc)
}
fn configured_executable_exists(record: &Value) -> bool {
    let folder = record["workingFolder"].as_str().unwrap_or_default();
    let executable = record["executable"].as_str().unwrap_or_default();
    !folder.is_empty() && !executable.is_empty() && Path::new(folder).join(executable).is_file()
}
fn matching_emulators<'a>(document: &'a Value, platform_id: &str) -> Vec<(&'a Value, bool)> {
    document["emulators"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|record| {
            record["enabled"] == true
                && record["platforms"]
                    .as_array()
                    .is_some_and(|platforms| platforms.iter().any(|id| id == platform_id))
        })
        .map(|record| (record, configured_executable_exists(record)))
        .collect()
}

pub(crate) fn select_emulator<'a>(
    matching: &[(&'a Value, bool)],
) -> Result<&'a Value, (&'static str, &'static str)> {
    if matching.is_empty() {
        return Err((
            "noEnabledEmulator",
            "No emulator is enabled for this platform. Enable one in Settings → Emulators.",
        ));
    }
    let mut ready = matching.iter().filter(|(_, available)| *available);
    let Some((record, _)) = ready.next() else {
        return Err((
            "noReadyEmulator",
            "The enabled emulator for this platform is not installed or its executable is missing.",
        ));
    };
    if ready.next().is_some() {
        return Err(("ambiguous",
            "More than one installed emulator is enabled for this platform. Disable all but the one you want to use in Settings → Emulators."));
    }
    Ok(record)
}

fn mame_target(game_path: &Path) -> Result<(&str, std::ffi::OsString), &'static str> {
    let machine = game_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| {
            !stem.is_empty() && stem.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        })
        .ok_or("Invalid MAME machine name.")?;
    let mut rom_path = game_path
        .parent()
        .ok_or("Missing MAME ROM folder.")?
        .as_os_str()
        .to_owned();
    rom_path.push(";roms");
    Ok((machine, rom_path))
}

pub fn diagnostics(
    root: &Path,
    platform_id: &str,
    game_path: Option<&Path>,
    file_error: Option<&str>,
) -> Value {
    let inspect = || {
        let _guard = OPERATIONS
            .try_lock()
            .map_err(|_| "An emulator update or settings save is in progress.".to_owned())?;
        let document = load(root)?;
        let matching = matching_emulators(&document, platform_id);
        let records: Vec<_> = matching
            .iter()
            .map(|(record, available)| {
                json!({
                    "id": record["id"],
                    "name": record["name"],
                    "executableAvailable": available,
                })
            })
            .collect();
        let selected = select_emulator(&matching);
        let (status, reason) = if let Some(reason) = file_error {
            ("gameFileUnavailable", Some(reason))
        } else {
            match selected {
                Err((status, reason)) => (status, Some(reason)),
                Ok(record) if record["id"] == "mame" && platform_id == "arcade" => {
                    match game_path
                        .ok_or("Game path is unavailable.")
                        .and_then(mame_target)
                    {
                        Ok(_) => ("ready", None),
                        Err(reason) => ("invalidLaunchTarget", Some(reason)),
                    }
                }
                Ok(_) => ("ready", None),
            }
        };
        Ok::<_, String>(json!({
            "status": status,
            "reason": reason,
            "matchingEmulators": records,
            "selectedEmulatorId": selected.ok().map(|record| &record["id"]),
        }))
    };
    inspect().unwrap_or_else(|error| json!({
        "status": if file_error.is_some() { "gameFileUnavailable" } else { "registryUnavailable" },
        "reason": file_error.unwrap_or("Could not inspect the emulator registry."),
        "registryError": error,
        "matchingEmulators": null,
        "selectedEmulatorId": null,
    }))
}

#[cfg(windows)]
pub fn exit_profile(record: &Value) -> Result<crate::universal_emulator_exit::Profile, String> {
    if let Some(profile) = record.get("exitProfile") {
        return crate::universal_emulator_exit::Profile::parse(profile);
    }
    let defaults = catalogue()
        .into_iter()
        .find(|entry| entry["id"] == record["id"]);
    crate::universal_emulator_exit::Profile::parse(
        defaults
            .as_ref()
            .map_or(&Value::Null, |entry| &entry["exitProfile"]),
    )
}

pub fn spawn_game<T>(
    root: &Path,
    platform_id: &str,
    game_path: &Path,
    before_spawn: impl FnOnce(&Value) -> T,
) -> Result<(String, std::process::Child, T), String> {
    let _guard = OPERATIONS
        .try_lock()
        .map_err(|_| "An emulator update or settings save is in progress.")?;
    let document = load(root)?;
    let matching = matching_emulators(&document, platform_id);
    let record = select_emulator(&matching).map_err(|(_, reason)| reason)?;
    let folder = Path::new(record["workingFolder"].as_str().unwrap());
    let executable = folder.join(record["executable"].as_str().unwrap());
    let mut command = Command::new(&executable);
    command.current_dir(folder);
    if let Some(switches) = record["switches"].as_array() {
        for switch in switches.iter().filter(|switch| switch["enabled"] == true) {
            if let Some(argument) = switch["argument"].as_str() {
                command.arg(argument);
            }
        }
    }
    if record["id"] == "mame" && platform_id == "arcade" {
        // MAME takes a machine name and looks for its ROM and parent sets in rompath.
        let (machine, rom_path) = mame_target(game_path)?;
        command.arg(machine).arg("-rompath").arg(rom_path);
    } else {
        command.arg(game_path);
    }
    let context = before_spawn(record);
    let name = record["name"].as_str().unwrap_or("Emulator");
    let child = command
        .spawn()
        .map_err(|error| format!("Could not launch {name}. {error}"))?;
    Ok((name.to_owned(), child, context))
}
#[tauri::command]
pub async fn load_emulators() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| view(Path::new(crate::library_settings::ROOT)))
        .await
        .map_err(|_| "Emulator settings worker failed.".to_owned())?
}
#[tauri::command]
pub async fn save_emulators(
    document: Value,
    expected_revision: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(crate::library_settings::ROOT);
        save(root, document, expected_revision.as_deref())?;
        view(root)
    })
    .await
    .map_err(|_| "Emulator save worker failed.".to_owned())?
}

fn scan_executable(folder: &Path, names: &[Value]) -> Result<Option<PathBuf>, String> {
    let directories = [folder.to_owned()];
    let mut nested = Vec::new();
    for entry in fs::read_dir(folder).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if metadata.is_dir() && !is_link(&metadata) {
            nested.push(entry.path());
        }
    }
    for directories in [directories.as_slice(), nested.as_slice()] {
        for name in names.iter().filter_map(Value::as_str) {
            let mut matches = directories
                .iter()
                .map(|directory| directory.join(name))
                .filter(|path| {
                    fs::symlink_metadata(path)
                        .is_ok_and(|metadata| metadata.is_file() && !is_link(&metadata))
                });
            if let Some(path) = matches.next() {
                if matches.next().is_some() {
                    return Err(format!(
                        "Multiple copies of {name}. Choose one in Settings."
                    ));
                }
                return Ok(Some(path));
            }
        }
    }
    Ok(None)
}

fn scan(root: &Path, expected_revision: Option<&str>) -> Result<Value, String> {
    let _guard = OPERATIONS
        .try_lock()
        .map_err(|_| "Another emulator operation is running.")?;
    let install_root = root.join("emulators");
    if !plain_directory(&install_root)? {
        return Err(format!(
            "Emulators folder not found at {}.",
            install_root.display()
        ));
    }
    let mut document = load(root)?;
    if document["revision"].as_str() != expected_revision {
        return Err("Settings changed in another window. Reload before scanning.".into());
    }
    let records = document["emulators"].as_array_mut().unwrap();
    let mut configured_paths = records
        .iter()
        .filter_map(|record| {
            let executable = record["executable"]
                .as_str()
                .filter(|path| !path.is_empty())?;
            Path::new(record["workingFolder"].as_str()?)
                .join(executable)
                .canonicalize()
                .ok()
        })
        .collect::<std::collections::HashSet<_>>();
    let profiles = catalogue();
    let mut found = Vec::new();
    let mut skipped = Vec::new();
    for entry in fs::read_dir(&install_root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let folder = entry.path();
        let metadata = fs::symlink_metadata(&folder).map_err(|error| error.to_string())?;
        if !metadata.is_dir() || is_link(&metadata) {
            continue;
        }
        let folder_name = entry.file_name();
        let folder_name = folder_name.to_string_lossy();
        let Some(profile) = profiles
            .iter()
            .find(|profile| folder_name.eq_ignore_ascii_case(profile["id"].as_str().unwrap()))
        else {
            skipped.push(format!("{folder_name}: no catalogue match."));
            continue;
        };
        let record = records
            .iter_mut()
            .find(|record| record["id"] == profile["id"])
            .unwrap();
        if record["executable"] != "" {
            continue;
        }
        let Some(names) = profile["scanExecutables"]
            .as_array()
            .or_else(|| profile["wingetInstall"]["executables"].as_array())
            .or_else(|| profile["githubInstall"]["executables"].as_array())
        else {
            skipped.push(format!("{folder_name}: no executable profile."));
            continue;
        };
        let executable = match scan_executable(&folder, names) {
            Ok(Some(path)) => path,
            Ok(None) => {
                skipped.push(format!("{folder_name}: expected executable not found."));
                continue;
            }
            Err(error) => {
                skipped.push(format!("{folder_name}: {error}"));
                continue;
            }
        };
        if !configured_paths.insert(
            executable
                .canonicalize()
                .map_err(|error| error.to_string())?,
        ) {
            continue;
        }
        if record["workingFolder"] != "" {
            // Keep a working folder the user already set, even when the executable was blank.
            record["executable"] = json!(executable);
        } else {
            record["workingFolder"] = json!(executable.parent().unwrap());
            record["executable"] = json!(executable.file_name().unwrap().to_string_lossy());
        }
        found.push(record["name"].as_str().unwrap().to_owned());
    }
    if !found.is_empty() {
        validate(&document)?;
        crate::admin_storage::save(root, SECTION, document, expected_revision, initial())?;
    }
    found.sort();
    skipped.sort();
    Ok(json!({"settings": view(root)?, "found": found, "skipped": skipped}))
}

#[tauri::command]
pub async fn scan_emulators(expected_revision: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        scan(
            Path::new(crate::library_settings::ROOT),
            expected_revision.as_deref(),
        )
    })
    .await
    .map_err(|_| "Emulator scan worker failed.".to_owned())?
}

fn launch_standalone(root: &Path, id: &str) -> Result<(), String> {
    let _guard = OPERATIONS
        .try_lock()
        .map_err(|_| "Another emulator operation is running.")?;
    let document = load(root)?;
    let record = document["emulators"]
        .as_array()
        .unwrap()
        .iter()
        .find(|record| record["id"] == id)
        .ok_or("Emulator not found.")?;
    let folder = Path::new(record["workingFolder"].as_str().unwrap());
    let executable = folder.join(record["executable"].as_str().unwrap());
    let name = record["name"].as_str().unwrap();
    if !folder.is_dir()
        || !configured_executable_exists(record)
        || !executable
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        return Err(format!(
            "Set a valid working folder and .exe for {name} in Settings."
        ));
    }
    Command::new(&executable)
        .current_dir(folder)
        .spawn()
        .map_err(|error| format!("Could not launch {name}. {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn launch_emulator(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        launch_standalone(Path::new(crate::library_settings::ROOT), &id)
    })
    .await
    .map_err(|_| "Emulator launch worker failed.".to_owned())?
}

#[tauri::command]
pub fn open_emulator_website(id: String) -> Result<(), String> {
    let doc = load(Path::new(crate::library_settings::ROOT))?;
    let url = doc["emulators"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id)
        .and_then(|e| e["website"].as_str())
        .ok_or("Unknown emulator website.")?;
    let mut command = Command::new("rundll32.exe");
    command.args(["url.dll,FileProtocolHandler", url]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .spawn()
        .map_err(|_| "Could not open the emulator website.")?;
    Ok(())
}

fn winget(args: &[&str], timeout: Duration) -> Result<String, String> {
    let winget_path = std::path::PathBuf::from(
        std::env::var_os("LOCALAPPDATA").ok_or("WinGet location unavailable.")?,
    )
    .join("Microsoft/WindowsApps/winget.exe");
    let mut cmd = Command::new(winget_path);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("WinGet could not start. {error}"))?;
    // Drain both streams concurrently so a verbose package operation cannot fill either pipe.
    let mut out = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        s
    });
    let mut err = child.stderr.take().unwrap();
    let error_reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut s = String::new();
        let _ = err.read_to_string(&mut s);
        s
    });
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let stdout = reader.join().unwrap_or_default();
            let stderr = error_reader.join().unwrap_or_default();
            let text = format!("{}\n{}", stdout.trim(), stderr.trim());
            return if status.success() {
                Ok(text)
            } else if args.first() == Some(&"upgrade")
                && status.code().map(|v| v as u32) == Some(0x8A15002B)
            {
                Ok(format!("No update available. {text}"))
            } else if args.first() == Some(&"install")
                && status.code().map(|v| v as u32) == Some(0x8A150061)
            {
                Err("WinGet already has this package installed. Configure its existing executable in Totem.".into())
            } else {
                Err(format!(
                    "WinGet could not complete the operation ({}). Open WinGet to review it. {}",
                    status.code().unwrap_or(-1),
                    text.chars().take(1200).collect::<String>()
                ))
            };
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            let _ = error_reader.join();
            return Err("WinGet timed out. Check its status before retrying.".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WingetInstall {
    package: String,
    installer_type: String,
    executables: Vec<String>,
    #[serde(default)]
    nested: bool,
}

fn install_arguments<'a>(package: &'a WingetInstall, location: &'a str) -> [&'a str; 13] {
    [
        "install",
        "--id",
        &package.package,
        "--exact",
        "--source",
        "winget",
        "--installer-type",
        &package.installer_type,
        "--location",
        location,
        "--no-upgrade",
        "--silent",
        "--disable-interactivity",
    ]
}

fn is_link(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Covers Windows junctions as well as symbolic links.
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn plain_directory(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !is_link(&metadata) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Ok(_) => Err(format!("Use a regular directory at {}.", path.display())),
        Err(error) => Err(format!("Could not check {}. {error}", path.display())),
    }
}

fn installed_executable(folder: &Path, package: &WingetInstall) -> Result<PathBuf, String> {
    let missing = || {
        format!(
            "WinGet finished but the emulator executable was not found under {}.",
            folder.display()
        )
    };
    if !plain_directory(folder)? {
        return Err(missing());
    }
    let find = |directory: &Path| {
        package
            .executables
            .iter()
            .map(|name| directory.join(name))
            .find(|path| {
                fs::symlink_metadata(path)
                    .is_ok_and(|metadata| metadata.is_file() && !is_link(&metadata))
            })
    };
    if let Some(path) = find(folder) {
        return Ok(path);
    }
    // Some portable packages retain their versioned folder inside the archive.
    if package.nested {
        for entry in fs::read_dir(folder).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
            if metadata.is_dir() && !is_link(&metadata) {
                if let Some(path) = find(&entry.path()) {
                    return Ok(path);
                }
            }
        }
    }
    Err(missing())
}

#[cfg(windows)]
fn registered_winget_executable(id: &str, package: &WingetInstall) -> Option<PathBuf> {
    if id == "azahar" {
        use std::path::Prefix;
        use winreg::{enums::*, RegKey};

        let key = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Azahar";
        for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
                let folder = RegKey::predef(hive)
                    .open_subkey_with_flags(key, KEY_READ | view)
                    .and_then(|entry| entry.get_value::<String, _>("InstallLocation"))
                    .map(PathBuf::from);
                if let Ok(folder) = folder {
                    let mut components = folder.components();
                    let drive_path = matches!(
                        components.next(),
                        Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_))
                    );
                    if drive_path
                        && folder.is_absolute()
                        && !components.any(|part| part == Component::ParentDir)
                    {
                        if let Ok(executable) = installed_executable(&folder, package) {
                            return Some(executable);
                        }
                    }
                }
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn registered_winget_executable(_: &str, _: &WingetInstall) -> Option<PathBuf> {
    None
}

fn install_winget(
    root: &Path,
    id: &str,
    expected_revision: Option<&str>,
    run_winget: impl FnOnce(&[&str], Duration) -> Result<String, String>,
    find_registered_executable: impl Fn(&str, &WingetInstall) -> Option<PathBuf>,
) -> Result<Value, String> {
    let known = catalogue()
        .into_iter()
        .find(|record| record["id"] == id)
        .ok_or("This emulator has no supported WinGet install.")?;
    let package: WingetInstall = serde_json::from_value(known["wingetInstall"].clone())
        .map_err(|_| "This emulator has no supported WinGet install.")?;
    let mut document = load(root)?;
    if document["revision"].as_str() != expected_revision {
        return Err("Emulator settings changed. Reload the list before installing.".into());
    }
    let record = document["emulators"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|record| record["id"] == id)
        .ok_or("This emulator is no longer in the list.")?;
    if configured_executable_exists(record) {
        return Err("This emulator already has a configured executable.".into());
    }
    if !plain_directory(root)? {
        return Err("Totem's app root is missing.".into());
    }
    let registered_executable = || find_registered_executable(id, &package);
    let executable = match registered_executable() {
        Some(executable) => executable,
        None => install_winget_package(root, id, &package, run_winget, registered_executable)?,
    };
    record["workingFolder"] = json!(executable
        .parent()
        .and_then(Path::to_str)
        .ok_or("Invalid installed folder.")?);
    record["executable"] = json!(executable
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid executable name.")?);
    record["installedVersion"] = json!("");
    record["enabled"] = json!(true);
    validate(&document)?;
    crate::admin_storage::save(root, SECTION, document, expected_revision, initial()).map_err(
        |error| {
            format!(
                "Found {}. Totem could not save the configuration. {error}",
                executable.display()
            )
        },
    )?;
    view(root)
}

fn install_winget_package(
    root: &Path,
    id: &str,
    package: &WingetInstall,
    run_winget: impl FnOnce(&[&str], Duration) -> Result<String, String>,
    registered_executable: impl FnOnce() -> Option<PathBuf>,
) -> Result<PathBuf, String> {
    let emulators = root.join("emulators");
    if let Err(error) = fs::create_dir(&emulators) {
        if error.kind() != ErrorKind::AlreadyExists {
            return Err(format!("Could not create {}. {error}", emulators.display()));
        }
    }
    if !plain_directory(&emulators)? {
        return Err("Totem's emulators folder is missing.".into());
    }
    let location = emulators.join(id);
    if plain_directory(&location)?
        && fs::read_dir(&location)
            .map_err(|error| error.to_string())?
            .next()
            .transpose()
            .map_err(|error| error.to_string())?
            .is_some()
    {
        return Err(format!(
            "{} already contains files. Configure the existing executable in Totem.",
            location.display()
        ));
    }
    let location_arg = location.to_str().ok_or("Invalid emulator install path.")?;
    run_winget(
        &install_arguments(package, location_arg),
        Duration::from_secs(600),
    )?;
    if !plain_directory(root)? || !plain_directory(&emulators)? {
        return Err("Totem's emulators folder is missing after installation.".into());
    }
    installed_executable(&location, package).or_else(|error| registered_executable().ok_or(error))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubInstall {
    asset_contains: String,
    executables: Vec<String>,
}

#[derive(serde::Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

struct InstallStage(PathBuf);
impl Drop for InstallStage {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

const MAX_GITHUB_ARCHIVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_GITHUB_ARCHIVE_ENTRIES: usize = 20_000;

fn extract_github_zip(
    archive_path: &Path,
    destination: &Path,
    allowed_executables: &[String],
) -> Result<PathBuf, String> {
    let file = fs::File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|_| "GitHub release was not a valid ZIP archive.")?;
    if archive.len() > MAX_GITHUB_ARCHIVE_ENTRIES {
        return Err("GitHub release contains too many files to install safely.".into());
    }
    fs::create_dir(destination).map_err(|error| error.to_string())?;
    let mut expanded_bytes = 0u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| "Could not read a file in the GitHub release archive.")?;
        let relative = entry
            .enclosed_name()
            .ok_or("GitHub release archive contains an unsafe file path.")?
            .to_path_buf();
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("GitHub release archive contains a symbolic link.".into());
        }
        expanded_bytes = expanded_bytes
            .checked_add(entry.size())
            .filter(|size| *size <= MAX_GITHUB_ARCHIVE_BYTES)
            .ok_or("GitHub release expands beyond the safe install size limit.")?;
        let output = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(output).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let entry_size = entry.size();
        let mut output_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output)
            .map_err(|error| format!("Could not write the GitHub release files. {error}"))?;
        let mut limited_entry = entry.take(entry_size.saturating_add(1));
        let copied = std::io::copy(&mut limited_entry, &mut output_file)
            .map_err(|error| error.to_string())?;
        if copied != entry_size {
            return Err("GitHub release archive entry size did not match its contents.".into());
        }
        output_file.flush().map_err(|error| error.to_string())?;
    }
    find_release_executable(destination, allowed_executables).ok_or_else(|| {
        "GitHub release was extracted but the emulator executable was not found.".into()
    })
}

fn extract_github_7z(
    archive_path: &Path,
    destination: &Path,
    allowed_executables: &[String],
) -> Result<PathBuf, String> {
    let file = fs::File::open(archive_path).map_err(|error| error.to_string())?;
    fs::create_dir(destination).map_err(|error| error.to_string())?;
    let mut entry_count = 0usize;
    let mut expanded_bytes = 0u64;
    let mut rejected_entry = false;
    sevenz_rust2::decompress_with_extract_fn(file, destination, |entry, input, output| {
        entry_count += 1;
        let relative = output.strip_prefix(destination).ok();
        let safe_path = relative.is_some_and(|path| {
            path.components()
                .all(|component| matches!(component, Component::Normal(_)))
        });
        expanded_bytes = expanded_bytes.saturating_add(entry.size());
        if entry_count > MAX_GITHUB_ARCHIVE_ENTRIES
            || expanded_bytes > MAX_GITHUB_ARCHIVE_BYTES
            || entry.is_anti_item()
            || !safe_path
        {
            rejected_entry = true;
            return Ok(false);
        }
        if entry.windows_attributes() & 0x400 != 0 {
            rejected_entry = true;
            return Ok(false);
        }
        if entry.is_directory() {
            return fs::create_dir_all(output)
                .map(|_| true)
                .map_err(sevenz_rust2::Error::from);
        }
        if let Some(parent) = output.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                rejected_entry = true;
                let _ = error;
                return Ok(false);
            }
        }
        let mut output_file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)
        {
            Ok(file) => file,
            Err(_) => {
                rejected_entry = true;
                return Ok(false);
            }
        };
        let mut limited_input = input.take(entry.size().saturating_add(1));
        let copied = match std::io::copy(&mut limited_input, &mut output_file) {
            Ok(copied) => copied,
            Err(_) => {
                rejected_entry = true;
                return Ok(false);
            }
        };
        if copied != entry.size() {
            rejected_entry = true;
            return Ok(false);
        }
        output_file.flush().map_err(sevenz_rust2::Error::from)?;
        Ok(true)
    })
    .map_err(|_| "GitHub release was not a valid 7z archive or could not be extracted safely.")?;
    if rejected_entry {
        return Err(
            "GitHub release contains an unsafe path or exceeds the safe extraction limits.".into(),
        );
    }
    find_release_executable(destination, allowed_executables).ok_or_else(|| {
        "GitHub release was extracted but the emulator executable was not found.".into()
    })
}

fn extract_github_archive(
    archive_path: &Path,
    asset_name: &str,
    destination: &Path,
    allowed_executables: &[String],
) -> Result<PathBuf, String> {
    if asset_name.to_ascii_lowercase().ends_with(".zip") {
        extract_github_zip(archive_path, destination, allowed_executables)
    } else if asset_name.to_ascii_lowercase().ends_with(".7z") {
        extract_github_7z(archive_path, destination, allowed_executables)
    } else {
        Err("GitHub release archive type is not supported.".into())
    }
}

fn find_release_executable(root: &Path, allowed: &[String]) -> Option<PathBuf> {
    let mut directories = vec![root.to_path_buf()];
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(directory).ok()? {
            let entry = entry.ok()?;
            let metadata = fs::symlink_metadata(entry.path()).ok()?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                directories.push(entry.path());
            } else if metadata.is_file()
                && allowed.iter().any(|name| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .eq_ignore_ascii_case(name)
                })
            {
                return Some(entry.path());
            }
        }
    }
    None
}

fn install_github(root: &Path, id: &str, expected_revision: Option<&str>) -> Result<Value, String> {
    let known = catalogue()
        .into_iter()
        .find(|record| record["id"] == id)
        .ok_or("This emulator has no supported GitHub release install.")?;
    let profile: GithubInstall = serde_json::from_value(known["githubInstall"].clone())
        .map_err(|_| "This emulator has no supported GitHub release install.")?;
    if profile.asset_contains.is_empty()
        || profile.executables.is_empty()
        || profile.executables.iter().any(|name| {
            name.is_empty()
                || !name.to_ascii_lowercase().ends_with(".exe")
                || name.contains('/')
                || name.contains('\\')
        })
    {
        return Err("The GitHub install profile is invalid.".into());
    }
    let repo = known["releaseRepo"]
        .as_str()
        .filter(|repo| {
            repo.split('/').count() == 2
                && repo
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"-_/.".contains(&byte))
        })
        .ok_or("This emulator has no supported GitHub release feed.")?;
    let mut document = load(root)?;
    if document["revision"].as_str() != expected_revision {
        return Err("Emulator settings changed. Reload the list before installing.".into());
    }
    let record = document["emulators"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|record| record["id"] == id)
        .ok_or("This emulator is no longer in the list.")?;
    if configured_executable_exists(record) {
        return Err("This emulator already has a configured executable.".into());
    }
    if !plain_directory(root)? {
        return Err("Totem's app root is missing.".into());
    }
    let emulators = root.join("emulators");
    if let Err(error) = fs::create_dir(&emulators) {
        if error.kind() != ErrorKind::AlreadyExists {
            return Err(format!("Could not create {}. {error}", emulators.display()));
        }
    }
    if !plain_directory(&emulators)? {
        return Err("Totem's emulators folder is missing.".into());
    }
    let location = emulators.join(id);
    if plain_directory(&location)?
        && fs::read_dir(&location)
            .map_err(|error| error.to_string())?
            .next()
            .transpose()
            .map_err(|error| error.to_string())?
            .is_some()
    {
        return Err(format!(
            "{} already contains files. Configure the existing executable in Totem.",
            location.display()
        ));
    }

    let http = reqwest::blocking::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| error.to_string())?;
    let release: GithubRelease = http
        .get(format!(
            "https://api.github.com/repos/{repo}/releases/latest"
        ))
        .header("User-Agent", "Totem-emulator-manager")
        .send()
        .map_err(|_| "Could not reach the emulator's GitHub release feed.")?
        .error_for_status()
        .map_err(|_| "No latest GitHub release is available for this emulator.")?
        .json()
        .map_err(|_| "The GitHub release feed returned invalid data.")?;
    let asset_matches = release
        .assets
        .iter()
        .filter(|asset| {
            asset.name.contains(&profile.asset_contains)
                && (asset.name.to_ascii_lowercase().ends_with(".zip")
                    || asset.name.to_ascii_lowercase().ends_with(".7z"))
                && asset.size > 0
                && asset.size <= MAX_GITHUB_ARCHIVE_BYTES
                && asset
                    .browser_download_url
                    .starts_with(&format!("https://github.com/{repo}/releases/download/"))
        })
        .collect::<Vec<_>>();
    if asset_matches.len() != 1 {
        return Err(
            "Could not identify exactly one Windows ZIP in the latest GitHub release.".into(),
        );
    }
    let asset = asset_matches[0];
    let response = http
        .get(&asset.browser_download_url)
        .header("User-Agent", "Totem-emulator-manager")
        .send()
        .map_err(|_| "Could not download the GitHub emulator release.")?
        .error_for_status()
        .map_err(|_| "The GitHub emulator release download failed.")?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_GITHUB_ARCHIVE_BYTES)
    {
        return Err("GitHub release archive exceeds the safe download size limit.".into());
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let stage_path = emulators.join(format!(".{id}.install-{}-{nonce}", std::process::id()));
    fs::create_dir(&stage_path).map_err(|error| error.to_string())?;
    let stage = InstallStage(stage_path.clone());
    let archive_path = stage_path.join("release.zip");
    let mut archive_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&archive_path)
        .map_err(|error| error.to_string())?;
    let mut limited_response = response.take(MAX_GITHUB_ARCHIVE_BYTES + 1);
    let downloaded = std::io::copy(&mut limited_response, &mut archive_file)
        .map_err(|_| "Could not finish downloading the GitHub emulator release.")?;
    if downloaded == 0 || downloaded > MAX_GITHUB_ARCHIVE_BYTES {
        return Err(
            "GitHub release archive is empty or exceeds the safe download size limit.".into(),
        );
    }
    archive_file.flush().map_err(|error| error.to_string())?;
    archive_file.sync_all().map_err(|error| error.to_string())?;
    drop(archive_file);
    let contents = stage_path.join("contents");
    let staged_executable =
        extract_github_archive(&archive_path, &asset.name, &contents, &profile.executables)?;
    if !plain_directory(root)? || !plain_directory(&emulators)? {
        return Err("Totem's emulators folder changed during installation.".into());
    }
    if plain_directory(&location)? {
        fs::remove_dir(&location)
            .map_err(|error| format!("Could not prepare the install folder. {error}"))?;
    }
    fs::rename(&contents, &location)
        .map_err(|error| format!("Could not finalize the GitHub install. {error}"))?;
    let executable = location.join(
        staged_executable
            .strip_prefix(&contents)
            .map_err(|_| "The installed executable path was invalid.")?,
    );
    record["workingFolder"] = json!(location.to_str().ok_or("Invalid emulator install path.")?);
    record["executable"] = json!(executable
        .strip_prefix(&location)
        .map_err(|_| "The installed executable path was invalid.")?
        .to_str()
        .ok_or("Invalid installed executable path.")?);
    record["installedVersion"] = json!(release.tag_name.chars().take(100).collect::<String>());
    record["enabled"] = json!(true);
    crate::admin_storage::save(root, SECTION, document, expected_revision, initial()).map_err(
        |error| {
            format!(
                "Installed at {}. Totem could not save the configuration. {error}",
                executable.display()
            )
        },
    )?;
    drop(stage);
    view(root)
}

#[tauri::command]
pub async fn install_emulator(
    id: String,
    expected_revision: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = OPERATIONS
            .try_lock()
            .map_err(|_| "An emulator install, update or save is already running.")?;
        let root = Path::new(crate::library_settings::ROOT);
        let known = catalogue()
            .into_iter()
            .find(|record| record["id"] == id)
            .ok_or("This emulator has no supported install.")?;
        if known["wingetInstall"].is_object() {
            install_winget(
                root,
                &id,
                expected_revision.as_deref(),
                winget,
                registered_winget_executable,
            )
        } else if known["githubInstall"].is_object() {
            install_github(root, &id, expected_revision.as_deref())
        } else {
            Err("This emulator has no supported install.".into())
        }
    })
    .await
    .map_err(|_| "Emulator install worker failed.".to_owned())?
}

#[tauri::command]
pub async fn emulator_update(id: String, install: bool) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || update(&id, install))
        .await
        .map_err(|_| "Update worker failed.".to_owned())?
}
fn automatic_package(record: &Value) -> Result<String, String> {
    if record["autoUpdate"] != true || record["enabled"] != true {
        return Err(
            "Save an enabled emulator with automatic WinGet updates selected first.".into(),
        );
    }
    catalogue()
        .into_iter()
        .find(|known| known["id"] == record["id"])
        .and_then(|known| known["wingetId"].as_str().map(str::to_owned))
        .ok_or("Use the official website for manual installation.".into())
}
fn upgrade_arguments(package: &str) -> Vec<&str> {
    vec![
        "upgrade",
        "--id",
        package,
        "--exact",
        "--source",
        "winget",
        "--silent",
        "--disable-interactivity",
    ]
}
fn update(id: &str, install: bool) -> Result<Value, String> {
    let _guard = OPERATIONS
        .try_lock()
        .map_err(|_| "An emulator update or save is already running.")?;
    let known = catalogue().into_iter().find(|c| c["id"] == id);
    let saved = load(Path::new(crate::library_settings::ROOT))?;
    let record = saved["emulators"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .ok_or("Save this emulator before checking updates.")?;
    if install {
        let package = automatic_package(record)?;
        winget(
            &[
                "list",
                "--id",
                &package,
                "--exact",
                "--source",
                "winget",
                "--disable-interactivity",
            ],
            Duration::from_secs(45),
        )?;
        let result = winget(&upgrade_arguments(&package), Duration::from_secs(600))?;
        return Ok(
            json!({"status":if result.starts_with("No update available."){ "No update available" }else{ "WinGet upgrade completed" },"details":result}),
        );
    }
    let Some(repo) = known.as_ref().and_then(|k| k["releaseRepo"].as_str()) else {
        return Ok(json!({"status":"Check the official website","website":record["website"]}));
    };
    let http = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .https_only(true)
        .build()
        .map_err(|e| e.to_string())?;
    let release: Value = http
        .get(format!(
            "https://api.github.com/repos/{repo}/releases/latest"
        ))
        .header("User-Agent", "Totem-emulator-manager")
        .send()
        .map_err(|_| "Could not reach the official release feed.")?
        .error_for_status()
        .map_err(|_| "No latest release is available from this feed. Use the official website.")?
        .json()
        .map_err(|_| "Invalid release response.")?;
    Ok(
        json!({"status":"Release checked","latestVersion":release["tag_name"],"website":release["html_url"],"notes":release["body"].as_str().unwrap_or("").chars().take(4000).collect::<String>()}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scan_configures_known_executables_without_replacing_existing_settings() {
        let root = std::env::temp_dir().join(format!(
            "totem-emulator-scan-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let stage = InstallStage(root);
        let root = &stage.0;
        for relative in [
            "winuae/winuae64.exe",
            "winuae/winuae (Beta).exe",
            "ares/ares-v148/ares.exe",
            "dolphin/Dolphin.exe",
            "dolphin-triforce/one/DolphinWX.exe",
            "dolphin-triforce/two/DolphinWX.exe",
            "unknown/launcher.exe",
        ] {
            let file = root.join("emulators").join(relative);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, b"fixture").unwrap();
        }
        let mut before = initial();
        let dolphin = before["emulators"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|record| record["id"] == "dolphin")
            .unwrap();
        dolphin["workingFolder"] = json!(root);
        dolphin["executable"] = json!("existing.exe");
        dolphin["enabled"] = json!(true);
        let before = save(root, before, None).unwrap();
        let result = scan(root, before["revision"].as_str()).unwrap();
        assert_eq!(result["found"], json!(["WinUAE", "ares"]));
        assert_eq!(result["skipped"].as_array().unwrap().len(), 2);
        let after = &result["settings"];
        let record = |id: &str| {
            after["emulators"]
                .as_array()
                .unwrap()
                .iter()
                .find(|record| record["id"] == id)
                .unwrap()
        };
        assert_eq!(record("winuae")["executable"], "winuae64.exe");
        assert_eq!(record("winuae")["enabled"], false);
        assert_eq!(
            record("ares")["workingFolder"],
            json!(root.join("emulators").join("ares").join("ares-v148"))
        );
        assert_eq!(record("dolphin")["executable"], "existing.exe");
        assert_eq!(record("dolphin")["enabled"], true);
        assert_eq!(after["availability"]["winuae"]["executableExists"], true);
        assert!(scan(root, before["revision"].as_str()).is_err());
        let repeat = scan(root, after["revision"].as_str()).unwrap();
        assert_eq!(repeat["found"], json!([]));
        assert_eq!(repeat["settings"]["revision"], after["revision"]);
    }

    #[test]
    fn diagnostics_use_effective_registry_without_writing_or_starting_programs() {
        let root = std::env::temp_dir().join(format!(
            "totem-diagnostics-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let game = root.join("game.zip");
        fs::write(&game, b"fixture").unwrap();
        let emulator = |id: &str, enabled, platform: &str| {
            json!({
                "id": id, "name": id, "enabled": enabled, "platforms": [platform],
                "workingFolder": root, "executable": format!("{id}.exe"),
                "installedVersion": "", "website": "https://example.com", "autoUpdate": false,
                "switches": []
            })
        };
        let saved = save(
            &root,
            json!({"version":1,"revision":null,"emulators":[
                emulator("mame", true, "arcade"), emulator("alternate", true, "arcade"),
                emulator("disabled", false, "arcade"), emulator("other-platform", true, "nes")
            ]}),
            None,
        )
        .unwrap();
        let revisions = root.join("config/emulators/revisions");
        let revision = revisions.join(format!("{}.json", saved["revision"].as_str().unwrap()));
        let before = fs::read(&revision).unwrap();
        let entry_count = fs::read_dir(&revisions).unwrap().count();
        let inspect = || diagnostics(&root, "arcade", Some(&game), None);
        let missing = inspect();
        assert_eq!(missing["status"], "noReadyEmulator");
        assert_eq!(missing["matchingEmulators"].as_array().unwrap().len(), 2);
        assert_eq!(
            missing["matchingEmulators"][0]["executableAvailable"],
            false
        );
        fs::write(root.join("mame.exe"), b"not an executable").unwrap();
        let ready = inspect();
        assert_eq!(ready["status"], "ready");
        assert_eq!(ready["selectedEmulatorId"], "mame");
        assert_eq!(ready["matchingEmulators"][0]["executableAvailable"], true);
        let invalid = diagnostics(&root, "arcade", Some(&root.join("invalid name.zip")), None);
        assert_eq!(invalid["status"], "invalidLaunchTarget");
        assert_eq!(invalid["reason"], "Invalid MAME machine name.");
        fs::write(root.join("alternate.exe"), b"not an executable").unwrap();
        let ambiguous = inspect();
        assert_eq!(ambiguous["status"], "ambiguous");
        assert!(ambiguous["selectedEmulatorId"].is_null());
        assert_eq!(fs::read(&revision).unwrap(), before);
        assert_eq!(fs::read_dir(&revisions).unwrap().count(), entry_count);
        assert_eq!(fs::read(&game).unwrap(), b"fixture");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 4);
    }

    #[test]
    fn winget_install_saves_only_after_finding_the_catalogue_executable() {
        let temp = std::env::temp_dir();
        let root = temp.join(format!(
            "totem-emulator-install-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let unused = |_: &[&str], _: Duration| panic!("WinGet should not run");
        let unregistered = |_: &str, _: &WingetInstall| None;
        assert!(install_winget(&root, "flycast", None, unused, unregistered).is_err());
        assert!(install_winget(&root, "cemu", Some("stale"), unused, unregistered).is_err());
        let missing = install_winget(&root, "cemu", None, |_, _| Ok(String::new()), unregistered)
            .unwrap_err();
        assert!(missing.contains("executable was not found"));
        assert!(load(&root).unwrap()["revision"].is_null());
        let occupied = root.join("emulators").join("pcsx2");
        fs::create_dir_all(&occupied).unwrap();
        fs::write(occupied.join("existing.txt"), b"keep").unwrap();
        assert!(install_winget(&root, "pcsx2", None, unused, unregistered)
            .unwrap_err()
            .contains("already contains files"));
        assert_eq!(fs::read(occupied.join("existing.txt")).unwrap(), b"keep");

        let location = root.join("emulators").join("cemu");
        let working_folder = location.join("Cemu_2.6");
        let saved = install_winget(
            &root,
            "cemu",
            None,
            |args, _| {
                assert_eq!(
                    args,
                    [
                        "install",
                        "--id",
                        "Cemu.Cemu",
                        "--exact",
                        "--source",
                        "winget",
                        "--installer-type",
                        "portable",
                        "--location",
                        location.to_str().unwrap(),
                        "--no-upgrade",
                        "--silent",
                        "--disable-interactivity",
                    ]
                );
                fs::create_dir_all(&working_folder).unwrap();
                fs::write(working_folder.join("Cemu.exe"), b"fixture").unwrap();
                Ok(String::new())
            },
            unregistered,
        )
        .unwrap();
        let record = saved["emulators"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == "cemu")
            .unwrap();
        assert_eq!(record["workingFolder"].as_str(), working_folder.to_str());
        assert_eq!(record["executable"], "Cemu.exe");
        assert_eq!(record["enabled"], true);
        assert_eq!(saved["availability"]["cemu"]["executableExists"], true);
        assert!(install_winget(
            &root,
            "cemu",
            saved["revision"].as_str(),
            unused,
            unregistered
        )
        .is_err());

        for (case, already_installed) in [("existing", true), ("fresh", false)] {
            let totem = root.join(case);
            let azahar_folder = root.join(format!("Azahar {case}"));
            fs::create_dir(&totem).unwrap();
            let registered = |id: &str, package: &WingetInstall| {
                assert_eq!(id, "azahar");
                installed_executable(&azahar_folder, package).ok()
            };
            if already_installed {
                fs::create_dir(&azahar_folder).unwrap();
                fs::write(azahar_folder.join("azahar.exe"), b"fixture").unwrap();
            }
            let saved = install_winget(
                &totem,
                "azahar",
                None,
                |_, _| {
                    assert!(
                        !already_installed,
                        "WinGet should not rerun for an existing install"
                    );
                    fs::create_dir(&azahar_folder).unwrap();
                    fs::write(azahar_folder.join("azahar.exe"), b"fixture").unwrap();
                    Ok(String::new())
                },
                registered,
            )
            .unwrap();
            let record = saved["emulators"]
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["id"] == "azahar")
                .unwrap();
            assert_eq!(record["workingFolder"].as_str(), azahar_folder.to_str());
            assert_eq!(record["executable"], "azahar.exe");
            assert_eq!(record["enabled"], true);
            assert_eq!(saved["availability"]["azahar"]["executableExists"], true);
        }
        assert_eq!(root.parent(), Some(temp.as_path()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn automatic_updates_require_opt_in_and_use_only_the_catalogue_package() {
        let mut record = initial()["emulators"][1].clone();
        assert!(automatic_package(&record).is_err());
        record["enabled"] = json!(true);
        record["autoUpdate"] = json!(true);
        record["wingetId"] = json!("Other.Application");
        let package = automatic_package(&record).unwrap();
        assert_eq!(package, "PCSX2Team.PCSX2");
        assert_eq!(
            upgrade_arguments(&package),
            vec![
                "upgrade",
                "--id",
                "PCSX2Team.PCSX2",
                "--exact",
                "--source",
                "winget",
                "--silent",
                "--disable-interactivity"
            ]
        );
        record["id"] = json!("user-custom");
        assert!(automatic_package(&record).is_err());
    }
    #[test]
    fn defaults_and_custom_update_validation() {
        let doc = initial();
        validate(&doc).unwrap();
        assert!(doc["emulators"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["enabled"] == false && e["autoUpdate"] == false));
        let mut bad = doc.clone();
        bad["emulators"][0]["website"] = json!("file:///tmp/unsafe");
        assert!(validate(&bad).is_err());
        let mut bad = doc;
        bad["emulators"][0]["id"] = json!("custom");
        bad["emulators"][0]["autoUpdate"] = json!(true);
        assert!(validate(&bad).is_err());
    }
    #[test]
    fn settings_roundtrip_conflict_and_removal_preserve_previous_revisions() {
        let root = std::env::temp_dir().join(format!(
            "totem-emulators-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let mut doc = load(&root).unwrap();
        doc["emulators"][0]["workingFolder"] = json!("C:\\fixture");
        doc["emulators"][0]["switches"][0]["enabled"] = json!(true);
        let saved = save(&root, doc, None).unwrap();
        assert_eq!(load(&root).unwrap(), saved);
        assert!(save(&root, initial(), None).is_err());
        let mut removed = saved.clone();
        removed["emulators"].as_array_mut().unwrap().remove(0);
        save(&root, removed, saved["revision"].as_str()).unwrap();
        let reloaded = load(&root).unwrap();
        let records = reloaded["emulators"].as_array().unwrap();
        assert_eq!(records.len(), catalogue().len());
        let retroarch = records
            .iter()
            .find(|record| record["id"] == "retroarch")
            .unwrap();
        assert_eq!(retroarch["workingFolder"], "");
        assert_eq!(retroarch["switches"][0]["enabled"], false);
        assert_eq!(
            std::fs::read_dir(root.join("config/emulators/revisions"))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|e| e.path().extension().is_some_and(|s| s == "json"))
                .count(),
            2
        );
        assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
        std::fs::remove_dir_all(root).unwrap();
    }
}
