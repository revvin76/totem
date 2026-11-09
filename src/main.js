import { installErrorLogging, recordFailure } from "./error-log.js";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { addSceneAntialiasing } from "./scene-antialiasing.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { createDepthOfField } from "./depth-of-field.js";
import { platformChooserSettings, applyPlatformChooserElements } from "./studio-page-settings.js";
import { createTotemPole } from "./totem-pole.js";
import { createPlatformForeground } from "./platform-foreground.js";
import { chooserActions } from "../light-study/chooser-controls.js";
import { appControllerAction, appKeyboardAction, initialiseControllerMappings, pressedControllerInputs } from "./app-controller-mappings.js";
import { inputModeEvent, trackInputMode, useInputMode } from "./input-mode.js";
import { matchesPlatformFilters, mountPlatformFilters } from "./platform-filters.js";
import { mountAppControllerMappings } from "./app-controller-mappings-ui.js";
import { applyPlatformDetails, renderPlatformEmulatorSummary, writePlatformText } from "./platform-details.js";
import { actionArtwork, mountPlatformBottomNav } from "./bottom-nav.js";
import { settingsControllerAction } from "./settings-navigation.js";
import { mountAlphabetJump } from "./alphabet-jump.js";
import "./alphabet-jump.css";
import { titleArtwork, trimLogo } from "../light-study/title-artwork.js";
import { loadStudioDocument, saveStudioDocument } from "./studio-config.js";
import { isShowcaseMuted, setShowcaseMuted } from "./studio-audio.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import browserPlatforms from "../platforms.json" with { type: "json" };
import { emulatorSettingsStore } from "./emulator-settings.js";
import { createConsole } from "./models.js";
import { loadPlatformModel, disposeImported, setModelAnimationProgress, setModelActivity } from "./platform-assets.js";
import { DREAMCAST_CLOSE_SECONDS, REAR_CARTRIDGE_SEATED_PROGRESS, prepareOffscreenDemo, prepareSwitchScreenDemo, showcaseBackdropFrame } from "./console-activity.js";
import { applyConsoleSkin, canCycleConsoleSkin, cycleConsoleSkin } from "./console-skins.js";
import { mountGameLibrary } from "./game-chooser-host.js";
import { observeEmulatorExit } from "./universal-emulator-exit-ui.js";
import { createLibraryClient, discoveredPlatformIds } from "./library-client.js";
import { mountFolderSettings } from "./folder-settings-ui.js";
import { createPlatformStore } from "./platform-store.js";
import { bundledLogo } from "./platform-artwork.js";
import { platformSymbol } from "./platform-symbols.js";
import { mountPlatformEditor } from "./platform-editor.js";
import { mountControllerMapping } from "./controller-mapping-ui.js";
import { createStudioEnvironment } from "./studio-environment.js";
import { resolveStudioEnvironment } from "./studio-environment-settings.js";
import { createSharedSceneRuntime } from "./shared-scene-runtime.js";
import { supportsDynamicHinge } from "./hardware-profiles.js";
import { consoleFocusAmount, frameCarouselEnvironment, worldXAtScreenColumn } from "./framing.js";
import {
  nearestSlot,
  orbitOrientation,
  orbitPosition,
  wrapIndex,
} from "./orbit.js";
import {
  applyConsoleControls,
  applyDeviceControls,
  DRAFT_KEY,
  makeLayoutSnapshot,
  neutralDeviceControls,
  parseLayoutSnapshot,
  platformSceneLayout,
  readPlatformSceneLayout,
} from "./layout.js";
import startupLayout from "../startup-layout.json" with { type: "json" };
import { mountLayoutControls } from "./controls.js";
import {
  DEMO_SYSTEMS,
  nearbyAngle,
  slotAngle,
  survivingSelection,
  visiblePlatforms,
} from "./collection.js";
import { mountSystemPicker } from "./system-picker.js";
import "./style.css";
import { loadingProfile, snapshotLoadingProfile, recordFrameTiming, resetFrameTiming, recordLoadingTime, timeLoading, describeGraphics, waitForLoadingIdle } from "./loading-profile.js";
import { displayPlatform } from "./model-display.js";
import { createModelResidency } from "./model-residency.js";
import { createRingPlaceholder } from "./ring-placeholder.js";
import { createGpuTimer } from "./gpu-timer.js";
import {
  failStartup,
  revealStartupChooser,
  startupBenchmarkConfig,
  startupBlocksController,
  startupMotionChanged,
  startupNeedsChooserFrame,
  startupOwnsSplash,
  waitForStartupHandoffIfReady,
} from "./startup-intro.js";

installErrorLogging("launcher");
recordLoadingTime("navigation-to-module", 0);
document.addEventListener("visibilitychange", resetFrameTiming);

const $ = (id) => document.getElementById(id);
const setPlatformLogo = titleArtwork($("platform-logo"), $("title"));
const native = isTauri();
const platformButtonArtwork = new Map();
function platformButtonArtworkUrl(platformId) {
  if (!native) return Promise.resolve(null);
  if (!platformButtonArtwork.has(platformId)) {
    platformButtonArtwork.set(
      platformId,
      invoke("get_platform_chooser_button", { platformId })
        .then((path) => (path ? convertFileSrc(path) : null))
        .catch(() => null),
    );
  }
  return platformButtonArtwork.get(platformId);
}
let modelResidencySnapshot = () => null;
let loadingBenchmarkActive = false;
let savedEmulators = [];
let emulatorAvailability = {};
async function refreshEmulatorSettings() {
  const document = await emulatorSettingsStore().load();
  savedEmulators = document.emulators;
  emulatorAvailability = document.availability ?? {};
}
async function saveLoadingProfile(stage) {
  if (!native) return;
  try {
    const path = await invoke("save_loading_profile", { profile: { ...snapshotLoadingProfile(), residency: modelResidencySnapshot(), stage } });
    console.debug("[Totem loading] Saved profile:", path);
  } catch (error) {
    console.warn("Could not save loading profile", error);
    if (loadingBenchmarkActive) throw error;
  }
}
let modelStatusForId = () => "";
const folderSettings = mountFolderSettings(native);
const library = createLibraryClient(native);
let librarySummary = null;
let libraryError = null;
const gameLibrary = mountGameLibrary({
  library, reducedMotion: () => reduceMotion,
  onStepPlatform: choose,
  getPlatform: (id) => platforms.find(p => p.id === id),
  getStore: () => platformStore,
  onPlatformSaved: (saved) => {
    platforms = platforms.map((platform) => platform.id === saved.id ? saved : platform);
    activePlatforms = activePlatforms.map((platform) => platform.id === saved.id ? saved : platform);
  },
});
const emulatorExitInput = { active: false, needsRelease: false };
observeEmulatorExit(({ phase }) => {
  if (phase === "active" || phase === "ended") {
    emulatorExitInput.active = phase === "active";
    emulatorExitInput.needsRelease = true;
  }
});
let platforms = browserPlatforms;
let activePlatforms = visiblePlatforms(platforms, DEMO_SYSTEMS);
let enabledPlatformIds = activePlatforms.map((p) => p.id);
let selected = 3,
  targetSlot = 3,
  currentSlot = 3,
  busy = false;
const baseline = parseLayoutSnapshot(
  JSON.stringify(startupLayout),
  platforms.map((p) => p.id),
);
const layout = structuredClone(baseline.layout);
let deviceOverrides = structuredClone(baseline.deviceOverrides);
let inactiveDeviceOverrides = structuredClone(baseline.inactiveDeviceOverrides);
let openWhenActive = structuredClone(baseline.openWhenActive);
let layoutControls = null;
let runPlatformAction = () => {};
trackInputMode();
let platformStore;
let logoRevision = 0;
let heroLogoUrl;
let heroLogoKey;
let requestSelectedModel = () => {};
let selectionTiming = null;
let selectionSequence = 0;
let refreshPlatformNav = () => {};
let captureLibraryEntrance = () => null;
let centerSelectedRail = () => {};
let pageSystemTypes = () => {};
let lastUserInputAt = performance.now();
function recordUserInput() { lastUserInputAt = performance.now(); }
for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "input", "change"])
  window.addEventListener(type, recordUserInput, { capture: true, passive: true });
const RESTING_CONTROL_KEYS = ["zoom", "panX", "panY", "panZ", "pitch", "yaw", "roll"];
const NEUTRAL_DEVICE_CONTROLS = Object.freeze(neutralDeviceControls());


const platformChooserStudio = new URLSearchParams(location.search).get('studio') === 'platformChooser';
document.body.classList.toggle('browser-preview', !native && !platformChooserStudio);

function modelStatusMessage(platform, model) {
  if (!platform || !model) return "";
  if (model.userData.modelLoadError || model.userData.loadError)
    return `Imported model unavailable; showing placeholder. ${model.userData.modelLoadError ?? model.userData.loadError}`;
  if (!platformChooserStudio && model.userData.detailTier === "preview" && (platform.modelFile || platform.bundledModel))
    return "Preparing detailed system…";
  if (model.userData.isPlaceholder)
    return "No 3D model configured; showing placeholder.";
  return "";
}
const REDUCED_MOTION_KEY = "horizon.carousel.reduced-motion.v1";
const POST_PROCESSING_DEFAULTS = Object.freeze({ version: 2, enabled: true, blur: 0.006 });
const POST_PROCESSING_KEY = "horizon.carousel.post-processing.v2";
let studioDraftAutosave = true, stagedStudioDraft = null, stagedStudioPreferences = new Map();
function persistStudioPreference(key, value) {
  const serialized = String(value);
  if (platformChooserStudio && !studioDraftAutosave) {
    const previous = stagedStudioPreferences.get(key)?.previous ?? localStorage.getItem(key);
    stagedStudioPreferences.set(key, { previous, value: serialized });
    window.dispatchEvent(new CustomEvent("totem:studio-draft-dirty"));
  } else localStorage.setItem(key, serialized);
}
enabledPlatformIds = [...baseline.enabledPlatformIds];
const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
const savedReducedMotion = localStorage.getItem(REDUCED_MOTION_KEY);
let reduceMotion = savedReducedMotion === null
  ? reducedQuery.matches
  : savedReducedMotion === "true";
let postProcessing = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(POST_PROCESSING_KEY));
    if (typeof saved?.enabled === "boolean" && Number.isFinite(saved.blur) && (saved.version === 2 || saved.enabled))
      return { version: 2, enabled: saved.enabled, blur: THREE.MathUtils.clamp(saved.blur, 0, 0.012) };
  } catch { /* Older installations may not have saved post-processing controls. */ }
  return { ...POST_PROCESSING_DEFAULTS };
})();
function restoreViewSettings(view) {
  if (typeof view?.reduceMotion === "boolean") {
    reduceMotion = view.reduceMotion;
    persistStudioPreference(REDUCED_MOTION_KEY, reduceMotion);
    $("reduced-motion").checked = reduceMotion;
  }
  const saved = view?.postProcessing;
  if (typeof saved?.enabled === "boolean" && Number.isFinite(saved.blur) && (saved.version === 2 || saved.enabled)) {
    postProcessing = {
      version: 2,
      enabled: saved.enabled,
      blur: THREE.MathUtils.clamp(saved.blur, 0, 0.012),
    };
    persistStudioPreference(POST_PROCESSING_KEY, JSON.stringify(postProcessing));
  }
}
$("reduced-motion").checked = reduceMotion;
reducedQuery.addEventListener("change", (e) => {
  if (localStorage.getItem(REDUCED_MOTION_KEY) !== null || stagedStudioPreferences.has(REDUCED_MOTION_KEY)) return;
  reduceMotion = e.matches;
  $("reduced-motion").checked = reduceMotion;
  if (reduceMotion) $("autoplay").checked = false;
  startupMotionChanged(reduceMotion);
});

function showError(message, error = message, context = "launcher.displayed-error") {
  void recordFailure(context, error);
  $("announcement").textContent = message;
  $("loading").hidden = false;
  $("loading").textContent = message;
}

let startupSplashDismissed = false;
function dismissStartupSplash() {
  if (startupSplashDismissed || startupOwnsSplash()) return;
  startupSplashDismissed = true;
  recordLoadingTime("splash-dismiss-requested", 0);
  const splash = $("startup-splash");
  if (!splash) return;
  splash.classList.add("is-hidden");
  window.setTimeout(() => splash.remove(), 300);
}

