import bundledPlatforms from "../platforms.json" with { type: "json" };
import bundledCollections from "../folder-collections.json" with { type: "json" };
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createPlatformStore } from "./platform-store.js";
import { normalizeFolderCollections } from "./folder-settings-data.js";
import { createRomFoldersEditor } from "./rom-folders-editor.js";
import { normalizeExtensions, platformExtensionStore } from "./emulator-settings.js";
import { confirmEditorLeave } from "./settings-navigation.js";

export function mountPlatformLibrarySettings(section, scanSection) {
  const native = isTauri(), extensionStore = platformExtensionStore(), dirty = new Map();
  const list = document.createElement("div"); list.className = "admin-platform-settings";
  const status = document.createElement("p"); status.setAttribute("role", "status"); status.id = "platform-library-settings-status";
  const scan = document.createElement("button"); scan.type = "button"; scan.textContent = "Rescan library"; scan.disabled = !native;
  const scanStatus = document.createElement("p"); scanStatus.setAttribute("role", "status");
  scanStatus.textContent = native ? "Scans all platforms using saved folders and file extensions." : "Rescanning is available in the desktop app.";
  scan.onclick = async () => {
    scan.disabled = true;
    try {
      scanStatus.textContent = "Scanning with saved folders and file extensions…";
      const summary = await invoke("scan_game_library");
      window.dispatchEvent(new CustomEvent("totem:library-rescanned", { detail: summary }));
      scanStatus.textContent = `Library scan finished: ${summary.totalGames} games.`;
    } catch (e) {
      scanStatus.textContent = `Scan failed: ${e.message || e}`;
    } finally {
      scan.disabled = !native;
      if (document.activeElement === document.body && scan.getClientRects().length) scan.focus();
    }
  };
  const scanHeading = document.createElement("h4"); scanHeading.textContent = "Library scan";
  scanSection.append(scanHeading, scan, scanStatus);
  section.append(status, list);
  const rows = [];
  let selectedId;
  document.getElementById("platform-editor").addEventListener("totem:platform-sources-can-leave", event => {
    if (!dirty.size) return;
    event.preventDefault();
    document.getElementById("editor-status").textContent = "Save or discard the changes in Games & Sources first.";
    const owner = dirty.values().next().value;
    if (event.detail && !owner.saving) confirmEditorLeave({
      title: "Unsaved Games & Sources changes",
      save: owner.save,
      discard: owner.discard,
      leave: event.detail,
    });
  });
  window.addEventListener("beforeunload", (event) => { if (dirty.size) { event.preventDefault(); event.returnValue = ""; } });
  const loaded = (async () => {
    try {
      status.textContent = "Loading platforms…";
      const store = await createPlatformStore(native, bundledPlatforms);
      const [platforms, loaded] = await Promise.all([store.catalogue(), extensionStore.load()]);
      let extensionDocument = loaded;
      const previewCollections = native ? [] : normalizeFolderCollections(bundledCollections);
      for (const record of platforms) {
        const row = document.createElement("details"), summary = document.createElement("summary"), title = document.createElement("strong"), maker = document.createElement("small");
        title.textContent = record.name; maker.textContent = record.maker; summary.append(title, maker); row.append(summary);
        const editor = document.createElement("div"); editor.className = "admin-platform-options";
        const extensionLabel = document.createElement("label"), extensions = document.createElement("input"), message = document.createElement("p");
        const folders = createRomFoldersEditor(markDirty);
        const extensionKey = record.id;
        let savedExtensions, savedFolders;
        function refreshSources() {
          const source = extensionDocument.romFolders?.platforms[extensionKey];
          const previewSources = previewCollections.filter(item => item.platformId === extensionKey);
          savedFolders = source?.paths ?? [...new Set(previewSources.flatMap(item => [
            ...item.gameRoots.filter(root => root.active !== false).map(root => root.path),
            item.configuredGamePath?.resolved,
          ]).filter(Boolean))];
          const template = source?.template;
          const declared = template
            ? template.admissions[0]?.[0]?.rule === "fallback" ? [] : [...template.extensions].sort()
            : [...new Set(previewSources.flatMap(item => item.extensions))];
          savedExtensions = (extensionDocument.platforms[extensionKey] ?? declared).join(", ");
          if (!dirty.has(extensionKey)) resetFields();
        }
        function resetFields() {
          extensions.value = savedExtensions;
          folders.reset(savedFolders);
        }
        extensionLabel.textContent = "File extensions"; extensions.placeholder = "zip, chd, iso"; extensionLabel.append(extensions);
        folders.element.disabled = !native;
        function sourceChanged() {
          const paths = folders.paths();
          return paths.length !== savedFolders.length || paths.some((path, index) => path !== savedFolders[index]);
        }
        function markDirty() {
          if (extensions.value === savedExtensions && !sourceChanged()) dirty.delete(extensionKey);
          else dirty.set(extensionKey, owner);
          message.textContent = dirty.has(extensionKey) ? "Unsaved changes" : "";
        }
        extensions.oninput = markDirty;
        message.setAttribute("role", "status");
        const saveExtensions = document.createElement("button"), discard = document.createElement("button");
        for (const btn of [saveExtensions, discard]) btn.type = "button";
        saveExtensions.textContent = "Save sources and extensions"; discard.textContent = "Discard changes";
        extensions.onkeydown = event => { if (event.key === "Enter") event.preventDefault(); };
        async function save() {
          if (saveExtensions.disabled || !dirty.has(extensionKey)) return false;
          extensions.readOnly = folders.element.disabled = saveExtensions.disabled = discard.disabled = true;
          try {
            const values = extensions.value !== savedExtensions ? normalizeExtensions(extensions.value) : null;
            const paths = sourceChanged() ? folders.paths() : null;
            if (paths?.some(path => !path)) throw new Error("Enter a full path for each folder, or remove the empty row.");
            extensionDocument = await extensionStore.save(extensionDocument, record.id, values, paths);
            dirty.delete(extensionKey);
            refreshSources();
            message.textContent = native ? "Changes saved. Use All sources & scans to update the index." : "Changes saved in this browser preview.";
            return true;
          } catch (e) {
            message.textContent = `Changes could not be saved. ${e.message || e}`;
            const tab = document.getElementById("editor-tab-sources");
            if (tab.getAttribute("aria-selected") !== "true") {
              tab.click();
              tab.focus();
            }
            return false;
          } finally {
            extensions.readOnly = saveExtensions.disabled = discard.disabled = false;
            folders.element.disabled = !native;
            if (document.activeElement === document.body && saveExtensions.getClientRects().length) saveExtensions.focus();
          }
        }
        const owner = {
          save,
          get saving() { return saveExtensions.disabled; },
          discard() {
            resetFields();
            dirty.delete(extensionKey);
            message.textContent = "Unsaved changes discarded.";
          },
        };
        saveExtensions.onclick = save;
        discard.onclick = owner.discard;
        editor.append(folders.element, extensionLabel, saveExtensions, discard, message); row.append(editor); row.hidden = true; list.append(row);
        rows.push({ id: record.id, row, title, refreshSources });
      }
      status.textContent = native ? "" : "Edit ROM folders and rescan in the desktop app.";
    } catch (error) { status.textContent = `Platform settings unavailable: ${error.message || error}`; }
  })();
  return {
    async showPlatform(id, name) {
      selectedId = id;
      await loaded;
      if (selectedId !== id) return;
      for (const entry of rows) {
        entry.row.hidden = entry.id !== id;
        if (entry.id === id) { entry.refreshSources(); entry.row.open = true; entry.title.textContent = name; }
      }
    },
  };
}
