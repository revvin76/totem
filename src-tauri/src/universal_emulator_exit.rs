//! Opt-in graceful exit for a retained, directly launched emulator process.
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    time::{Duration, Instant},
};

#[cfg(windows)]
pub mod windows;

const SECTION: &str = "universal-emulator-exit";
pub const EVENT: &str = "totem:emulator-exit-status";

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum Shortcut {
    #[default]
    BumpersBackStart,
    BackStart,
    StickClicks,
    BumpersStickClicks,
    BumpersTriggers,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum Method {
    #[default]
    Auto,
    WmClose,
    AltF4,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub enabled: bool,
    shortcut: Shortcut,
    hold_ms: u64,
    method: Method,
    controller_slot: Option<u32>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            shortcut: Shortcut::default(),
            hold_ms: 1500,
            method: Method::default(),
            controller_slot: None,
        }
    }
}

impl Settings {
    fn validate(self) -> Result<Self, String> {
        if !matches!(self.hold_ms, 500 | 1000 | 1500 | 2000 | 3000)
            || self.controller_slot.is_some_and(|slot| slot > 3)
        {
            return Err("Invalid Universal Emulator Exit settings.".into());
        }
        Ok(self)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDocument {
    revision: Option<String>,
    settings: Settings,
}

impl SettingsDocument {
    fn initial() -> serde_json::Value {
        serde_json::json!({ "revision": null, "settings": Settings::default() })
    }

    fn load(root: &Path) -> Result<Self, String> {
        let document: Self =
            serde_json::from_value(crate::admin_storage::load(root, SECTION, Self::initial())?)
                .map_err(|error| error.to_string())?;
        document.settings.validate()?;
        Ok(document)
    }

    fn save(root: &Path, settings: Settings, revision: Option<&str>) -> Result<Self, String> {
        settings.validate()?;
        serde_json::from_value(crate::admin_storage::save(
            root,
            SECTION,
            serde_json::json!({ "settings": settings }),
            revision,
            Self::initial(),
        )?)
        .map_err(|error| error.to_string())
    }
}

pub fn launch_settings(root: &Path) -> Result<Settings, String> {
    SettingsDocument::load(root).map(|document| document.settings)
}

#[tauri::command]
pub async fn load_emulator_exit_settings() -> Result<SettingsDocument, String> {
    tauri::async_runtime::spawn_blocking(|| {
        SettingsDocument::load(Path::new(crate::library_settings::ROOT))
    })
    .await
    .map_err(|_| "Exit settings worker unavailable.")?
}

#[tauri::command]
pub async fn save_emulator_exit_settings(
    settings: Settings,
    expected_revision: Option<String>,
) -> Result<SettingsDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        SettingsDocument::save(
            Path::new(crate::library_settings::ROOT),
            settings,
            expected_revision.as_deref(),
        )
    })
    .await
    .map_err(|_| "Exit settings worker unavailable.")?
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Strategy {
    #[default]
    Auto,
    Native,
    WmClose,
    AltF4,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
enum WindowPolicy {
    #[default]
    UniqueForeground,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    strategy: Strategy,
    timeout_ms: u64,
    window_policy: WindowPolicy,
    allow_alt_f4: bool,
    // Informational. Totem never interacts with emulator confirmation dialogs.
    #[serde(rename = "confirmationExpected")]
    _confirmation_expected: Option<bool>,
    #[serde(rename = "compatibility")]
    _compatibility: Option<String>,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            strategy: Strategy::Auto,
            timeout_ms: 10_000,
            window_policy: WindowPolicy::UniqueForeground,
            allow_alt_f4: false,
            _confirmation_expected: None,
            _compatibility: None,
        }
    }
}

