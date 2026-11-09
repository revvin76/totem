use std::path::{Path, PathBuf};
use tauri::Manager;

fn home_root(app_data: &Path, identifier: &str) -> Result<PathBuf, String> {
    if identifier == "dev.horizon.totem.lightstudy" {
        // Studio retains its own identity/preferences, but edits the existing
        // Totem home layout and platform registry rather than a private copy.
        Ok(app_data
            .parent()
            .ok_or("Invalid Studio app-data directory.")?
            .join("dev.horizon.carousel.poc"))
    } else {
        Ok(app_data.to_owned())
    }
}
pub fn home_data_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    home_root(
        &app.path().app_data_dir().map_err(|e| e.to_string())?,
        &app.config().identifier,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn studio_uses_the_existing_home_owner_without_changing_other_app_roots() {
        let base = std::env::temp_dir();
        let canonical = base.join("dev.horizon.carousel.poc");
        assert_eq!(
            home_root(
                &base.join("dev.horizon.totem.lightstudy"),
                "dev.horizon.totem.lightstudy"
            )
            .unwrap(),
            canonical
        );
        assert_eq!(
            home_root(&canonical, "dev.horizon.carousel.poc").unwrap(),
            canonical
        );
        let other = base.join("other");
        assert_eq!(home_root(&other, "other").unwrap(), other);
    }
}