async function start() {
  document.querySelector(".brand-logo").hidden = false;
  const benchmarkConfig = await startupBenchmarkConfig;
  startupMotionChanged(reduceMotion);
  loadingBenchmarkActive = Boolean(benchmarkConfig);
  if (loadingBenchmarkActive) $("app").inert = true;
  let initialSelectedId = baseline.selectedPlatform;
  let orbitSettingsUpdated = false;
  let hasPersistedLayout = false;
  let savedDefaultTimestamp = 0;
  if (native) {
    $("runtime").textContent = "RUST / TAURI · INTERACTIVE 3D";
  }
  platformStore = await timeLoading("platform-store", () => createPlatformStore(native, browserPlatforms));
  platforms = await timeLoading("catalogue", () => platformStore.catalogue());
  try { await refreshEmulatorSettings(); }
  catch (error) { console.warn("Could not load emulator settings for the platform summary", error); }
  if (native) {
    try {
      const savedDefault = await timeLoading("saved-layout", () => invoke("load_default_layout"));
      if (savedDefault) {
        const restored = parseLayoutSnapshot(
          JSON.stringify(savedDefault),
          platforms.map((p) => p.id),
        );
        Object.assign(layout, restored.layout);
        Object.assign(baseline, restored);
        deviceOverrides = structuredClone(restored.deviceOverrides);
        inactiveDeviceOverrides = structuredClone(restored.inactiveDeviceOverrides);
        openWhenActive = structuredClone(restored.openWhenActive);
        enabledPlatformIds = [...restored.enabledPlatformIds];
        initialSelectedId = restored.selectedPlatform;
        savedDefaultTimestamp = Date.parse(restored.createdAt) || 0;
        hasPersistedLayout = true;
        restoreViewSettings(restored.view);
        $("draft-status").textContent = "Saved default layout loaded.";
      }
    } catch (error) {
      $("draft-status").textContent = `Saved default could not be loaded: ${error}`;
    }
  }
  if (native) {
    $("loading").textContent = "Loading your saved library…";
    try {
      librarySummary = await timeLoading("library-cache", () => library.cachedSummary());
      loadingProfile.libraryCache = librarySummary;
    }
    catch (error) { libraryError = `Saved library unavailable: ${error}`; }
  }
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) {
      const restored = parseLayoutSnapshot(
        draft,
        platforms.map((p) => p.id),
      );
      const draftTimestamp = Date.parse(restored.createdAt) || 0;
      if (native && savedDefaultTimestamp && draftTimestamp < savedDefaultTimestamp) {
        localStorage.removeItem(DRAFT_KEY);
        $("draft-status").textContent = "Older local draft ignored; saved default restored.";
      } else {
        Object.assign(layout, restored.layout);
        if (localStorage.getItem("horizon.carousel.orbit-ring.v3") !== "applied") {
          Object.assign(layout.orbit, startupLayout.layout.orbit);
          orbitSettingsUpdated = true;
        }
        initialSelectedId = restored.selectedPlatform;
        enabledPlatformIds = restored.enabledPlatformIds;
        deviceOverrides = {
          ...structuredClone(baseline.deviceOverrides),
          ...restored.deviceOverrides,
        };
        inactiveDeviceOverrides = {
          ...structuredClone(baseline.inactiveDeviceOverrides),
          ...restored.inactiveDeviceOverrides,
        };
        openWhenActive = {
          ...structuredClone(baseline.openWhenActive),
          ...restored.openWhenActive,
        };
        hasPersistedLayout = true;
        restoreViewSettings(restored.view);
        $("draft-status").textContent = "Local draft restored.";
      }
    }
  } catch {
    $("draft-status").textContent =
      "Could not restore the local draft. Defaults are shown; load a snapshot to recover a layout.";
  }
  startupMotionChanged(reduceMotion);
  if (native && !hasPersistedLayout)
    enabledPlatformIds = discoveredPlatformIds(platforms, librarySummary?.platformCounts ?? {});
  activePlatforms = visiblePlatforms(platforms, enabledPlatformIds);
  if (activePlatforms.length)
    initialSelectedId = activePlatforms[Math.floor(Math.random() * activePlatforms.length)].id;
  selected = activePlatforms.findIndex((p) => p.id === initialSelectedId);
  if (selected < 0 && activePlatforms.length) selected = 0;
  targetSlot = currentSlot = Math.max(0, selected);
  const host = $("scene");
  const graphicsStartedAt = performance.now();
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  describeGraphics(renderer);
  const gpuTimer = createGpuTimer(renderer.getContext());
  loadingProfile.gpu = { supported: gpuTimer.supported, milliseconds: gpuTimer.samples };
  addEventListener("pagehide", () => gpuTimer.dispose(), { once: true });
  Object.assign(renderer.domElement.style, {position:"absolute",inset:"0",pointerEvents:"none"});
  $("app").prepend(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    renderer.setAnimationLoop(null);
    showError(
      "3D rendering was interrupted. Reload the screen to restore the scene.",
    );
  });
  const scene = new THREE.Scene();
  const homeContent = new THREE.Group();
  homeContent.name = "Home screen content";
  homeContent.position.y = 8;
  scene.add(homeContent);
  const defaultHomeFov = 36;
  const camera = new THREE.PerspectiveCamera(defaultHomeFov, 1, 0.01, 160);
  let studioDocument = {};
  const modelById = new Map();
  function togglePlatformAudio() {
    const next = setShowcaseMuted();
    refreshPlatformNav();
    $("announcement").textContent = next ? "Platform audio muted." : "Platform audio unmuted.";
  }
  const alphabetJump = mountAlphabetJump($("app"), {
    items: () => activePlatforms,
    selected: () => activePlatforms[selected],
    titleOf: platform => platform.name,
    select: platform => {
      const index = activePlatforms.indexOf(platform);
      if (index !== selected) navigateTo(index);
    },
  });
  const platformActions = {
    ...Object.fromEntries(Object.keys(chooserActions).map(action => [action, () => choose(0, action)])),
    none: null,
    filters: () => void filtersPopup.open(),
    "navigation-menu": () => {
      if (!document.hasFocus() || document.querySelector("dialog[open]")) return;
      toggleNavigation(true);
    },
    "toggle-mute": togglePlatformAudio,
    escape: () => {
      if (!navigationMenu.hidden) toggleNavigation(false, true);
      else if (!$("system-picker").hidden) toggleSystems(false);
      else if (!$("settings").hidden) toggleSettings(false);
      else $("announcement").textContent = "Already at platform selection.";
    },
    "previous-filter": () => pageSystemTypes(-1),
    "next-filter": () => pageSystemTypes(1),
    previous: () => navigate(-1),
    next: () => navigate(1),
    "previous-platform": () => navigate(-1),
    "next-platform": () => navigate(1),
    "previous-letter": () => alphabetJump.jump(-1),
    "next-letter": () => alphabetJump.jump(1),
    "cycle-skin": () => {
      const platform = activePlatforms[selected];
      if (!platform) return;
      try {
        const skin = cycleConsoleSkin(modelById.get(platform.id), platform.id);
        $("announcement").textContent = skin ? `${platform.name} · ${skin}` : "Alternate skins are unavailable for this model.";
      } catch {
        $("announcement").textContent = "The skin preference could not be saved.";
      }
    },
    select: () => choose(),
  };
  runPlatformAction = action => {
    if (Object.hasOwn(platformActions, action)) platformActions[action]?.();
  };
  const renderPlatformNav = mountPlatformBottomNav($("platform-footer"), platformActions);
  const renderHardwareStart = mountPlatformBottomNav($("hardware-start"), platformActions, "hardware-start");
  const renderHardwareEnd = mountPlatformBottomNav($("hardware-end"), platformActions, "hardware-end");
  let platformPage, platformNav;
  refreshPlatformNav = () => {
    const id = activePlatforms[selected]?.id;
    const canCycleSkin = canCycleConsoleSkin(modelById.get(id), id);
    const audioOn = !isShowcaseMuted();
    renderPlatformNav(platformNav, canCycleSkin, audioOn);
    renderHardwareStart(platformNav, canCycleSkin, audioOn);
    renderHardwareEnd(platformNav, canCycleSkin, audioOn);
    const hint = $("navigation-input-hint");
    const { source } = actionArtwork("navigation-menu");
    hint.hidden = !source;
    if (source) hint.src = source;
  };
  function updatePlatformNav(documentState) {
    initialiseControllerMappings(documentState);
    platformPage = platformChooserSettings(documentState);
    platformNav = platformPage.bottomNav;
    refreshPlatformNav();
  }
  const readEnvironment = () => loadStudioDocument(native);
  let studioEditor, runtimeDraftScene;
  const captureSceneLayout = () => platformSceneLayout({ layout, deviceOverrides, inactiveDeviceOverrides, openWhenActive });
  function applySceneLayout(settings) {
    Object.assign(layout, structuredClone(settings.layout));
    deviceOverrides = structuredClone(settings.deviceOverrides);
    inactiveDeviceOverrides = structuredClone(settings.inactiveDeviceOverrides);
    openWhenActive = structuredClone(settings.openWhenActive);
  }
  function applyRuntimeSceneLayout(document) {
    const settings = readPlatformSceneLayout(document, platforms.map(p => p.id));
    if (settings) {
      runtimeDraftScene ??= captureSceneLayout();
      applySceneLayout(settings);
      orbitSettingsUpdated = false;
    } else if (runtimeDraftScene) {
      applySceneLayout(runtimeDraftScene);
      runtimeDraftScene = null;
    } else return;
    for (const id of ["orbit-controls", "consoles-controls", "inactive-controls", "device-controls"]) {
      $(id).inert = Boolean(settings);
    }
    for (const id of ["reset", "load-snapshot", "save-default"]) $(id).disabled = Boolean(settings);
    status("draft-status", settings ? "Edit the Platform Chooser layout in Totem Studio." : "Local layout restored.");
  }
  try {
    studioDocument = await readEnvironment();
    if (platformChooserStudio) {
      const settings = readPlatformSceneLayout(studioDocument, platforms.map(p => p.id));
      if (settings) {
        applySceneLayout(settings);
        orbitSettingsUpdated = false;
      }
    } else applyRuntimeSceneLayout(studioDocument);
  }
  catch (error) { void recordFailure("studio-environment", error); }
  postProcessing = {...postProcessing,...platformChooserSettings(studioDocument,postProcessing).depthOfField};
  applyPlatformChooserElements(studioDocument);
  updatePlatformNav(studioDocument);
  mountAppControllerMappings($("app-controller-mappings"), {
    read: readEnvironment,
    save: saveStudioDocument,
    apply(documentState) {
      initialiseControllerMappings(documentState);
      refreshPlatformNav();
    },
  });
  window.addEventListener(inputModeEvent, refreshPlatformNav);
  const environment = createStudioEnvironment(scene, renderer, resolveStudioEnvironment(studioDocument), {width:innerWidth,height:innerHeight});
  environment.gameplayBackdrop.apply(studioDocument.gameplayBackdrop);
  const updateGameplayBackdrop = (texture, brightness) =>
    environment.gameplayBackdrop.update(texture, renderer.domElement.clientWidth || 1, renderer.domElement.clientHeight || 1, brightness);
  let sceneTools;
  environment.setContentRoots([homeContent]);
  const platformDetails = document.querySelector(".hero");
  const poleCenter = new THREE.Vector3();
  let platformPole;
  function alignPlatformPole() {
    const pole = platformPole?.root;
    if (!pole?.visible) return;
    const { position, alignWithDetails } = platformPage.pole;
    pole.position.x = position[0];
    if (!alignWithDetails || !platformPage.elements.details.visible) return;
    const canvas = renderer.domElement.getBoundingClientRect();
    const details = platformDetails.getBoundingClientRect();
    if (!canvas.width || !details.width) return;
    const column = (details.left + details.width / 2 - canvas.left) * 2 / canvas.width - 1;
    pole.localToWorld(poleCenter.set(0, pole.userData.totemRest.anchor[1] / 2, 0));
    pole.position.x += worldXAtScreenColumn(camera, poleCenter, column) - poleCenter.x;
  }
  function syncPlatformPole({ enabled, position, rotation, scale, mascotScale, mascotYaw }) {
    if (!platformPole && enabled) {
      platformPole = createTotemPole();
      homeContent.add(platformPole.root);
    }
    if (!platformPole) return;
    platformPole.root.visible = enabled;
    platformPole.root.position.fromArray(position);
    platformPole.root.rotation.fromArray(rotation);
    platformPole.root.scale.fromArray(scale);
    Object.assign(platformPole.root.userData.totemRest, { mascotScale, mascotYaw });
    alignPlatformPole();
  }
  syncPlatformPole(platformPage.pole);
  addEventListener("pagehide", event => { if (!event.persisted) platformPole?.dispose(); });
  const sharedStage = createSharedSceneRuntime({
    scene, renderer, environment, homeContent, homeCamera: camera,
    homeCameraOverride: () => sceneTools?.camera,
    homeEditorPerch: () => studioEditor?.previewPole(),
    selectedConsoleId: () => activePlatforms[selected]?.id,
  });
  environment.apply(resolveStudioEnvironment(studioDocument), platformPage.lights);
  window.totemSceneRuntime = sharedStage;
  let refreshingEnvironment = false;
  const environmentRefresh = setInterval(async () => {
    if (refreshingEnvironment) return;
    refreshingEnvironment = true;
    try {
      const next = await readEnvironment();
      if (next.revision !== studioDocument.revision) {
        const cameraChanged = JSON.stringify(next.pages?.platformChooser?.camera) !==
          JSON.stringify(studioDocument.pages?.platformChooser?.camera);
        if (!platformChooserStudio && JSON.stringify(next.pages?.platformChooser?.sceneLayout) !==
            JSON.stringify(studioDocument.pages?.platformChooser?.sceneLayout)) {
          applyRuntimeSceneLayout(next);
          if (layoutControls) {
            layoutControls.selectDevice(activePlatforms[selected], deviceOverrides, inactiveDeviceOverrides, openWhenActive);
            updatePath();
          }
        }
        studioDocument = next;
        postProcessing = {...postProcessing,...platformChooserSettings(next,postProcessing).depthOfField};
        applyPlatformChooserElements(next);
        updatePlatformNav(next);
        if (cameraChanged) frameHomeCamera($("app").getBoundingClientRect());
        syncPlatformPole(platformPage.pole);
        environment.apply(resolveStudioEnvironment(next), platformPage.lights);
        environment.gameplayBackdrop.apply(next.gameplayBackdrop);
      }
    } catch (error) { console.warn("Studio environment refresh failed", error); }
    finally { refreshingEnvironment = false; }
  }, 1500);
  addEventListener("pagehide", () => clearInterval(environmentRefresh), {once:true});
  const composer = new EffectComposer(renderer);
  const scenePass = new RenderPass(scene, camera);
  composer.addPass(scenePass);
  const depthEffect = createDepthOfField(scene,camera,environment.gameplayBackdrop.mesh);
  const depthOfField = depthEffect.pass;
  depthEffect.update(postProcessing);
  composer.addPass(depthOfField);
  composer.addPass(environment.bloom);
  composer.addPass(new OutputPass());
  addSceneAntialiasing(composer);
  const foreground = createPlatformForeground($("app"), scene, renderer, environment.lightSources);
  const orbitFront = new THREE.Vector3(), orbitBack = new THREE.Vector3();
  function renderPlatform() {
    const viewer = sharedStage.camera;
    const panelVisible = platformDetails.checkVisibility({ visibilityProperty: true });
    // The midpoint of opposite slots follows the authored orbit, including pan and tilt.
    orbitPosition(0, layout.orbit, orbitFront, camera.quaternion);
    orbitPosition(Math.PI, layout.orbit, orbitBack, camera.quaternion);
    homeContent.localToWorld(orbitFront.lerp(orbitBack, .5)).applyMatrix4(viewer.matrixWorldInverse);
    const panelDepth = panelVisible ? Math.max(viewer.near, -orbitFront.z) : null;
    sharedStage.platformPanelDepth = panelDepth;
    foreground.render(viewer, platformPole?.root,
      homeContent.children.find(root => root.userData.isTotemMascot), panelDepth, () => composer.render());
  }
  addEventListener("pagehide", event => { if (!event.persisted) foreground.dispose(); });
  recordLoadingTime("renderer-environment-postprocessing", graphicsStartedAt);
  function syncPostProcessingControls() {
    postProcessing={...postProcessing,...platformChooserSettings(studioDocument,postProcessing).depthOfField};
    depthEffect.update(postProcessing);
  }
  syncPostProcessingControls();
  const focusDepthOfFieldOn = (model) => {
    depthEffect.update(sceneTools?.editing ? { enabled: false } : postProcessing, sharedStage.camera, model);
  };
  const stopConsoleDemos = () => {
    for (const model of modelById.values()) setModelActivity(model, false);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopConsoleDemos();
  });
  const residency = createModelResidency({
    idle: waitForLoadingIdle,
    createPlaceholder: createRingPlaceholder,
    async load(platform, tier) {
      const model = await loadPlatformModel(displayPlatform(platform, platformChooserStudio ? "studio" : tier), platformStore, false, {
        carouselShowcase: tier === "display",
      });
      if (model.userData.modelLoadError) {
        disposeImported(model);
        throw new Error(model.userData.modelLoadError);
      }
      model.userData.detailTier = tier;
      try {
      const uploadStarted = performance.now();
      const textures = new Set();
      model.traverse(part => {
        if (!part.isMesh) return;
        for (const material of Array.isArray(part.material) ? part.material : [part.material])
          for (const value of Object.values(material))
            if (value?.isTexture && !value.isVideoTexture && value.image?.width) textures.add(value);
      });
      for (const texture of textures) renderer.initTexture(texture);
      recordLoadingTime("model-texture-upload-submitted", uploadStarted, { platform: platform.id, tier, textures: textures.size });
      const compileStarted = performance.now();
      await renderer.compileAsync(model, camera, scene);
      recordLoadingTime("shader-compile", compileStarted, { platform: platform.id, tier });
      const mediaStarted = performance.now();
      if (tier === "display" && platform.id === "switch" &&
          (!platform.modelFile || platform.modelFile.id.startsWith(`${platform.bundledModel?.sha256}.`))) {
        prepareSwitchScreenDemo(model);
      }
      if (tier === "display") {
        const getClip = (type) => invoke(`get_showcase_${type}_video`, { platformId: platform.id })
          .catch(error => { void recordFailure(`showcase.${type}-clip`, error); return null; });
        const [startup, gameplay] = native ? await Promise.all([
          getClip("startup"),
          model.userData.consoleActivity?.screenDemo ? null : getClip("gameplay"),
        ]) : [];
        prepareOffscreenDemo(model, platform.id, gameplay ? {
          url: convertFileSrc(gameplay), filename: gameplay.split(/[\\/]/).at(-1),
        } : null, startup ? convertFileSrc(startup) : null);
        recordLoadingTime("model-showcase-preparation", mediaStarted, { platform: platform.id, tier });
      }
      return model;
      } catch (error) { disposeImported(model); throw error; }
    },
    dispose: disposeImported,
    detach(platform, model) {
      homeContent.remove(model);
      if (modelById.get(platform.id) === model) modelById.delete(platform.id);
      if (activePlatforms[selected]?.id === platform.id) refreshPlatformNav();
    },
    attach(platform, model, previous) {
      const started = performance.now();
      if (previous) {
        model.position.copy(previous.position);
        model.quaternion.copy(previous.quaternion);
        model.scale.copy(previous.scale);
        for (const key of ["orbitAngle", "reveal", "restingControls", "movingOverride", "animationTransition"])
          if (previous.userData[key] !== undefined) model.userData[key] = previous.userData[key];
      } else {
        const index = activePlatforms.findIndex(p => p.id === platform.id);
        model.userData.orbitAngle = slotAngle(index, currentSlot, activePlatforms.length);
        model.userData.reveal = 0;
      }
      model.userData.isPlaceholder = Boolean(model.userData.placeholder);
      applyConsoleSkin(model, platform.id);
      modelById.set(platform.id, model);
      homeContent.add(model);
      recordLoadingTime("model-scene-attach", started, { platform: platform.id, tier: model.userData.detailTier });
      if (activePlatforms[selected]?.id === platform.id) {
        refreshPlatformNav();
        $("model-load-status").textContent = modelStatusMessage(platform, model);
        dismissStartupSplash();
      }
    },
  });
  modelResidencySnapshot = () => residency.snapshot();
  window.totemModelResidency = residency;
  modelStatusForId = (id) => residency.snapshot().failures.some(f => f.id === id && f.tier === "display")
    ? "Detailed system unavailable; showing preview."
    : modelStatusMessage(activePlatforms.find((platform) => platform.id === id), modelById.get(id));
  captureLibraryEntrance = async (platform) => {
    const existing = modelById.get(platform.id);
    const model = existing ?? await ensureModel(platform);
    if (!existing && model && !document.hidden) {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    if (!model?.visible) return null;
    focusDepthOfFieldOn(model);
    const rect = renderer.domElement.getBoundingClientRect();
    const origin = model.getWorldPosition(new THREE.Vector3());
    const orientation = camera.getWorldQuaternion(new THREE.Quaternion());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
    const projected = origin.clone().project(camera);
    const projectedUp = origin.clone().add(up).project(camera);
    return {
      id: platform.id,
      x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (1 - projected.y) * rect.height / 2,
      scale: Math.abs(projectedUp.y - projected.y) * rect.height / 2 * model.getWorldScale(new THREE.Vector3()).x,
      rotation: orientation.invert().multiply(model.getWorldQuaternion(new THREE.Quaternion())),
      placeholder: Boolean(model.userData.isPlaceholder),
    };
  };
  let firstSelectedFrameRecorded = false;
  let firstDisplayFrameRecorded = false;
  let collectionRevision = 0;
  let railKind = "all";
  let railFilters = {};
  let platformGenres = {};
  const applyFilters = (next, genres = platformGenres) => {
    railFilters = next;
    platformGenres = genres;
    railKind = next.kind ?? "all";
    updateRailTypeControls();
    filtersPopup.renderChips();
    void syncCollection(enabledPlatformIds, activePlatforms[selected]?.id, false).catch(error =>
      showError(`Could not filter systems: ${error.message}`));
  };
  const filtersPopup = mountPlatformFilters({
    getPlatforms: () => platforms.filter(platform => enabledPlatformIds.includes(platform.id)),
    getFilters: () => railFilters,
    onApply: applyFilters,
    loadGenres: () => native ? invoke("get_cached_platform_genres") : Promise.resolve({}),
  });
  function filterKind(kind) {
    const next = { ...railFilters };
    if (kind === "all") delete next.kind;
    else next.kind = kind;
    applyFilters(next);
  }
  const rail = $("systems");
  const railTrack = $("systems-track");
  function updateRailTypeControls() {
    document.querySelectorAll("#system-types [data-kind]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.kind === railKind));
      button.disabled = button.dataset.kind !== "all" &&
        !enabledPlatformIds.some((id) => platforms.find((platform) => platform.id === id)?.kind === button.dataset.kind);
    });
  }
  pageSystemTypes = (direction) => {
    const filters = [...document.querySelectorAll("#system-types [data-kind]")]
      .filter((button) => !button.disabled);
    if (filters.length < 2) return;
    const current = filters.findIndex((button) => button.dataset.kind === railKind);
    const next = filters[(current + direction + filters.length) % filters.length];
    if (!next || next.dataset.kind === railKind) return;
    filterKind(next.dataset.kind);
  };
  $("system-types").addEventListener("click", (event) => {
    const button = event.target.closest("[data-kind]");
    if (!button || button.disabled || button.dataset.kind === railKind) return;
    filterKind(button.dataset.kind);
  });
  updateRailTypeControls();
  function addCard(platform, copy) {
    const button = document.createElement("button");
    button.className = "system";
    button.setAttribute("aria-label", platform.name);
    button.title = platform.name;
    button.dataset.platform = platform.id;
    if (copy) {
      button.dataset.railCopy = "";
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
    }
    const image = new Image();
    image.alt = "";
    image.className = "system-logo";
    image.draggable = false;
    const symbol = platformSymbol(platform);
    if (symbol) {
      image.src = symbol.path;
      image.classList.add(symbol.crop ? "system-logo-crop" : "system-logo-mark");
      if (symbol.position) image.style.objectPosition = `${symbol.position} center`;
    }
    else image.hidden = true;
    const fallbackImage = symbol?.path ?? null;
    const fallbackImageClass = symbol?.crop ? "system-logo system-logo-crop" : "system-logo system-logo-mark";
    void platformButtonArtworkUrl(platform.id).then((artworkUrl) => {
      if (!artworkUrl || !button.isConnected) return;
      image.onerror = () => {
        image.onerror = null;
        button.classList.remove("system-image-card");
        image.className = fallbackImageClass;
        image.hidden = !fallbackImage;
        if (fallbackImage) image.src = fallbackImage;
      };
      image.src = artworkUrl;
      image.className = "system-artwork";
      image.hidden = false;
      button.classList.add("system-image-card");
    });
    const text = document.createElement("span");
    const name = document.createElement("span");
    name.className = "system-name";
    name.dataset.platformText = `system-${platform.id}`;
    name.dataset.textLabel = `${platform.name} rail label`;
    name.textContent = platform.name;
    const maker = document.createElement("span");
    maker.className = "system-year";
    maker.textContent = platform.maker;
    text.append(name, maker);
    button.append(image, text);
    applyPlatformDetails(button, platformPage);
    button.addEventListener("click", () =>
      navigateTo(activePlatforms.findIndex((p) => p.id === platform.id)),
    );
    railTrack.append(button);
  }
  let railCopies = -1;
  let railTarget = null;
  let highlightedCard = null;
  function highlightCard(card) {
    highlightedCard?.removeAttribute("data-rail-current");
    card.dataset.railCurrent = "";
    highlightedCard = card;
  }
  function renderRail(force = false) {
    const count = activePlatforms.length;
    const copies = count > 1 ? Math.ceil(rail.clientWidth / (100 * count)) + 1 : 0;
    if (!force && copies === railCopies) return;
    railCopies = copies;
    railTarget = null;
    highlightedCard = null;
    railTrack.replaceChildren();
    for (let cycle = -copies; cycle <= copies; cycle++) {
      for (const platform of activePlatforms) addCard(platform, cycle !== 0);
    }
    for (const card of railTrack.querySelectorAll(".system:not([data-rail-copy])")) {
      card.setAttribute("aria-current", String(card.dataset.platform === activePlatforms[selected]?.id));
    }
  }
  centerSelectedRail = (index, smooth = true, direction = 0) => {
    const platformId = activePlatforms[index]?.id;
    if (!platformId) return;
    const cards = Array.from(railTrack.querySelectorAll(`.system[data-platform="${CSS.escape(platformId)}"]`));
    const canonical = cards.find(card => !card.hasAttribute("data-rail-copy"));
    if (!canonical) return;
    const railLeft = rail.getBoundingClientRect().left;
    const leftFor = card => {
      const bounds = card.getBoundingClientRect();
      return rail.scrollLeft + bounds.left - railLeft - (rail.clientWidth - bounds.width) / 2;
    };
    if (!smooth) {
      const previous = rail.scrollLeft;
      rail.scrollLeft = leftFor(canonical);
      railTarget = previous === rail.scrollLeft ? null : rail.scrollLeft;
      highlightCard(canonical);
      return;
    }
    const origin = direction && railTarget !== null ? railTarget : rail.scrollLeft;
    let target = leftFor(canonical);
    let targetCard = canonical;
    let nearest = Infinity;
    let nextInDirection = null;
    for (const card of cards) {
      const left = leftFor(card);
      const distance = Math.abs(left - origin);
      if (direction && (left - origin) * direction > 1 &&
          (nextInDirection === null || distance < Math.abs(nextInDirection.left - origin))) {
        nextInDirection = { left, card };
      }
      if (distance < nearest) {
        target = left;
        targetCard = card;
        nearest = distance;
      }
    }
    if (nextInDirection !== null) {
      target = nextInDirection.left;
      targetCard = nextInDirection.card;
    }
    highlightCard(targetCard);
    railTarget = target;
    rail.scrollTo({ left: target, behavior: "smooth" });
  };
  let railScrollSettleTimer = 0;
  rail.addEventListener("pointerdown", () => {
    railTarget = null;
    window.clearTimeout(railScrollSettleTimer);
  });
  rail.addEventListener("scroll", () => {
    window.clearTimeout(railScrollSettleTimer);
    railScrollSettleTimer = window.setTimeout(() => {
      if (gameLibrary.isOpen() || !activePlatforms.length) return;
      const programmatic = railTarget !== null;
      railTarget = null;
      const railBounds = rail.getBoundingClientRect();
      const center = railBounds.left + rail.clientWidth / 2;
      let nearestCard = null;
      let nearestDistance = Infinity;
      for (const card of railTrack.querySelectorAll(".system")) {
        const bounds = card.getBoundingClientRect();
        const distance = Math.abs(bounds.left + bounds.width / 2 - center);
        if (distance < nearestDistance) {
          nearestCard = card;
          nearestDistance = distance;
        }
      }
      if (!nearestCard) return;
      const index = activePlatforms.findIndex(
        (platform) => platform.id === nearestCard.dataset.platform,
      );
      if (index < 0) return;
      if (programmatic && (index !== selected || nearestCard.hasAttribute("data-rail-copy"))) {
        centerSelectedRail(selected, false);
      } else if (index !== selected) navigateTo(index);
      else if (nearestDistance > 1 || nearestCard.hasAttribute("data-rail-copy")) centerSelectedRail(index, false);
    }, 120);
  }, { passive: true });
  window.addEventListener("resize", () => {
    renderRail();
    centerSelectedRail(selected, false);
  });

  const pathGeometry = new THREE.BufferGeometry();
  const path = new THREE.LineLoop(
    pathGeometry,
    new THREE.LineBasicMaterial({
      color: "#6babc8",
      transparent: true,
      opacity: 0.18,
    }),
  );
  homeContent.add(path);
  path.visible = false;
  function updatePath() {
    pathGeometry.setFromPoints(
      Array.from({ length: 160 }, (_, i) =>
        orbitPosition(
          (i / 160) * Math.PI * 2,
          layout.orbit,
          undefined,
          camera.quaternion,
        ),
      ),
    );
  }
  updatePath();
  function status(id, message) {
    if ($(id).textContent !== message) $(id).textContent = message;
  }
  function captureView() {
    return {
      viewport: { width: host.clientWidth, height: host.clientHeight },
      camera: {
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        fov: camera.fov,
        view: camera.view,
      },
      reduceMotion,
      postProcessing: structuredClone(postProcessing),
    };
  }
  function saveStudioDraft() {
    if (stagedStudioDraft === null && !stagedStudioPreferences.size) return () => {};
    const previousDraft = stagedStudioDraft === null ? null : localStorage.getItem(DRAFT_KEY);
    const staged = stagedStudioDraft, preferences = new Map(stagedStudioPreferences);
    try {
      if (staged !== null) localStorage.setItem(DRAFT_KEY, staged);
      for (const [key, item] of preferences) localStorage.setItem(key, item.value);
    } catch (error) {
      if (staged !== null) {
        if (previousDraft === null) localStorage.removeItem(DRAFT_KEY);
        else localStorage.setItem(DRAFT_KEY, previousDraft);
      }
      for (const [key, item] of preferences) {
        if (item.previous === null) localStorage.removeItem(key);
        else localStorage.setItem(key, item.previous);
      }
      throw error;
    }
    stagedStudioDraft = null; stagedStudioPreferences.clear();
    status("draft-status", "Draft saved locally.");
    return () => {
      if (staged !== null) {
        if (previousDraft === null) localStorage.removeItem(DRAFT_KEY);
        else localStorage.setItem(DRAFT_KEY, previousDraft);
        stagedStudioDraft = staged;
      }
      for (const [key, item] of preferences) {
        if (item.previous === null) localStorage.removeItem(key);
        else localStorage.setItem(key, item.previous);
        stagedStudioPreferences.set(key, item);
      }
    };
  }
  function setStudioDraftAutosave(enabled) {
    if (enabled) {
      saveStudioDraft();
      studioDraftAutosave = true;
    } else studioDraftAutosave = false;
  }
  function saveDraft() {
    try {
      const draft = runtimeDraftScene ?? { layout, deviceOverrides, inactiveDeviceOverrides, openWhenActive };
      const serialized = JSON.stringify(makeLayoutSnapshot(
        draft.layout,
        activePlatforms[selected]?.id ?? null,
        captureView(),
        enabledPlatformIds,
        draft.deviceOverrides,
        draft.inactiveDeviceOverrides,
        draft.openWhenActive,
      ));
      if (platformChooserStudio && !studioDraftAutosave) {
        stagedStudioDraft = serialized;
        window.dispatchEvent(new CustomEvent("totem:studio-draft-dirty"));
        status("draft-status", "Unsaved layout draft changes.");
      } else {
        localStorage.setItem(DRAFT_KEY, serialized);
        if (!runtimeDraftScene) status("draft-status", "Draft saved locally.");
      }
    } catch {
      status(
        "draft-status",
        "Draft could not be saved. Save a snapshot before closing.",
      );
    }
  }
  async function syncCollection(nextIds, preferredId = null, persist = true) {
    const revision = ++collectionRevision;
    const previousIds = activePlatforms.map((p) => p.id);
    const previousSelected = activePlatforms[selected]?.id ?? null;
    const available = visiblePlatforms(platforms, nextIds).filter(
      (platform) =>
        !native ||
        !librarySummary ||
        (librarySummary.platformCounts[platform.id] ?? 0) > 0,
    );
    const ids = available.map((p) => p.id);
    const next = available.filter(platform => matchesPlatformFilters(platform, railFilters, platformGenres));
    const activeIds = next.map((p) => p.id);
    const selectedId = activeIds.includes(preferredId)
      ? preferredId
      : survivingSelection(previousIds, activeIds, previousSelected);
    enabledPlatformIds = ids;
    activePlatforms = next;
    selected = next.findIndex((p) => p.id === selectedId);
    currentSlot = targetSlot = Math.max(0, selected);
    const preloadStarted = performance.now();
    const visibleIds = visibleConsolePreviews(next, selected);
    recordLoadingTime("visible-preview-priority", preloadStarted, { ids: visibleIds });
    void residency.setCollection(next, selected, visibleIds).then(() => {
      if (revision !== collectionRevision) return;
      recordLoadingTime("bounded-preload-complete", preloadStarted, { residency: residency.snapshot() });
      void saveLoadingProfile("bounded-preload-complete");
      window.setTimeout(() => {
        if (revision === collectionRevision) void saveLoadingProfile("steady-state");
      }, 10000);
    });
    drag = null;
    $("autoplay").checked = false;
    for (const [id, model] of modelById) model.visible = activeIds.includes(id);
    picker.refresh(ids);
    rail.style.setProperty("--systems-shown", Math.max(1, next.length));
    renderRail(true);
    updateSelection(selected);
    if (persist) saveDraft();
    updateRailTypeControls();
    centerSelectedRail(selected, false);
    if (revision !== collectionRevision) return;
    status(
      "collection-status",
      native ? `${next.length} systems with games · ${librarySummary?.totalGames ?? 0} indexed game entries${librarySummary?.warnings.length ? " · some folders could not be read" : ""}.` : `${next.length} systems enabled. Changes also save in your layout draft.`,
    );
    $("loading").hidden = true;
    ensureSelectedModel();
  }
  function ensureModel(platform) {
    return platform ? residency.ensure(platform.id) : Promise.resolve(null);
  }
  function visibleConsolePreviews(collection, index) {
    camera.updateMatrixWorld();
    homeContent.updateWorldMatrix(true, false);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const bounds = new THREE.Sphere(new THREE.Vector3(), 1.5);
    const visible = collection.filter((_, i) => {
      if (i === index) return true;
      orbitPosition(slotAngle(i, index, collection.length), layout.orbit, bounds.center, camera.quaternion);
      homeContent.localToWorld(bounds.center);
      return frustum.intersectsSphere(bounds);
    });
    return [collection[index], ...visible].filter(Boolean).map(platform => platform.id);
  }
  function ensureSelectedModel() {
    void residency.reprioritize(selected, visibleConsolePreviews(activePlatforms, selected));
    const platform = activePlatforms[selected];
    if (!platform) { dismissStartupSplash(); return; }
    if (!modelById.has(platform.id)) $("model-load-status").textContent = "Loading selected system…";
    void ensureModel(platform).finally(() => {
      if (activePlatforms[selected]?.id === platform.id) $("model-load-status").textContent = modelStatusForId(platform.id);
      dismissStartupSplash();
    });
  }
  requestSelectedModel = ensureSelectedModel;
  const eligiblePlatforms = () => native ? platforms.filter(p => (librarySummary?.platformCounts[p.id] ?? 0) > 0) : platforms;
  window.addEventListener("totem:platform-renamed", (event) => {
    const index = platforms.findIndex((p) => p.id === event.detail.id);
    if (index >= 0) platforms[index] = event.detail;
    void syncCollection(enabledPlatformIds, activePlatforms[selected]?.id, false).catch(showError);
  });
  window.addEventListener("totem:library-rescanned", (event) => {
    librarySummary = event.detail;
    picker.setCatalogue(eligiblePlatforms());
    void syncCollection(enabledPlatformIds, activePlatforms[selected]?.id, false).catch(showError);
  });
  const picker = mountSystemPicker(eligiblePlatforms(), enabledPlatformIds, (ids) => {
    syncCollection(ids).catch((error) =>
      showError(`Could not prepare systems: ${error.message}`),
    );
  });
  const editor = mountPlatformEditor(
    platformStore,
    () => platforms,
    async (saved) => {
      const index = platforms.findIndex((p) => p.id === saved.id);
      if (index >= 0) platforms[index] = saved;
      else platforms.push(saved);
      void residency.invalidate(saved.id, saved);
      picker.setCatalogue(eligiblePlatforms());
      await syncCollection(enabledPlatformIds, activePlatforms[selected]?.id);
    },
    async (id) => {
      if (folderSettings.isOpen()) $("folder-close").click();
      if (folderSettings.isOpen()) return;
      const ids = enabledPlatformIds.includes(id)
        ? enabledPlatformIds
        : [...enabledPlatformIds, id];
      await syncCollection(ids, id);
    },
  );
  const mapping = mountControllerMapping({
    native,
    getPlatforms: () => platforms,
    reducedMotion: () => reduceMotion,
  });
  const railVisibility = $("editor-rail-visibility");
  let editorPlatformId;
  function refreshEditorVisibility() {
    const platform = platforms.find(record => record.id === editorPlatformId);
    const count = librarySummary?.platformCounts?.[editorPlatformId] ?? 0;
    $("editor-platform-summary").textContent = platform
      ? [platform.year, native && librarySummary ? `${count.toLocaleString()} indexed games` : null].filter(Boolean).join(" · ")
      : "";
    railVisibility.hidden = !platform || (native && (!librarySummary || !count));
    railVisibility.setAttribute("aria-pressed", String(enabledPlatformIds.includes(editorPlatformId)));
  }
  $("platform-editor").addEventListener("totem:platform-context", ({ detail }) => {
    editorPlatformId = detail.id;
    refreshEditorVisibility();
  });
  railVisibility.addEventListener("click", async () => {
    const id = editorPlatformId;
    const ids = enabledPlatformIds.includes(id) ? enabledPlatformIds.filter(value => value !== id) : [...enabledPlatformIds, id];
    railVisibility.disabled = true;
    try {
      await syncCollection(ids, activePlatforms[selected]?.id);
      $("editor-status").textContent = "Carousel visibility updated.";
    } catch (error) {
      $("editor-status").textContent = `Could not update carousel visibility. ${error}`;
    } finally {
      refreshEditorVisibility();
      railVisibility.disabled = false;
    }
  });
  $("mapping-toggle").addEventListener("click", () => {
    $("autoplay").checked = false;
    mapping.open(activePlatforms[selected]?.id ?? platforms[0]?.id);
  });
  $("editor-toggle").addEventListener("click", () => {
    $("autoplay").checked = false;
    editor.open(activePlatforms[selected]?.id);
  });
  $("folder-settings").addEventListener("totem:settings-platform-editor", (event) => {
    const { detail } = event;
    if (!folderSettings.isOpen()) return;
    if (detail.platformId && !platforms.some((platform) => platform.id === detail.platformId)) return;
    if (editor.open(detail.platformId ?? activePlatforms[selected]?.id, detail.tab, $("admin-platforms"), detail.gameId)) {
      event.preventDefault();
      const target = detail.target && $(detail.target);
      if (target) {
        for (let parent = target.parentElement; parent && parent !== $("platform-editor"); parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
      }
      if (target?.getClientRects().length && !target.disabled) target.focus();
      else $("platform-editor").querySelector('[role="tab"][aria-selected="true"]')?.focus();
    }
  });
  $("folder-settings").addEventListener("totem:settings-mapping-editor", ({ detail }) => {
    if (!folderSettings.isOpen() || $("mapping-dialog").open) return;
    void mapping.open(detail ?? activePlatforms[selected]?.id ?? platforms[0]?.id);
  });
  const controls = (layoutControls = mountLayoutControls(
    layout,
    () => {
      $("autoplay").checked = false;
      updatePath();
      saveDraft();
      studioEditor?.setSceneLayout(captureSceneLayout());
    },
    baseline.layout,
    baseline.deviceOverrides,
    baseline.inactiveDeviceOverrides,
    openWhenActive,
  ));
  controls.selectDevice(
    activePlatforms[selected],
    deviceOverrides,
    inactiveDeviceOverrides,
    openWhenActive,
  );
  $("trajectory").addEventListener(
    "change",
    () => (path.visible = $("trajectory").checked),
  );
  $("reset").addEventListener("click", () => {
    Object.assign(layout, structuredClone(baseline.layout));
    deviceOverrides = structuredClone(baseline.deviceOverrides);
    inactiveDeviceOverrides = structuredClone(baseline.inactiveDeviceOverrides);
    openWhenActive = structuredClone(baseline.openWhenActive);
    controls.selectDevice(
      activePlatforms[selected],
      deviceOverrides,
      inactiveDeviceOverrides,
      openWhenActive,
    );
    controls.refresh();
    $("trajectory").checked = path.visible = false;
    $("autoplay").checked = false;
    updatePath();
    navigateTo(
      Math.max(
        0,
        activePlatforms.findIndex((p) => p.id === baseline.selectedPlatform),
      ),
    );
    saveDraft();
    studioEditor?.setSceneLayout(captureSceneLayout());
    status(
      "snapshot-status",
      "Scene reset. Saved snapshot files are unchanged.",
    );
  });
  $("save-snapshot").addEventListener("click", async () => {
    $("save-snapshot").disabled = true;
    $("autoplay").checked = false;
    currentSlot = targetSlot = Math.round(targetSlot);
    updateSelection(
      activePlatforms.length
        ? wrapIndex(targetSlot, activePlatforms.length)
        : -1,
    );
    try {
      const snapshot = makeLayoutSnapshot(
        layout,
        activePlatforms[selected]?.id ?? null,
        captureView(),
        enabledPlatformIds,
        deviceOverrides,
        inactiveDeviceOverrides,
        openWhenActive,
      );
      if (native) {
        const path = await invoke("save_layout_snapshot", { snapshot });
        status("snapshot-status", `Snapshot saved: ${path}`);
      } else {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(snapshot, null, 2)], {
            type: "application/json",
          }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = `horizon-layout-${snapshot.createdAt.replace(/[:.]/g, "-")}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        status(
          "snapshot-status",
          "Snapshot download requested. Keep the JSON file to restore this layout.",
        );
      }
      saveDraft();
    } catch (error) {
      status("snapshot-status", `Could not save snapshot: ${error}`);
    } finally {
      $("save-snapshot").disabled = false;
    }
  });
  $("save-default").hidden = !native;
  $("save-default").addEventListener("click", async () => {
    if (runtimeDraftScene) return;
    if (platformChooserStudio && !studioDraftAutosave) {
      status("snapshot-status", "Turn Autosave on before saving the layout as the default.");
      return;
    }
    $("save-default").disabled = true;
    $("autoplay").checked = false;
    currentSlot = targetSlot = Math.round(targetSlot);
    updateSelection(
      activePlatforms.length
        ? wrapIndex(targetSlot, activePlatforms.length)
        : -1,
    );
    try {
      const snapshot = makeLayoutSnapshot(
        layout,
        activePlatforms[selected]?.id ?? null,
        captureView(),
        enabledPlatformIds,
        deviceOverrides,
        inactiveDeviceOverrides,
        openWhenActive,
      );
      const savedPath = await invoke("save_default_layout", { snapshot });
      Object.assign(layout, snapshot.layout);
      Object.assign(baseline.layout, structuredClone(snapshot.layout));
      for (const target of [
        baseline.deviceOverrides,
        baseline.inactiveDeviceOverrides,
        baseline.openWhenActive,
      ])
        for (const key of Object.keys(target)) delete target[key];
      Object.assign(baseline.deviceOverrides, structuredClone(snapshot.deviceOverrides));
      Object.assign(baseline.inactiveDeviceOverrides, structuredClone(snapshot.inactiveDeviceOverrides));
      Object.assign(baseline.openWhenActive, structuredClone(snapshot.openWhenActive));
      baseline.selectedPlatform = snapshot.selectedPlatform;
      baseline.enabledPlatformIds = [...snapshot.enabledPlatformIds];
      baseline.view = structuredClone(snapshot.view);
      localStorage.setItem(REDUCED_MOTION_KEY, String(reduceMotion));
      localStorage.setItem(POST_PROCESSING_KEY, JSON.stringify(postProcessing));
      localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot));
      localStorage.setItem("horizon.carousel.orbit-ring.v3", "applied");
      status("draft-status", `Saved default layout: ${savedPath.split(/[\\/]/).pop()}`);
      status(
        "snapshot-status",
        "Default saved. It will load at startup and Reset scene will return to it.",
      );
    } catch (error) {
      status("snapshot-status", `Could not save default: ${error}`);
    } finally {
      $("save-default").disabled = false;
    }
  });
  $("load-snapshot").addEventListener("click", () =>
    $("snapshot-file").click(),
  );
  $("snapshot-file").addEventListener("change", async () => {
    if (runtimeDraftScene) return;
    const file = $("snapshot-file").files[0];
    if (!file) return;
    try {
      if (file.size > 65536) throw new Error("Layout file is too large.");
      const snapshot = parseLayoutSnapshot(
        await file.text(),
        platforms.map((p) => p.id),
      );
      Object.assign(layout, snapshot.layout);
      deviceOverrides = snapshot.deviceOverrides;
      inactiveDeviceOverrides = snapshot.inactiveDeviceOverrides;
      openWhenActive = snapshot.openWhenActive;
      restoreViewSettings(snapshot.view);
      $("reduced-motion").checked = reduceMotion;
      syncPostProcessingControls();
      controls.selectDevice(
        activePlatforms[selected],
        deviceOverrides,
        inactiveDeviceOverrides,
        openWhenActive,
      );
      controls.refresh();
      $("autoplay").checked = false;
      await syncCollection(
        snapshot.enabledPlatformIds,
        snapshot.selectedPlatform,
      );
      updatePath();
      saveDraft();
      studioEditor?.setSceneLayout(captureSceneLayout());
      status("snapshot-status", `Loaded ${file.name}.`);
    } catch (error) {
      status("snapshot-status", `Layout unchanged: ${error.message}`);
    } finally {
      $("snapshot-file").value = "";
    }
  });
  $("reduced-motion").addEventListener("change", () => {
    reduceMotion = $("reduced-motion").checked;
    persistStudioPreference(REDUCED_MOTION_KEY, reduceMotion);
    if (reduceMotion) $("autoplay").checked = false;
    saveDraft();
  });
  $("autoplay").addEventListener("change", () => {
    if ($("autoplay").checked) {
      reduceMotion = false;
      $("reduced-motion").checked = false;
      persistStudioPreference(REDUCED_MOTION_KEY, "false");
    }
    lastAuto = performance.now();
  });

  function frameHomeCamera(viewport) {
    const savedCamera = studioDocument.pages?.platformChooser?.camera ? platformPage.camera : undefined;
    camera.fov = defaultHomeFov;
    frameCarouselEnvironment(camera, host.getBoundingClientRect(), viewport, homeContent.position.y,
      sceneTools ? undefined : savedCamera);
    sceneTools?.applyCameraSettings(savedCamera);
    sceneTools?.syncProjection();
  }

  function resize() {
    const viewport = $("app").getBoundingClientRect();
    const { width, height } = viewport;
    renderer.setSize(width, height);
    composer.setSize(width, height);
    sharedStage.resize(width, height);
    frameHomeCamera(viewport);
    alignPlatformPole();
    updatePath();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  if (platformChooserStudio) {
    const [{ mountPlatformChooserStudio }, { createPlatformSceneTools }] = await Promise.all([
      import('./platform-chooser-studio.js'), import('./platform-scene-tools.js'),
    ]);
    sceneTools = createPlatformSceneTools({ scene, camera, host: $("app"), lights: environment.platformLightObjects,
      activeModel: () => modelById.get(activePlatforms[selected]?.id) });
    sceneTools.onSceneClick = pick;
    studioEditor = mountPlatformChooserStudio({initialDocument:studioDocument,depthOfField:postProcessing,native,sceneTools,
      initialSceneLayout: captureSceneLayout(),
      restoreSceneLayout(settings) {
        applySceneLayout(settings);
        layoutControls.selectDevice(activePlatforms[selected], deviceOverrides, inactiveDeviceOverrides, openWhenActive);
        updatePath();
      },
      poleObject: () => platformPole?.root,
      onAutosaveChange:setStudioDraftAutosave,saveExtra:saveStudioDraft,onDocument(next){
      studioDocument=next;
      postProcessing={...postProcessing,...platformChooserSettings(next,postProcessing).depthOfField};
      sceneTools.applyCameraSettings(platformChooserSettings(next,postProcessing).camera);
      applyPlatformChooserElements(next);
      updatePlatformNav(next);
      syncPlatformPole(platformPage.pole);
      environment.apply(resolveStudioEnvironment(next), platformPage.lights);
      environment.gameplayBackdrop.apply(next.gameplayBackdrop);
    }});
  }
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  function pick(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, sceneTools?.camera ?? camera);
    const roots = activePlatforms
      .map((p) => modelById.get(p.id))
      .filter(Boolean);
    const pole = platformPole?.root;
    const mascot = sceneTools && homeContent.children.find(root => root.userData.isTotemMascot);
    const backdrop = environment.gameplayBackdrop.mesh;
    const scenery = [environment.floor, environment.backdrop, backdrop];
    const targets = new Set(sceneTools ? [...roots, pole, mascot, ...scenery].filter(Boolean) : roots);
    for (const hit of raycaster.intersectObjects([...targets].filter(root => root.visible), true)) {
      let root = hit.object;
      while (root?.visible && !targets.has(root)) root = root.parent;
      if (!root?.visible) continue;
      if (sceneTools && root === pole) return sceneTools.onObjectPick?.("pole");
      if (sceneTools && root === mascot) return sceneTools.onObjectPick?.("mascot");
      if (sceneTools && scenery.includes(root)) return sceneTools.onObjectPick?.(root === backdrop ? "video" : "scene");
      const index = activePlatforms.findIndex(p => p.id === root.userData.platformId);
      if (index < 0) continue;
      navigateTo(index);
      sceneTools?.onObjectPick?.("device");
      return;
    }
    sceneTools?.onObjectPick?.(null);
  }
  let drag = null;
  host.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || gameLibrary.isOpen() || (!activePlatforms.length && !sceneTools))
      return;
    $("autoplay").checked = false;
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      slot: targetSlot,
      moved: false,
    };
    host.setPointerCapture(e.pointerId);
  });
  host.addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 6) drag.moved = true;
    if (drag.moved && activePlatforms.length) {
      targetSlot = drag.slot - dx / 180;
      updateSelection(
        wrapIndex(Math.round(targetSlot), activePlatforms.length),
      );
    }
  });
  function finishCarouselDrag(e) {
    if (!drag || drag.id !== e.pointerId) return;
    const moved = drag.moved;
    targetSlot = Math.round(targetSlot);
    drag = null;
    if (host.hasPointerCapture(e.pointerId))
      host.releasePointerCapture(e.pointerId);
    if (moved) requestSelectedModel();
    else if (e.type === "pointerup") pick(e);
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    host.addEventListener(type, finishCarouselDrag);
  let lastWheel = 0;
  host.addEventListener(
    "wheel",
    (e) => {
      if (gameLibrary.isOpen()) return;
      e.preventDefault();
      if (
        performance.now() - lastWheel > 240 &&
        Math.abs(e.deltaX) + Math.abs(e.deltaY) > 4
      ) {
        navigate(
          Math.sign(
            Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY,
          ),
        );
        lastWheel = performance.now();
      }
    },
    { passive: false },
  );
  let lastRailWheel = 0;
  rail.addEventListener("wheel", (e) => {
    if (gameLibrary.isOpen()) return;
    e.preventDefault();
    if (
      performance.now() - lastRailWheel > 240 &&
      Math.abs(e.deltaX) + Math.abs(e.deltaY) > 4
    ) {
      navigate(Math.sign(Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY));
      lastRailWheel = performance.now();
    }
  }, { passive: false });
  let initialCollectionReady = false;
  let startupFramePending = false;
  function canPresentStartupFrame() {
    return document.hasFocus() && !document.hidden && !document.querySelector("dialog[open]");
  }
  function checkStartupFrame() {
    if (!initialCollectionReady || !startupNeedsChooserFrame() || startupFramePending || !canPresentStartupFrame()) return;
    const platform = activePlatforms[selected];
    const model = modelById.get(platform?.id);
    if (platform && (!model?.visible || (model.userData.isPlaceholder && !(platform.usePlaceholder && model.userData.detailTier)))) {
      if (residency.snapshot().failures.some(failure => failure.id === platform.id && failure.tier === "preview")) {
        failStartup(new Error("The selected system model could not be loaded: " + platform.name + "."));
      }
      return;
    }
    if (!platform && (activePlatforms.length || (native && !librarySummary))) return;
    if (model && model.userData.reveal < 0.8) return;
    const gl = renderer.getContext();
    if (gl.isContextLost()) {
      failStartup(new Error("The graphics context was lost before the carousel could render."));
      return;
    }
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) {
      failStartup(new Error("The graphics system could not track the first carousel frame."));
      return;
    }
    gl.flush();
    startupFramePending = true;
    function checkPresentedFrame() {
      const unchanged = activePlatforms[selected] === platform && modelById.get(platform?.id) === model;
      if (!startupNeedsChooserFrame() || !unchanged || !canPresentStartupFrame()) {
        gl.deleteSync(fence);
        startupFramePending = false;
        return;
      }
      const result = gl.clientWaitSync(fence, 0, 0);
      if (result === gl.TIMEOUT_EXPIRED) {
        requestAnimationFrame(checkPresentedFrame);
        return;
      }
      gl.deleteSync(fence);
      if (result === gl.WAIT_FAILED) {
        failStartup(new Error("The graphics system could not complete the first carousel frame."));
        return;
      }
      void revealStartupChooser({
        platform: platform?.id ?? null,
        frame: platform ? model.userData.detailTier : librarySummary?.totalGames ? "empty-collection" : "empty-library",
        gpuCompleted: true,
        focused: document.hasFocus(),
      }).then(success => {
        if (success) void saveLoadingProfile("startup-chooser-handoff");
      });
    }
    requestAnimationFrame(checkPresentedFrame);
  }
  let lastFrame = performance.now(),
    lastAuto = performance.now(),
    lastPad = 0,
    lastRailPad = 0;
  let heldPadButtons = new Set();
  let settingsPadNeedsRelease = false;
  const disarmSettingsPad = () => { settingsPadNeedsRelease = true; };
  window.addEventListener("blur", disarmSettingsPad);
  document.addEventListener("visibilitychange", () => { if (document.hidden) disarmSettingsPad(); });
  lastUserInputAt = performance.now();
  const animateFrame = (now) => {
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    const inChooser = sharedStage.update(now, dt);
    sceneTools?.setActive(!inChooser);
    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    const previouslyHeld = heldPadButtons;
    heldPadButtons = pressedControllerInputs(pad);
    const startupBlocksInput = startupBlocksController(heldPadButtons);
    if (startupBlocksInput) heldPadButtons.clear();
    if ((emulatorExitInput.active && !document.hasFocus()) || emulatorExitInput.needsRelease) {
      if (document.hasFocus() && !heldPadButtons.size) emulatorExitInput.needsRelease = false;
      heldPadButtons = new Set();
    }
    if (heldPadButtons.size) lastUserInputAt = now;
    if ([...heldPadButtons].some(input => !previouslyHeld.has(input))) useInputMode("xbox");
    const alphabetInput = alphabetJump.poll(now, heldPadButtons, previouslyHeld,
      Boolean(pad && document.hasFocus() && !document.hidden && !inChooser && !busy && !loadingBenchmarkActive &&
        !emulatorExitInput.needsRelease && navigationMenu.hidden && $("settings").hidden && $("system-picker").hidden &&
        !document.body.classList.contains("studio-platform-chooser") && !filtersPopup.isOpen() &&
        !gameLibrary.isOpen() && !document.querySelector("dialog[open]")),
      input => appControllerAction("platform", input));
    if (alphabetInput) $("autoplay").checked = false;
    scenePass.camera = sharedStage.camera;
    if (inChooser) {
      foreground.hide();
      stopConsoleDemos();
      updateGameplayBackdrop(sharedStage.activeView.gameplayTexture?.());
      resetFrameTiming();
      const effects = sharedStage.activeView.depthOfField?.() ?? {enabled:false};
      depthEffect.update(effects,sharedStage.camera,effects.focus);
      if (!document.hidden) {
        const sampleGpu = sharedStage.activeView.cinematicGpu?.();
        if (sampleGpu) gpuTimer.begin(sampleGpu);
        try { composer.render(); }
        finally { if (sampleGpu) gpuTimer.end(); }
      }
      return;
    }
    if (filtersPopup.isOpen()) {
      lastAuto = now;
      for (const input of heldPadButtons) {
        if (previouslyHeld.has(input)) continue;
        filtersPopup.controller(input, appControllerAction("platform", input));
        break;
      }
      if (!document.hidden) renderPlatform();
      return;
    }
    if (folderSettings.isOpen()) {
      foreground.hide();
      stopConsoleDemos();
      updateGameplayBackdrop(null);
      resetFrameTiming();
      lastAuto = now;
      if (!document.hasFocus() || document.hidden) {
        settingsPadNeedsRelease = true;
        return;
      }
      if (settingsPadNeedsRelease) {
        if (!heldPadButtons.size) settingsPadNeedsRelease = false;
        return;
      }
      for (const input of heldPadButtons) {
        if (previouslyHeld.has(input)) continue;
        $("folder-settings").dispatchEvent(new CustomEvent("totem:settings-controller", { detail: input, cancelable: true }));
        break;
      }
      return;
    }
    const idleRotationAllowed = !startupBlocksInput && !loadingBenchmarkActive && !document.hidden &&
      !gameLibrary.isOpen() && !filtersPopup.isOpen() && !folderSettings.isOpen() &&
      !$('platform-editor').open && !$('mapping-dialog').open &&
      $('system-picker').hidden && $('navigation-menu').hidden &&
      !document.querySelector('dialog[open]');
    if (idleRotationAllowed && !$("autoplay").checked && activePlatforms.length > 1 &&
        now - lastUserInputAt >= 20_000) {
      const alternative = Math.floor(Math.random() * (activePlatforms.length - 1));
      const nextIndex = alternative >= selected ? alternative + 1 : alternative;
      lastUserInputAt = now;
      navigateTo(nextIndex);
    }
    if (
      !startupBlocksInput && !loadingBenchmarkActive && $("autoplay").checked &&
      !document.hidden &&
      !gameLibrary.isOpen() &&
      navigationMenu.hidden &&
      !$("platform-editor").open &&
      !$("mapping-dialog").open &&
      now - lastAuto > 3200
    ) {
      navigate(1, false);
      lastAuto = now;
    }
    let deferredPlatformAction;
    if (!navigationMenu.hidden) {
      lastAuto = now;
      if (document.hasFocus()) {
        for (const input of heldPadButtons) {
          if (!previouslyHeld.has(input) && handleNavigationController(input)) break;
        }
      }
    } else if (
      pad && !alphabetInput && !loadingBenchmarkActive && !gameLibrary.isOpen() &&
      !document.body.classList.contains("studio-platform-chooser") &&
      !$("platform-editor").open && !$("mapping-dialog").open &&
      $("settings").hidden
    ) {
      for (const input of heldPadButtons) {
        const action = appControllerAction("platform", input);
        if (["none", "previous-letter", "next-letter"].includes(action) || (!$("system-picker").hidden && action !== "filters" && action !== "escape")) continue;
        const filter = action === "previous-filter" || action === "next-filter";
        const rotate = ["previous", "next", "previous-platform", "next-platform"].includes(action);
        if (previouslyHeld.has(input) &&
            !(filter && now - lastRailPad > 300) &&
            !(rotate && now - lastPad > 220)) continue;
        if (Object.hasOwn(platformActions, action)) {
          // Submit the new carousel pose in the same frame as the input.
          if (rotate) platformActions[action]();
          else deferredPlatformAction = platformActions[action];
        }
        if (filter) lastRailPad = now;
        if (rotate) lastPad = now;
        break;
      }
    }
    currentSlot = reduceMotion
      ? targetSlot
      : THREE.MathUtils.damp(currentSlot, targetSlot, 7, dt);
    activePlatforms.forEach((platform, i) => {
      const model = modelById.get(platform.id);
      if (!model) return;
      const targetAngle = slotAngle(i, currentSlot, activePlatforms.length);
      const previous = model.userData.orbitAngle ?? targetAngle;
      const a = reduceMotion
        ? targetAngle
        : THREE.MathUtils.damp(
            previous,
            nearbyAngle(previous, targetAngle),
            10,
            dt,
          );
      model.userData.orbitAngle = a;
      model.userData.reveal = reduceMotion
        ? 1
        : THREE.MathUtils.damp(model.userData.reveal ?? 0, 1, 9, dt);
      orbitPosition(a, layout.orbit, model.position, camera.quaternion);
      orbitOrientation(a, camera.quaternion, model.quaternion);
      const focus = consoleFocusAmount(a, activePlatforms.length) * model.userData.reveal;
      const restingControls = (model.userData.restingControls ??= {});
      for (const key of RESTING_CONTROL_KEYS)
        restingControls[key] = THREE.MathUtils.lerp(
          layout.inactive[key],
          layout.consoles[key],
          focus,
        );
      applyConsoleControls(
        model,
        restingControls,
        camera.quaternion,
        THREE.MathUtils.lerp(0.35, 1.5, focus),
      );
      const activeOverride = deviceOverrides[platform.id] ?? NEUTRAL_DEVICE_CONTROLS;
      const inactiveOverride = inactiveDeviceOverrides[platform.id] ?? NEUTRAL_DEVICE_CONTROLS;
      const movingOverride = (model.userData.movingOverride ??= {});
      for (const key of RESTING_CONTROL_KEYS)
        movingOverride[key] = THREE.MathUtils.lerp(
          inactiveOverride[key],
          activeOverride[key],
          focus,
        );
      applyDeviceControls(model, movingOverride, camera.quaternion);
      const topLoading = model.userData.topLoading === true;
      const opens = openWhenActive[platform.id] ?? (topLoading || supportsDynamicHinge(platform));
      const transition = (model.userData.animationTransition ??= {
        open: false,
        pending: null,
        pendingSince: 0,
        progress: 0,
      });
      const stagedTracks = model.userData.animationTracks?.filter((track) =>
        track.settings.spinRate || track.settings.translation,
      ) ?? [];
      const animationStart = topLoading ? 0.78 : platform.id === "switch" ? 0.9 : stagedTracks.length
        ? Math.min(...stagedTracks.map((track) => track.settings.startProgress ?? 0))
        : 0.5;
      const activity = model.userData.consoleActivity;
      const loadingCard = platform.id === "3ds" && activity?.rearCartridge &&
        activity.elapsed < REAR_CARTRIDGE_SEATED_PROGRESS && !reduceMotion;
      const wantsOpen = opens && focus >= animationStart && !loadingCard;
      if (wantsOpen !== transition.open) {
        if (transition.pending !== wantsOpen) {
          transition.pending = wantsOpen;
          transition.pendingSince = now;
        } else if (now - transition.pendingSince >= (topLoading ? 0 : platform.modelAnimations?.transitionDelayMs ?? 100)) {
          transition.open = wantsOpen;
          transition.pending = null;
        }
      } else {
        transition.pending = null;
      }
      const targetProgress = transition.open ? (topLoading || platform.id === "switch" ? 1 : focus) : 0;
      transition.progress = reduceMotion
        ? targetProgress
        : topLoading
          ? transition.progress + Math.sign(targetProgress - transition.progress) * Math.min(
            dt / (platform.id === "dreamcast" && targetProgress > transition.progress ? DREAMCAST_CLOSE_SECONDS : 2.2),
            Math.abs(targetProgress - transition.progress),
          )
          : THREE.MathUtils.damp(transition.progress, targetProgress, 3.5, dt);
      if (model.userData.animationTracks?.length) {
        const animationProgress = model.userData.closeWhenActive
          ? 1 - transition.progress
          : transition.progress;
        setModelAnimationProgress(model, animationProgress, null, reduceMotion ? 0 : dt, i === selected && !document.hidden);
      } else if (model.userData.hingePivot) {
        model.userData.hingePivot.rotation.x =
          Math.PI * 0.5 * (1 - transition.progress);
      }
      const active = !startupOwnsSplash() && i === selected && (platform.id !== "amiga500" || !document.hidden);
      setModelActivity(model, active, dt, reduceMotion ? (active ? 1 : 0) : focus, reduceMotion, camera);
    });
    const selectedModel = modelById.get(activePlatforms[selected]?.id);
    const frame = showcaseBackdropFrame(selectedModel);
    updateGameplayBackdrop(frame?.texture, frame?.brightness);
    focusDepthOfFieldOn(selectedModel);
    environment.focusPlatform(selectedModel, selectedModel &&
      consoleFocusAmount(selectedModel.userData.orbitAngle, activePlatforms.length) * selectedModel.userData.reveal);
    sceneTools?.update();
    const controllerStatus = pad ? "CONTROLLER CONNECTED" : "CONTROLLER READY";
    if ($("controller").textContent !== controllerStatus)
      $("controller").textContent = controllerStatus;
    deferredPlatformAction?.();
    if (!document.hidden && !$("mapping-dialog").open) {
      const renderStartedAt = performance.now();
      const timing = selectionTiming;
      const tier = modelById.get(timing?.platform)?.userData.detailTier;
      const detailed = timing && tier === "display" && !timing.detailed;
      gpuTimer.begin(detailed ? () => {
        recordLoadingTime("selection-detailed-gpu-observed", timing.start, timing.details);
      } : undefined);
      try {
        renderPlatform();
        checkStartupFrame();
      } finally { gpuTimer.end(); }
      if (timing && !timing.responded) {
        timing.responded = true;
        recordLoadingTime("selection-first-frame-submitted", timing.start, { ...timing.details, tier });
      }
      if (detailed) {
        timing.detailed = true;
        recordLoadingTime("selection-detailed-frame-submitted", timing.start, timing.details);
      }
      recordFrameTiming(now, performance.now() - renderStartedAt);
      if (!firstSelectedFrameRecorded && modelById.has(activePlatforms[selected]?.id)) {
        firstSelectedFrameRecorded = true;
        recordLoadingTime("first-selected-model-frame-submitted", 0);
        void saveLoadingProfile("first-selected-frame");
      }
      if (!firstDisplayFrameRecorded && modelById.get(activePlatforms[selected]?.id)?.userData.detailTier === "display") {
        firstDisplayFrameRecorded = true;
        recordLoadingTime("first-selected-display-frame-submitted", 0);
      }
    } else resetFrameTiming();
  };
  sharedStage.setCinematicSuspended = (suspended) => {
    if (suspended) {
      foreground.hide();
      renderer.domElement.style.visibility = "hidden";
      renderer.setAnimationLoop(null);
      return;
    }
    lastFrame = performance.now();
    return new Promise(presented => {
      renderer.setAnimationLoop(now => {
        animateFrame(now);
        if (document.hidden) return;
        // Reveal the canvas after it has rendered the return view.
        renderer.domElement.style.visibility = "";
        renderer.setAnimationLoop(animateFrame);
        presented();
      });
    });
  };
  renderer.setAnimationLoop(now => {
    if (!startupOwnsSplash()) {
      renderer.setAnimationLoop(animateFrame);
      animateFrame(now);
      return;
    }
    try { animateFrame(now); }
    catch (error) {
      renderer.setAnimationLoop(null);
      if (!failStartup(error)) throw error;
    }
  });
  await syncCollection(enabledPlatformIds, initialSelectedId, false);
  initialCollectionReady = true;
  if (orbitSettingsUpdated) {
    saveDraft();
    localStorage.setItem("horizon.carousel.orbit-ring.v3", "applied");
  }
  void gameLibrary.warmShell();
  if (libraryError) showError(libraryError);
  let libraryRefresh = Promise.resolve();
  if (native) {
    if (!librarySummary) {
      $("loading").textContent = "Checking your game library in the background…";
      $("loading").hidden = false;
    }
    libraryRefresh = timeLoading("library-scan-including-cache-write", () => library.scan(platforms)).then(async (summary) => {
      loadingProfile.libraryScan = summary;
      await waitForStartupHandoffIfReady();
      librarySummary = summary;
      window.dispatchEvent(new CustomEvent("totem:library-index-ready", { detail: summary }));
      picker.setCatalogue(eligiblePlatforms());
      const ids = hasPersistedLayout
        ? enabledPlatformIds
        : discoveredPlatformIds(platforms, summary.platformCounts ?? {});
      await syncCollection(ids, activePlatforms[selected]?.id ?? initialSelectedId, false);
    }).catch((error) => {
      libraryError = `Library scan failed: ${error}. Check the folders in Settings.`;
      if (!librarySummary) {
        if (!failStartup(new Error(libraryError))) showError(libraryError);
      } else $("collection-status").textContent = `Showing saved library; refresh failed: ${error}`;
    }).finally(() => saveLoadingProfile("library-refresh-complete"));
  }
  if (benchmarkConfig) {
    void (async () => {
      await Promise.race([libraryRefresh, new Promise((_, reject) => window.setTimeout(() => reject(Error("Library benchmark timeout")), 60000))]);
      if (!loadingProfile.libraryScan || libraryError) throw Error(libraryError || "Native library scan did not complete");
      const originalIds = [...enabledPlatformIds], originalSelected = activePlatforms[selected]?.id;
      const originalCollection = [...activePlatforms];
      const { runLoadingBenchmark } = await import("./loading-benchmark.js");
      await runLoadingBenchmark({
        config: benchmarkConfig, residency, profile: loadingProfile, save: saveLoadingProfile,
        finish: () => invoke("finish_loading_benchmark"), navigate, navigateTo,
        selectedId: () => activePlatforms[selected]?.id, collection: originalCollection, collectionSize: () => activePlatforms.length,
        filter: () => syncCollection(originalIds.slice(0, 5), originalSelected, false),
        restore: () => syncCollection(originalIds, originalSelected, false),
        invalidate: () => {
          const platform = activePlatforms[selected];
          return residency.invalidate(platform.id, { ...platform });
        },
      });
    })().catch(async error => {
      loadingProfile.benchmark = { completed: false, error: String(error) };
      try { await Promise.race([saveLoadingProfile("benchmark-failed"), new Promise(resolve => window.setTimeout(resolve, 5000))]); }
      finally { await Promise.race([invoke("finish_loading_benchmark"), new Promise(resolve => window.setTimeout(resolve, 5000))]); }
    });
  }
  if (native && !activePlatforms.length && librarySummary) {
    writePlatformText($("tagline"), "No games found. Check your game folders and supported extensions in Settings, then restart Totem.");
  }
}

function updatePlatformEmulators(platform) {
  const associatedEmulators = savedEmulators.filter((emulator) => emulator.platforms.includes(platform?.id));
  renderPlatformEmulatorSummary($("platform-emulators"), associatedEmulators, emulatorAvailability);
}
function updateSelection(index, railDirection = 0) {
  if (index !== selected) selectionTiming = null;
  selected = index;
  refreshPlatformNav();
  const p = activePlatforms[index];
  layoutControls?.selectDevice(
    p,
    deviceOverrides,
    inactiveDeviceOverrides,
    openWhenActive,
  );
  document.documentElement.style.setProperty("--accent", p?.color ?? "#77d9ff");
  writePlatformText($("title"), p?.name ?? (native ? "No games found" : "No systems enabled"));
  writePlatformText($("tagline"), p?.tagline ?? "Open Systems and check the devices you want to show.");
  $("model-load-status").textContent = p ? modelStatusForId(p.id) : "";
  writePlatformText($("maker"), p?.maker || "—");
  updatePlatformEmulators(p);
  const bundledLogoPath = bundledLogo(p);
  const logoKey = p?.logoFile?.id ?? bundledLogoPath;
  const logoAlt = p ? `${p.name} logo` : "";
  if (logoKey !== heroLogoKey) {
    heroLogoKey = logoKey;
    const logoToken = ++logoRevision;
    void setPlatformLogo(null);
    if (heroLogoUrl) URL.revokeObjectURL(heroLogoUrl);
    heroLogoUrl = null;
    if (p?.logoFile)
      platformStore
        .logoUrl(p.logoFile)
        .then(async (url) => {
          if (logoToken !== logoRevision) {
            URL.revokeObjectURL(url);
            return;
          }
          heroLogoUrl = url;
          await setPlatformLogo(url, logoAlt);
          if (logoToken === logoRevision && $("platform-logo").hidden && bundledLogoPath)
            await setPlatformLogo(bundledLogoPath, logoAlt);
        })
        .catch((error) => {
          if (logoToken !== logoRevision) return;
          $("announcement").textContent =
            `Logo unavailable for ${p.name}: ${error.message ?? error}`;
          if (bundledLogoPath) void setPlatformLogo(bundledLogoPath, logoAlt);
        });
    else if (bundledLogoPath) void setPlatformLogo(bundledLogoPath, logoAlt);
  }
  $("platform-logo").alt = logoAlt;
  writePlatformText($("year"), p?.year || "—");
  writePlatformText($("platform-category"), p?.kind || "—");
  const gameCount = librarySummary?.platformCounts?.[p?.id] ?? 0;
  writePlatformText($("game-count"), librarySummary ? gameCount.toLocaleString() : "—");
  $("metadata").hidden = !p;
  $("previous").disabled = $("next").disabled = activePlatforms.length < 2;
  $("select").disabled = !p || busy;
  document
    .querySelectorAll(".system:not([data-rail-copy])")
    .forEach((button) =>
      button.setAttribute(
        "aria-current",
        String(button.dataset.platform === p?.id),
      ),
    );
  centerSelectedRail(index, true, railDirection);
  $("announcement").textContent = p
    ? `${p.name}, ${index + 1} of ${activePlatforms.length}`
    : "No systems enabled. Use the system checklist to add devices.";
}
function navigateTo(index) {
  if (index < 0 || index >= activePlatforms.length) return;
  const started = performance.now();
  targetSlot = nearestSlot(
    Math.round(targetSlot),
    index,
    activePlatforms.length,
  );
  $("autoplay").checked = false;
  updateSelection(index);
  recordNavigation(started);
  requestSelectedModel();
}
function navigate(direction, manual = true) {
  if (activePlatforms.length < 2) return;
  const started = performance.now();
  if (manual) $("autoplay").checked = false;
  targetSlot = Math.round(targetSlot) + direction;
  updateSelection(wrapIndex(targetSlot, activePlatforms.length), direction);
  recordNavigation(started);
  requestSelectedModel();
}
function recordNavigation(start) {
  const platform = activePlatforms[selected]?.id;
  if (!platform || gameLibrary.isOpen()) return;
  const details = { platform, selection: ++selectionSequence };
  selectionTiming = { platform, start, details, responded: false, detailed: false };
  recordLoadingTime("selection-state-updated", start, details);
}
async function choose(direction = 0, action) {
  if (busy || !activePlatforms[selected]) return;
  if (direction && (activePlatforms.length < 2 || !gameLibrary.isOpen())) return;
  busy = true;
  $("select").disabled = true;
  $("autoplay").checked = false;
  const index = direction ? wrapIndex(selected + direction, activePlatforms.length) : selected;
  const platform = activePlatforms[index];
  try {
    const chosen = native
      ? await invoke("select_platform", { id: platform.id })
      : platform;
    if (direction && !gameLibrary.isOpen()) return;
    window.dispatchEvent(
      new CustomEvent("horizon:platform-selected", { detail: chosen }),
    );
    const opened = await gameLibrary.open(chosen, direction || reduceMotion || document.hidden ? null : await captureLibraryEntrance(platform));
    if (opened && direction) navigateTo(activePlatforms.findIndex(item => item.id === platform.id));
    if (opened && action) gameLibrary.runAction(action);
  } catch (error) {
    if (direction) throw error;
    $("announcement").textContent = `Could not select the system: ${error}`;
    showError(`Selection failed: ${error}`);
  } finally {
    busy = false;
    $("select").disabled = !activePlatforms.length;
  }
}
$("previous").addEventListener("click", () => navigate(-1));
$("next").addEventListener("click", () => navigate(1));
$("select").addEventListener("click", () => choose());
const navigationMenu = $("navigation-menu");
const navigationToggle = $("navigation-toggle");
const fullscreenToggle = $("fullscreen-toggle");
const exitTotem = $("exit-totem");
const desktopWindow = native ? getCurrentWindow() : null;
fullscreenToggle.hidden = !desktopWindow && !document.fullscreenEnabled;
exitTotem.hidden = !desktopWindow;

async function isFullscreen() {
  return desktopWindow ? desktopWindow.isFullscreen() : Boolean(document.fullscreenElement);
}

function updateFullscreenLabel(fullscreen) {
  fullscreenToggle.textContent = fullscreen ? "Exit fullscreen" : "Enter fullscreen";
}

fullscreenToggle.addEventListener("click", async () => {
  try {
    const fullscreen = await isFullscreen();
    if (desktopWindow) await desktopWindow.setFullscreen(!fullscreen);
    else if (fullscreen) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    updateFullscreenLabel(!fullscreen);
  } catch (error) {
    showError("Could not change fullscreen mode.", error, "launcher.fullscreen");
  }
});
exitTotem.addEventListener("click", async () => {
  try {
    await desktopWindow.close();
  } catch (error) {
    showError("Could not close Totem.", error, "launcher.exit");
  }
});

function toggleNavigation(open, restoreFocus = false) {
  navigationMenu.hidden = !open;
  navigationToggle.setAttribute("aria-expanded", String(open));
  navigationToggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
  if (open) {
    moveNavigationFocus("Home");
    if (!fullscreenToggle.hidden) {
      void isFullscreen().then(updateFullscreenLabel)
        .catch(error => showError("Could not read fullscreen mode.", error, "launcher.fullscreen"));
    }
  }
  if (restoreFocus) navigationToggle.focus();
}
navigationToggle.addEventListener("click", () => {
  const open = navigationMenu.hidden;
  toggleNavigation(open, !open);
});
navigationMenu.addEventListener("click", (event) => {
  if (event.target.closest("button")) toggleNavigation(false, true);
}, true);
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".header-actions")) toggleNavigation(false);
});
document.addEventListener("focusin", (event) => {
  if (!event.target.closest(".header-actions")) toggleNavigation(false);
});
function navigationButtons() {
  return [...navigationMenu.querySelectorAll("button:not([hidden]):not(:disabled)")];
}
function moveNavigationFocus(key) {
  const buttons = navigationButtons();
  const current = buttons.indexOf(document.activeElement);
  const index = key === "Home" ? 0 : key === "End" ? buttons.length - 1
    : key === "ArrowUp" ? (current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length)
    : (current + 1) % buttons.length;
  buttons[index]?.focus({ preventScroll: true });
}
function handleNavigationController(input) {
  const action = settingsControllerAction(input);
  if (action === "back" || appControllerAction("platform", input) === "navigation-menu") {
    toggleNavigation(false, true);
  } else if (action === "confirm") {
    const buttons = navigationButtons();
    if (buttons.includes(document.activeElement)) document.activeElement.click();
    else buttons[0]?.focus();
  } else if (action === "up" || action === "down") {
    moveNavigationFocus(action === "up" ? "ArrowUp" : "ArrowDown");
  } else return false;
  return true;
}
document.addEventListener("keydown", (event) => {
  if (navigationMenu.hidden) return;
  if (event.key === "Escape" ||
      (!event.altKey && !event.ctrlKey && !event.metaKey &&
        appKeyboardAction("platform", event.code) === "navigation-menu")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) toggleNavigation(false, true);
  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    moveNavigationFocus(event.key);
  }
});
function toggleSettings(open) {
  if (open) toggleSystems(false, false);
  $("settings").hidden = !open;
  $("settings-toggle").setAttribute("aria-expanded", String(open));
  if (open) {
    $("autoplay").checked = false;
    $("settings-close").focus();
  } else navigationToggle.focus();
}
$("settings-toggle").addEventListener("click", () =>
  toggleSettings($("settings").hidden),
);
$("settings-close").addEventListener("click", () => toggleSettings(false));
function toggleSystems(open, focus = true) {
  $("system-picker").hidden = !open;
  $("systems-toggle").setAttribute("aria-expanded", String(open));
  if (open) {
    $("settings").hidden = true;
    $("settings-toggle").setAttribute("aria-expanded", "false");
    $("autoplay").checked = false;
    $("system-search").focus();
  } else if (focus) navigationToggle.focus();
}
$("systems-toggle").addEventListener("click", () =>
  toggleSystems($("system-picker").hidden),
);
$("systems-close").addEventListener("click", () => toggleSystems(false));
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey ||
      loadingBenchmarkActive || document.body.classList.contains("studio-platform-chooser")) return;
  if (
    folderSettings.isOpen() ||
    gameLibrary.isOpen() ||
    $("platform-editor").open ||
    $("mapping-dialog").open
    || !navigationMenu.hidden || document.querySelector(".platform-filters[open]")
  )
    return;
  if (e.key === "Escape" && !$("system-picker").hidden) {
    toggleSystems(false);
    return;
  }
  if (e.key === "Escape" && !$("settings").hidden) {
    toggleSettings(false);
    return;
  }
  if (
    e.target.closest("input,select,textarea,[contenteditable],.studio-home-panel summary") ||
    !$("settings").hidden ||
    !$("system-picker").hidden
  )
    return;
  if (["Enter", "Space"].includes(e.code) && e.target.closest("button, a, summary")) return;
  const action = appKeyboardAction("platform", e.code);
  if (action === "none") return;
  e.preventDefault();
  if (!e.repeat || ["previous", "next", "previous-platform", "next-platform", "previous-filter", "next-filter"].includes(action)) {
    runPlatformAction(action);
  }
});
window.addEventListener("totem:emulators-changed", () => {
  void refreshEmulatorSettings()
    .then(() => updatePlatformEmulators(activePlatforms[selected]))
    .catch((error) => console.warn("Could not refresh emulator settings for the platform summary", error));
});
start().catch((error) => {
  if (failStartup(error)) return;
  dismissStartupSplash();
  showError("Unable to initialise the carousel. " + error.message, error, "launcher.startup");
});