impl Profile {
    pub fn parse(value: &serde_json::Value) -> Result<Self, String> {
        if value.is_null() {
            return Ok(Self::default());
        }
        let profile: Self = serde_json::from_value(value.clone())
            .map_err(|error| format!("Invalid emulator exit profile: {error}"))?;
        if !(1000..=120_000).contains(&profile.timeout_ms) {
            return Err("Emulator exit timeout must be between 1 and 120 seconds.".into());
        }
        Ok(profile)
    }

    fn resolve(&self, method: Method) -> Result<ClosePlan, &'static str> {
        match (method, self.strategy) {
            (Method::WmClose, _) | (Method::Auto, Strategy::Auto | Strategy::WmClose) => {
                Ok(ClosePlan::Window)
            }
            (Method::Auto, Strategy::Native) => {
                Err("This emulator has no verified native exit handler in Totem.")
            }
            (Method::AltF4, _) if self.allow_alt_f4 => Ok(ClosePlan::WindowThenSystem),
            (Method::AltF4, _) => Ok(ClosePlan::Window),
            (Method::Auto, Strategy::AltF4) if !self.allow_alt_f4 => {
                Err("This emulator's exit profile does not permit Alt+F4 fallback.")
            }
            (Method::Auto, Strategy::AltF4) => Ok(ClosePlan::System),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClosePlan {
    Window,
    WindowThenSystem,
    System,
}

#[derive(Default)]
struct Hold {
    armed: bool,
    since: Option<Instant>,
}

impl Hold {
    fn sample(
        &mut self,
        buttons: Option<u32>,
        mask: u32,
        duration: Duration,
        now: Instant,
    ) -> bool {
        let Some(buttons) = buttons else {
            *self = Self::default();
            return false;
        };
        let chord = buttons & mask;
        if chord == 0 {
            self.armed = true;
        }
        if chord != mask || !self.armed {
            self.since = None;
            return false;
        }
        let since = *self.since.get_or_insert(now);
        if now.duration_since(since) < duration {
            return false;
        }
        *self = Self::default();
        true
    }
}

#[derive(Default)]
struct CloseProgress {
    pending_since: Option<Instant>,
    window_timed_out: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CloseRequest {
    Window,
    System,
}

impl CloseProgress {
    fn request(&self, plan: ClosePlan) -> Option<CloseRequest> {
        if self.pending_since.is_some() {
            return None;
        }
        Some(match plan {
            ClosePlan::Window => CloseRequest::Window,
            ClosePlan::WindowThenSystem if !self.window_timed_out => CloseRequest::Window,
            ClosePlan::WindowThenSystem | ClosePlan::System => CloseRequest::System,
        })
    }

    fn posted(&mut self, now: Instant) {
        self.pending_since = Some(now);
    }

    fn timed_out(&mut self, now: Instant, timeout: Duration) -> bool {
        if !self
            .pending_since
            .is_some_and(|since| now.duration_since(since) >= timeout)
        {
            return false;
        }
        self.pending_since = None;
        self.window_timed_out = true;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_off_and_settings_round_trip_through_revision_store() {
        let root = std::env::temp_dir().join(format!(
            "totem-emulator-exit-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let defaults = launch_settings(&root).unwrap();
        assert!(!defaults.enabled);
        assert_eq!(defaults.hold_ms, 1500);
        assert!(matches!(defaults.shortcut, Shortcut::BumpersBackStart));
        assert!(matches!(defaults.method, Method::Auto));
        let settings = Settings {
            enabled: true,
            shortcut: Shortcut::StickClicks,
            hold_ms: 3000,
            method: Method::AltF4,
            controller_slot: Some(2),
        };
        let saved = SettingsDocument::save(&root, settings, None).unwrap();
        let reloaded = SettingsDocument::load(&root).unwrap();
        assert_eq!(saved.revision, reloaded.revision);
        assert_eq!(
            serde_json::to_value(settings).unwrap(),
            serde_json::to_value(reloaded.settings).unwrap()
        );
        assert!(SettingsDocument::save(&root, settings, None).is_err());
        assert!(SettingsDocument::save(
            &root,
            Settings {
                controller_slot: Some(4),
                ..settings
            },
            saved.revision.as_deref(),
        )
        .is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_partial_hold_restarts_and_a_full_hold_fires_only_once() {
        let mut hold = Hold::default();
        let start = Instant::now();
        let duration = Duration::from_millis(1500);
        let mut sample = |buttons, ms| {
            hold.sample(
                Some(buttons),
                0b11,
                duration,
                start + Duration::from_millis(ms),
            )
        };
        assert!(!sample(0, 0));
        assert!(!sample(0b11, 10));
        assert!(!sample(0b01, 1500));
        assert!(!sample(0b11, 1510));
        assert!(!sample(0b11, 3009));
        assert!(sample(0b11, 3010));
        assert!(!sample(0b11, 8000));
        assert!(!sample(0b01, 8010));
        assert!(!sample(0b11, 10000));
        assert!(!sample(0, 11000));
        assert!(!sample(0b11, 11100));
        assert!(sample(0b11, 12600));
    }

    #[test]
    fn interrupted_monitor_requires_release_and_a_new_hold() {
        let mut hold = Hold::default();
        let start = Instant::now();
        let duration = Duration::from_millis(500);
        let mut sample =
            |buttons, ms| hold.sample(buttons, 3, duration, start + Duration::from_millis(ms));
        assert!(!sample(Some(0), 0));
        assert!(!sample(Some(3), 100));
        assert!(!sample(None, 400));
        assert!(!sample(Some(3), 500));
        assert!(!sample(Some(3), 1500));
        assert!(!sample(Some(0), 1600));
        assert!(!sample(Some(3), 1700));
        assert!(sample(Some(3), 2200));
    }

    #[test]
    fn exit_profiles_fail_closed_and_require_explicit_system_close_permission() {
        let profile = Profile::parse(&serde_json::Value::Null).unwrap();
        assert_eq!(profile.resolve(Method::Auto), Ok(ClosePlan::Window));
        assert_eq!(profile.resolve(Method::AltF4), Ok(ClosePlan::Window));
        let native = Profile::parse(&serde_json::json!({"strategy": "native"})).unwrap();
        assert!(native.resolve(Method::Auto).is_err());
        assert_eq!(native.resolve(Method::WmClose), Ok(ClosePlan::Window));
        let restricted = Profile::parse(&serde_json::json!({"strategy": "altF4"})).unwrap();
        assert!(restricted.resolve(Method::Auto).is_err());
        let allowed =
            Profile::parse(&serde_json::json!({"strategy": "altF4", "allowAltF4": true})).unwrap();
        assert_eq!(allowed.resolve(Method::Auto), Ok(ClosePlan::System));
        assert_eq!(
            allowed.resolve(Method::AltF4),
            Ok(ClosePlan::WindowThenSystem)
        );
        assert!(Profile::parse(&serde_json::json!({"timeoutMs": 0})).is_err());
    }

    #[test]
    fn a_posted_request_blocks_duplicates_until_timeout_and_retry_is_explicit() {
        let mut state = CloseProgress::default();
        let start = Instant::now();
        let timeout = Duration::from_secs(10);
        assert_eq!(
            state.request(ClosePlan::WindowThenSystem),
            Some(CloseRequest::Window)
        );
        state.posted(start);
        assert_eq!(state.request(ClosePlan::WindowThenSystem), None);
        assert!(!state.timed_out(start + timeout - Duration::from_millis(1), timeout));
        assert_eq!(state.request(ClosePlan::WindowThenSystem), None);
        assert!(state.timed_out(start + timeout, timeout));
        assert_eq!(
            state.request(ClosePlan::WindowThenSystem),
            Some(CloseRequest::System)
        );
        assert_eq!(state.request(ClosePlan::Window), Some(CloseRequest::Window));
        assert!(!state.timed_out(start + timeout, timeout));
    }
}
