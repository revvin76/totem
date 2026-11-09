use crate::{
    controller_mapping, emulators, library_index, library_settings, platform_editor, Platform,
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    evaluated_at: u64,
    evaluation_ms: f64,
    platforms: Vec<Row>,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    platform: Platform,
    game_count: Option<usize>,
    checks: Checks,
}

#[derive(Serialize)]
struct Evidence {
    status: &'static str,
    explanation: &'static str,
    source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

type Checks = BTreeMap<&'static str, Evidence>;

const LIBRARY: &str =
    "Effective library settings, collection manifest and platform extension rules";
const INDEX: &str = "Active library index snapshot";
const EMULATORS: &str = "Validated emulator registry and executable path metadata";
const CATALOGUE: &str = "Effective platform catalogue and platform editor registry";
const PLATFORM_ASSETS: &str = "Platform Chooser asset resolver";
const MODELS: &str = "Platform Editor and bundled model resolvers";

fn evidence(status: &'static str, explanation: &'static str, source: &'static str) -> Evidence {
    Evidence {
        status,
        explanation,
        source,
        detail: None,
    }
}

impl Evidence {
    fn detail(mut self, detail: impl ToString) -> Self {
        self.detail = Some(detail.to_string());
        self
    }
}

fn presence(path: &Path, directory: bool) -> Option<bool> {
    match fs::metadata(path) {
        Ok(metadata) => Some(if directory {
            metadata.is_dir()
        } else {
            metadata.is_file() && metadata.len() > 0
        }),
        Err(error) if error.kind() == ErrorKind::NotFound => Some(false),
        Err(_) => None,
    }
}

fn presentation_asset(
    result: Result<Option<PathBuf>, String>,
    absent: &'static str,
    present: &'static str,
) -> Evidence {
    match result {
        Ok(Some(path)) if presence(&path, false) == Some(false) => evidence(
            "red",
            "Resolved asset is empty or unavailable.",
            PLATFORM_ASSETS,
        )
        .detail(path.display()),
        Ok(Some(path)) if presence(&path, false) == Some(true) => {
            evidence("green", present, PLATFORM_ASSETS).detail(path.display())
        }
        Ok(Some(path)) => evidence(
            "amber",
            "Resolved asset could not be verified as a nonempty file.",
            PLATFORM_ASSETS,
        )
        .detail(path.display()),
        Ok(None) => evidence("amber", absent, PLATFORM_ASSETS),
        Err(error) => evidence(
            "amber",
            "Could not verify the presentation asset.",
            PLATFORM_ASSETS,
        )
        .detail(error),
    }
}

fn platform_checks(platform: &Platform, bundled: bool, editor_root: &Path) -> Checks {
    let mut checks = Checks::new();
    checks.insert(
        "metadata-provenance",
        evidence("green", "Effective catalogue source identified.", CATALOGUE).detail(
            if !bundled {
                "Custom Platform Editor entry"
            } else if platform.details.contains_key("recordRevision") {
                "Bundled catalogue entry with saved Platform Editor overrides"
            } else {
                "Bundled catalogue entry"
            },
        ),
    );
    checks.insert(
        "custom-platform-integration",
        if bundled {
            evidence("grey", "This is a bundled platform.", CATALOGUE)
        } else {
            evidence(
                "green",
                "Custom entry is present in the effective catalogue.",
                CATALOGUE,
            )
        },
    );
    checks.insert(
        "rail-artwork",
        presentation_asset(
            crate::platform_presentation_file(&platform.id, "Artwork/UI/button.png"),
            "No platform-specific rail artwork was found. The chooser can use fallback artwork.",
            "Rail artwork is present. Format and approval were not verified.",
        ),
    );
    checks.insert(
        "startup-video",
        presentation_asset(
            crate::platform_presentation_file(&platform.id, "Branding/Startup.mp4"),
            "No platform-specific startup clip was found.",
            "Startup clip resolved. Playback was not tested.",
        ),
    );
    let gameplay_path = crate::showcase_gameplay_path(&platform.id);
    checks.insert(
        "video-files",
        match &gameplay_path {
            Ok(Some(path)) if presence(path, false) == Some(true) => evidence(
                "green",
                "Showcase gameplay path resolves to a nonempty file.",
                PLATFORM_ASSETS,
            )
            .detail(path.display()),
            Ok(Some(path)) if presence(path, false) == Some(false) => evidence(
                "red",
                "Resolved showcase file is empty or unavailable.",
                PLATFORM_ASSETS,
            )
            .detail(path.display()),
            Ok(Some(path)) => evidence(
                "amber",
                "The resolved showcase file could not be inspected.",
                PLATFORM_ASSETS,
            )
            .detail(path.display()),
            Ok(None) => evidence(
                "amber",
                "No showcase clip resolved. Other media files were not assessed.",
                PLATFORM_ASSETS,
            ),
            Err(error) => evidence(
                "amber",
                "Could not inspect showcase file availability.",
                PLATFORM_ASSETS,
            )
            .detail(error),
        },
    );
    checks.insert(
        "gameplay-video-routing",
        presentation_asset(
            gameplay_path,
            "No platform showcase gameplay clip resolved. Other playback routes were not checked.",
            "Showcase gameplay clip resolved. Playback was not tested.",
        ),
    );

    for (field, check_id) in [
        ("logoFile", "hero-logo"),
        ("modelFile", "model-availability"),
    ] {
        let Some(asset) = platform.details.get(field).filter(|asset| !asset.is_null()) else {
            continue;
        };
        let check = match asset["id"]
            .as_str()
            .and_then(|id| platform_editor::asset_path(editor_root, id).ok())
        {
            Some(path) => match presence(&path, false) {
                Some(true) => evidence(
                    "amber",
                    "Imported asset is present. Content and rendering were not verified.",
                    MODELS,
                )
                .detail(path.display()),
                Some(false) => evidence(
                    "red",
                    "Imported asset file is missing, empty or invalid.",
                    MODELS,
                )
                .detail(path.display()),
                None => evidence(
                    "amber",
                    "Imported asset path could not be inspected.",
                    MODELS,
                )
                .detail(path.display()),
            },
            None => evidence("red", "Imported asset reference is invalid.", MODELS),
        };
        checks.insert(check_id, check);
    }
    if !checks.contains_key("model-availability") {
        let check = match platform.details.get("bundledModel") {
            Some(model) => match crate::bundled_model_path(
                model["path"].as_str().unwrap_or_default(),
                model["sha256"].as_str().unwrap_or_default(),
            ) {
                Ok(path) => evidence("green", "Bundled model file is available. Integrity and loadability are separate checks.", MODELS).detail(path.display()),
                Err(error) => evidence("amber", "Bundled path could not be confirmed. Browser and procedural fallbacks were not assessed.", MODELS).detail(error),
            },
            None => evidence("amber", "No bundled or imported model reference. Procedural rendering was not assessed.", MODELS),
        };
        checks.insert("model-availability", check);
    }
    checks
}

fn library_checks(
    checks: &mut Checks,
    id: &str,
    library: &library_index::LibraryReadiness,
) -> Option<usize> {
    let sources = library
        .sources
        .get(id)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let paths = sources
        .iter()
        .map(|source| {
            format!(
                "{}: {}{}",
                source.path.display(),
                match source.availability {
                    Some(true) => "available",
                    Some(false) => "missing or invalid",
                    None => "not verified",
                },
                if source.optional {
                    " (conventional fallback)"
                } else {
                    ""
                },
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let present = sources
        .iter()
        .any(|source| source.availability == Some(true));
    let broken = sources
        .iter()
        .any(|source| !source.optional && source.availability == Some(false));
    let unknown = sources.iter().any(|source| source.availability.is_none());
    checks.insert(
        "source-roots",
        if sources.is_empty() {
            evidence("red", "No effective source root is configured.", LIBRARY)
        } else {
            evidence("green", "Effective source roots were resolved.", LIBRARY).detail(&paths)
        },
    );
    checks.insert(
        "source-paths",
        if broken {
            evidence(
                "red",
                "A required source folder is missing or invalid.",
                LIBRARY,
            )
        } else if !present && !unknown {
            evidence("red", "No effective source folder is available.", LIBRARY)
        } else if unknown {
            evidence(
                "amber",
                "One or more source paths could not be inspected.",
                LIBRARY,
            )
        } else {
            evidence("green", "Effective source folders are available.", LIBRARY)
        }
        .detail(paths),
    );
    let rules = sources
        .iter()
        .map(|source| {
            format!(
                "{}: {} ({})",
                source.path.display(),
                source.extensions.join(", "),
                source.rules.join(", "),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    checks.insert(
        "source-inheritance",
        evidence(
            if sources.is_empty() { "amber" } else { "green" },
            "Effective collection and conventional source rules.",
            LIBRARY,
        )
        .detail(&rules),
    );
    checks.insert(
        "extension-rules",
        if sources.is_empty() || sources.iter().any(|source| source.extensions.is_empty()) {
            evidence(
                "amber",
                "An effective source rule could not be verified.",
                LIBRARY,
            )
        } else if sources
            .iter()
            .any(|source| source.rules.iter().any(|rule| rule == "fallback"))
        {
            evidence(
                "amber",
                "At least one source inherits broad fallback extensions.",
                LIBRARY,
            )
        } else {
            evidence(
                "green",
                "The effective extension rules are explicit.",
                LIBRARY,
            )
        }
        .detail(rules),
    );

    let count_map = library.counts.as_ref()?;
    let empty = library_index::IndexedReadiness::default();
    let counts = count_map.get(id).unwrap_or(&empty);
    let freshness = if !library.current {
        "Index was built against different source settings."
    } else if library.summary.cached {
        "Restored index matches the configuration. Files were not rescanned."
    } else {
        "Active scan snapshot matches the configuration. Files were not rescanned."
    };
    checks.insert(
        "indexed-games",
        if library.current && counts.count > 0 {
            evidence(
                "green",
                "Games are present in the current configuration's index snapshot.",
                INDEX,
            )
        } else {
            evidence(
                "amber",
                "The index is stale or contains no entries for this platform.",
                INDEX,
            )
        }
        .detail(format!("{} indexed games. {freshness}", counts.count)),
    );
    let clean_scan = library.current
        && !library.summary.cached
        && library.summary.missing_roots == 0
        && library.summary.warnings.is_empty();
    checks.insert(
        "scan-health",
        if clean_scan {
            evidence(
                "green",
                "Active scan reported no missing roots or warnings.",
                INDEX,
            )
        } else {
            evidence(
                "amber",
                "The scan is cached, stale or has reported issues.",
                INDEX,
            )
        }
        .detail(format!(
            "{freshness} Global scan reported {} missing roots and {} warnings.",
            library.summary.missing_roots,
            library.summary.warnings.len()
        )),
    );
    checks.insert(
        "scan-warnings",
        if library.summary.warnings.is_empty() && library.current {
            evidence(
                "green",
                "No warnings recorded in the index snapshot.",
                INDEX,
            )
        } else {
            evidence(
                "amber",
                "The snapshot has scan warnings or is stale.",
                INDEX,
            )
        }
        .detail(
            library
                .summary
                .warnings
                .iter()
                .take(8)
                .cloned()
                .collect::<Vec<_>>()
                .join("\n"),
        ),
    );
    checks.insert(
        "source-provenance",
        evidence(
            if library.current && counts.count > 0 && counts.provenance == counts.count {
                "green"
            } else {
                "amber"
            },
            "Indexed entries with recorded admission provenance.",
            INDEX,
        )
        .detail(format!("{} / {}", counts.provenance, counts.count)),
    );
    if let Some(path) = counts.example_command_file.as_ref() {
        let detail = format!(
            "{} CMD/BAT entries. Example: {}. {freshness}",
            counts.command_files,
            path.display()
        );
        for check_id in ["suspicious-entries", "false-positives"] {
            checks.insert(check_id, evidence("amber",
                "The index contains command scripts. Confirm that each is an intended game launch entry.", INDEX,
            ).detail(&detail));
        }
    }
    for (check_id, matched) in [
        ("front-covers", counts.covers),
        ("clear-logos", counts.logos),
        ("gameplay-videos", counts.videos),
    ] {
        let coverage = if counts.count == 0 {
            "No indexed games to evaluate.".to_owned()
        } else {
            format!(
                "{matched} / {} ({}%)",
                counts.count,
                matched * 100 / counts.count
            )
        };
        let status = if !library.current {
            "amber"
        } else if counts.count > 0 && matched == counts.count {
            "green"
        } else {
            "amber"
        };
        let explanation = if status == "green" {
            "Every indexed game has a matching media reference. File validity and visual approval are separate checks."
        } else {
            "Media coverage is incomplete or the index is stale. File validity and additional provider fallbacks were not tested."
        };
        checks.insert(check_id, evidence(status, explanation, INDEX)
            .detail(format!("{coverage}. {freshness}")));
    }
    Some(counts.count)
}

struct Runtime<'a> {
    record: &'a Value,
    executable: PathBuf,
    available: Option<bool>,
}

fn runtime_inventory(document: &Value) -> Vec<Runtime<'_>> {
    document["emulators"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|record| {
            let folder = record["workingFolder"].as_str().unwrap_or_default();
            let filename = record["executable"].as_str().unwrap_or_default();
            let executable = Path::new(folder).join(filename);
            let available = if folder.is_empty() || filename.is_empty() {
                Some(false)
            } else {
                presence(&executable, false)
            };
            Runtime {
                record,
                executable,
                available,
            }
        })
        .collect()
}

fn emulator_checks(checks: &mut Checks, id: &str, inventory: &[Runtime<'_>]) {
    let associated: Vec<_> = inventory
        .iter()
        .filter(|entry| {
            entry.record["platforms"]
                .as_array()
                .is_some_and(|platforms| platforms.iter().any(|platform| platform == id))
        })
        .collect();
    let records = associated
        .iter()
        .map(|entry| {
            format!(
                "{} · {} · {}",
                entry.record["name"].as_str().unwrap_or_default(),
                if entry.record["enabled"] == true {
                    "enabled"
                } else {
                    "disabled"
                },
                entry.executable.display(),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    checks.insert(
        "runtime-association",
        if associated.is_empty() {
            evidence(
                "red",
                "No emulator registry record is associated with this platform.",
                EMULATORS,
            )
        } else {
            evidence(
                "green",
                "At least one emulator is associated with this platform.",
                EMULATORS,
            )
            .detail(&records)
        },
    );
    let enabled: Vec<_> = associated
        .iter()
        .filter(|entry| entry.record["enabled"] == true)
        .collect();
    checks.insert(
        "emulator-enabled",
        if enabled.is_empty() {
            evidence("red", "No associated emulator is enabled.", EMULATORS)
        } else {
            evidence("green", "An associated emulator is enabled.", EMULATORS)
        }
        .detail(&records),
    );
    let installed = associated.iter().any(|entry| entry.available == Some(true));
    let unavailable = associated.iter().any(|entry| entry.available.is_none());
    checks.insert("emulator-installed", if installed {
        evidence("amber", "An associated executable exists. The installation and operation were not verified.", EMULATORS)
    } else if unavailable {
        evidence("amber", "Associated emulator installations could not be inspected.", EMULATORS)
    } else {
        evidence("red", "No associated emulator executable was found at its configured path.", EMULATORS)
    }.detail(&records));
    let matching: Vec<_> = enabled
        .iter()
        .map(|entry| (entry.record, entry.available == Some(true)))
        .collect();
    let unknown = enabled.iter().any(|entry| entry.available.is_none());
    let selected = emulators::select_emulator(&matching);
    checks.insert(
        "default-runtime",
        match selected {
            Ok(record) if !unknown => evidence(
                "green",
                "The launcher can resolve a unique executable.",
                EMULATORS,
            )
            .detail(record["name"].as_str().unwrap_or_default()),
            Err(("ambiguous", reason)) => evidence("red", reason, EMULATORS).detail(&records),
            _ if unknown => evidence(
                "amber",
                "An enabled executable could not be inspected.",
                EMULATORS,
            )
            .detail(&records),
            Err((_, reason)) => evidence("red", reason, EMULATORS).detail(&records),
            Ok(_) => unreachable!(),
        },
    );
    checks.insert(
        "emulator-executable",
        if enabled.iter().any(|entry| entry.available == Some(true)) {
            evidence(
                "green",
                "An enabled emulator has a regular executable file at its configured path.",
                EMULATORS,
            )
        } else if unknown {
            evidence(
                "amber",
                "Could not inspect an enabled executable path.",
                EMULATORS,
            )
        } else {
            evidence(
                "red",
                "No enabled executable was found at its configured path.",
                EMULATORS,
            )
        }
        .detail(&records),
    );
    if let Ok(record) = selected {
        checks.insert(
            "emulator-configuration",
            evidence(
                "amber",
                "Registry fields passed validation. Runtime configuration was not tested.",
                EMULATORS,
            ),
        );
        checks.insert(
            "launch-arguments",
            evidence(
                "amber",
                "Launch switch syntax passed registry validation. Operation was not tested.",
                EMULATORS,
            )
            .detail(record["switches"].to_string()),
        );
        let folder = record["workingFolder"].as_str().unwrap_or_default();
        checks.insert(
            "working-directory",
            match presence(Path::new(folder), true) {
                Some(true) => evidence(
                    "green",
                    "The configured working directory exists.",
                    EMULATORS,
                ),
                Some(false) => evidence(
                    "red",
                    "The configured working directory is unavailable.",
                    EMULATORS,
                ),
                None => evidence(
                    "amber",
                    "The configured working directory could not be inspected.",
                    EMULATORS,
                ),
            }
            .detail(folder),
        );
    }
}

pub(crate) fn evaluate(
    catalogue: Vec<Platform>,
    bundled: HashSet<String>,
    editor_root: &Path,
    controller_root: Option<&Path>,
    library_service: &library_index::Service,
) -> Snapshot {
    let started = Instant::now();
    let ids: Vec<_> = catalogue
        .iter()
        .map(|platform| platform.id.clone())
        .collect();
    let library = library_service.readiness(&ids);
    let emulator_registry = emulators::load(Path::new(library_settings::ROOT));
    let controllers = controller_root
        .ok_or("Controller profile directory is unavailable.".to_owned())
        .and_then(|path| controller_mapping::load(path, &ids));
    let inventory = emulator_registry.as_ref().ok().map(runtime_inventory);
    let mut warnings = Vec::new();
    if let Err(error) = &library {
        warnings.push(format!("Library evidence unavailable. {error}"));
    }
    if let Err(error) = &emulator_registry {
        warnings.push(format!("Emulator evidence unavailable. {error}"));
    }
    if let Err(error) = &controllers {
        warnings.push(format!("Controller evidence unavailable. {error}"));
    }
    let platforms = catalogue.into_iter().map(|platform| {
        let mut checks = platform_checks(&platform, bundled.contains(&platform.id), editor_root);
        let game_count = library.as_ref().ok().and_then(|library| library_checks(&mut checks, &platform.id, library));
        if let Some(inventory) = &inventory { emulator_checks(&mut checks, &platform.id, inventory); }
        if let Ok(document) = &controllers {
            let count = document["profiles"].as_array().into_iter().flatten()
                .filter(|profile| profile["platformId"] == platform.id).count();
            checks.insert("platform-controller", evidence(
                if count > 0 { "green" } else { "amber" },
                if count > 0 { "Valid saved controller mappings exist. Input acceptance was not tested." } else { "No valid saved platform controller mapping was found." },
                "Controller mapping store",
            ).detail(format!("{count} profiles")));
        }
        Row { platform, game_count, checks }
    }).collect();
    let evaluated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    Snapshot {
        evaluated_at,
        evaluation_ms: started.elapsed().as_secs_f64() * 1000.0,
        platforms,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn distinguishes_missing_ambiguous_and_unverified_runtimes() {
        let record = json!({
            "id": "fixture", "name": "Fixture", "platforms": ["fixture"],
            "enabled": true, "workingFolder": "", "switches": [],
        });
        let runtime = |available| Runtime {
            record: &record,
            executable: PathBuf::from("fixture.exe"),
            available,
        };
        let check = |inventory: &[Runtime<'_>]| {
            let mut checks = Checks::new();
            emulator_checks(&mut checks, "fixture", inventory);
            (
                checks["default-runtime"].status,
                checks["emulator-installed"].status,
            )
        };
        assert_eq!(check(&[]), ("red", "red"));
        assert_eq!(check(&[runtime(Some(false))]), ("red", "red"));
        assert_eq!(check(&[runtime(None)]), ("amber", "amber"));
        assert_eq!(check(&[runtime(Some(true))]), ("green", "amber"));
        assert_eq!(
            check(&[runtime(Some(true)), runtime(Some(true))]),
            ("red", "amber")
        );
        assert_eq!(
            check(&[runtime(Some(true)), runtime(None)]),
            ("amber", "amber")
        );
    }

    #[test]
    fn keeps_cached_media_counts_separate_from_validity_and_freshness() {
        let mut library = library_index::LibraryReadiness {
            sources: Default::default(),
            current: false,
            counts: None,
            summary: library_index::Summary::default(),
        };
        let mut checks = Checks::new();
        assert_eq!(library_checks(&mut checks, "fixture", &library), None);
        assert!(!checks.contains_key("front-covers"));

        library.counts = Some(Default::default());
        assert_eq!(library_checks(&mut checks, "fixture", &library), Some(0));
        assert!(checks["front-covers"]
            .detail
            .as_deref()
            .unwrap()
            .contains("No indexed games"));
        assert_eq!(checks["front-covers"].status, "amber");

        library.counts.as_mut().unwrap().insert(
            "fixture".into(),
            library_index::IndexedReadiness {
                count: 4,
                covers: 3,
                command_files: 2,
                example_command_file: Some(PathBuf::from("example.cmd")),
                ..Default::default()
            },
        );
        assert_eq!(library_checks(&mut checks, "fixture", &library), Some(4));
        assert_eq!(checks["indexed-games"].status, "amber");
        assert!(checks["front-covers"]
            .detail
            .as_deref()
            .unwrap()
            .contains("3 / 4 (75%)"));
        assert_eq!(checks["front-covers"].status, "amber");
        assert!(checks["suspicious-entries"]
            .detail
            .as_deref()
            .unwrap()
            .contains("2 CMD/BAT"));

        library.current = true;
        library.counts.as_mut().unwrap().get_mut("fixture").unwrap().covers = 4;
        library_checks(&mut checks, "fixture", &library);
        assert_eq!(checks["front-covers"].status, "green");

        library.counts.as_mut().unwrap().get_mut("fixture").unwrap().covers = 3;
        library_checks(&mut checks, "fixture", &library);
        assert_eq!(checks["front-covers"].status, "amber");
    }

    #[test]
    fn marks_resolved_nonempty_platform_assets_green_and_broken_assets_red() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let asset = std::env::temp_dir().join(format!("totem-readiness-startup-{stamp}.mp4"));
        fs::write(&asset, b"present").unwrap();

        let present = presentation_asset(
            Ok(Some(asset.clone())),
            "No startup asset.",
            "Startup asset resolves; playback remains untested.",
        );
        assert_eq!(present.status, "green");

        fs::remove_file(&asset).unwrap();
        let missing = presentation_asset(
            Ok(Some(asset.clone())),
            "No startup asset.",
            "Startup asset resolves; playback remains untested.",
        );
        assert_eq!(missing.status, "red");
    }

    #[test]
    fn rejects_traversal_in_platform_and_asset_references() {
        assert!(crate::platform_presentation_file("../fixture", "Artwork/UI/button.png").is_err());
        assert!(platform_editor::asset_path(Path::new("fixtures"), "../model.glb").is_err());
        assert!(crate::bundled_model_path("assets/models/../model.glb", &"a".repeat(64)).is_err());
    }
}
