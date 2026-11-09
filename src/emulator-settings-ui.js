import catalogue from "../emulator-catalogue.json" with { type: "json" };
import { emulatorSettingsStore, validateEmulator } from "./emulator-settings.js";
import { createPlatformStore } from "./platform-store.js";
import { createLibraryClient } from "./library-client.js";
import { confirmEditorLeave } from "./settings-navigation.js";

const make = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
const action = (text, fn) => { const el = make("button", text); el.type = "button"; el.addEventListener("click", fn); return el; };
const sortedByName = (records) => [...records].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
function inputRow(parent, title, value, type = "text") {
  const label = make("label", title), input = make("input"); input.type = type;
  if (type === "checkbox") input.checked = value; else input.value = value;
  label.append(input); parent.append(label); return input;
}
export function mountEmulators(section, platforms) {
  const store = emulatorSettingsStore();
  const library = createLibraryClient(store.native);
  let documentState, selected = new Set(), editing, busy = false;
  let detectedPlatformIds = null, restoreFilters, contextPlatformId;
  const toolbar = make("div", null, "admin-emulator-toolbar"), search = make("input"), filter = make("select"), statusFilter = make("select"), detectedLabel = make("label", "Detected platforms only"), detectedOnly = make("input");
  detectedOnly.type = "checkbox"; detectedOnly.disabled = !store.native; detectedOnly.setAttribute("aria-label", "Show only platforms with detected games"); detectedLabel.className = "admin-emulator-detected-filter"; detectedLabel.append(detectedOnly);
  search.type = "search"; search.placeholder = "Search emulators…"; search.setAttribute("aria-label", "Search emulators");
  filter.setAttribute("aria-label", "Emulator platform filter");
  function populatePlatformFilter() {
    const current = filter.value;
    const allowed = detectedOnly.checked && detectedPlatformIds
      ? platforms.filter((platform) => detectedPlatformIds.has(platform.id))
      : platforms;
    filter.replaceChildren(new Option(detectedOnly.checked ? "All detected platforms" : "All platforms", ""));
    sortedByName(allowed).forEach((platform) => filter.add(new Option(platform.name, platform.id)));
    filter.value = allowed.some((platform) => platform.id === current) ? current : "";
  }
  populatePlatformFilter();
  statusFilter.setAttribute("aria-label", "Emulator status filter"); for (const [label, value] of [["All emulators", ""], ["Enabled", "enabled"], ["Disabled", "disabled"]]) statusFilter.add(new Option(label, value));
  toolbar.append(search, filter, statusFilter, detectedLabel);
  const summary = make("p"), status = make("p"); status.setAttribute("role", "status"); summary.id = "emulator-summary"; status.id = "emulator-status";
  const table = make("table", null, "admin-emulator-table"), head = make("thead"), header = make("tr"), body = make("tbody");
  ["Select", "Emulator", "Supported platforms", "Status", ""].forEach((title) => header.append(make("th", title))); head.append(header); table.append(head, body);
  const results = make("div", null, "emulator-update-results"); results.setAttribute("aria-live", "polite");
  const buttons = make("div", null, "admin-emulator-actions");
  const catalogueView = make("div");
  const editor = make("section", null, "emulator-editor");
  editor.hidden = true;
  editor.setAttribute("aria-labelledby", "emulator-editor-heading");
  const installProgress = make("dialog", null, "emulator-install-progress");
  installProgress.setAttribute("aria-label", "Emulator installation progress");
  const installProgressSpinner = make("span", "◌", "emulator-install-spinner"), installProgressMessage = make("p"), installProgressAction = make("button", "Close");
  let installProgressActionHandler = () => installProgress.close();
  installProgressAction.type = "button";
  installProgressMessage.setAttribute("role", "status");
  installProgressAction.addEventListener("click", () => installProgressActionHandler());
  installProgressAction.hidden = true;
  installProgress.append(installProgressSpinner, installProgressMessage, installProgressAction);
  catalogueView.append(summary, toolbar, buttons, status, table, results);
  section.append(catalogueView, editor);
  document.body.append(installProgress);

  async function persist(records) {
    const saved = await store.save({ ...documentState, emulators: records }); documentState = saved; render(); window.dispatchEvent(new Event("totem:emulators-changed")); return saved;
  }
  function setBusy(value) {
    busy = value;
    for (const button of buttons.querySelectorAll("button")) button.disabled = value;
    scanButton.disabled = value || !store.native;
    for (const button of body.querySelectorAll("button[data-install], button[data-launch]")) button.disabled = value || !store.native;
  }
  async function install(record) {
    if (busy || !documentState || !store.native) return;
    const installProfile = catalogue.find((entry) => entry.id === record.id);
    const installMethod = installProfile?.wingetInstall ? "WinGet" : "GitHub release";
    setBusy(true);
    installProgressSpinner.hidden = false;
    installProgressAction.hidden = true;
    installProgressMessage.textContent = `Installing ${record.name} via ${installMethod}. This can take several minutes…`;
    installProgress.showModal();
    try {
      documentState = await store.install(record.id, documentState.revision);
      const installed = documentState.emulators.find((entry) => entry.id === record.id);
      if (!installed) throw new Error("Installation finished, but the saved emulator settings could not be found.");
      window.dispatchEvent(new Event("totem:emulators-changed"));
      render();
      setBusy(false);
      status.textContent = `${record.name} installed successfully.`;
      installProgressSpinner.hidden = true;
      installProgressMessage.textContent = `${record.name} installed successfully via ${installMethod} and is enabled. Review its working folder and executable before continuing.`;
      installProgressAction.textContent = `Review ${record.name} settings`;
      installProgressActionHandler = () => {
        installProgress.close();
        configure(installed, {
          message: `Installed via ${installMethod}. Review the enabled setting and executable paths.`,
          openerId: `emulator-configure-${installed.id}`,
        });
      };
      installProgressAction.hidden = false;
      installProgressAction.focus();
    } catch (error) {
      const reason = error.message || String(error);
      status.textContent = `${record.name} installation via ${installMethod} failed: ${reason}`;
      installProgressSpinner.hidden = true;
      installProgressMessage.textContent = status.textContent;
      installProgressAction.textContent = "Close";
      installProgressActionHandler = () => installProgress.close();
      installProgressAction.hidden = false;
      installProgressAction.focus();
    } finally {
      setBusy(false);
    }
  }
  function render() {
    if (!documentState) return;
    summary.textContent = `${documentState.emulators.length} known and custom emulators · ${documentState.emulators.filter((e) => e.enabled).length} enabled`;
    if (store.native) summary.textContent += ` · ${Object.values(documentState.availability || {}).filter((e) => e.executableExists).length} executables found`;
    body.replaceChildren();
    const visibleEmulators = documentState.emulators.filter((e) => `${e.name} ${e.platforms.join(" ")}`.toLowerCase().includes(search.value.toLowerCase()) && (!filter.value || e.platforms.includes(filter.value)) && (!statusFilter.value || e.enabled === (statusFilter.value === "enabled")));
    for (const record of sortedByName(visibleEmulators)) {
      const row = make("tr"), selectCell = make("td"), checkbox = make("input"); checkbox.type = "checkbox"; checkbox.checked = selected.has(record.id); checkbox.setAttribute("aria-label", `Select ${record.name}`);
      checkbox.onchange = () => checkbox.checked ? selected.add(record.id) : selected.delete(record.id); selectCell.append(checkbox);
      const name = make("td"), supported = make("td"), state = make("td"), controls = make("td");
      const configureButton = action(record.name, () => configure(record, { openerId: configureButton.id }));
      configureButton.id = `emulator-configure-${record.id}`;
      name.append(configureButton);
      const platformNames = record.platforms.map((id) => platforms.find((p) => p.id === id)?.name || id).join(", ");
      supported.textContent = record.platforms.length > 3 ? `Multi (${record.platforms.length})` : platformNames || "Not assigned";
      supported.title = platformNames;
      const executableExists = documentState.availability?.[record.id]?.executableExists;
      state.textContent = record.enabled ? (executableExists === false ? "Enabled · executable missing" : "Enabled") : (executableExists ? "Installed · disabled" : "Disabled");
      const installProfile = catalogue.find((entry) => entry.id === record.id);
      if (!executableExists && (installProfile?.wingetInstall || installProfile?.githubInstall)) {
        const button = action("Install", () => install(record));
        button.dataset.install = record.id;
        button.disabled = busy || !store.native;
        button.setAttribute("aria-label", `Install ${record.name}`);
        const method = installProfile?.wingetInstall ? "WinGet" : "GitHub release";
        button.title = store.native ? `Install via ${method} under Totem/emulators/${record.id}` : "Install from the Windows desktop app";
        controls.append(button);
      }
      if (store.native && executableExists) {
        const button = action("Launch", async () => {
          if (busy) return;
          setBusy(true);
          status.textContent = `Opening ${record.name}…`;
          try { await store.launch(record.id); status.textContent = `${record.name} started.`; }
          catch (error) { status.textContent = error.message || String(error); }
          finally { setBusy(false); }
        });
        button.dataset.launch = record.id;
        button.disabled = busy;
        button.setAttribute("aria-label", `Launch ${record.name}`);
        button.title = "Open the emulator without a game";
        controls.append(button);
      }
      if (record.website) controls.append(action("Visit site ↗", () => { void Promise.resolve(store.open(record)).catch((e) => status.textContent = e.message || String(e)); }));
      row.append(selectCell, name, supported, state, controls); body.append(row);
    }
  }
  detectedOnly.addEventListener("change", () => { populatePlatformFilter(); render(); });
  for (const control of [search, filter, statusFilter]) control.addEventListener("input", render);
  async function update(all) {
    if (busy || !documentState) return;
    const records = documentState.emulators.filter((e) => all || selected.has(e.id));
    if (!records.length) { status.textContent = "Select one or more emulators."; return; }
    setBusy(true); results.replaceChildren();
    try {
      for (const record of records) {
        status.textContent = `Checking ${record.name}…`;
        const resultRow = make("details"), title = make("summary", record.name); resultRow.append(title); results.append(resultRow);
        try {
          const result = await store.update(record, record.autoUpdate && record.enabled && store.native);
          title.textContent = `${record.name} · ${result.latestVersion ? `latest ${result.latestVersion}` : result.status}`;
          resultRow.append(make("p", record.installedVersion ? `Recorded installed version: ${record.installedVersion}` : "Installed version has not been recorded."));
          if (result.notes || result.details) resultRow.append(make("pre", result.notes || result.details));
          if (record.website) resultRow.append(action("Open official download page", () => store.open(record)));
        } catch (error) {
          title.textContent = `${record.name} · ${error.message || String(error)}`;
          if (record.website) resultRow.append(action("Visit website", () => store.open(record)));
        }
      }
      status.textContent = `Finished processing ${records.length} emulators. See each result below.`;
    } finally { setBusy(false); }
  }
  const scanButton = action("Scan emulators", async () => {
    if (busy || !documentState || !store.native) return;
    setBusy(true);
    status.textContent = "Scanning the Totem emulators folder…";
    results.replaceChildren();
    try {
      const { settings, found, skipped } = await store.scan(documentState.revision);
      documentState = settings;
      render();
      if (found.length) window.dispatchEvent(new Event("totem:emulators-changed"));
      status.textContent = found.length
        ? `Configured ${found.length} emulator paths: ${found.join(", ")}.`
        : "No new emulator paths configured.";
      if (skipped.length) {
        const details = make("details"), list = make("ul");
        details.append(make("summary", `${skipped.length} folders need review`), list);
        for (const item of skipped) list.append(make("li", item));
        results.append(details);
      }
    } catch (error) { status.textContent = `Scan failed: ${error.message || error}`; }
    finally { setBusy(false); }
  });
  scanButton.disabled = !store.native;
  if (!store.native) scanButton.title = "Scan from the Windows desktop app";
  const addEmulator = action("Add emulator", () => configure(null, { openerId: addEmulator.id }));
  addEmulator.id = "emulator-add";
  buttons.append(scanButton, addEmulator, action("Remove selected", async () => {
    if (busy || !selected.size) { status.textContent = "Select emulators to remove."; return; }
    try { await persist(documentState.emulators.filter((e) => !selected.has(e.id))); selected.clear(); status.textContent = "Emulator entries removed. Installed files were not changed."; }
    catch (error) { status.textContent = `Not removed: ${error.message || error}`; }
  }), action("Update selected", () => update(false)), action("Update all", () => update(true)));

  function canLeave(resume) {
    if (!editing) return true;
    if (busy) return false;
    if (!editing.dirty()) return true;
    confirmEditorLeave({
      title: "Unsaved emulator changes",
      save: editing.save,
      discard: editing.discard,
      leave: resume,
    });
    return false;
  }
  function closeEditor(restoreFocus = false) {
    const previous = editing;
    editing = null;
    editor.hidden = true;
    editor.replaceChildren();
    catalogueView.hidden = false;
    if (!restoreFocus || !previous) return;
    previous.scrollHost.scrollTop = previous.scrollTop;
    const opener = document.getElementById(previous.openerId);
    if (opener) opener.focus();
    else {
      status.textContent = "The original emulator is outside the current filters. Focus returned to search.";
      search.focus();
    }
  }
  function backToList() {
    if (!editing?.openerId) return false;
    if (canLeave(backToList)) closeEditor(true);
    return true;
  }
  function configure(record, { message: initialMessage = "", openerId, returnToPlatform } = {}) {
    if (busy || editing || !documentState) return false;
    let saved = structuredClone(record || { id: `user-${crypto.randomUUID()}`, name: "", enabled: false, website: "", platforms: [], workingFolder: "", executable: "", installedVersion: "", autoUpdate: false, switches: [] });
    let draft = structuredClone(saved);
    const scrollHost = section.closest(".admin-content");
    const scrollTop = scrollHost.scrollTop;
    const platformName = id => platforms.find(platform => platform.id === id)?.name ?? id;
    const heading = make("h4", record?.name || "Add emulator");
    heading.id = "emulator-editor-heading";
    heading.tabIndex = -1;
    const context = make("p", contextPlatformId ? `Opened from ${platformName(contextPlatformId)} · Launch & Input` : "Emulator configuration", "emulator-editor-context");
    const scope = make("div", null, "emulator-editor-scope");
    const scopeTitle = make("strong");
    const scopeText = make("p");
    scope.append(scopeTitle, scopeText);
    const form = make("form");
    const fields = make("div", null, "emulator-config-fields");
    const message = make("p", initialMessage, "emulator-editor-message");
    message.setAttribute("role", "status");
    message.tabIndex = -1;
    const name = inputRow(fields, "Emulator name", draft.name);
    const enabled = inputRow(fields, "Enable for game launching", draft.enabled, "checkbox");
    const paths = make("div", null, "emulator-executable-fields");
    fields.append(paths);
    const workingFolder = inputRow(paths, "Working folder", draft.workingFolder);
    const executable = inputRow(paths, "Executable path", draft.executable);
    const supported = make("details", null, "emulator-editor-disclosure");
    const supportedTitle = make("summary"), platformChoices = make("div", null, "emulator-platform-choices");
    const platformSearch = make("input");
    platformSearch.type = "search";
    platformSearch.placeholder = "Search supported platforms…";
    platformSearch.setAttribute("aria-label", "Search supported platforms");
    const noPlatforms = make("p", "No platforms match this search.");
    noPlatforms.hidden = true;
    supported.append(supportedTitle, platformSearch, platformChoices, noPlatforms);
    const platformInputs = new Map(sortedByName(platforms).map(p => [p.id, inputRow(platformChoices, p.name, draft.platforms.includes(p.id), "checkbox")]));
    platformSearch.addEventListener("input", () => {
      const query = platformSearch.value.trim().toLowerCase();
      let count = 0;
      for (const [id, input] of platformInputs) {
        const match = platformName(id).toLowerCase().includes(query);
        input.parentElement.hidden = !match;
        if (match) count++;
      }
      noPlatforms.hidden = Boolean(count);
    });
    const advanced = make("details", null, "emulator-editor-disclosure");
    advanced.append(make("summary", "Advanced options"));
    const advancedFields = make("div", null, "emulator-advanced-fields");
    const website = inputRow(advancedFields, "Website (optional)", draft.website, "url");
    const version = inputRow(advancedFields, "Recorded installed version (optional)", draft.installedVersion);
    const auto = inputRow(advancedFields, "Use WinGet for automatic updates", draft.autoUpdate, "checkbox");
    const catalogueEntry = catalogue.find(e => e.id === draft.id), packageId = catalogueEntry?.wingetId;
    auto.disabled = !store.native || !packageId;
    const installDescription = catalogueEntry?.githubInstall
      ? `Install downloads the latest matching Windows release from ${catalogueEntry.releaseRepo} into Totem/emulators/${draft.id}.`
      : packageId
        ? `${store.native ? "Targets" : "Available in the desktop app for"} the installed WinGet package ${packageId}. Portable installations should use manual updates.`
        : "Add the emulator’s website to make it available for manual updates.";
    advancedFields.append(make("p", installDescription));
    const switches = make("fieldset");
    switches.append(make("legend", "Launch switches"));
    advancedFields.append(switches);
    advanced.append(advancedFields);
    fields.append(supported, advanced);
    const switchRows = [];
    function switchRow(value) {
      const row = make("div", null, "emulator-switch-row"), checked = make("input"), argument = make("input"); checked.type = "checkbox"; checked.checked = value.enabled; checked.setAttribute("aria-label", "Use launch switch"); argument.value = value.argument; argument.setAttribute("aria-label", "Launch switch argument");
      const model = { row, checked, argument }; switchRows.push(model); row.append(checked, argument, action("Remove switch", () => { switchRows.splice(switchRows.indexOf(model), 1); row.remove(); sync(); addSwitch.focus(); })); switches.insertBefore(row, addSwitch);
      return argument;
    }
    const addSwitch = action("Add switch", () => { switchRow({ argument: "", enabled: false }).focus(); sync(); });
    switches.append(addSwitch);
    const dirty = () => JSON.stringify(draft) !== JSON.stringify(saved);
    function refreshScope() {
      const affected = [...new Set([...saved.platforms, ...draft.platforms])];
      const primary = affected.includes(contextPlatformId) ? [contextPlatformId] : [];
      const ordered = [...new Set([...primary, ...affected])];
      const names = ordered.slice(0, 3).map(platformName);
      const others = ordered.length - names.length;
      scopeTitle.textContent = affected.length > 1 ? `Shared emulator · ${affected.length} platforms`
        : affected.length ? "Single-platform emulator" : "Emulator with no assigned platforms";
      scopeText.textContent = names.length
        ? `Changes affect ${names.join(", ")}${others ? ` and ${others} others` : ""}. Settings are saved in the emulator registry.`
        : "Settings are saved in the emulator registry. Add platforms under Supported platforms.";
      supportedTitle.textContent = `Supported platforms · ${draft.platforms.length}`;
      save.disabled = busy || !dirty();
      discard.disabled = save.disabled;
    }
    function sync() {
      const associated = new Set(saved.platforms.filter(id => platformInputs.get(id)?.checked ?? true));
      for (const [id, input] of platformInputs) if (input.checked) associated.add(id);
      Object.assign(draft, { name: name.value, enabled: enabled.checked, workingFolder: workingFolder.value, executable: executable.value, website: website.value, installedVersion: version.value, autoUpdate: auto.checked, platforms: [...associated], switches: switchRows.map(s => ({ argument: s.argument.value, enabled: s.checked.checked })) });
      refreshScope();
    }
    const inputs = { name, enabled, workingFolder, executable, website, installedVersion: version, autoUpdate: auto };
    function bindSaved() {
      draft = structuredClone(saved);
      for (const [key, input] of Object.entries(inputs)) {
        if (input.type === "checkbox") input.checked = draft[key];
        else input.value = draft[key];
      }
      for (const [id, input] of platformInputs) input.checked = draft.platforms.includes(id);
      for (const { row } of switchRows.splice(0)) row.remove();
      draft.switches.forEach(switchRow);
      refreshScope();
    }
    function discardDraft() {
      bindSaved();
      message.textContent = "Unsaved emulator changes discarded.";
    }
    async function saveDraft() {
      if (busy) return false;
      sync();
      if (!dirty()) return true;
      const focused = document.activeElement;
      busy = true;
      fields.inert = true;
      refreshScope();
      message.textContent = "Saving emulator settings…";
      try {
        const checked = validateEmulator(draft);
        const records = documentState.emulators.filter((e) => e.id !== checked.id);
        records.push(checked);
        const persisted = await persist(records);
        saved = structuredClone(persisted.emulators.find(entry => entry.id === checked.id) ?? checked);
        bindSaved();
        heading.textContent = saved.name;
        message.textContent = "Emulator settings saved.";
        status.textContent = `${saved.name} settings saved.`;
        return true;
      } catch (error) {
        message.textContent = `Not saved: ${error.message || error}`;
        return false;
      } finally {
        busy = false;
        fields.inert = false;
        refreshScope();
        if (document.activeElement === document.body) {
          if (focused?.isConnected && !focused.disabled && focused !== document.body) focused.focus();
          else message.focus();
        }
      }
    }
    const footer = make("div", null, "admin-emulator-actions");
    const save = action("Save emulator", saveDraft);
    save.className = "emulator-save";
    const discard = action("Discard changes", () => { discardDraft(); message.focus(); });
    footer.append(save, discard);
    if (openerId) footer.append(action("Back to emulator list", backToList));
    if (returnToPlatform) footer.append(action(`Back to ${platformName(contextPlatformId)}`, returnToPlatform));
    fields.addEventListener("input", event => { if (event.target !== platformSearch) sync(); });
    fields.addEventListener("change", event => { if (event.target !== platformSearch) sync(); });
    const saveArea = make("footer", null, "emulator-editor-footer");
    saveArea.append(message, footer);
    form.append(fields, saveArea);
    form.addEventListener("submit", (event) => event.preventDefault());
    editing = { openerId, scrollHost, scrollTop, dirty, discard: discardDraft, save: saveDraft };
    editor.replaceChildren(context, heading, scope, form);
    bindSaved();
    catalogueView.hidden = true;
    editor.hidden = false;
    scrollHost.scrollTop = 0;
    heading.focus();
    return true;
  }
  installProgress.addEventListener("cancel", (event) => event.preventDefault());
  window.addEventListener("beforeunload", (event) => { if (busy || editing?.dirty()) { event.preventDefault(); event.returnValue = ""; } });
  function updateDetectedPlatforms(summary) {
    detectedPlatformIds = summary?.platformCounts
      ? new Set(Object.entries(summary.platformCounts).filter(([, count]) => Number.isInteger(count) && count > 0).map(([id]) => id))
      : null;
    detectedOnly.disabled = !detectedPlatformIds;
    if (detectedOnly.disabled) detectedOnly.checked = false;
    populatePlatformFilter();
    render();
  }
  const loaded = Promise.all([store.load(), createPlatformStore(store.native, platforms).then((owner) => owner.catalogue()), library.cachedSummary().catch(() => null)]).then(([doc, currentPlatforms, librarySummary]) => {
    documentState = doc; platforms = currentPlatforms;
    updateDetectedPlatforms(librarySummary);
  }).catch((error) => status.textContent = `Emulators unavailable: ${error.message || error}`);
  for (const eventName of ["totem:library-rescanned", "totem:library-index-ready"]) {
    window.addEventListener(eventName, (event) => updateDetectedPlatforms(event.detail));
  }
  window.addEventListener("totem:platform-renamed", (event) => {
    const index = platforms.findIndex((p) => p.id === event.detail.id); if (index >= 0) platforms[index] = event.detail;
    populatePlatformFilter(); render();
  });
  return {
    canLeave, backToList,
    async openContext({ platformId, emulatorId }, back, isCurrent) {
      await loaded;
      if (!isCurrent() || !documentState) return;
      const associated = documentState.emulators.filter(entry => entry.platforms.includes(platformId));
      const match = emulatorId ? associated.find(entry => entry.id === emulatorId) : associated.length === 1 ? associated[0] : null;
      contextPlatformId = platformId;
      if (match && document.activeElement === back && configure(match, { returnToPlatform: () => back.click() })) return;
      const previous = [detectedOnly.checked, filter.value, search.value, statusFilter.value];
      restoreFilters = () => {
        const [detected, platform, query, state] = previous;
        detectedOnly.checked = detected && !detectedOnly.disabled;
        populatePlatformFilter();
        filter.value = [...filter.options].some(option => option.value === platform) ? platform : "";
        search.value = query;
        statusFilter.value = state;
        render();
      };
      detectedOnly.checked = false;
      populatePlatformFilter();
      filter.value = platformId;
      search.value = statusFilter.value = "";
      render();
      if (!associated.length) status.textContent = "No emulator is associated with this platform.";
      else if (emulatorId && !match) status.textContent = "The original emulator is no longer associated. Showing the remaining matches.";
    },
    leaveContext() {
      closeEditor();
      contextPlatformId = null;
      restoreFilters?.();
      restoreFilters = null;
    },
  };
}
