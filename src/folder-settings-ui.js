import { invoke } from "@tauri-apps/api/core";
import defaults from "../folder-settings.json" with { type: "json" };
import collections from "../folder-collections.json" with { type: "json" };
import platforms from "../platforms.json" with { type: "json" };
import "./folder-settings.css";
import { igdb } from "./igdb-client.js";
import { normalizeFolderCollections, preserveUnlistedPlatforms } from "./folder-settings-data.js";
import { confirmEditorLeave } from "./settings-navigation.js";

const FOLDERS = [
  ["root", "Totem home"], ["platforms", "Platform libraries"],
  ["collections", "Other collections and engines"], ["playlists", "Favourites and recently played"],
  ["models", "Model import staging (reserved)"], ["artworkCache", "Downloaded artwork cache"],
  ["legacy", "Original CoinOPS metadata and system artwork"], ["manifest", "Collection manifest (JSON)"],
];

export function mountFolderSettings(native) {
  const $ = (id) => document.getElementById(id);
  const dialog = $("folder-settings");
  let current, records = [], opener, savedMetadata;
  const fields = new Map();
  const metadataChecks = [...document.querySelectorAll("[data-metadata-provider], [data-metadata-platform]")];
  const platformHost = $("metadata-platform-options");
  for (const platform of platforms) {
    const label = document.createElement("label");
    const input = document.createElement("input"); input.type = "checkbox"; input.dataset.metadataPlatform = platform.id; input.checked = true; input.disabled = !native;
    label.append(input, document.createTextNode(platform.name)); platformHost.append(label); metadataChecks.push(input);
  }
  for (const input of metadataChecks) input.disabled = !native;
  for (const input of metadataChecks) input.addEventListener("change", () => { $("metadata-preferences-status").textContent = "Unsaved artwork preferences."; });
  $("steamgriddb-api-key").disabled = !native;
  $("steamgriddb-save-connection").disabled = $("steamgriddb-test-connection").disabled = !native;
  $("metadata-save-preferences").disabled = !native;
  function metadataPreferences() {
    return {
      igdbTypes: metadataChecks.filter((input) => input.dataset.metadataProvider === "igdb" && input.checked).map((input) => input.dataset.metadataType),
      steamgriddbTypes: metadataChecks.filter((input) => input.dataset.metadataProvider === "steamgriddb" && input.checked).map((input) => input.dataset.metadataType),
      platforms: preserveUnlistedPlatforms(metadataChecks.filter((input) => input.dataset.metadataPlatform && input.checked).map((input) => input.dataset.metadataPlatform), savedMetadata?.platforms ?? [], metadataChecks.filter((input) => input.dataset.metadataPlatform).map((input) => input.dataset.metadataPlatform)),
    };
  }
  function showMetadataSettings(state) {
    savedMetadata = structuredClone(state);
    const igdb = new Set(state.igdbTypes ?? []), sgdb = new Set(state.steamgriddbTypes ?? []), enabledPlatforms = new Set(state.platforms ?? []);
    for (const input of metadataChecks) {
      if (input.dataset.metadataProvider === "igdb") input.checked = igdb.has(input.dataset.metadataType);
      else if (input.dataset.metadataProvider === "steamgriddb") input.checked = sgdb.has(input.dataset.metadataType);
      else if (input.dataset.metadataPlatform) input.checked = enabledPlatforms.has(input.dataset.metadataPlatform);
    }
    $("steamgriddb-connection-status").textContent = state.configured ? `Configured · ${state.protection}` : "No connection configured.";
    dialog.dispatchEvent(new CustomEvent("totem:metadata-settings-loaded", { detail: [...enabledPlatforms] }));
  }
  async function refreshMetadataSettings() {
    try {
      const state = native ? await invoke("get_metadata_settings") : { configured: false, igdbTypes: ["cover", "logo", "artwork"], steamgriddbTypes: ["grid", "hero", "logo"], platforms: platforms.map((item) => item.id) };
      showMetadataSettings(state);
    } catch (error) { $("steamgriddb-connection-status").textContent = `Metadata settings unavailable: ${error}`; }
  }
  async function saveMetadataSettings() {
    if (!native) throw new Error("Open the desktop app to save metadata settings.");
    const state = await invoke("save_metadata_settings", { apiKey: $("steamgriddb-api-key").value, preferences: metadataPreferences() });
    $("steamgriddb-api-key").value = ""; showMetadataSettings(state);
  }
  $("steamgriddb-save-connection").addEventListener("click", async () => {
    $("steamgriddb-save-connection").disabled = $("steamgriddb-test-connection").disabled = true;
    $("steamgriddb-connection-status").textContent = "Saving protected connection and preferences…";
    try { await saveMetadataSettings(); $("steamgriddb-connection-status").textContent = "SteamGridDB connection and metadata preferences saved."; }
    catch (error) { $("steamgriddb-connection-status").textContent = `SteamGridDB settings not saved: ${error}`; }
    finally { $("steamgriddb-save-connection").disabled = $("steamgriddb-test-connection").disabled = !native; }
  });
  $("steamgriddb-test-connection").addEventListener("click", async () => {
    $("steamgriddb-save-connection").disabled = $("steamgriddb-test-connection").disabled = true;
    $("steamgriddb-connection-status").textContent = "Saving settings and checking SteamGridDB…";
    try { await saveMetadataSettings(); await invoke("test_steamgriddb_connection"); $("steamgriddb-connection-status").textContent = "Connected to SteamGridDB successfully."; }
    catch (error) { $("steamgriddb-connection-status").textContent = `SteamGridDB connection not updated: ${error}`; }
    finally { $("steamgriddb-save-connection").disabled = $("steamgriddb-test-connection").disabled = !native; }
  });
  async function saveProviderPreferences() {
    if ($("metadata-save-preferences").disabled || $("steamgriddb-save-connection").disabled) return false;
    $("metadata-save-preferences").disabled = true;
    $("metadata-preferences-status").textContent = "Saving metadata preferences…";
    try {
      await saveMetadataSettings();
      $("metadata-preferences-status").textContent = "Metadata preferences saved.";
      return true;
    } catch (error) {
      $("metadata-preferences-status").textContent = `Metadata preferences not saved: ${error}`;
      return false;
    }
    finally { $("metadata-save-preferences").disabled = !native; }
  }
  $("metadata-save-preferences").addEventListener("click", saveProviderPreferences);
  const connectionButtons = ["igdb-import-shared", "igdb-save-connection", "igdb-test-connection"];
  function setConnectionBusy(busy) { for (const id of connectionButtons) $(id).disabled = !native || busy; }
  async function showConnection() {
    setConnectionBusy(true);
    try {
      if (!native) { $("igdb-connection-status").textContent = "Configure and use IGDB in the desktop app."; return; }
      const state = await igdb.status();
      $("igdb-connection-status").textContent = state.configured ? `Configured · client ID ends ${state.clientIdSuffix} · ${state.protection}` : "No connection configured.";
    } catch (error) { $("igdb-connection-status").textContent = `Connection unavailable: ${error}`; }
    finally { setConnectionBusy(false); }
  }
  $("igdb-client-id").disabled = $("igdb-client-secret").disabled = !native;
  function clearIgdbDraft() {
    $("igdb-client-id").value = $("igdb-client-secret").value = "";
  }
  async function saveIgdbDraft() {
    if ($("igdb-save-connection").disabled) return false;
    setConnectionBusy(true);
    try {
      await igdb.save($("igdb-client-id").value, $("igdb-client-secret").value);
      clearIgdbDraft();
      await showConnection();
      return true;
    } catch (error) {
      $("igdb-connection-status").textContent = `IGDB connection not updated: ${error}`;
      return false;
    } finally { setConnectionBusy(false); }
  }
  $("igdb-save-connection").addEventListener("click", saveIgdbDraft);
  for (const [id, action] of [
    ["igdb-import-shared", () => igdb.importShared()],
    ["igdb-test-connection", () => igdb.test()],
  ]) $(id).addEventListener("click", async () => {
    setConnectionBusy(true); $("igdb-connection-status").textContent = "Checking IGDB connection…";
    try {
      await action(); await showConnection();
      if (id === "igdb-test-connection") $("igdb-connection-status").textContent = "Connected to IGDB successfully.";
    } catch (error) { $("igdb-connection-status").textContent = `IGDB connection not updated: ${error}`; }
    finally { clearIgdbDraft(); setConnectionBusy(false); }
  });
  for (const [key, name] of FOLDERS) {
    const label = document.createElement("label");
    label.textContent = name;
    const input = document.createElement("input"); input.type = "text"; input.readOnly = !native; input.spellcheck = false;
    const state = document.createElement("span"); state.className = "folder-path-status";
    label.append(input, state); $("folder-fields").append(label); fields.set(key, { input, state });
    input.addEventListener("input", () => { $("folder-save-status").textContent = "Unsaved folder changes. Saving updates paths; it does not move files."; });
  }
  function renderCollections() {
    const query = $("folder-collection-search").value.trim().toLowerCase();
    $("folder-collection-list").replaceChildren();
    for (const record of records.filter((item) => `${item.name} ${item.platformId ?? ""}`.toLowerCase().includes(query))) {
      const row = document.createElement("details");
      const heading = document.createElement("summary"); heading.textContent = `${record.name} · ${record.kind}`;
      const ext = document.createElement("p"); ext.textContent = record.extensions?.length ? `Supported extensions: ${record.extensions.join(", ")}` : "Legacy menu or collection; no supported extensions declared.";
      row.append(heading, ext);
      for (const root of record.gameRoots ?? []) {
        const path = document.createElement("p"); path.className = "folder-game-path"; path.textContent = root.path; row.append(path);
      }
      if (record.configuredGamePath) {
        const external = document.createElement("p");
        external.textContent = `Original configured path: ${record.configuredGamePath.resolved}${record.configuredGamePath.outsideCollections ? " · retained external location" : ""}${record.configuredGamePath.exists ? "" : " · was unavailable at import"}`;
        row.append(external);
      }
      $("folder-collection-list").append(row);
    }
  }
  function render(data) {
    current = data.settings; records = normalizeFolderCollections(data.collections);
    for (const [key, { input, state }] of fields) {
      input.value = current.paths[key];
      const result = data.statuses?.find((item) => item.key === key);
      state.textContent = !native ? "Desktop validates this path" : result?.exists ? "Available" : "Not found";
    }
    const counts = current.counts;
    $("folder-summary").textContent = `${counts.collections} source collections · ${counts.platformFamilies} platform families · ${counts.favorites} favourite entries · ${counts.lastPlayed} recently played entries`;
    const missing = records.filter((item) => item.configuredGamePath?.exists === false).length;
    $("folder-missing-paths").textContent = missing ? `${missing} configured game locations were unavailable at import. Expand a collection below to review its original path.` : "";
    $("folder-migration-status").textContent = `Migration: ${current.migration.state}. Report: ${current.migration.reportPath}`;
    $("folder-storage").textContent = native ? `Settings revisions: ${data.storage}` : "Browser preview uses the bundled migration snapshot. Open the desktop app to validate folders and save changes.";
    $("folder-save").disabled = !native;
    renderCollections();
    dialog.dispatchEvent(new CustomEvent("totem:library-sources-loaded", { detail: records }));
  }
  async function refresh() {
    $("folder-save").disabled = true;
    $("folder-save-status").textContent = "Loading folder settings…";
    try {
      render(native ? await invoke("get_library_settings") : { settings: defaults, collections });
      $("folder-save-status").textContent = native ? "Folders loaded from disk." : "Browser preview · library folders are read-only.";
    } catch (error) { $("folder-save-status").textContent = `Could not load folder settings: ${error}`; }
  }
  async function refreshErrorLogLocation() {
    const location = $("error-log-location");
    if (!native) { location.textContent = "Error logging is available in the desktop app."; return; }
    try { location.textContent = await invoke("get_error_log_location"); }
    catch (error) { location.textContent = `Error log location unavailable: ${error}`; }
  }
  function openSettings() {
    if (dialog.open) return;
    opener = document.activeElement;
    dialog.showModal();
    dialog.dispatchEvent(new Event("totem:settings-open"));
    refresh(); refreshErrorLogLocation(); showConnection(); refreshMetadataSettings();
  }
  $("folder-settings-toggle").addEventListener("click", openSettings);
  $("action-mappings-toggle").addEventListener("click", () => {
    openSettings();
    dialog.querySelector('[aria-controls="admin-action-mappings"]')?.click();
    const panel = $("app-controller-mappings");
    panel.open = true;
    panel.querySelector("summary").focus();
    panel.scrollIntoView({ block: "start" });
  });
  function foldersChanged() {
    return current && [...fields].some(([key, { input }]) => input.value.trim() !== current.paths[key]);
  }
  function igdbChanged() {
    return ["igdb-client-id", "igdb-client-secret"].some(id => $(id).value.trim());
  }
  function preferencesChanged() {
    const signature = (value) => JSON.stringify(["igdbTypes", "steamgriddbTypes", "platforms"].map((key) => [...(value[key] ?? [])].sort()));
    const metadataChanged = savedMetadata && signature(metadataPreferences()) !== signature(savedMetadata);
    return metadataChanged || $("steamgriddb-api-key").value.trim();
  }
  function providersChanged() {
    return igdbChanged() || preferencesChanged();
  }
  function allowLeave(section, resume) {
    if (section === "sources" && foldersChanged()) {
      if (!$("folder-save").disabled) confirmEditorLeave({
        title: "Unsaved library folders", save: saveFolders, discard: () => discard.click(), leave: resume,
      });
      return false;
    }
    if (section === "providers" && providersChanged()) {
      if (igdbChanged()) {
        if (!$("igdb-save-connection").disabled) confirmEditorLeave({
          title: "Unsaved IGDB connection", save: saveIgdbDraft, discard: clearIgdbDraft, leave: resume,
        });
      } else if (!$("metadata-save-preferences").disabled && !$("steamgriddb-save-connection").disabled) {
        confirmEditorLeave({
          title: "Unsaved artwork provider settings", save: saveProviderPreferences,
          discard: () => discardProviders.click(), leave: resume,
        });
      }
      return false;
    }
    return true;
  }
  dialog.addEventListener("totem:settings-section-can-leave", event => {
    if (!allowLeave(event.detail.section, event.detail.resume)) event.preventDefault();
  });
  function allowClose(event) {
    const section = foldersChanged() ? "sources" : providersChanged() ? "providers" : null;
    if (!section) return true;
    event?.preventDefault();
    allowLeave(section, () => $("folder-close").click());
    return false;
  }
  $("folder-close").addEventListener("click", (event) => { if (allowClose(event)) dialog.close(); });
  dialog.addEventListener("cancel", allowClose);
  const discard = document.createElement("button"); discard.type = "button"; discard.textContent = "Discard folder changes"; discard.id = "folder-discard";
  discard.disabled = !native;
  discard.addEventListener("click", () => {
    if (current) for (const [key, { input }] of fields) input.value = current.paths[key];
    $("folder-save-status").textContent = "Unsaved folder changes discarded.";
  });
  $("folder-save").before(discard);
  const discardProviders = document.createElement("button"); discardProviders.type = "button";
  discardProviders.textContent = "Discard provider changes"; discardProviders.id = "metadata-discard"; discardProviders.disabled = !native;
  discardProviders.addEventListener("click", () => {
    if (savedMetadata) showMetadataSettings(savedMetadata);
    for (const id of ["igdb-client-id", "igdb-client-secret", "steamgriddb-api-key"]) $(id).value = "";
    $("metadata-preferences-status").textContent = "Unsaved provider changes discarded.";
  });
  $("metadata-save-preferences").before(discardProviders);
  dialog.addEventListener("close", () => {
    if (opener?.getClientRects().length) opener.focus();
    else $("navigation-toggle")?.focus();
  });
  $("folder-refresh").addEventListener("click", () => {
    if (foldersChanged()) { $("folder-save-status").textContent = "Save or discard folder changes before reloading."; return; }
    refresh();
  });
  window.addEventListener("beforeunload", (event) => {
    if (foldersChanged() || providersChanged()) { event.preventDefault(); event.returnValue = ""; }
  });
  $("folder-collection-search").addEventListener("input", renderCollections);
  async function saveFolders() {
    if (!native || !current || $("folder-save").disabled) return false;
    $("folder-save").disabled = true;
    try {
      const paths = Object.fromEntries([...fields].map(([key, field]) => [key, field.input.value.trim()]));
      render(await invoke("save_library_settings", { paths, expectedRevision: current.revision }));
      $("folder-save-status").textContent = "Folder settings saved and read back from disk. Files were not moved.";
      return true;
    } catch (error) {
      $("folder-save-status").textContent = `Settings not saved: ${error}`;
      return false;
    }
    finally { $("folder-save").disabled = false; }
  }
  $("folder-save").addEventListener("click", saveFolders);
  return { isOpen: () => dialog.open };
}
