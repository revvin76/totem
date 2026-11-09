import known from "../emulator-catalogue.json" with { type: "json" };
import { invoke, isTauri } from "@tauri-apps/api/core";

export function initialEmulators() {
  return { version: 1, revision: null, emulators: known.map((e) => ({ ...structuredClone(e), enabled: false, workingFolder: "", executable: "", installedVersion: "", autoUpdate: false, switches: e.switches.map((argument) => ({ argument, enabled: false })) })) };
}
function mergeCatalogue(document) {
  const defaults = initialEmulators().emulators;
  const ids = new Set(document.emulators.map((emulator) => emulator.id));
  return { ...document, emulators: [...document.emulators, ...defaults.filter((emulator) => !ids.has(emulator.id))] };
}
export function normalizeExtensions(value) {
  const result = [...new Set(value.toLowerCase().split(/[\s,;]+/).map((s) => s.replace(/^\./, "")).filter(Boolean))];
  if (!result.length || result.length > 100 || result.some((s) => !/^[a-z0-9]{1,24}$/.test(s))) throw new Error("Enter extensions such as zip, chd or iso, separated by commas.");
  return result;
}
export function validateEmulator(record) {
  if (!record.name.trim()) throw new Error("Enter an emulator name.");
  if (record.website) {
    const url = new URL(record.website);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use an HTTPS website without credentials.");
  }
  if (record.enabled && (!record.workingFolder.trim() || !/\.exe$/i.test(record.executable))) throw new Error("Enabled emulators need a working folder and an .exe executable.");
  if (record.switches.some((s) => !s.argument.trim() || /[\r\n\0]/.test(s.argument))) throw new Error("Each launch switch needs a single argument or argument group.");
  if (record.autoUpdate && !known.find((e) => e.id === record.id)?.wingetId) throw new Error("Automatic updates are not supported for this emulator.");
  return structuredClone(record);
}
const readPreview = (key, fallback) => JSON.parse(localStorage.getItem(key) || "null") ?? fallback();
function savePreview(key, doc, expected, initial) {
  if (readPreview(key, initial).revision !== expected) throw new Error("Settings changed in another window. Reload before saving.");
  const next = structuredClone(doc); next.revision = crypto.randomUUID(); localStorage.setItem(key, JSON.stringify(next));
  const persisted = JSON.parse(localStorage.getItem(key));
  if (JSON.stringify(next) !== JSON.stringify(persisted)) throw new Error("Saved settings could not be verified.");
  return persisted;
}
export function emulatorSettingsStore() {
  const native = isTauri(), key = "totem.emulators.v1";
  return {
    native,
    load: async () => mergeCatalogue(native ? await invoke("load_emulators") : readPreview(key, initialEmulators)),
    save: async (doc) => {
      const normalized = mergeCatalogue(doc);
      normalized.emulators.forEach(validateEmulator);
      return native ? invoke("save_emulators", { document: normalized, expectedRevision: normalized.revision }) : savePreview(key, normalized, normalized.revision, initialEmulators);
    },
    scan: (expectedRevision) => invoke("scan_emulators", { expectedRevision }),
    launch: (id) => invoke("launch_emulator", { id }),
    async install(id, expectedRevision) {
      if (!native) throw new Error("WinGet installation is available in the Windows desktop app.");
      return invoke("install_emulator", { id, expectedRevision });
    },
    async update(record, install) {
      if (native) return invoke("emulator_update", { id: record.id, install });
      if (install) throw new Error("WinGet updates are available in the desktop application.");
      const repo = known.find((e) => e.id === record.id)?.releaseRepo;
      if (!repo) return { status: "Check the official website", website: record.website };
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("Release feed unavailable. Use the official website.");
      const release = await response.json();
      if (typeof release.tag_name !== "string") throw new Error("Invalid release response. Use the official website.");
      return { status: "Release checked", latestVersion: release.tag_name, website: release.html_url, notes: (release.body || "").slice(0, 4000) };
    },
    open: (record) => native ? invoke("open_emulator_website", { id: record.id }) : window.open(record.website, "_blank", "noopener,noreferrer"),
  };
}
export function platformExtensionStore() {
  const native = isTauri(), key = "totem.platform-extensions.v1", initial = () => ({ version: 1, revision: null, platforms: {} });
  return {
    native,
    load: () => native ? invoke("load_platform_extensions") : Promise.resolve(readPreview(key, initial)),
    save: async (doc, id, extensions, folders) => {
      if (native) return invoke("save_platform_extensions", { platformId: id, extensions, folders, expectedRevision: doc.revision });
      const next = structuredClone(doc);
      if (extensions) next.platforms[id] = extensions;
      return savePreview(key, next, doc.revision, initial);
    },
  };
}
