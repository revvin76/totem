import catalogue from "../platforms.json" with { type: "json" };
import { createMappingStore } from "./mapping-store.js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import "./administration.css";
import "./platform-readiness-dashboard.css";
import { mountEmulators } from "./emulator-settings-ui.js";
import { mountPlatformLibrarySettings } from "./platform-library-settings-ui.js";
import { mountTotemPersonality } from "./totem-personality-ui.js";
import { mountPlatformReadinessDashboard } from "./platform-readiness-dashboard.js";
import { nextSettingsOption, settingsControllerAction, settingsIcon } from "./settings-navigation.js";
import { mountCinematicSettings } from "./cinematic-launch/settings.js";
import { mountEmulatorExitSettings } from "./universal-emulator-exit-ui.js";
import { antiAliasingEnabled, setAntiAliasingEnabled } from "./scene-antialiasing.js";
import { emulatorSettingsStore } from "./emulator-settings.js";
import { mountSettingsGameDiagnostics } from "./settings-game-diagnostics.js";
import { mountStartupIntroSetting } from "./startup-intro-preference.js";

const $ = (id) => document.getElementById(id);
function button(text, action) {
  const node = document.createElement("button"); node.type = "button"; node.textContent = text; node.addEventListener("click", action); return node;
}
function disclosure(title, nodes) {
  const node = document.createElement("details"), summary = document.createElement("summary");
  summary.textContent = title; node.append(summary, ...nodes.filter(Boolean)); return node;
}
function mountFullscreenSetting(section) {
  const label = document.createElement("label");
  label.className = "admin-checkbox-option";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkbox.disabled = true;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  label.append(checkbox, "Open Totem in fullscreen", appliesNow());
  section.append(label, status);
  if (!isTauri()) {
    status.textContent = "Available in the Totem desktop app.";
    return;
  }
  let saved;
  async function load() {
    try {
      saved = await invoke("load_window_settings");
      checkbox.checked = saved.fullscreen !== false;
      checkbox.disabled = false;
      status.textContent = "";
    } catch {
      status.textContent = "Could not load the fullscreen preference.";
    }
  }
  void load();
  checkbox.addEventListener("change", async () => {
    const fullscreen = checkbox.checked;
    checkbox.disabled = true;
    try {
      saved = await invoke("save_window_settings", { fullscreen, expectedRevision: saved.revision });
      status.textContent = saved.applied ? "" : "Saved. The window mode will change next time Totem opens.";
    } catch (error) {
      checkbox.checked = saved.fullscreen !== false;
      status.textContent = `Could not save the fullscreen preference. ${error}`;
    } finally {
      checkbox.disabled = false;
      if (document.activeElement === document.body && section.getClientRects().length) checkbox.focus();
    }
  });
}
function appliesNow() {
  const hint = document.createElement("small");
  hint.className = "admin-save-hint";
  hint.textContent = "Applies now";
  return hint;
}
function mountAdministration() {
  const settings = $("folder-settings"), body = settings.querySelector(".folder-body");
  settings.classList.add("admin-shell"); $("platform-editor").classList.add("admin-shell");
  $("folder-close").textContent = "← Back to Totem";
  const sections = new Map();
  const links = new Map();
  const layout = document.createElement("div"); layout.className = "admin-layout";
  const nav = document.createElement("nav"); nav.className = "admin-nav"; nav.setAttribute("aria-label", "Settings categories");
  const content = document.createElement("div"); content.className = "admin-content";
  const platformEditor = $("platform-editor");
  const generalPages = [
    ["sources", "Library & Sources"],
    ["emulators", "Emulators"],
    ["launching", "Launch & Return"],
    ["action-mappings", "Controllers"],
    ["providers", "Artwork Providers"],
    ["personality", "Appearance"],
    ["advanced", "System & Diagnostics"],
  ];
  const generalLinks = document.createElement("div");
  generalLinks.id = "admin-general-pages";
  generalLinks.hidden = true;
  let lastGeneralPage = generalPages[0][0];
  const generalEntry = button("General Settings", () => visitSection(lastGeneralPage));
  generalEntry.prepend(settingsIcon("general"));
  generalEntry.setAttribute("aria-controls", generalLinks.id);
  generalEntry.setAttribute("aria-expanded", "false");
  const editorCanClose = (resume) => !platformEditor.open || !platformEditor.classList.contains("inline-platform-editor") ||
    platformEditor.dispatchEvent(new CustomEvent("totem:platform-editor-can-close", { cancelable: true, detail: resume }));
  const canLeaveSection = resume => editorCanClose(resume) &&
    (activeSection !== "emulators" || emulatorSettings.canLeave(resume)) && settings.dispatchEvent(new CustomEvent(
    "totem:settings-section-can-leave", { cancelable: true, detail: { section: activeSection, resume } },
  ));
  for (const type of ["click", "cancel"]) settings.addEventListener(type, event => {
    if ((type === "click" ? event.target.closest("#folder-close") : event.target === settings) &&
        !canLeaveSection(() => $("folder-close").click())) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  settings.addEventListener("close", event => {
    if (event.target !== settings) return;
    if (platformEditor.classList.contains("inline-platform-editor")) platformEditor.close();
    if (activeSection === "emulators") emulatorSettings.leaveContext();
  });
  let activeSection;
  /** @type {import("./settings-navigation.js").SettingsRoute[]} */
  const returnTrail = [];
  const returnButtons = new Map();
  const navigationStatus = document.createElement("p");
  navigationStatus.className = "admin-navigation-status";
  navigationStatus.setAttribute("role", "status");
  navigationStatus.hidden = true;
  function explainNavigation(message) {
    navigationStatus.textContent = message;
    navigationStatus.hidden = !message;
  }
  function updateReturnButton() {
    for (const back of returnButtons.values()) back.hidden = true;
    const frame = returnTrail.at(-1);
    if (frame?.destination.section !== activeSection) return;
    const back = returnButtons.get(activeSection);
    const sectionName = links.get(frame.origin.section).textContent;
    back.textContent = `← Back to ${sectionName}`;
    back.hidden = false;
  }
  function showSection(id, newSession = false) {
    if (id === activeSection && !newSession) return;
    const previousFocus = document.activeElement;
    if (activeSection === "platforms" && platformEditor.classList.contains("inline-platform-editor")) platformEditor.close();
    if (activeSection === "emulators") emulatorSettings.leaveContext();
    activeSection = id;
    settings.dataset.section = id;
    for (const [key, panel] of sections) panel.hidden = key !== id;
    const inGeneral = generalLinks.contains(links.get(id));
    if (inGeneral) lastGeneralPage = id;
    generalLinks.hidden = !inGeneral;
    generalEntry.setAttribute("aria-expanded", String(inGeneral));
    for (const [key, link] of links) {
      link.setAttribute("aria-current", key === id ? "page" : "false");
    }
    content.scrollTop = 0;
    if (settings.contains(previousFocus) && !previousFocus.getClientRects().length) links.get(id).focus();
    if (id === "readiness") void dashboard.open({ newSession });
    if (id === "launching") { void refreshCinematic(); void emulatorExit.reload(); }
  }
  const openPlatform = detail => !settings.dispatchEvent(new CustomEvent("totem:settings-platform-editor", {
    cancelable: true, detail,
  }));
  const platformSection = document.createElement("header");
  platformSection.className = "admin-platform-heading";
  const platformTitle = document.createElement("h3");
  platformTitle.textContent = "Platforms";
  function focusControl(id) {
    const control = id && $(id);
    if (!control?.getClientRects().length || control.disabled) return false;
    control.focus({ preventScroll: true });
    return document.activeElement === control;
  }
  function visitSection(section) {
    if (returnTrail.at(-1)?.origin.section === section) {
      backFromRelated();
      return;
    }
    if (section === activeSection && section !== "platforms") return;
    if (!canLeaveSection(() => visitSection(section))) return;
    returnTrail.length = 0;
    explainNavigation("");
    showSection(section);
    if (section === "platforms") openPlatform({});
    updateReturnButton();
  }
  function followRoute(frame) {
    if (!canLeaveSection(() => followRoute(frame))) return false;
    const { origin, destination } = frame;
    const { section, platformId, target, tab, gameId } = destination;
    explainNavigation("");
    showSection(section);
    if (section === "platforms" && !openPlatform({ platformId, tab, target, gameId })) {
      showSection(origin.section);
      explainNavigation("This platform is no longer available.");
      return false;
    }
    returnTrail.push(frame);
    updateReturnButton();
    if (section !== "platforms") {
      if (!focusControl(target)) returnButtons.get(section).focus();
      if (section === "emulators") {
        const back = returnButtons.get(section);
        void emulatorSettings.openContext(destination, back,
          () => returnTrail.at(-1) === frame && activeSection === section);
      }
    }
    return true;
  }
  const openRelated = (destination, trigger) => {
    const tab = platformEditor.querySelector('[data-editor-tab][aria-selected="true"]')?.dataset.editorTab;
    const platformId = activeSection === "platforms" ? selectedPlatform?.id : undefined;
    const origin = {
      section: activeSection, platformId, tab, focusKey: trigger.id,
      gameId: tab === "sources" ? gameDiagnostics.selectedId() : undefined,
      scroll: [content.scrollTop, platformEditor.querySelector(".editor-detail").scrollTop,
        platformEditor.querySelector(".editor-sidebar").scrollTop, $(`editor-panel-${tab}`)?.scrollTop],
    };
    return followRoute({ origin, destination: { platformId, ...destination } });
  };
  function backFromRelated() {
    if (!returnTrail.length || !canLeaveSection(backFromRelated)) return;
    const { origin } = returnTrail.pop();
    explainNavigation("");
    showSection(origin.section);
    updateReturnButton();
    if (origin.section === "readiness") {
      dashboard.restoreFocus(origin.focusKey, origin.scroll);
      return;
    }
    if (origin.section === "platforms") {
      if (!openPlatform({ platformId: origin.platformId, tab: origin.tab, gameId: origin.gameId })) {
        openPlatform({});
        explainNavigation("The original platform is unavailable. Showing the selected platform instead.");
        return;
      }
    }
    function restoreOriginFocus() {
      const [contentTop, detail, sidebar, panel] = origin.scroll;
      content.scrollTop = contentTop;
      if (origin.section === "platforms") {
        platformEditor.querySelector(".editor-detail").scrollTop = detail;
        platformEditor.querySelector(".editor-sidebar").scrollTop = sidebar;
        const tabPanel = $(`editor-panel-${origin.tab}`);
        if (tabPanel) tabPanel.scrollTop = panel ?? 0;
      }
      if (focusControl(origin.focusKey)) return;
      focusControl(`editor-tab-${origin.tab}`) || links.get(origin.section).focus();
      explainNavigation("The original control is unavailable. Focus returned to its Settings section.");
    }
    if (origin.focusKey?.startsWith("settings-launch-emulator-") || origin.focusKey === "settings-manage-emulators") {
      const focused = document.activeElement;
      void launchRefresh.then(() => {
        if (activeSection === "platforms" && selectedPlatform?.id === origin.platformId && document.activeElement === focused) {
          restoreOriginFocus();
        }
      });
    } else restoreOriginFocus();
  }
  const allSources = button("Library & Sources →", () => openRelated({ section: "sources" }, allSources));
  allSources.id = "settings-all-sources";
  allSources.className = "admin-secondary-action";
  const returnToReadiness = button("← Back to Readiness", backFromRelated);
  returnButtons.set("platforms", returnToReadiness);
  returnToReadiness.hidden = true;
  const platformActions = document.createElement("div"); platformActions.className = "admin-platform-actions";
  platformActions.append(returnToReadiness, allSources);
  platformSection.append(platformTitle, platformActions);
  for (const [id, name] of [["readiness", "Readiness"], ["platforms", "Platforms"], ...generalPages]) {
    const section = document.createElement("section");
    section.className = "admin-section";
    section.id = `admin-${id}`;
    section.hidden = true;
    section.setAttribute("aria-label", name);
    if (id !== "readiness" && id !== "platforms") {
      const heading = document.createElement("h3");
      heading.textContent = name;
      heading.id = `admin-${id}-title`;
      heading.tabIndex = -1;
      section.append(heading);
    }
    const action = button(name, () => visitSection(id));
    action.setAttribute("aria-controls", section.id);
    if (id === "readiness" || id === "platforms") {
      action.prepend(settingsIcon(id));
      nav.append(action);
    } else generalLinks.append(action);
    links.set(id, action);
    sections.set(id, section);
    content.append(section);
  }
  nav.append(generalEntry, generalLinks);
  for (const id of ["sources", "emulators", "providers"]) {
    const back = button("← Back to platform", backFromRelated);
    back.hidden = true;
    sections.get(id).prepend(back);
    returnButtons.set(id, back);
  }
  sections.get("platforms").prepend(platformSection);
  nav.append(navigationStatus);
  layout.append(nav, content);
  body.before(layout);
  const dashboardPanel = sections.get("readiness");
  const refreshCinematic = mountCinematicSettings(sections.get("launching"), {
    native: isTauri(),
    capability: () => invoke("cinematic_capability"),
  });
  const emulatorExit = mountEmulatorExitSettings(sections.get("launching"));
  const library = $("editor-panel-sources"), sources = sections.get("sources"), artwork = sections.get("providers"), advanced = sections.get("advanced"), controllers = sections.get("action-mappings");
  if (!new URLSearchParams(location.search).has("studio")) mountFullscreenSetting(advanced);
  const antiAliasingLabel = document.createElement("label");
  antiAliasingLabel.className = "admin-checkbox-option";
  const antiAliasing = document.createElement("input");
  antiAliasing.type = "checkbox";
  antiAliasing.checked = antiAliasingEnabled();
  antiAliasing.addEventListener("change", () => setAntiAliasingEnabled(antiAliasing.checked));
  antiAliasingLabel.append(antiAliasing, "Anti-aliasing", appliesNow());
  advanced.append(antiAliasingLabel);
  controllers.append($("app-controller-mappings"));
  const dashboard = mountPlatformReadinessDashboard(dashboardPanel, {
    onDrillThrough: followRoute,
  });
  const sourcesFromSystem = button("Open library folders →", () => openRelated({ section: "sources" }, sourcesFromSystem));
  sourcesFromSystem.id = "settings-sources-from-system";
  advanced.append(sourcesFromSystem);
  const fields = [...$("folder-fields").children];
  $("folder-fields").append(disclosure("More folders", fields.slice(2)));
  const folderHeading = document.createElement("h4"); folderHeading.textContent = "Library folders";
  sources.append($("folder-summary"), $("folder-missing-paths"), folderHeading, $("folder-path-help"), $("folder-fields"), settings.querySelector(".folder-footer"));
  for (const provider of [...body.querySelectorAll(".igdb-connection")]) {
    const title = provider.querySelector("h3"), status = provider.querySelector('[role="status"]');
    const details = disclosure("Configure connection", [...provider.children].filter((node) => node !== title && node !== status));
    provider.replaceChildren(title, status, details); artwork.append(provider);
  }
  const coverage = body.querySelector(".metadata-platforms");
  const coverageDetails = disclosure("Custom platform coverage", [coverage]); artwork.append(coverageDetails);
  const search = document.createElement("input"); search.type = "search"; search.placeholder = "Search system or manufacturer"; search.setAttribute("aria-label", "Search platform coverage");
  const type = document.createElement("select"); type.setAttribute("aria-label", "Coverage hardware type"); type.add(new Option("All hardware types", ""));
  for (const value of [...new Set(catalogue.map((p) => p.kind))]) type.add(new Option(value, value));
  const maker = document.createElement("select"); maker.setAttribute("aria-label", "Coverage manufacturer"); maker.add(new Option("All manufacturers", ""));
  for (const value of [...new Set(catalogue.map((p) => p.maker))].sort()) maker.add(new Option(value, value));
  coverage.prepend(search, maker, type);
  const filterCoverage = () => {
    for (const input of coverage.querySelectorAll("[data-metadata-platform]")) {
      const platform = catalogue.find((p) => p.id === input.dataset.metadataPlatform);
      input.closest("label").hidden = !platform || (type.value && platform.kind !== type.value) || (maker.value && platform.maker !== maker.value) || !`${platform.name} ${platform.maker}`.toLowerCase().includes(search.value.toLowerCase());
    }
  };
  for (const control of [search, type, maker]) control.addEventListener("input", filterCoverage);
  const selectCoverage = (predicate) => {
    for (const input of coverage.querySelectorAll("[data-metadata-platform]")) {
      if (input.disabled || input.closest("label").hidden) continue;
      input.checked = predicate(input.dataset.metadataPlatform); input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  const coverageAll = button("Enable filtered", () => selectCoverage(() => true)), coverageNone = button("Disable filtered", () => selectCoverage(() => false));
  coverageAll.disabled = coverageNone.disabled = Boolean(coverage.querySelector("[data-metadata-platform]")?.disabled);
  coverage.prepend(coverageAll, coverageNone);
  const preset = document.createElement("select"); preset.setAttribute("aria-label", "Apply platform coverage preset");
  for (const [label, value] of [["Apply platform coverage preset…", ""], ["All supported platforms", "all"], ["Enabled systems", "enabled"], ["Custom selection", "custom"]]) preset.add(new Option(label, value));
  preset.disabled = coverageAll.disabled;
  preset.addEventListener("change", () => {
    if (preset.value === "custom") coverageDetails.open = true;
    else {
      const enabled = new Set([...$("system-checklist").querySelectorAll("input:checked")].map((input) => input.dataset.platform));
      for (const input of coverage.querySelectorAll("[data-metadata-platform]")) {
        if (!input.disabled) { input.checked = preset.value === "all" || enabled.has(input.dataset.metadataPlatform); input.dispatchEvent(new Event("change", { bubbles: true })); }
      }
    }
    preset.value = "";
  });
  artwork.insertBefore(preset, coverageDetails);
  artwork.append($("metadata-save-preferences").parentElement, $("metadata-preferences-status"));
  const deviceStatus = document.createElement("p"); deviceStatus.setAttribute("role", "status");
  const profiles = document.createElement("p"); profiles.setAttribute("role", "status");
  const updateControllers = () => { const pads = [...navigator.getGamepads()].filter(Boolean); deviceStatus.textContent = pads.length ? pads.map((pad) => pad.id).join(" · ") : "No PC controller detected. Connect a controller and press a button."; };
  let mappingTrigger;
  const openMapping = (trigger, platformId) => {
    mappingTrigger = trigger;
    settings.dispatchEvent(new CustomEvent("totem:settings-mapping-editor", { detail: platformId }));
  };
  const configureMappings = button("Configure mappings", () => openMapping(configureMappings));
  controllers.append(deviceStatus, profiles, configureMappings);
  updateControllers(); window.addEventListener("gamepadconnected", updateControllers); window.addEventListener("gamepaddisconnected", updateControllers);
  let mappingStore;
  const refreshProfiles = async () => {
    try { mappingStore ??= createMappingStore(isTauri(), () => catalogue.map((p) => p.id)); const state = await (await mappingStore).list(); profiles.textContent = `${state.profiles.length} saved mapping profiles · ${new Set(state.profiles.map((p) => p.platformId)).size} platforms customised${state.errors.length ? ` · ${state.errors.length} profiles need attention` : ""}`; }
    catch (error) { profiles.textContent = `Mapping profiles unavailable: ${error.message ?? error}`; }
  };
  $("mapping-dialog").addEventListener("close", () => {
    void refreshProfiles();
    if (settings.open) mappingTrigger?.focus();
  });
  links.get("action-mappings").addEventListener("click", () => void refreshProfiles());
  advanced.append(...[$("error-log-location"), $("folder-migration-status"), $("folder-storage")].filter(Boolean));
  const imported = disclosure("Imported collections", [$("folder-collection-search").previousElementSibling, $("folder-collection-search"), $("folder-collection-list")]);
  advanced.append(disclosure("Folder and provider help", [...body.children]));
  const librarySettings = mountPlatformLibrarySettings(library, sources);
  sources.append(imported);
  const emulatorSettings = mountEmulators(sections.get("emulators"), catalogue);
  const launch = $("editor-panel-launch");
  const media = $("editor-panel-logo");
  const mediaStatus = document.createElement("div");
  const mediaHeading = document.createElement("h4"); mediaHeading.textContent = "Game artwork coverage";
  const mediaList = document.createElement("ul");
  const eligibility = document.createElement("p");
  let eligiblePlatforms;
  const reviewProviders = button("Review provider settings →", () => {
    openRelated({ section: "providers", target: "admin-providers-title" }, reviewProviders);
  });
  reviewProviders.id = "settings-review-providers";
  mediaStatus.append(mediaHeading, mediaList, eligibility, reviewProviders);
  media.prepend(mediaStatus);
  function refreshMedia() {
    if (!selectedPlatform) return;
    const checks = dashboard.platformChecks(selectedPlatform.id);
    mediaList.replaceChildren();
    const artworkChecks = ["front-covers", "back-covers", "clear-logos"];
    for (const id of artworkChecks) {
      const check = checks?.[id];
      if (!check) continue;
      const item = document.createElement("li");
      item.textContent = `${check.label}: ${check.explanation}`;
      mediaList.append(item);
    }
    if (!mediaList.childElementCount) {
      const item = document.createElement("li");
      item.textContent = "Coverage evidence is unavailable. Refresh Readiness to check indexed artwork.";
      mediaList.append(item);
    }
    eligibility.textContent = !isTauri() ? "Provider settings are read-only in browser preview." : eligiblePlatforms
      ? `Saved IGDB lookup policy: ${eligiblePlatforms.has(selectedPlatform.id) ? "Enabled" : "Not enabled"} for this platform.`
      : "The saved IGDB lookup policy is unavailable.";
  }
  settings.addEventListener("totem:metadata-settings-loaded", ({ detail }) => {
    eligiblePlatforms = new Set(detail);
    refreshMedia();
  });
  const launchStatus = document.createElement("p");
  launchStatus.setAttribute("role", "status");
  const launchHeading = document.createElement("h4");
  launchHeading.textContent = "Emulator associations";
  const launchScope = document.createElement("p");
  launchScope.className = "platform-launch-context";
  const launchList = document.createElement("ul");
  launchList.className = "platform-launch-emulators";
  let selectedPlatform;
  const gameDiagnostics = mountSettingsGameDiagnostics(library, () => selectedPlatform?.id);
  let launchRefresh;
  const refreshLaunch = async () => {
    const platform = selectedPlatform;
    if (!platform) return;
    launchList.replaceChildren();
    manageEmulators.disabled = true;
    launchScope.textContent = `Showing emulators associated with ${platform.name}. Editing an emulator can affect every platform that uses it.`;
    launchStatus.textContent = "Loading emulator associations…";
    try {
      const state = await emulatorSettingsStore().load();
      if (selectedPlatform !== platform) return;
      const associations = state.emulators.filter(entry => entry.platforms.includes(platform.id));
      manageEmulators.disabled = !associations.length;
      const installed = entry => state.availability?.[entry.id]?.executableExists;
      const ready = associations.filter(entry => entry.enabled && installed(entry));
      launchStatus.textContent = !associations.length ? `No emulators associated with ${platform.name}.`
        : !isTauri() ? "Browser preview shows associations; installation is checked in Totem for Windows."
        : ready.length === 1 ? `${ready[0].name} is the only enabled emulator with an executable for this platform. Gameplay is unverified.`
        : ready.length > 1 ? "Several enabled emulators have executables for this platform. Review the associations before launching."
        : associations.some(entry => entry.enabled) ? "No enabled emulator executable was found." : "No associated emulator is enabled.";
      for (const entry of associations) {
        const item = document.createElement("li");
        const detail = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = entry.name;
        const evidence = document.createElement("small");
        const state = entry.enabled ? "Enabled for game launching" : "Disabled for game launching";
        const availability = isTauri() ? (installed(entry) ? " · Executable found" : " · Executable unavailable") : "";
        evidence.textContent = `${state}${availability}`;
        const scope = document.createElement("small");
        scope.textContent = entry.platforms.length === 1 ? `Only ${platform.name}` : `Shared across ${entry.platforms.length} platforms`;
        detail.append(name, evidence, scope);
        const configure = button("Edit settings →", () => openRelated({ section: "emulators", emulatorId: entry.id }, configure));
        configure.id = `settings-launch-emulator-${entry.id}`;
        configure.setAttribute("aria-label", `Edit ${entry.name} settings`);
        item.append(detail, configure);
        launchList.append(item);
      }
    } catch (error) {
      if (selectedPlatform === platform) launchStatus.textContent = `Emulator associations unavailable. ${error}`;
    }
  };
  const manageEmulators = button("Manage matching emulators →", () => {
    openRelated({ section: "emulators" }, manageEmulators);
  });
  manageEmulators.id = "settings-manage-emulators";
  const platformMapping = button("Open gameplay controller mapping →", () => openMapping(platformMapping, selectedPlatform?.id));
  launch.append(launchHeading, launchScope, launchStatus, launchList, manageEmulators, platformMapping);
  platformEditor.addEventListener("totem:platform-context", ({ detail }) => {
    selectedPlatform = detail;
    void librarySettings.showPlatform(detail.id, detail.name);
    launchRefresh = refreshLaunch();
    refreshMedia();
  });
  platformEditor.addEventListener("totem:platform-tab", ({ detail: { tab, gameId } }) => {
    if (tab === "sources" && selectedPlatform) void gameDiagnostics.showGames(selectedPlatform.id, gameId);
  });
  window.addEventListener("totem:emulators-changed", () => { if (platformEditor.open) launchRefresh = refreshLaunch(); });
  const appearance = sections.get("personality");
  mountStartupIntroSetting(appearance);
  appearance.append(button("Carousel presentation controls", () => { $("folder-close").click(); if (!settings.open) $("settings-toggle").click(); }));
  const personalityHint = document.createElement("p");
  personalityHint.append(appliesNow(), " · Totem Personality changes save as you make them. Preview controls are for inspection.");
  appearance.append(personalityHint);
  void mountTotemPersonality(appearance);
  body.replaceChildren(layout);
  const controllerStatus = document.createElement("p");
  controllerStatus.className = "settings-controller-status";
  controllerStatus.setAttribute("role", "status");
  let adjustingSelect;
  function controllerMessage(message, surface = settings) {
    const host = surface === settings ? settings.querySelector(".folder-header") : surface;
    if (controllerStatus.parentElement !== host) host.append(controllerStatus);
    controllerStatus.textContent = message;
  }
  function finishAdjustment(commit = false) {
    if (!adjustingSelect) return false;
    const { control, index } = adjustingSelect;
    adjustingSelect = null;
    controllerMessage("");
    delete control.dataset.padAdjusting;
    if (!commit) control.selectedIndex = index;
    else if (control.selectedIndex !== index) {
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }
  function useDirectInput(event) {
    if (!settings.open) return;
    delete document.body.dataset.settingsController;
    controllerMessage("");
    if (finishAdjustment() && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  window.addEventListener("pointerdown", useDirectInput, true);
  window.addEventListener("keydown", useDirectInput, true);
  document.addEventListener("focusout", event => {
    if (event.target === adjustingSelect?.control) finishAdjustment();
    else if (controllerStatus.textContent) controllerMessage("");
  });
  settings.addEventListener("close", () => {
    finishAdjustment();
    delete document.body.dataset.settingsController;
    controllerMessage("");
  });
  settings.addEventListener("totem:settings-open", () => {
    returnTrail.length = 0;
    explainNavigation("");
    lastGeneralPage = generalPages[0][0];
    showSection("readiness", true);
    updateReturnButton();
    links.get("readiness").focus();
  });
  function back() {
    if (finishAdjustment()) return;
    if (activeSection === "readiness" && dashboard.cancel()) return;
    const dialog = document.activeElement?.closest("dialog:modal");
    if (dialog && dialog !== settings && dialog !== platformEditor) {
      if (dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close();
      return;
    }
    if (activeSection === "emulators" && emulatorSettings.backToList()) return;
    if (returnTrail.length) backFromRelated();
    else $("folder-close").click();
  }
  const focusable = "button, select, input, textarea, summary, [href], #emulator-editor-heading";
  const activatable = "button, summary, input:is([type=checkbox], [type=radio], [type=button]), a[href]";
  const canFocus = el => {
    if (el.matches(":disabled, [aria-disabled=true]") || el.closest("[hidden], [inert]") || !el.getClientRects().length) return false;
    for (let closed = el.closest("details:not([open])"); closed; closed = closed.parentElement.closest("details:not([open])")) {
      if (!closed.querySelector(":scope > summary")?.contains(el)) return false;
    }
    return true;
  };
  const available = root => [...root.querySelectorAll(focusable)].filter(canFocus);
  function moveFocus(direction, controller = false) {
    const focused = document.activeElement;
    if (controller && activeSection === "platforms") {
      const tab = platformEditor.querySelector('[role="tab"][aria-selected="true"]');
      const panel = focused.closest("[data-editor-panel]");
      if (panel && direction === "left" && tab) { tab.focus(); return true; }
      if (focused.matches('[role="tab"]')) {
        if (direction === "down") {
          available($(focused.getAttribute("aria-controls")))[0]?.focus();
          return true;
        }
        if (direction === "left" || direction === "right") {
          const tabs = available(focused.closest('[role="tablist"]'));
          const next = tabs[tabs.indexOf(focused) + (direction === "left" ? -1 : 1)];
          if (next) { next.click(); next.focus(); return true; }
        }
      }
    }
    if (nav.contains(focused)) {
      const items = available(nav);
      const index = items.indexOf(focused);
      if (direction === "right") {
        if (activeSection === "readiness" && dashboard.moveFocus(direction)) return true;
        if (focused === generalEntry && !generalLinks.hidden) links.get(activeSection).focus();
        else available(sections.get(activeSection))[0]?.focus();
      } else if (direction === "up" && index === 0) $("folder-close").focus();
      else if (direction === "up" || direction === "down") items[index + (direction === "up" ? -1 : 1)]?.focus();
      return true;
    }
    if (focused === $("folder-close") && ["down", "right"].includes(direction)) {
      links.get(activeSection).focus();
      return true;
    }
    if (dashboardPanel.contains(focused)) {
      if (dashboard.moveFocus(direction)) return true;
      if (focused.closest(".rd-diagnostics")) return false;
      if (direction === "left") links.get("readiness").focus();
      else if (direction === "up") $("folder-close").focus();
      else return false;
      return true;
    }
    if (!settings.contains(focused)) return false;
    if (direction === "left") {
      links.get(activeSection).focus();
      return true;
    }
    if (direction === "up" || direction === "down") {
      const items = available(settings).filter(el => !nav.contains(el));
      const index = items.indexOf(focused);
      const next = index < 0 ? available(sections.get(activeSection))[0]
        : items[index + (direction === "up" ? -1 : 1)];
      next?.focus();
      return Boolean(next);
    }
    return false;
  }
  settings.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape" && event.target.closest("dialog:modal") === settings) {
      if (returnTrail.length) {
        event.preventDefault();
        back();
      } else if (activeSection === "emulators" && emulatorSettings.backToList()) event.preventDefault();
      return;
    }
    if (!event.key.startsWith("Arrow") || event.target.matches("input, select, textarea")) return;
    if (moveFocus(event.key.slice(5).toLowerCase())) event.preventDefault();
  });
  settings.addEventListener("totem:settings-controller", (event) => {
    if ($("mapping-dialog").open) return;
    const action = settingsControllerAction(event.detail);
    if (!action) return;
    document.body.dataset.settingsController = "";
    if (action === "back") return back();
    const focused = document.activeElement;
    const modal = focused?.closest("dialog:modal");
    const surface = modal ?? settings;
    if (dashboardPanel.contains(focused) && action === "confirm" && dashboard.confirm()) return;
    if (adjustingSelect) {
      if (action === "confirm") finishAdjustment(true);
      else {
        focused.selectedIndex = nextSettingsOption(focused, action);
        controllerMessage(`${focused.selectedOptions[0]?.label ?? ""}. Confirm to apply, or Back to cancel.`, surface);
      }
      return;
    }
    if (action === "confirm" && canFocus(focused)) {
      if (focused.matches("select:not([multiple])")) {
        adjustingSelect = { control: focused, index: focused.selectedIndex };
        focused.dataset.padAdjusting = "";
        controllerMessage("Use the directional controls to choose an option. Confirm to apply, or Back to cancel.", surface);
        return;
      }
      if (focused.matches(activatable)) {
        focused.click();
        return;
      }
      if (focused.matches("textarea, input:not([type=checkbox], [type=radio], [type=range])")) {
        controllerMessage(focused.type === "file" ? "Use a keyboard or mouse to open the file picker."
          : "Use a keyboard to enter text. Use the directional controls to move to another field.", surface);
        return;
      }
    }
    if (modal && modal !== settings && !dashboardPanel.contains(modal)) {
      if (action === "confirm") return;
      const items = available(modal);
      items[items.indexOf(focused) + (action === "up" || action === "left" ? -1 : 1)]?.focus();
      return;
    }
    if (!settings.contains(focused)) {
      links.get(activeSection).focus();
      return;
    }
    if (action !== "confirm") moveFocus(action, true);
  });

  // Existing editor owns its draft, persistence, renderer and event handlers.
  $("editor-heading").textContent = $("editor-toggle").textContent = "Platform workspace";
  $("editor-tab-main").textContent = "General";
  $("editor-tab-launch").textContent = "Launch & Input";
  $("editor-tab-logo").textContent = "Artwork & Media";
  $("editor-tab-console").textContent = "Presentation";
  $("editor-rail-visibility").append(" ", appliesNow());
  $("editor-panel-logo").append($("box-art-section")); $("editor-tab-box-art").remove(); $("editor-panel-box-art").remove();
  const packagingControls = $("box-art-section").querySelector(".box-art-layout>div:last-child");
  const surfaceFields = [$("box-art-face").closest("label"), $("box-art-enabled").closest("label"), $("box-art-placement"), $("box-art-reset")];
  packagingControls.append(disclosure("Configure artwork surfaces", surfaceFields));
  $("box-art-section").append(disclosure("Source and licensing", [$("box-art-section").querySelector(".box-art-credit"), $("box-art-license").closest("label")]));
  $("editor-panel-main").append(disclosure("Technical details", [$("editor-device-id"), $("editor-quality"), $("editor-library-location")]));
  const animation = $("platform-form").querySelector(".editor-animation");
  const modelTools = disclosure("Advanced model tools", [animation]);
  const controls = $("platform-form").querySelector(".editor-model-controls");
  const presentation = controls.querySelector(".editor-library-presentation");
  modelTools.append(...[...controls.children].filter((node) => node !== presentation)); controls.append(modelTools);
  const sidebar = $("platform-editor").querySelector(".editor-sidebar");
  const systemDialog = document.createElement("dialog"); systemDialog.className = "admin-shell admin-systems-dialog";
  systemDialog.setAttribute("aria-label", "Manage systems"); systemDialog.append($("system-picker")); document.body.append(systemDialog);
  let systemsOpener;
  $("systems-toggle").addEventListener("click", () => {
    if (!systemDialog.open) systemsOpener = document.activeElement;
  }, true);
  $("systems-toggle").addEventListener("click", () => {
    if (!$("system-picker").hidden && !systemDialog.open) systemDialog.showModal();
  });
  $("systems-close").addEventListener("click", () => systemDialog.close());
  systemDialog.addEventListener("cancel", (event) => { event.preventDefault(); $("systems-close").click(); });
  systemDialog.addEventListener("close", () => systemsOpener?.focus());
  sidebar.append(button("Manage systems", () => { const picker = $("system-picker"); if (picker.hidden) $("systems-toggle").click(); }));
  $("system-picker").classList.add("admin-system-picker");
  $("system-picker").querySelector("h2").textContent = "Manage systems";
  $("editor-panel-main").append(button("Manage carousel visibility…", () => { if ($("system-picker").hidden) $("systems-toggle").click(); }));
  $("platform-editor").addEventListener("close", () => { if (!$("system-picker").hidden) $("systems-close").click(); });
  $("mapping-dialog").classList.add("admin-shell");
  const mappingBody = $("mapping-dialog").querySelector(".mapping-body");
  mappingBody.append(disclosure("Current assignments and mapping scope", [$("mapping-dialog").querySelector(".mapping-table-wrap"), $("mapping-dialog").querySelector(".mapping-scope")]));
  // Contextual access remains while new native persistence acceptance is pending.
  $("mapping-toggle").hidden = $("systems-toggle").hidden = $("settings-toggle").hidden = true;
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAdministration, { once: true });
else mountAdministration();
