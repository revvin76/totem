import { mountGameInformation } from "./game-information.js";
import { installErrorLogging } from "../src/error-log.js";
import { THUMBNAIL_TYPES, normalizeThumbnails } from "./thumbnail-settings.js";
import { selectionRoots, offsetSelection } from "./layout-selection.js";
import { titleArtwork } from "./title-artwork.js";
import { bindDeviceScreen, createDisplayPrimitive, createPlinthPrimitive, DISPLAY_LABELS, prepareArcadeCabinet, prepareTelevision, resolveDisplayType, TV_PLINTH_HEIGHT } from "./scene-display.js";
import { addWiiUGamePadPreview, matchedDualScreenDemo, PRIMARY_PREVIEW, SECONDARY_PREVIEW, setPreviewRegion, uncroppedPreviewUV } from "../src/dual-screen-preview.js";
import { applyConsoleSkin, watchConsoleSkins } from "../src/console-skins.js";
import { studio } from "./studio.js";
import { hasTotemAsset } from "../src/totem-mascot.js";
import { createTotemPole } from "../src/totem-pole.js";
import { actionArtwork, controllerIcon } from "../src/bottom-nav.js";
import { keyboardGlyph } from "../src/keyboard-inputs.js";
import { mountFilterPicker } from "./filter-picker.js";
import { mountCenteredTitleRail } from "../src/centered-title-rail.js";
import { bindStudioPanelResize } from "../src/studio-panel-resize.js";
import { canonicalChooserAction, chooserActions, sideNavButtons, toggleDetailsAction, xboxButtons } from "./chooser-controls.js";
import { appControllerAction, appKeyboardAction, pressedControllerInputs } from "../src/app-controller-mappings.js";
import { mountAlphabetJump } from "../src/alphabet-jump.js";
import "../src/alphabet-jump.css";
import { inputModeEvent, trackInputMode, useInputMode } from "../src/input-mode.js";
import { studioInvoke } from "../src/studio-config.js";
import { readBrowserBundledModel } from "../src/platform-store.js";
import { displayPlatform } from "../src/model-display.js";
import { controllerForPlatform } from "../src/controller-mapping.js";
import { createControllerModel } from "../src/controller-models.js";
import { disposeImported, loadPlatformModel, setModelAnimationProgress, setModelActivity } from "../src/platform-assets.js";
import { createLibraryMedia, libraryAccessoryOptions } from "../src/library-accessories.js";
import { devicePose, libraryDisplay, libraryShowsControllers, libraryShowsMedia } from "../src/library-presentation.js";
import { findScreen } from "../src/game-selection-stage.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { applyGizmo, objectCenter, pickSceneObject, positionGizmo } from "./object-gizmo.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { addSceneAntialiasing } from "../src/scene-antialiasing.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createStudioEnvironment } from "../src/studio-environment.js";
import { createDepthOfField } from "../src/depth-of-field.js";
import { normalizeDepthOfField } from "../src/studio-page-settings.js";
import "../src/platform-filters.css";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import odyssey from "./super-mario-odyssey.json";

import switchModelUrl from "../public/assets/models/switch.glb?url";
import tvModelUrl from "../public/assets/models/flatpanel-tv.glb?url";
import snesControllerUrl from "../public/assets/models/snes-controller.glb?url";
const megaDriveControllerUrl = null;
const masterSystemControllerUrl = null;
import playStation1ControllerUrl from "../public/assets/models/playstation-1-controller.glb?url";
import playStation2ControllerUrl from "../public/assets/models/playstation-2-controller.glb?url";
import playStation4ControllerUrl from "../public/assets/models/playstation-4-controller.glb?url";
const threeDoControllerUrl = null;
const wiiUControllerUrl = null;
const jaguarControllerUrl = null;

installErrorLogging("game-chooser", isTauri() || window.parent !== window
  ? (context, detail) => studioInvoke("record_error", { context, detail })
  : null);

const importedControllerModels = {
  jaguar: { url: jaguarControllerUrl, standalone: true },
  snes: { url: snesControllerUrl, pair: false },
  megadrive: { url: megaDriveControllerUrl, pair: false },
  mastersystem: { url: masterSystemControllerUrl, pair: true },
  playstation: { url: playStation1ControllerUrl, pair: false },
  ps2: { url: playStation2ControllerUrl, pair: false },
  ps4: { url: playStation4ControllerUrl, pair: false },
  "3do": { url: threeDoControllerUrl, pair: false },
  wiiu: { url: wiiUControllerUrl, pair: false, standalone: true },
};

const canvas = document.querySelector("#scene");
const STORE_KEY = "totem.light-study.scene-controls.v1";
const LAYOUT_VERSION = 2;
const SWITCH_PREVIEW_BASELINE_Y = -0.1010825;
const DEFAULT_SETTINGS = {
  lightsEnabled: true, hue: 260, brightness: 1.2, lightReflection: 0.65, consoleReflection: 0.65,
  lightX: 0, lightY: 0, lightZ: 0, reflectionsEnabled: true, autoRotate: false,
  cameraX: 0, cameraY: 5, cameraZ: 31, cameraTilt: 0, cameraPanX: 0, cameraPanY: 9, cameraZoom: 1,
  switchPosition: [15.8, 0, -18], switchRotation: [0, 0, 0], switchScale: [130, 130, 130],
  boxPosition: [-12.5, 0, -18], boxRotation: [0, 0, 0], boxScale: [1, 1, 1],
  displayPosition: [0, 0, -15], displayRotation: [0, 0, 0], displayScale: [1, 1, 1],
  controllerPosition: [17, 0.35, -16], controllerRotation: [0, 0, 0], controllerScale: [1, 1, 1],
  controllersEnabled: true,
  polePosition: [0, 0, -11], poleRotation: [0, 0, 0], poleScale: [5, 5, 5],
  depthOfFieldEnabled: false, depthOfFieldBlur: 0.006,
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const vectorSetting = (value, fallback, min, max) => fallback.map((component, index) => clamp(value?.[index] ?? component, min, max));
const cloneSettings = (value) => structuredClone(value);
function normalizePole(value) {
  return {
    poleEnabled: value.poleEnabled !== false,
    polePosition: vectorSetting(value.polePosition, DEFAULT_SETTINGS.polePosition, -100, 100),
    poleRotation: vectorSetting(value.poleRotation, DEFAULT_SETTINGS.poleRotation, -Math.PI * 4, Math.PI * 4),
    poleScale: vectorSetting(value.poleScale, DEFAULT_SETTINGS.poleScale, .1, 15),
  };
}
function sceneSnapshot() {
  const { poleEnabled, polePosition, poleRotation, poleScale, ...sceneSettings } = settings;
  return {settings:sceneSettings, uiDesign, gameplayBackdrop, pole:{poleEnabled, polePosition, poleRotation, poleScale}};
}
function normalizeSettings(value = {}) {
  const oldDefaultBox = value.boxPosition?.join(",") === "-21,0,-18" && value.boxScale?.join(",") === "1,1,1";
  const displayPosition = vectorSetting(value.displayPosition, DEFAULT_SETTINGS.displayPosition, -100, 100);
  const displayRotation = vectorSetting(value.displayRotation, DEFAULT_SETTINGS.displayRotation, -Math.PI * 4, Math.PI * 4);
  const displayScale = vectorSetting(value.displayScale, DEFAULT_SETTINGS.displayScale, 0.1, 10);
  return {
    lightsEnabled: value.lightsEnabled !== false,
    hue: clamp(value.hue ?? DEFAULT_SETTINGS.hue, 0, 360),
    brightness: clamp(value.brightness ?? DEFAULT_SETTINGS.brightness, 0.3, 2.4),
    lightReflection: clamp(value.lightReflection ?? DEFAULT_SETTINGS.lightReflection, 0, 1),
    consoleReflection: clamp(value.consoleReflection ?? value.reflection ?? DEFAULT_SETTINGS.consoleReflection, 0, 1),
    lightX: clamp(value.lightX ?? 0, -12, 12),
    lightY: clamp(value.lightY ?? 0, -8, 8),
    lightZ: clamp(value.lightZ ?? 0, -15, 15),
    reflectionsEnabled: value.reflectionsEnabled !== false,
    autoRotate: value.autoRotate === true,
    cameraX: clamp(value.cameraX ?? DEFAULT_SETTINGS.cameraX, -35, 35),
    cameraY: clamp(value.cameraY ?? DEFAULT_SETTINGS.cameraY, -20, 35),
    cameraZ: clamp(value.cameraZ ?? DEFAULT_SETTINGS.cameraZ, 5, 65),
    cameraTilt: clamp(value.cameraTilt ?? 0, -25, 25),
    cameraPanX: clamp(value.cameraPanX ?? 0, -30, 30),
    cameraPanY: clamp(value.cameraPanY ?? 9, -10, 25),
    cameraZoom: clamp(value.cameraZoom ?? 1, 0.6, 2.2),
    switchPosition: vectorSetting(value.switchPosition, DEFAULT_SETTINGS.switchPosition, -100, 100),
    switchRotation: vectorSetting(value.switchRotation, DEFAULT_SETTINGS.switchRotation, -Math.PI * 4, Math.PI * 4),
    switchScale: vectorSetting(value.switchScale, DEFAULT_SETTINGS.switchScale, 1, 500),
    boxPosition: vectorSetting(oldDefaultBox ? null : value.boxPosition, DEFAULT_SETTINGS.boxPosition, -100, 100),
    boxRotation: vectorSetting(value.boxRotation, DEFAULT_SETTINGS.boxRotation, -Math.PI * 4, Math.PI * 4),
    boxScale: vectorSetting(oldDefaultBox ? null : value.boxScale, DEFAULT_SETTINGS.boxScale, 0.1, 10),
    displayType: resolveDisplayType(studio.type, value),
    displayPosition, displayRotation, displayScale,
    plinthPosition: vectorSetting(value.plinthPosition, displayPosition, -100, 100),
    plinthRotation: vectorSetting(value.plinthRotation, displayRotation, -Math.PI * 4, Math.PI * 4),
    plinthScale: vectorSetting(value.plinthScale, displayScale, 0.1, 10),
    controllerPosition: vectorSetting(value.controllerPosition, DEFAULT_SETTINGS.controllerPosition, -100, 100),
    controllerRotation: vectorSetting(value.controllerRotation, DEFAULT_SETTINGS.controllerRotation, -Math.PI * 4, Math.PI * 4),
    controllerScale: vectorSetting(value.controllerScale, DEFAULT_SETTINGS.controllerScale, 0.1, 10),
    controllersEnabled: value.controllersEnabled !== false,
    ...normalizePole(value),
    depthOfFieldEnabled: value.depthOfFieldEnabled === true,
    depthOfFieldBlur: normalizeDepthOfField({blur:value.depthOfFieldBlur}).blur,
  };
}
const UI_FONT_FAMILIES = ["Segoe UI", "Arial", "Inter", "Trebuchet MS", "Georgia", "Verdana", "monospace", "system-ui"];
const MAX_CUSTOM_ELEMENTS = 32;
const CUSTOM_ELEMENT_ID = /^custom-[a-z0-9-]{1,50}$/;
const isRailButtonStyle = (id) => id === "game-button-inactive" || id === "game-button-active";
function normalizeUiDesign(value = {}) {
  const elements = {};
  const savedElements = { ...value.elements };
  const oldTitle = savedElements["game-title-main"];
  if (oldTitle && typeof oldTitle === "object") {
    const { hidden, ...titleStyle } = oldTitle;
    const title = savedElements["game-title"] || {};
    savedElements["game-title"] = { ...titleStyle, ...title };
    for (const axis of ["x", "y"]) {
      if (typeof titleStyle[axis] === "number" && typeof title[axis] === "number")
        savedElements["game-title"][axis] = titleStyle[axis] + title[axis];
    }
  }
  for (const [id, raw] of Object.entries(savedElements)) {
    if (["game-title-main", "game-title-prefix", "game-logo"].includes(id)) continue;
    if (id.startsWith("thumbnail-")) continue;
    if (/^game-(mario-kart|metroid|pokemon|hollow-knight|mario-odyssey|celeste|zelda|sonic)$/.test(id)) continue;
    if (!raw || typeof raw !== "object") continue;
    const element = {};
    if (raw.hidden != null) element.hidden = Boolean(raw.hidden);
    for (const key of ["x", "y"]) if (raw[key] != null) element[key] = clamp(raw[key], -3000, 3000);
    if (raw.width != null) element.width = clamp(raw.width, 24, 2400);
    if (raw.height != null) element.height = clamp(raw.height, 20, 1600);
    if (raw.rotation != null) element.rotation = clamp(raw.rotation, -180, 180);
    if (UI_FONT_FAMILIES.includes(raw.fontFamily)) element.fontFamily = raw.fontFamily;
    if (raw.fontSize != null) element.fontSize = clamp(raw.fontSize, 8, 120);
    if ([400, 500, 600, 700, 800, 900].includes(Number(raw.fontWeight))) element.fontWeight = Number(raw.fontWeight);
    if (["left", "center", "right"].includes(raw.textAlign)) element.textAlign = raw.textAlign;
    if (id === "game-title" && ["left", "center", "right"].includes(raw.logoAlign)) element.logoAlign = raw.logoAlign;
    if (typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color)) element.color = raw.color;
    if (typeof raw.background === "string" && /^#[0-9a-f]{6}$/i.test(raw.background)) element.background = raw.background;
    if (typeof raw.borderColor === "string" && /^#[0-9a-f]{6}$/i.test(raw.borderColor)) element.borderColor = raw.borderColor;
    if (raw.opacity != null) element.opacity = clamp(raw.opacity, 0, 1);
    if (raw.borderRadius != null) element.borderRadius = clamp(raw.borderRadius, 0, 100);
    if (raw.padding != null) element.padding = clamp(raw.padding, 0, 60);
    const marginX = raw.marginX ?? raw.margin;
    const marginY = raw.marginY ?? raw.margin;
    if (marginX != null) element.marginX = clamp(marginX, isRailButtonStyle(id) ? 0 : -60, 60);
    if (marginY != null) element.marginY = clamp(marginY, -60, 60);
    if (Object.hasOwn(sideNavButtons, id)) {
      if (xboxButtons.some(([icon]) => icon === raw.controllerIcon)) element.controllerIcon = raw.controllerIcon;
      const action = canonicalChooserAction(raw.controllerAction);
      if (Object.hasOwn(chooserActions, action)) element.controllerAction = action;
    }
    elements[id] = element;
  }
  const custom = {};
  for (const [id, item] of Object.entries(value.custom || {})) {
    if (!CUSTOM_ELEMENT_ID.test(id) || !["text", "panel"].includes(item?.kind)) continue;
    custom[id] = { kind: item.kind, text: typeof item.text === "string" ? item.text.slice(0, 160) : "" };
    if (Object.keys(custom).length === MAX_CUSTOM_ELEMENTS) break;
  }
  const removed = Array.isArray(value.removed) ? [...new Set(value.removed.filter(id => typeof id === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(id)))] : [];
  return { elements, custom, removed, thumbnails: normalizeThumbnails(value) };
}
let stored = {};
try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { /* Use the default scene settings. */ }
if (!stored || typeof stored !== "object") stored = {};
stored = await studio.load(stored);
const needsLayoutRefresh = stored.layoutVersion !== LAYOUT_VERSION;
let settings = normalizeSettings(stored.settings);
let gameplayBackdrop = stored.gameplayBackdrop;
if (needsLayoutRefresh && !studio.document.defaults.handheld) {
  Object.assign(settings, {
    cameraX: 0, cameraY: 5, cameraZ: 31, cameraTilt: 0, cameraPanX: 0, cameraPanY: 9, cameraZoom: 1,
    switchPosition: [...DEFAULT_SETTINGS.switchPosition], switchRotation: [...DEFAULT_SETTINGS.switchRotation], switchScale: [...DEFAULT_SETTINGS.switchScale],
    boxPosition: [...DEFAULT_SETTINGS.boxPosition], boxRotation: [...DEFAULT_SETTINGS.boxRotation], boxScale: [...DEFAULT_SETTINGS.boxScale],
  });
}
let panelOpen = stored.panelOpen !== false;
let panelPosition = stored.panelPosition && Number.isFinite(Number(stored.panelPosition.left)) && Number.isFinite(Number(stored.panelPosition.top))
  ? { left: Number(stored.panelPosition.left), top: Number(stored.panelPosition.top) }
  : null;
let sidenavPanelOpen = stored.sidenavPanelOpen === true;
let sidenavPanelPosition = stored.sidenavPanelPosition && Number.isFinite(Number(stored.sidenavPanelPosition.left)) && Number.isFinite(Number(stored.sidenavPanelPosition.top))
  ? { left: Number(stored.sidenavPanelPosition.left), top: Number(stored.sidenavPanelPosition.top) }
  : null;
let uiDesign = normalizeUiDesign(stored.uiDesign);
let uiUndoStack = Array.isArray(stored.uiUndo) ? stored.uiUndo.map(normalizeUiDesign).slice(-50) : [];
let uiRedoStack = Array.isArray(stored.uiRedo) ? stored.uiRedo.map(normalizeUiDesign).slice(-50) : [];
let lastCommittedUiDesign = structuredClone(uiDesign);
let uiSelectedTarget = typeof stored.uiSelectedTarget === "string" ? stored.uiSelectedTarget : "game-rail";
let uiEditMode = !studio.runtime && stored.uiEditMode === true;
let uiSelection = new Set([uiSelectedTarget]);
let undoStack = !needsLayoutRefresh && Array.isArray(stored.undo) ? stored.undo.map(normalizeSettings).slice(-50) : [];
let redoStack = !needsLayoutRefresh && Array.isArray(stored.redo) ? stored.redo.map(normalizeSettings).slice(-50) : [];
let lastCommitted = cloneSettings(settings);
let editMode = !studio.runtime && !needsLayoutRefresh && stored.editMode === "object" ? "object" : "camera";
let selectedObjectName = "";
let transformAction = !needsLayoutRefresh && ["translate", "rotate", "scale"].includes(stored.transformAction) ? stored.transformAction : "translate";
const sharedStage = studio.runtime ? window.parent.totemSceneRuntime : null;
const renderer = sharedStage?.renderer ?? new THREE.WebGLRenderer({ canvas, powerPreference: "high-performance" });
if (!sharedStage) renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = sharedStage ? new THREE.Group() : new THREE.Scene();

function attachViewContent(parent, content) {
  sharedStage?.adoptContent(content);
  parent.add(content);
}

const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 160);
camera.position.set(0, 5, 31);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = true;
controls.minDistance = 20;
controls.maxDistance = 48;
controls.minPolarAngle = 0.2;
controls.maxPolarAngle = Math.PI - 0.2;
controls.target.set(settings.cameraPanX, settings.cameraPanY, -8);
camera.zoom = settings.cameraZoom;
camera.updateProjectionMatrix();
const transformControls = new TransformControls(camera, canvas);
transformControls.enabled = false;
scene.add(transformControls.getHelper());
const gizmo = new THREE.Object3D();
const gizmoCenter = new THREE.Vector3();
let gizmoTarget;
let gizmoChildren = [];

const environment = sharedStage?.environment ?? createStudioEnvironment(scene, renderer, settings, {width:innerWidth,height:innerHeight});
if (!sharedStage) environment.gameplayBackdrop.apply(gameplayBackdrop);
const composer = sharedStage ? null : new EffectComposer(renderer);
const depthOfField = composer ? createDepthOfField(scene,camera,environment.gameplayBackdrop.mesh) : null;
if (composer) {
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(depthOfField.pass);
  composer.addPass(environment.bloom);
  composer.addPass(new OutputPass());
  addSceneAntialiasing(composer);
}

const panel = document.querySelector("#scene-controls");
const objectPanel = document.querySelector("#object-controls");
const stage = document.querySelector("#stage");
const openButton = document.querySelector("#scene-open");
const undoButton = document.querySelector("#undo");
const redoButton = document.querySelector("#redo");
const sidenavPanel = document.querySelector("#sidenav-controls");
const resizeHandles = document.createElement("div");
resizeHandles.className = "layout-resize-handles";
resizeHandles.hidden = true;
for (const edge of ["left", "right", "top", "bottom"]) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.dataset.resizeEdge = edge;
  handle.setAttribute("aria-label", `Resize ${edge} edge with arrow keys`);
  resizeHandles.append(handle);
}
sidenavPanel.before(resizeHandles);
let resizeHandlesFrame = 0;
let resizeHandlesTarget = null;
const resizeObserver = new ResizeObserver(scheduleResizeHandles);
resizeObserver.observe(stage);
const sidenavOpenButton = document.querySelector("#sidenav-open");
const uiUndoButton = document.querySelector("#ui-undo");
const uiRedoButton = document.querySelector("#ui-redo");
const editTarget = document.querySelector("#edit-target");
const cameraModeButton = document.querySelector("#camera-mode");
const objectModeButton = document.querySelector("#object-mode");
let handheld;
let gameBox;
let supportObjects;
let pole;
let displayObject;
let plinthObject;
let controllerObjects;
let mediaObject;
let tvModelLoad;
let activePlatform = {id:'switch',name:'Nintendo Switch'};
const settingForControl = {
  "lights-enabled": "lightsEnabled",
  hue: "hue",
  brightness: "brightness",
  "light-reflection": "lightReflection",
  "console-reflection": "consoleReflection",
  "light-x": "lightX",
  "light-y": "lightY",
  "light-z": "lightZ",
  "camera-x": "cameraX",
  "camera-y": "cameraY",
  "camera-z": "cameraZ",
  "camera-tilt": "cameraTilt",
  "camera-pan-x": "cameraPanX",
  "camera-pan-y": "cameraPanY",
  "camera-zoom": "cameraZoom",
  "depth-of-field-enabled": "depthOfFieldEnabled",
  "depth-of-field-blur": "depthOfFieldBlur",
  "reflections-enabled": "reflectionsEnabled",
  "auto-rotate": "autoRotate",
};
function persist() {
  if (studio.runtime) return;
  studio.save(sceneSnapshot());
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ layoutVersion: LAYOUT_VERSION, settings, panelOpen, panelPosition, undo: undoStack, redo: redoStack, editMode, transformAction, sidenavPanelOpen, sidenavPanelPosition, uiDesign, uiUndo: uiUndoStack, uiRedo: uiRedoStack, uiSelectedTarget, uiEditMode })); }
  catch (error) { console.warn("Could not autosave scene controls.", error); }
}
function applyPanelPosition() {
  if (!panelPosition) {
    panelPosition = { left: panel.offsetLeft, top: panel.offsetTop };
  }
  const panelWidth = panel.offsetWidth || 248;
  const panelHeight = panel.offsetHeight || Math.min(460, Math.max(120, stage.clientHeight - 24));
  panelPosition.left = clamp(panelPosition.left, 0, Math.max(0, stage.clientWidth - panelWidth));
  panelPosition.top = clamp(panelPosition.top, 0, Math.max(0, stage.clientHeight - panelHeight));
  panel.style.left = `${panelPosition.left}px`;
  panel.style.top = `${panelPosition.top}px`;
}
function updatePanelVisibility() {
  panel.classList.toggle("is-closed", !panelOpen);
  openButton.classList.toggle("is-hidden", panelOpen);
  if (panelOpen) applyPanelPosition();
  persist();
}
function updateHistoryButtons() {
  undoButton.disabled = undoStack.length === 0;
  document.querySelector("#object-undo").disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
  document.querySelector("#object-redo").disabled = redoStack.length === 0;
}
function updateUiHistoryButtons() {
  uiUndoButton.disabled = uiUndoStack.length === 0;
  uiRedoButton.disabled = uiRedoStack.length === 0;
}
function currentUiElement() {
  return [...document.querySelectorAll("[data-ui-element], [data-ui-style]")].find((element) => element.dataset.uiElement === uiSelectedTarget || element.dataset.uiStyle === uiSelectedTarget) || null;
}
function uiElementBounds(target) {
  const rect = target.getBoundingClientRect();
  const style = getComputedStyle(target);
  const width = parseFloat(style.width) || target.offsetWidth || rect.width;
  const height = parseFloat(style.height) || target.offsetHeight || rect.height;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width, height };
}
function uiElementRotation(target) {
  let degrees = 0;
  for (let element = target; element && element !== stage; element = element.parentElement) {
    degrees += parseFloat(element.style.rotate) || 0;
  }
  return degrees * Math.PI / 180;
}
function scheduleResizeHandles() {
  if (resizeHandlesFrame) return;
  resizeHandlesFrame = requestAnimationFrame(() => {
    resizeHandlesFrame = 0;
    const selected = uiEditMode && studio.inspector === "layout" && uiSelection.has(uiSelectedTarget)
      ? currentUiElement() : null;
    const target = selected?.dataset.uiElement && selected.closest(".game-card, .game-details, .layout-custom")
      ? selected : null;
    if (target !== resizeHandlesTarget) {
      if (resizeHandlesTarget) resizeObserver.unobserve(resizeHandlesTarget);
      if (target) resizeObserver.observe(target);
      resizeHandlesTarget = target;
    }
    resizeHandles.hidden = !target?.getClientRects().length || getComputedStyle(target).visibility !== "visible";
    if (resizeHandles.hidden) return;
    const bounds = uiElementBounds(target);
    const stageRect = stage.getBoundingClientRect();
    Object.assign(resizeHandles.style, {
      left: `${bounds.x - stageRect.x}px`,
      top: `${bounds.y - stageRect.y}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      rotate: `${uiElementRotation(target)}rad`,
    });
  });
}
function beginUiResize(edge) {
  const target = resizeHandlesTarget;
  const id = target.dataset.uiElement;
  const design = { ...uiDesign.elements[id] };
  const horizontal = edge === "left" || edge === "right";
  const direction = edge === "left" || edge === "top" ? -1 : 1;
  const property = horizontal ? "width" : "height";
  const angle = uiElementRotation(target) + (horizontal ? 0 : Math.PI / 2);
  const localAngle = (design.rotation || 0) * Math.PI / 180 + (horizontal ? 0 : Math.PI / 2);
  const style = getComputedStyle(target);
  const minSize = parseFloat(horizontal ? style.minWidth : style.minHeight) || 0;
  return { target, id, design, property, direction, bounds: uiElementBounds(target), angle, localAngle, minSize };
}
function resizeUiElement(resize, delta) {
  const { target, id, design, property, direction, bounds, angle, localAngle } = resize;
  const control = document.querySelector(`#layout-${property}`);
  const initialSize = Math.round(bounds[property]);
  const minSize = Math.max(Number(control.min), resize.minSize);
  const maxSize = Number(control.max);
  const requested = initialSize + Math.round(direction * delta);
  let size = clamp(requested, minSize, maxSize);
  if (requested >= initialSize) size = Math.max(initialSize, size);
  if (requested <= initialSize) size = Math.min(initialSize, size);
  const x = design.x ?? 0;
  const y = design.y ?? 0;
  if (size === initialSize) {
    if (resize.changed) {
      if (Object.keys(design).length) uiDesign.elements[id] = { ...design };
      else delete uiDesign.elements[id];
      resize.changed = false;
    }
    return;
  }

  // Measure after layout so flex, grid and bottom-anchored elements all keep the opposite edge in place.
  target.style.translate = `${x}px ${y}px`;
  target.style[property] = `${size}px`;
  const next = uiElementBounds(target);
  const centreShift = (next.x - bounds.x) * Math.cos(angle) + (next.y - bounds.y) * Math.sin(angle);
  const correction = direction * (next[property] - bounds[property]) / 2 - centreShift;
  uiDesign.elements[id] = {
    ...design,
    [property]: size,
    x: clamp(Math.round(x + correction * Math.cos(localAngle)), -3000, 3000),
    y: clamp(Math.round(y + correction * Math.sin(localAngle)), -3000, 3000),
  };
  resize.changed = true;
}
function cssColorToHex(color) {
  const channels = color.match(/\d+/g)?.slice(0, 3).map((channel) => Number(channel).toString(16).padStart(2, "0"));
  return channels?.length === 3 ? `#${channels.join("")}` : "#ffffff";
}
const uiElementSelect = document.querySelector("#layout-target");
const thumbnailsEnabled = document.querySelector("#thumbnails-enabled");
const thumbnailTypeSelect = document.querySelector("#thumbnail-type");
THUMBNAIL_TYPES.forEach(([value,label])=>thumbnailTypeSelect.add(new Option(label,value)));
const uiEditToggle = document.querySelector("#ui-edit-toggle");
const addElementKind = document.querySelector("#layout-add-kind");
const addElementButton = document.querySelector("#layout-add");
const removeElementButton = document.querySelector("#layout-remove");
const customText = document.querySelector("#layout-text");
const titlePreview = document.querySelector("#layout-title-preview");
const logoAlignment = document.querySelector("#layout-logo-alignment");
const logoAlignmentButtons = logoAlignment.querySelectorAll("[data-logo-align]");
const setTitleArtwork = titleArtwork(document.querySelector("#featured-logo"), document.querySelector("#featured-title-text"));
const titleSampleLogo = "/branding/totem/totem_word_logo.png";
function renderTitlePreview() {
  if (!studio.runtime) void setTitleArtwork(titlePreview.value === "logo" ? titleSampleLogo : null, "Sample title logo");
}
function populateUiTargetOptions() {
  const targets = [...stage.querySelectorAll("[data-ui-element]")].filter(element =>
    !element.closest(".scene-controls") &&
    element.closest(studio.inspector === "sidenav" ? ".game-rail, .game-menu" : ".game-card, .game-details, .layout-custom")
  );
  const available = targets.filter(element => !element.closest("[data-layout-removed]"));
  const options = available.map((element) => {
    const option = document.createElement("option");
    option.value = element.dataset.uiElement;
    option.textContent = element.dataset.uiLabel || element.dataset.uiElement;
    return option;
  });
  for (const [id, label] of (studio.inspector === "sidenav" ? [["game-button-inactive", "Game button · Inactive style"], ["game-button-active", "Game button · Active style"], ["game-thumbnail", "Game button · Thumbnail style"]] : [])) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    options.push(option);
  }
  uiElementSelect.replaceChildren(...options);
  if (!options.some(option => option.value === uiSelectedTarget)) uiSelectedTarget = options[0]?.value || "";
  uiSelection = new Set([...uiSelection].filter(id => options.some(option => option.value === id)));

  const previousKind = addElementKind.value;
  const canAddCustom = Object.keys(uiDesign.custom).length < MAX_CUSTOM_ELEMENTS;
  const additions = canAddCustom ? [new Option("Text", "text"), new Option("Panel", "panel")] : [];
  for (const element of stage.querySelectorAll("[data-ui-element][data-layout-removed]")) {
    if (!element.parentElement.closest("[data-layout-removed]")) {
      additions.push(new Option(`Restore ${element.dataset.uiLabel}`, `restore:${element.dataset.uiElement}`));
    }
  }
  addElementKind.replaceChildren(...additions);
  if (additions.some(option => option.value === previousKind)) addElementKind.value = previousKind;
  addElementButton.disabled = addElementKind.disabled = !additions.length;
}
const gameRail = document.querySelector(".rail-list");
let railGames = [...gameRail.querySelectorAll(".rail-game")];
let selectedGame = railGames.find(game => game.classList.contains("rail-active")) ?? railGames[0];
let visibleGames = railGames.filter(game => !game.hidden);
const alphabetJump = mountAlphabetJump(document.querySelector("#stage"), {
  items: () => visibleGames,
  selected: () => visibleGames.includes(selectedGame) ? selectedGame : null,
  titleOf: game => game.dataset.titlePrefix || game.dataset.title || "",
  select: game => { if (selectedGame !== game) selectGame(game); },
});
gameRail.classList.add("rail-scroll");
const titleRail = mountCenteredTitleRail(gameRail, {
  cards: () => visibleGames,
  loop: studio.runtime,
  onCopy: card => {
    const thumbnail = card.querySelector(".rail-thumb");
    if (thumbnail) thumbnailObserver.observe(thumbnail);
  },
  active: () => studio.runtime ? studio.active : !uiEditMode,
  select: game => {
    if (game === selectedGame) titleRail.center(game);
    else selectGame(game);
  },
});
const thumbnailCache = new Map();
const thumbnailObserver = new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){thumbnailObserver.unobserve(entry.target);void loadThumbnail(entry.target);}
}, {root:gameRail,rootMargin:'120px'});
function gameThumbnail(gameId, type) {
  const key=`${gameId}:${type}`;
  if(!thumbnailCache.has(key)) {
    const request=gameId?.startsWith('library-') ? studioInvoke('get_library_game_thumbnail',{gameId,artworkType:type}).catch(()=>null) : Promise.resolve(null);
    thumbnailCache.set(key,request);
    if(thumbnailCache.size>64)thumbnailCache.delete(thumbnailCache.keys().next().value);
  }
  return thumbnailCache.get(key);
}
async function loadThumbnail(thumbnail) {
  const gameId=thumbnail.closest('.rail-game')?.dataset.game,type=thumbnail.dataset.artworkType;
  const source=await gameThumbnail(gameId, type);
  if(!thumbnail.isConnected || thumbnail.dataset.artworkType!==type)return;
  thumbnail.replaceChildren();
  if(source){const image=document.createElement('img');image.src=source;image.alt='';image.draggable=false;thumbnail.append(image);}
  else {thumbnail.textContent='—';thumbnail.title=`${THUMBNAIL_TYPES.find(([id])=>id===type)?.[1] || type} unavailable`;}
}
function applyThumbnailDesign() {
  const {enabled,type}=uiDesign.thumbnails;
  for(const game of document.querySelectorAll('.rail-game')) {
    let thumbnail=game.querySelector('.rail-thumb');
    game.classList.toggle('has-thumb',enabled);
    if(!enabled){if(thumbnail)thumbnailObserver.unobserve(thumbnail);thumbnail?.remove();continue;}
    if(!thumbnail){thumbnail=document.createElement('span');thumbnail.className='rail-thumb';thumbnail.dataset.uiStyle='game-thumbnail';thumbnail.setAttribute('aria-hidden','true');game.prepend(thumbnail);}
    if(thumbnail.dataset.artworkType!==type){thumbnailObserver.unobserve(thumbnail);thumbnail.dataset.artworkType=type;thumbnail.className=`rail-thumb rail-thumb-${type}`;thumbnail.textContent='…';thumbnailObserver.observe(thumbnail);}
  }
}
function applyUiStyle(element) {
  const design = uiDesign.elements[element.dataset.uiStyle] || {};
  const railButton = isRailButtonStyle(element.dataset.uiStyle);
  const x = railButton ? 0 : design.x;
  element.style.translate = x != null || design.y != null ? `${x || 0}px ${design.y || 0}px` : "";
  element.style.rotate = design.rotation ? `${design.rotation}deg` : "";
  element.style.width = !railButton && design.width != null ? `${design.width}px` : "";
  element.style.height = design.height != null ? `${design.height}px` : "";
  element.style.flex = design.height != null ? "0 0 auto" : "";
  if (element.matches(".rail-game")) element.style.minHeight = design.height != null ? "0px" : "";
  element.style.fontFamily = design.fontFamily || "";
  element.style.fontSize = design.fontSize != null ? `${design.fontSize}px` : "";
  element.style.fontWeight = design.fontWeight || "";
  element.style.textAlign = design.textAlign || "";
  element.style.color = design.color || "";
  element.style.background = design.background
    ? `color-mix(in srgb, ${design.background} ${(design.opacity ?? 1) * 100}%, transparent)` : "";
  element.style.borderColor = design.borderColor || "";
  element.style.visibility = design.hidden ? "hidden" : "";
  element.style.setProperty("--layout-fill-opacity", design.opacity ?? 1);
  element.style.borderRadius = design.borderRadius != null ? `${design.borderRadius}px` : "";
  element.style.padding = design.padding != null ? `${design.padding}px` : "";
  element.style.marginInline = design.marginX != null ? `${design.marginX}px` : "";
  element.style.marginBlock = design.marginY != null ? `${design.marginY}px` : "";
}
function refreshBackArtwork() {
  const back = document.querySelector(".back-control");
  const backIcon = back.querySelector("img");
  const { source, active, keyboard } = actionArtwork("escape");
  if (source && backIcon.getAttribute("src") !== source) backIcon.src = source;
  backIcon.hidden = !source;
  backIcon.classList.toggle("back-keycap", keyboard);
  backIcon.alt = "";
  if (active) back.style.setProperty("--controller-active-glyph", `url("${active}")`);
  else back.style.removeProperty("--controller-active-glyph");
  back.title = chooserActions.escape;
}

function applyUiDesign() {
  for (const element of stage.querySelectorAll(".layout-custom")) {
    if (!Object.hasOwn(uiDesign.custom, element.dataset.uiElement)) element.remove();
  }
  for (const [id, item] of Object.entries(uiDesign.custom)) {
    let element = stage.querySelector(`[data-ui-element="${id}"]`);
    if (!element) {
      element = document.createElement("div");
      element.dataset.uiElement = id;
      stage.append(element);
    }
    element.className = `layout-custom layout-custom-${item.kind}`;
    element.dataset.uiLabel = item.kind === "panel" ? "Panel" : (item.text.trim().slice(0, 32) || "Text");
    element.textContent = item.kind === "text" ? item.text : "";
  }
  applyThumbnailDesign();
  refreshBackArtwork();
  const removed = new Set(uiDesign.removed);
  for (const element of document.querySelectorAll("[data-ui-element]")) {
    const id = element.dataset.uiElement;
    const design = uiDesign.elements[id] || {};
    element.toggleAttribute("data-layout-removed", removed.has(id));
    element.style.translate = design.x != null || design.y != null ? `${design.x || 0}px ${design.y || 0}px` : "";
    element.style.rotate = design.rotation ? `${design.rotation}deg` : "";
    element.style.width = design.width != null ? `${design.width}px` : "";
    element.style.height = design.height != null ? `${design.height}px` : "";
    element.style.flex = element.classList.contains("rail-game") && design.height != null ? "0 0 auto" : "";
    if (element.matches(".metric-icon")) element.style.flexBasis = design.width != null ? "auto" : "";
    element.style.fontFamily = design.fontFamily || "";
    element.style.fontSize = design.fontSize != null ? `${design.fontSize}px` : "";
    element.style.fontWeight = design.fontWeight || "";
    element.style.textAlign = design.textAlign || "";
    element.style.color = design.color || "";
    if (element instanceof SVGElement) {
      element.style.fill = design.color || "";
      element.style.stroke = design.color || "";
    }
    element.style.visibility = design.hidden ? "hidden" : "";
    element.style.setProperty("--layout-fill-opacity", design.opacity ?? 1);
    element.style.borderRadius = design.borderRadius != null ? `${design.borderRadius}px` : "";
    element.style.padding = design.padding != null ? `${design.padding}px` : "";
    element.style.marginInline = design.marginX != null ? `${design.marginX}px` : "";
    element.style.marginBlock = design.marginY != null ? `${design.marginY}px` : "";
    if (Object.hasOwn(uiDesign.custom, id)) {
      element.style.background = design.background
        ? `color-mix(in srgb, ${design.background} ${(design.opacity ?? 1) * 100}%, transparent)` : "";
      element.style.borderColor = design.borderColor || "";
    }
    if (id === "game-title") {
      element.style.setProperty("--title-font", design.fontFamily || "");
      element.style.setProperty("--title-size", element.style.fontSize);
      element.style.setProperty("--title-weight", element.style.fontWeight);
      element.style.setProperty("--logo-align", design.logoAlign ?? design.textAlign ?? "left");
    }
  }
  for (const element of document.querySelectorAll("[data-ui-style]")) applyUiStyle(element);
  document.querySelectorAll("[data-ui-element], [data-ui-style]").forEach((element) => {
    const selected = uiEditMode && (uiSelection.has(element.dataset.uiElement) || uiSelection.has(element.dataset.uiStyle));
    element.classList.toggle("ui-layout-selected", selected);
  });
  stage.classList.toggle("ui-edit-mode", uiEditMode);
  uiEditToggle.classList.toggle("is-active", uiEditMode);
  uiEditToggle.setAttribute("aria-pressed", String(uiEditMode));
  scheduleResizeHandles();
  titleRail.center(selectedGame);
}
function renderUiEditor() {
  scheduleResizeHandles();
  thumbnailsEnabled.checked=uiDesign.thumbnails.enabled;
  thumbnailTypeSelect.value=uiDesign.thumbnails.type;
  thumbnailTypeSelect.disabled=!uiDesign.thumbnails.enabled;
  document.querySelector("#layout-selection-count").textContent = `${uiSelection.size} selected · Shift-click to add or remove`;
  uiElementSelect.value = uiSelectedTarget;
  const target = currentUiElement();
  const railButton = Boolean(target) && isRailButtonStyle(uiSelectedTarget);
  document.querySelectorAll('.sidenav-body input[id^="layout-"], .sidenav-body select[id^="layout-"]').forEach(control=>{
    if (["layout-target", "layout-add-kind"].includes(control.id)) return;
    control.disabled = !target || (railButton && ["layout-x", "layout-width"].includes(control.id));
  });
  document.querySelector("#layout-rail-fit").hidden = !railButton;
  document.querySelector("#layout-margin-x").min = railButton ? 0 : -60;
  const layout = studio.inspector === "layout";
  const item = uiDesign.custom[uiSelectedTarget];
  removeElementButton.disabled = !layout || !target?.dataset.uiElement;
  document.querySelector("#layout-text-row").hidden = !layout || item?.kind !== "text";
  if (item?.kind === "text") customText.value = item.text;
  const editingTitle = layout && uiSelectedTarget === "game-title";
  document.querySelector("#layout-title-preview-row").hidden = !editingTitle;
  logoAlignment.hidden = !editingTitle;
  document.querySelector("#layout-reset").disabled = !target;
  if (!target) {updateUiHistoryButtons();return;}
  const design = uiDesign.elements[uiSelectedTarget] || {};
  if (editingTitle) {
    const alignment = design.logoAlign ?? design.textAlign ?? "left";
    for (const button of logoAlignmentButtons) {
      const selected = button.dataset.logoAlign === alignment;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
  }
  const computed = getComputedStyle(target);
  const font = uiSelectedTarget === "game-title" ? getComputedStyle(target.querySelector("strong")) : computed;
  const bounds = target.getBoundingClientRect();
  const controls = {
    "layout-x": railButton ? 0 : design.x ?? 0,
    "layout-y": design.y ?? 0,
    "layout-width": railButton ? Math.round(bounds.width) : design.width ?? Math.round(bounds.width),
    "layout-height": design.height ?? Math.round(bounds.height),
    "layout-rotation": design.rotation ?? 0,
    "layout-font-size": design.fontSize ?? Math.round(parseFloat(font.fontSize) || 16),
    "layout-opacity": design.opacity ?? 1,
    "layout-radius": design.borderRadius ?? Math.round(parseFloat(computed.borderTopLeftRadius) || 0),
    "layout-padding": design.padding ?? Math.round(parseFloat(computed.paddingLeft) || 0),
    "layout-margin-x": design.marginX ?? Math.round(parseFloat(computed.marginInlineStart) || 0),
    "layout-margin-y": design.marginY ?? Math.round(parseFloat(computed.marginBlockStart) || 0),
  };
  for (const [id, value] of Object.entries(controls)) {
    const input = document.getElementById(id);
    input.value = value;
    const min = Number(input.min), max = Number(input.max);
    input.style.setProperty("--range-fill", `${((value - min) / (max - min)) * 100}%`);
    const output = document.getElementById(`${id}-value`);
    if (output) output.value = id === "layout-opacity" ? Number(value).toFixed(2) : id === "layout-rotation" ? `${Math.round(value)}°` : `${Math.round(value)}px`;
  }
  const family = design.fontFamily || UI_FONT_FAMILIES.find((name) => computed.fontFamily.toLowerCase().includes(name.toLowerCase())) || "system-ui";
  document.querySelector("#layout-font-family").value = family;
  document.querySelector("#layout-font-weight").value = String(design.fontWeight || computed.fontWeight || 700);
  document.querySelector("#layout-text-align").value = design.textAlign || computed.textAlign;
  document.querySelector("#layout-visible").checked = !design.hidden;
  document.querySelector("#layout-color").value = design.color || cssColorToHex(computed.color);
  const gameStyle = target.dataset.uiStyle;
  document.querySelector("#layout-background").value = design.background || (gameStyle === "game-button-active" ? "#741bdb" : "#100923");
  document.querySelector("#layout-border-color").value = design.borderColor || (gameStyle === "game-button-active" ? "#f5d1ff" : "#9b63d7");
  updateUiHistoryButtons();
}
function commitUiHistory(before = lastCommittedUiDesign) {
  if (JSON.stringify(uiDesign) === JSON.stringify(before)) return;
  uiUndoStack.push(structuredClone(before));
  uiUndoStack = uiUndoStack.slice(-50);
  uiRedoStack = [];
  lastCommittedUiDesign = structuredClone(uiDesign);
  updateUiHistoryButtons();
  persist();
  studio.rememberEdit();
}
function restoreUiHistory(from, to) {
  if (!from.length) return;
  to.push(structuredClone(uiDesign));
  uiDesign = from.pop();
  lastCommittedUiDesign = structuredClone(uiDesign);
  applyUiDesign();
  populateUiTargetOptions();
  renderUiEditor();
  persist();
  studio.rememberEdit();
}
function applySidenavPanelPosition() {
  if (!sidenavPanelPosition) sidenavPanelPosition = { left: Math.max(12, stage.clientWidth - 336), top: 18 };
  const width = sidenavPanel.offsetWidth || 318;
  const height = sidenavPanel.offsetHeight || Math.min(620, Math.max(160, stage.clientHeight - 36));
  sidenavPanelPosition.left = clamp(sidenavPanelPosition.left, 0, Math.max(0, stage.clientWidth - width));
  sidenavPanelPosition.top = clamp(sidenavPanelPosition.top, 0, Math.max(0, stage.clientHeight - height));
  sidenavPanel.style.right = "auto";
  sidenavPanel.style.left = `${sidenavPanelPosition.left}px`;
  sidenavPanel.style.top = `${sidenavPanelPosition.top}px`;
}
function updateSidenavPanelVisibility() {
  sidenavPanel.classList.toggle("is-closed", !sidenavPanelOpen);
  sidenavOpenButton.classList.toggle("is-hidden", sidenavPanelOpen);
  if (sidenavPanelOpen) applySidenavPanelPosition();
  persist();
}
function selectUiTarget(id, extend = false) {
  if (extend) {
    if (uiSelection.has(id)) uiSelection.delete(id); else uiSelection.add(id);
  } else uiSelection = new Set([id]);
  uiSelectedTarget = uiSelection.has(id) ? id : [...uiSelection].at(-1) || id;
  uiElementSelect.value = uiSelectedTarget;
  renderUiEditor();
  applyUiDesign();
  persist();
}
populateUiTargetOptions();
applyUiDesign();
populateUiTargetOptions();
renderUiEditor();
updateSidenavPanelVisibility();
uiElementSelect.addEventListener("change", () => selectUiTarget(uiElementSelect.value));
addElementButton.addEventListener("click", () => {
  const before = structuredClone(uiDesign);
  const choice = addElementKind.value;
  if (choice.startsWith("restore:")) {
    uiSelectedTarget = choice.slice(8);
    uiDesign.removed = uiDesign.removed.filter(id => id !== uiSelectedTarget);
  } else if (["text", "panel"].includes(choice) && Object.keys(uiDesign.custom).length < MAX_CUSTOM_ELEMENTS) {
    uiSelectedTarget = `custom-${crypto.randomUUID()}`;
    uiDesign.custom[uiSelectedTarget] = { kind: choice, text: choice === "text" ? "New text" : "" };
  } else return;
  uiSelection = new Set([uiSelectedTarget]);
  applyUiDesign();
  populateUiTargetOptions();
  renderUiEditor();
  commitUiHistory(before);
});
removeElementButton.addEventListener("click", () => {
  const id = currentUiElement()?.dataset.uiElement;
  if (!id) return;
  const before = structuredClone(uiDesign);
  if (Object.hasOwn(uiDesign.custom, id)) {
    delete uiDesign.custom[id];
    delete uiDesign.elements[id];
  } else {
    uiDesign.removed.push(id);
  }
  uiSelection.clear();
  applyUiDesign();
  populateUiTargetOptions();
  renderUiEditor();
  commitUiHistory(before);
});
customText.addEventListener("input", () => {
  const item = uiDesign.custom[uiSelectedTarget];
  if (item?.kind !== "text") return;
  item.text = customText.value;
  applyUiDesign();
  uiElementSelect.selectedOptions[0].textContent = currentUiElement().dataset.uiLabel;
  persist();
});
customText.addEventListener("change", () => commitUiHistory());
titlePreview.addEventListener("change", renderTitlePreview);
for (const button of logoAlignmentButtons) {
  button.addEventListener("click", () => {
    const title = uiDesign.elements["game-title"] ||= {};
    title.logoAlign = button.dataset.logoAlign;
    applyUiDesign();
    renderUiEditor();
    commitUiHistory();
  });
}
uiEditToggle.addEventListener("click", () => {
  uiEditMode = !uiEditMode;
  applyUiDesign();
  persist();
});
const uiRangeProperties = {
  "layout-x": "x", "layout-y": "y", "layout-width": "width", "layout-height": "height",
  "layout-rotation": "rotation", "layout-font-size": "fontSize", "layout-opacity": "opacity",
  "layout-radius": "borderRadius", "layout-padding": "padding",
  "layout-margin-x": "marginX", "layout-margin-y": "marginY",
};
const sidenavBody = document.querySelector(".sidenav-body");
let rangeDrag = null;
sidenavBody.addEventListener("pointerdown", (event) => {
  const input = event.target;
  if (event.button === 0 && input.type === "range" && input.step === "1" && uiRangeProperties[input.id]) {
    rangeDrag = { input, id: event.pointerId };
  }
});
function finishRangeDrag(event) {
  if (rangeDrag?.id === event.pointerId) rangeDrag = null;
}
window.addEventListener("pointerup", finishRangeDrag, true);
window.addEventListener("pointercancel", finishRangeDrag, true);
sidenavBody.addEventListener("input", (event) => {
  const property = uiRangeProperties[event.target.id];
  if (!property) return;
  const element = uiDesign.elements[uiSelectedTarget] ||= {};
  const input = event.target;
  const value = input.valueAsNumber;
  element[property] = rangeDrag?.input === input
    ? clamp(Math.round(value / 5) * 5, Number(input.min), Number(input.max))
    : value;
  applyUiDesign();
  renderUiEditor();
  persist();
});
document.querySelector(".sidenav-body").addEventListener("change", (event) => {
  const before = structuredClone(lastCommittedUiDesign);
  const element = uiDesign.elements[uiSelectedTarget] ||= {};
  if (event.target.id === "layout-visible") element.hidden = !event.target.checked;
  else if (event.target.id === "layout-font-family") element.fontFamily = event.target.value;
  else if (event.target.id === "layout-font-weight") element.fontWeight = Number(event.target.value);
  else if (event.target.id === "layout-text-align") element.textAlign = event.target.value;
  else if (event.target.id === "layout-color") element.color = event.target.value;
  else if (event.target.id === "layout-background") element.background = event.target.value;
  else if (event.target.id === "layout-border-color") element.borderColor = event.target.value;
  else if (event.target.id === "thumbnail-type") uiDesign.thumbnails.type=event.target.value;
  else if (event.target.id === "thumbnails-enabled") uiDesign.thumbnails.enabled=event.target.checked;
  else return;
  applyUiDesign();
  renderUiEditor();
  commitUiHistory(before);
});
for (const id of Object.keys(uiRangeProperties)) {
  document.getElementById(id).addEventListener("change", () => commitUiHistory());
}
document.querySelector("#layout-reset").addEventListener("click", () => {
  const before = structuredClone(uiDesign);
  delete uiDesign.elements[uiSelectedTarget];
  applyUiDesign();
  renderUiEditor();
  commitUiHistory(before);
});
uiUndoButton.addEventListener("click", () => restoreUiHistory(uiUndoStack, uiRedoStack));
uiRedoButton.addEventListener("click", () => restoreUiHistory(uiRedoStack, uiUndoStack));
document.querySelector("#sidenav-close").addEventListener("click", () => { sidenavPanelOpen = false; updateSidenavPanelVisibility(); });
sidenavOpenButton.addEventListener("click", () => { sidenavPanelOpen = true; updateSidenavPanelVisibility(); });
const sidenavHeader = sidenavPanel.querySelector(".sidenav-header");
let sidenavPanelDrag = null;
sidenavHeader.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest(".history-buttons")) return;
  const rect = sidenavPanel.getBoundingClientRect();
  sidenavPanelDrag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  sidenavHeader.setPointerCapture(event.pointerId);
  event.preventDefault();
});
sidenavHeader.addEventListener("pointermove", (event) => {
  if (!sidenavPanelDrag || sidenavPanelDrag.pointerId !== event.pointerId) return;
  const rect = stage.getBoundingClientRect();
  sidenavPanelPosition = { left: event.clientX - rect.left - sidenavPanelDrag.offsetX, top: event.clientY - rect.top - sidenavPanelDrag.offsetY };
  applySidenavPanelPosition();
});
function finishSidenavPanelDrag(event) {
  if (!sidenavPanelDrag || (event && sidenavPanelDrag.pointerId !== event.pointerId)) return;
  sidenavPanelDrag = null;
  applySidenavPanelPosition();
  persist();
}
sidenavHeader.addEventListener("pointerup", finishSidenavPanelDrag);
sidenavHeader.addEventListener("pointercancel", finishSidenavPanelDrag);
sidenavHeader.addEventListener("lostpointercapture", finishSidenavPanelDrag);
let uiLayoutDrag = null;
function selectedOrigins() {
  const records = [...document.querySelectorAll('[data-ui-element], [data-ui-style]')].map(element => {
    const ancestors=[];
    for(let parent=element.parentElement;parent;parent=parent.parentElement) {
      const id=parent.dataset.uiStyle || parent.dataset.uiElement;if(id)ancestors.push(id);
    }
    return {id:element.dataset.uiStyle || element.dataset.uiElement,ancestors};
  });
  return Object.fromEntries(selectionRoots(uiSelection,records).map(id=>[id,{
    x:uiDesign.elements[id]?.x || 0,y:uiDesign.elements[id]?.y || 0,lockX:isRailButtonStyle(id),
  }]));
}
function previewInspector(element) {
  return element.closest('.game-rail, .game-menu') ? 'sidenav' : 'layout';
}
stage.addEventListener('pointerdown', event => {
  if (!uiEditMode || isEditingObjects() || uiLayoutDrag || event.button !== 0 || event.target.closest('.scene-controls, #bottom-nav')) return;
  const handle = event.target.closest('[data-resize-edge]');
  if (handle && !resizeHandles.hidden) {
    event.preventDefault();
    event.stopPropagation();
    handle.focus({ preventScroll: true });
    uiLayoutDrag = {
      pointerId: event.pointerId,
      before: structuredClone(uiDesign),
      resize: beginUiResize(handle.dataset.resizeEdge),
      startX: event.clientX,
      startY: event.clientY,
    };
    stage.setPointerCapture(event.pointerId);
    return;
  }
  const target=event.target.closest('[data-ui-element], [data-ui-style]');
  if(!target)return;
  if (!sidenavPanelOpen || studio.inspector !== previewInspector(target)) return;
  event.preventDefault();event.stopPropagation();
  const id=target.dataset.uiStyle || target.dataset.uiElement;
  if(event.shiftKey)selectUiTarget(id,true);
  else if(!uiSelection.has(id))selectUiTarget(id);
  stage.tabIndex=-1;stage.focus({preventScroll:true});
  if(!uiSelection.has(id))return;
  uiLayoutDrag={pointerId:event.pointerId,before:structuredClone(uiDesign),origins:selectedOrigins(),startX:event.clientX,startY:event.clientY};
  stage.setPointerCapture(event.pointerId);
}, true);
stage.addEventListener('pointermove',event=>{
  if(!uiLayoutDrag || uiLayoutDrag.pointerId!==event.pointerId)return;
  const { resize, origins, startX, startY } = uiLayoutDrag;
  const dx = event.clientX - startX;
  const dy = event.clientY - startY;
  if (resize) resizeUiElement(resize, dx * Math.cos(resize.angle) + dy * Math.sin(resize.angle));
  else offsetSelection(uiDesign.elements, origins, Math.round(dx), Math.round(dy));
  applyUiDesign();
  renderUiEditor();
  if (!resize) persist();
});
function finishUiLayoutDrag(event) {
  if(!uiLayoutDrag || (event && uiLayoutDrag.pointerId!==event.pointerId))return;
  const before=uiLayoutDrag.before;uiLayoutDrag=null;commitUiHistory(before);
}
stage.addEventListener('pointerup',finishUiLayoutDrag);
stage.addEventListener('pointercancel',finishUiLayoutDrag);
stage.addEventListener('lostpointercapture',finishUiLayoutDrag);
resizeHandles.addEventListener("keydown", event => {
  const edge = event.target.dataset.resizeEdge;
  if (!edge || resizeHandles.hidden || uiLayoutDrag) return;
  const horizontal = edge === "left" || edge === "right";
  const decrease = horizontal ? "ArrowLeft" : "ArrowUp";
  const increase = horizontal ? "ArrowRight" : "ArrowDown";
  if (event.key !== decrease && event.key !== increase) return;
  event.preventDefault();
  event.stopPropagation();
  const before = structuredClone(uiDesign);
  resizeUiElement(beginUiResize(edge), event.key === decrease ? -1 : 1);
  applyUiDesign();
  renderUiEditor();
  commitUiHistory(before);
});
stage.addEventListener('click', event => {
  if (studio.runtime || event.target.closest('.scene-controls, #bottom-nav, .scene-open')) return;
  const target = event.target.closest('[data-ui-element], [data-ui-style]');
  if (!target && !event.target.closest('button')) return;
  event.preventDefault();
  event.stopPropagation();
  if (!target) return;
  const id = target.dataset.uiStyle || target.dataset.uiElement;
  const mode = previewInspector(target);
  if (!sidenavPanelOpen || studio.inspector !== mode) studio.onInspector(mode);
  uiEditMode = true;
  selectUiTarget(id);
}, true);
window.addEventListener('keydown',event=>{
  if(!uiEditMode || isEditingObjects() || !uiSelection.size || event.target.closest('input,textarea,select,[contenteditable="true"],.scene-controls,.studio-toolbar,.layout-resize-handles,#bottom-nav'))return;
  const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
  if(!direction)return;
  event.preventDefault();event.stopImmediatePropagation();
  const before=structuredClone(uiDesign),step=event.shiftKey?10:1;
  offsetSelection(uiDesign.elements,selectedOrigins(),direction[0]*step,direction[1]*step);
  applyUiDesign();renderUiEditor();commitUiHistory(before);persist();
},true);

function isEditingObjects() {
  return !studio.runtime && !objectPanel.classList.contains("is-closed");
}
function sceneObjects() {
  return { "game-box": gameBox, display: displayObject, plinth: plinthObject, switch: handheld, controllers: controllerObjects, pole: pole?.root };
}
function syncTransformGizmo() {
  const target = editMode === "object" && isEditingObjects()
    ? sceneObjects()[selectedObjectName]
    : null;
  if (!target?.visible || !target.children.length) {
    transformControls.enabled = false;
    if (gizmoTarget) {
      transformControls.detach();
      gizmo.removeFromParent();
      gizmoTarget = null;
      gizmoChildren = [];
    }
    return;
  }

  const changedTarget = gizmoTarget !== target;
  if (changedTarget || target.children.length !== gizmoChildren.length ||
      target.children.some((child, index) => child !== gizmoChildren[index])) {
    objectCenter(target, gizmoCenter);
    gizmoChildren = [...target.children];
  }
  if (changedTarget) {
    gizmoTarget = target;
    target.parent.add(gizmo);
    transformControls.attach(gizmo);
  }
  transformControls.enabled = true;
  positionGizmo(gizmo, target, gizmoCenter);
  for (const axis of ["x", "y", "z"]) {
    const input = document.getElementById(`object-${axis}`);
    const offset = gizmo.position[axis] - target.position[axis];
    // Previously saved positions outside the slider range can move back
    // towards it without jumping when another axis is dragged.
    transformControls[`min${axis.toUpperCase()}`] = Math.min(Number(input.min), target.position[axis]) + offset;
    transformControls[`max${axis.toUpperCase()}`] = Math.max(Number(input.max), target.position[axis]) + offset;
  }
}

function syncObjectEditor() {
  const editing = isEditingObjects();
  const objectSelected = editing && Boolean(selectedObjectName);
  stage.classList.toggle("object-selected", objectSelected);
  for (const overlay of stage.querySelectorAll(":scope > :is([data-ui-element], #bottom-nav, #input-feedback)")) {
    overlay.inert = objectSelected;
  }
  editTarget.value = selectedObjectName;
  syncTransformGizmo();
  controls.enabled = !studio.runtime && !gizmoTarget && !transformControls.dragging;
  cameraModeButton.classList.toggle("is-active", editMode === "camera");
  objectModeButton.classList.toggle("is-active", editMode === "object");
  cameraModeButton.setAttribute("aria-pressed", String(editMode === "camera"));
  objectModeButton.setAttribute("aria-pressed", String(editMode === "object"));
  renderObjectControlValues();
}

function selectSceneObject(name) {
  selectedObjectName = name;
  editMode = name ? "object" : "camera";
  syncObjectEditor();
}

function renderSettings() {
  if (handheld) {
    handheld.position.fromArray(settings.switchPosition);
    handheld.rotation.fromArray(settings.switchRotation);
    handheld.scale.fromArray(settings.switchScale);
    const pose = studio.runtime && activePlatform?.libraryPresentation?.pose;
    if (pose) {
      handheld.position.add(new THREE.Vector3(pose.x, pose.y - devicePose.y, pose.z).multiplyScalar(3));
      handheld.rotation.x += THREE.MathUtils.degToRad(pose.pitch);
      handheld.rotation.y += THREE.MathUtils.degToRad(pose.yaw);
      handheld.rotation.z += THREE.MathUtils.degToRad(pose.roll);
      handheld.scale.multiplyScalar(pose.zoom / devicePose.zoom);
    }
  }
  if (gameBox) {
    gameBox.position.fromArray(settings.boxPosition);
    gameBox.rotation.fromArray(settings.boxRotation);
    gameBox.scale.fromArray(settings.boxScale);
  }
  renderDisplayObject();
  renderControllers();
  renderPole();
  if (mediaObject && handheld) {
    mediaObject.position.copy(handheld.position).add(new THREE.Vector3(-5, 2.8, 3));
    mediaObject.rotation.set(-0.21, -0.21, 0);
    mediaObject.scale.setScalar(1);
    applyLibraryAccessoryOffset(mediaObject, activePlatform.libraryPresentation?.accessories?.media);
  }
  const target = new THREE.Vector3(settings.cameraPanX, settings.cameraPanY, -8);
  const baseCameraPosition = new THREE.Vector3(settings.cameraX, settings.cameraY, settings.cameraZ);
  camera.position.copy(target).add(baseCameraPosition.sub(target).applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(settings.cameraTilt)));
  controls.target.copy(target);
  camera.zoom = settings.cameraZoom;
  camera.updateProjectionMatrix();
  controls.update();

  if (!sharedStage) environment.apply(settings);
  controls.autoRotate = settings.autoRotate;
  controls.autoRotateSpeed = 0.4;

  syncObjectEditor();

  const fields = {
    "lights-enabled": settings.lightsEnabled,
    hue: settings.hue,
    brightness: settings.brightness,
    "light-reflection": settings.lightReflection,
    "console-reflection": settings.consoleReflection,
    "light-x": settings.lightX,
    "light-y": settings.lightY,
    "light-z": settings.lightZ,
    "camera-x": settings.cameraX,
    "camera-y": settings.cameraY,
    "camera-z": settings.cameraZ,
    "camera-tilt": settings.cameraTilt,
    "camera-pan-x": settings.cameraPanX,
    "camera-pan-y": settings.cameraPanY,
    "camera-zoom": settings.cameraZoom,
    "depth-of-field-enabled": settings.depthOfFieldEnabled,
    "depth-of-field-blur": settings.depthOfFieldBlur,
    "reflections-enabled": settings.reflectionsEnabled,
    "auto-rotate": settings.autoRotate,
  };
  for (const [id, value] of Object.entries(fields)) {
    const input = document.getElementById(id);
    if (input.type === "checkbox") input.checked = value;
    else {
      input.value = value;
      const min = Number(input.min), max = Number(input.max);
      input.style.setProperty("--range-fill", `${((value - min) / (max - min)) * 100}%`);
      const output = document.getElementById(`${id}-value`);
      output.value = id === "depth-of-field-blur" ? value.toFixed(3) : id === "hue" ? `${Math.round(value)}°`
        : id === "brightness" ? `${value.toFixed(2)}×`
        : id === "light-reflection" || id === "console-reflection" || id === "camera-zoom" ? value.toFixed(2)
        : id === "camera-tilt" ? `${Math.round(value)}°`
        : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
    }
  }
  document.getElementById('depth-of-field-blur').disabled=!settings.depthOfFieldEnabled;
  updateHistoryButtons();
}
const objectSettingPrefix = () => ({ "game-box": "box", display: "display", plinth: "plinth", switch: "switch", controllers: "controller", pole: "pole" })[selectedObjectName];
const objectScaleBaseline = prefix => prefix === "switch" ? 170 : prefix === "pole" ? 5 : 1;
function renderObjectControlValues() {
  const prefix = objectSettingPrefix();
  for (const input of objectPanel.querySelectorAll('input[type="range"]')) {
    input.disabled = !prefix;
    if (!prefix) document.getElementById(`${input.id}-value`).value = "—";
  }
  if (!prefix) return;
  const position = settings[`${prefix}Position`];
  const rotation = settings[`${prefix}Rotation`];
  const scale = settings[`${prefix}Scale`];
  const baseline = objectScaleBaseline(prefix);
  const values = {
    "object-x": position[0], "object-y": position[1], "object-z": position[2],
    "object-rotate-x": THREE.MathUtils.radToDeg(rotation[0]),
    "object-rotate-y": THREE.MathUtils.radToDeg(rotation[1]),
    "object-rotate-z": THREE.MathUtils.radToDeg(rotation[2]),
    "object-scale": (scale[0] + scale[1] + scale[2]) / (3 * baseline),
  };
  for (const [id, value] of Object.entries(values)) {
    const input = document.getElementById(id);
    input.value = value;
    const min = Number(input.min), max = Number(input.max);
    input.style.setProperty("--range-fill", `${((value - min) / (max - min)) * 100}%`);
    document.getElementById(`${id}-value`).value = id.startsWith("object-rotate-")
      ? `${Math.round(value)}°`
      : id === "object-scale" ? `${value.toFixed(2)}×`
      : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
  }
}
function commitHistory() {
  const next = cloneSettings(settings);
  if (JSON.stringify(next) === JSON.stringify(lastCommitted)) return;
  undoStack.push(cloneSettings(lastCommitted));
  undoStack = undoStack.slice(-50);
  redoStack = [];
  lastCommitted = cloneSettings(next);
  updateHistoryButtons();
  persist();
  studio.rememberEdit();
}
function restoreHistory(from, to) {
  if (!from.length) return;
  to.push(cloneSettings(settings));
  settings = from.pop();
  lastCommitted = cloneSettings(settings);
  renderSettings();
  persist();
  studio.rememberEdit();
}
for (const controlsPanel of [panel, objectPanel]) controlsPanel.addEventListener("input", (event) => {
  if (event.target.id.startsWith("object-")) {
    const prefix = objectSettingPrefix();
    if (!prefix) return;
    const value = Number(event.target.value);
    if (event.target.id.startsWith("object-rotate-")) {
      const axis = event.target.id.at(-1);
      settings[`${prefix}Rotation`]["xyz".indexOf(axis)] = THREE.MathUtils.degToRad(value);
    } else if (event.target.id === "object-scale") {
      const base = objectScaleBaseline(prefix) * value;
      settings[`${prefix}Scale`] = [base, base, base];
    } else {
      const axis = event.target.id.at(-1);
      settings[`${prefix}Position`]["xyz".indexOf(axis)] = value;
    }
    renderSettings();
    persist();
    return;
  }
  const key = settingForControl[event.target.id];
  if (!key || event.target.type !== "range") return;
  settings[key] = Number(event.target.value);
  renderSettings();
  persist();
});
for (const controlsPanel of [panel, objectPanel]) controlsPanel.addEventListener("change", (event) => {
  const key = settingForControl[event.target.id];
  if (event.target.type === "checkbox" && key) {
    settings[key] = event.target.checked;
    renderSettings();
  }
  if (event.target.type === "range" || event.target.type === "checkbox") commitHistory();
});
const transformButtons = document.querySelectorAll("[data-transform]");
function setTransformTool(action) {
  transformAction = action;
  for (const tool of transformButtons) {
    const active = tool.dataset.transform === action;
    tool.classList.toggle("is-active", active);
    tool.setAttribute("aria-pressed", String(active));
  }
  transformControls.setMode(action);
  // Rotate with the object's axes. Keep movement aligned with scene positions.
  transformControls.setSpace(action === "rotate" ? "local" : "world");
}
for (const button of transformButtons) {
  button.addEventListener("click", () => {
    setTransformTool(button.dataset.transform);
    editMode = "object";
    syncObjectEditor();
    persist();
  });
}
cameraModeButton.addEventListener("click", () => { editMode = "camera"; syncObjectEditor(); persist(); });
objectModeButton.addEventListener("click", () => { editMode = "object"; syncObjectEditor(); persist(); });
editTarget.addEventListener("change", () => selectSceneObject(editTarget.value));

const selectionRay = new THREE.Raycaster(undefined, undefined, camera.near, camera.far);
const selectionPoint = new THREE.Vector2();
let selectionPress;
function isSelectionClick(event) {
  return selectionPress?.id === event.pointerId &&
    Math.hypot(event.clientX - selectionPress.x, event.clientY - selectionPress.y) <= 5;
}
canvas.addEventListener("pointerdown", event => {
  selectionPress = !studio.runtime && event.isPrimary && event.button === 0 && !transformControls.dragging
    ? { id: event.pointerId, x: event.clientX, y: event.clientY }
    : null;
});
canvas.addEventListener("pointermove", event => {
  if (!isSelectionClick(event)) selectionPress = null;
});
canvas.addEventListener("pointercancel", () => { selectionPress = null; });
canvas.addEventListener("pointerup", event => {
  const clicked = !studio.runtime && isSelectionClick(event);
  selectionPress = null;
  if (!clicked) return;
  const rect = canvas.getBoundingClientRect();
  selectionPoint.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    1 - ((event.clientY - rect.top) / rect.height) * 2,
  );
  camera.updateMatrixWorld();
  selectionRay.setFromCamera(selectionPoint, camera);
  const picked = pickSceneObject(selectionRay, sceneObjects());
  if (picked && !isEditingObjects()) studio.onInspector('objects');
  if (picked || isEditingObjects()) selectSceneObject(picked);
});

const monitorTypeSelect = document.querySelector("#monitor-type");
const controllersSelect = document.querySelector("#controllers-enabled");
const poleScopeSelect = document.querySelector("#totem-pole-scope");
const poleEnabledSelect = document.querySelector("#totem-pole-enabled");
poleScopeSelect.addEventListener("change", async () => {
  const all = poleScopeSelect.value === "all";
  poleScopeSelect.disabled = poleEnabledSelect.disabled = true;
  await studio.setPoleScope(all, value => {
    Object.assign(settings, normalizePole(value));
    undoStack = [];
    redoStack = [];
    lastCommitted = cloneSettings(settings);
    updateHistoryButtons();
    renderSettings();
  });
  poleScopeSelect.value = studio.editAllPoles ? "all" : "profile";
  poleScopeSelect.disabled = poleEnabledSelect.disabled = false;
});
poleEnabledSelect.addEventListener("change", () => {
  settings.poleEnabled = poleEnabledSelect.value === "yes";
  selectSceneObject(settings.poleEnabled ? "pole" : "");
  renderSettings();
  commitHistory();
});
monitorTypeSelect.addEventListener("change", () => {
  settings.displayType = monitorTypeSelect.value;
  if (settings.displayType !== "none") {
    selectedObjectName = "display";
    editMode = "object";
  }
  renderSettings();
  commitHistory();
});
controllersSelect.addEventListener("change", () => { settings.controllersEnabled = controllersSelect.value === "yes"; renderSettings(); persist(); commitHistory(); });
setTransformTool(transformAction);
transformControls.addEventListener("dragging-changed", (event) => {
  if (!event.value) {
    syncObjectEditor();
    commitHistory();
  }
});
transformControls.addEventListener("objectChange", () => {
  const object = gizmoTarget;
  if (!object) return;
  applyGizmo(gizmo, object, gizmoCenter);
  const prefix = objectSettingPrefix();
  settings[`${prefix}Position`] = object.position.toArray();
  settings[`${prefix}Rotation`] = object.rotation.toArray().slice(0, 3);
  settings[`${prefix}Scale`] = object.scale.toArray();
  renderObjectControlValues();
  persist();
});
function syncCameraFromOrbit() {
  settings.cameraX = camera.position.x;
  settings.cameraY = camera.position.y;
  settings.cameraZ = camera.position.z;
  settings.cameraTilt = 0;
  settings.cameraPanX = controls.target.x;
  settings.cameraPanY = controls.target.y;
  settings.cameraZoom = camera.zoom;
  for (const [id, value] of Object.entries({
    "camera-x": settings.cameraX, "camera-y": settings.cameraY, "camera-z": settings.cameraZ,
    "camera-tilt": settings.cameraTilt, "camera-pan-x": settings.cameraPanX,
    "camera-pan-y": settings.cameraPanY, "camera-zoom": settings.cameraZoom,
  })) {
    const input = document.getElementById(id);
    input.value = value;
    const min = Number(input.min), max = Number(input.max);
    input.style.setProperty("--range-fill", `${((value - min) / (max - min)) * 100}%`);
    document.getElementById(`${id}-value`).value = id === "camera-zoom" ? `${value.toFixed(2)}×`
      : id === "camera-tilt" ? `${Math.round(value)}°`
      : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
  }
}
controls.addEventListener("end", () => {
  if (gizmoTarget) return;
  syncCameraFromOrbit();
  commitHistory();
  persist();
});
undoButton.addEventListener("click", () => restoreHistory(undoStack, redoStack));
redoButton.addEventListener("click", () => restoreHistory(redoStack, undoStack));
document.querySelector('#object-undo').addEventListener('click',()=>restoreHistory(undoStack,redoStack));
document.querySelector('#object-redo').addEventListener('click',()=>restoreHistory(redoStack,undoStack));
document.querySelector("#object-close").addEventListener("click", () => {
  objectPanel.classList.add("is-closed");
  selectSceneObject("");
});
let objectPanelPosition;
try { objectPanelPosition=JSON.parse(localStorage.getItem('totem.studio.object-panel')); } catch {}
function placeObjectPanel() {
  if(!objectPanelPosition)return;
  objectPanel.style.right='auto';
  objectPanel.style.left=`${clamp(objectPanelPosition.x,0,Math.max(0,stage.clientWidth-objectPanel.offsetWidth))}px`;
  objectPanel.style.top=`${clamp(objectPanelPosition.y,0,Math.max(0,stage.clientHeight-objectPanel.offsetHeight))}px`;
}
const objectHeader=objectPanel.querySelector('header');let objectPanelDrag=null;
objectHeader.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.target.closest('button'))return;
  const bounds=objectPanel.getBoundingClientRect();objectPanelDrag={id:event.pointerId,x:event.clientX-bounds.left,y:event.clientY-bounds.top};
  objectHeader.setPointerCapture(event.pointerId);event.preventDefault();
});
objectHeader.addEventListener('pointermove',event=>{
  if(!objectPanelDrag||objectPanelDrag.id!==event.pointerId)return;
  const bounds=stage.getBoundingClientRect();objectPanelPosition={x:event.clientX-bounds.left-objectPanelDrag.x,y:event.clientY-bounds.top-objectPanelDrag.y};placeObjectPanel();
});
function finishObjectPanelDrag(){objectPanelDrag=null;if(objectPanelPosition)localStorage.setItem('totem.studio.object-panel',JSON.stringify(objectPanelPosition));}
objectHeader.addEventListener('pointerup',finishObjectPanelDrag);objectHeader.addEventListener('pointercancel',finishObjectPanelDrag);objectHeader.addEventListener('lostpointercapture',finishObjectPanelDrag);
document.querySelector("#scene-close").addEventListener("click", () => { panelOpen = false; updatePanelVisibility(); });
openButton.addEventListener("click", () => { panelOpen = true; updatePanelVisibility(); });
const panelHeader = panel.querySelector(".controls-header");
let panelDrag = null;
panelHeader.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest(".history-buttons")) return;
  const rect = panel.getBoundingClientRect();
  panelDrag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  panelHeader.setPointerCapture(event.pointerId);
  event.preventDefault();
});
panelHeader.addEventListener("pointermove", (event) => {
  if (!panelDrag || panelDrag.pointerId !== event.pointerId) return;
  const stageRect = stage.getBoundingClientRect();
  panelPosition = {
    left: event.clientX - stageRect.left - panelDrag.offsetX,
    top: event.clientY - stageRect.top - panelDrag.offsetY,
  };
  applyPanelPosition();
});
function finishPanelDrag(event) {
  if (!panelDrag || (event && panelDrag.pointerId !== event.pointerId)) return;
  panelDrag = null;
  applyPanelPosition();
  persist();
}
panelHeader.addEventListener("pointerup", finishPanelDrag);
panelHeader.addEventListener("pointercancel", finishPanelDrag);
panelHeader.addEventListener("lostpointercapture", finishPanelDrag);
if (!studio.runtime) {
  bindStudioPanelResize(panel, { container: stage, onResize: position => { panelPosition = position; } });
  bindStudioPanelResize(sidenavPanel, { container: stage, onResize: position => { sidenavPanelPosition = position; } });
  bindStudioPanelResize(objectPanel, { container: stage,
    onResize: ({ left, top }) => { objectPanelPosition = { x: left, y: top }; },
  });
}
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && uiEditMode && !isEditingObjects()) {
    uiEditMode = false;
    applyUiDesign();
    persist();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")
      && sidenavPanelOpen && !event.target.matches("input, textarea, select")) {
    event.preventDefault();
    const undoUi = event.key.toLowerCase() === "z" && !event.shiftKey;
    restoreUiHistory(undoUi ? uiUndoStack : uiRedoStack, undoUi ? uiRedoStack : uiUndoStack);
    return;
  }
  if (event.target.matches("input, textarea, select") && !(event.ctrlKey || event.metaKey)) return;
  if (isEditingObjects() && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (transformControls.dragging) return;
    const toolByKey = { w: "translate", e: "rotate", r: "scale" }[event.key.toLowerCase()];
    if (toolByKey) {
      event.preventDefault();
      setTransformTool(toolByKey);
      editMode = "object";
      syncObjectEditor();
      persist();
      return;
    }
    if (event.key.toLowerCase() === "q") {
      event.preventDefault();
      editMode = "camera";
      syncObjectEditor();
      persist();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      selectSceneObject("");
      return;
    }
  }
  if (!(event.ctrlKey || event.metaKey) || event.target.matches("input, textarea, select")) return;
  if (event.key.toLowerCase() === "z") {
    event.preventDefault();
    restoreHistory(event.shiftKey ? redoStack : undoStack, event.shiftKey ? undoStack : redoStack);
  } else if (event.key.toLowerCase() === "y") {
    event.preventDefault();
    restoreHistory(redoStack, undoStack);
  }
});
renderSettings();
updatePanelVisibility();

const video = document.querySelector("#gameplay");
video.autoplay = !studio.runtime;
video.crossOrigin = "anonymous";
video.addEventListener("error", () => console.error("Could not open the gameplay preview.", video.error));
function playGameplay() {
  if (!video.getAttribute('src')) return;
  void video.play().catch(error => {
    if (error.name === "NotAllowedError") showInputFeedback("Press Enter to play the preview with sound.");
    else if (error.name !== "AbortError") console.warn("Could not play the gameplay preview.", error);
  });
}
function toggleGameplay() {
  if (video.paused) playGameplay();
  else video.pause();
}
for (const event of ["play", "pause", "ended", "volumechange"]) {
  video.addEventListener(event, () => studio.refreshBarLabels());
}
const gameplayTexture = new THREE.VideoTexture(video);
gameplayTexture.colorSpace = THREE.SRGBColorSpace;
gameplayTexture.minFilter = THREE.LinearFilter;
gameplayTexture.magFilter = THREE.LinearFilter;
gameplayTexture.generateMipmaps = false;
const gameplayScreen = new THREE.MeshBasicMaterial({map:gameplayTexture,color:0x000000,toneMapped:false});
let arcadeCabinet;
video.addEventListener("resize", () => arcadeCabinet?.setVideoSize(video.videoWidth, video.videoHeight));
video.addEventListener("loadeddata", () => gameplayScreen.color.setHex(0xffffff));

const gameCoverTexture = new THREE.Texture();
gameCoverTexture.colorSpace = THREE.SRGBColorSpace;
gameCoverTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

gameBox = new THREE.Group();
const gameBoxBody = new THREE.Mesh(
  new THREE.BoxGeometry(7.23, 9.6, 0.62),
  new THREE.MeshStandardMaterial({ color: "#d93c42", roughness: 0.45, metalness: 0.05 })
);
gameBoxBody.position.y = 4.8;
gameBox.add(gameBoxBody);
const cover = new THREE.Mesh(
  new THREE.PlaneGeometry(6.99, 9.32),
  new THREE.MeshBasicMaterial({ map: gameCoverTexture, toneMapped: false })
);
cover.position.set(0, 4.8, 0.316);
gameBox.add(cover);
gameBox.position.fromArray(settings.boxPosition);
gameBox.rotation.fromArray(settings.boxRotation);
gameBox.scale.fromArray(settings.boxScale);
scene.add(gameBox);

supportObjects = new THREE.Group();
supportObjects.name = "Studio support objects";
scene.add(supportObjects);
pole = createTotemPole();
pole.root.visible = false;
supportObjects.add(pole.root);
window.addEventListener("pagehide", event => { if (!event.persisted) pole.dispose(); });
displayObject = new THREE.Group();
plinthObject = new THREE.Group();
plinthObject.name = "Plinth";
supportObjects.add(displayObject, plinthObject);
const displayModels = new Map();
let televisionPlinth = createPlinthPrimitive(environment.plinthMaterial);
controllerObjects = new THREE.Group();
supportObjects.add(controllerObjects);
const controllerSceneCache = new Map();
let controllerSceneRequest = 0;
let renderedControllers;
function normalizedController(source, width) {
  const controller = source.clone(true);
  const bounds = new THREE.Box3().setFromObject(controller);
  const size = bounds.getSize(new THREE.Vector3());
  const factor = width / Math.max(size.x, size.y, size.z);
  controller.scale.multiplyScalar(factor);
  bounds.setFromObject(controller);
  const center = bounds.getCenter(new THREE.Vector3());
  controller.position.set(-center.x, -bounds.min.y, -center.z);
  return controller;
}
function loadControllerScene(platformId) {
  const imported = importedControllerModels[platformId];
  const profile = controllerForPlatform(platformId);
  const key = imported ? `model:${platformId}` : `profile:${profile.id}`;
  if (!controllerSceneCache.has(key)) {
    const task = (async () => {
      let source;
      let useImportedModel = Boolean(imported);
      if (imported) {
        try { source = (await new GLTFLoader().loadAsync(imported.url)).scene; }
        catch (error) { console.warn(`Controller model unavailable for ${platformId}; using its profile model.`, error); useImportedModel = false; }
      }
      if (!useImportedModel) source = createControllerModel(profile).root;
      if (useImportedModel && platformId === "wiiu") addWiiUGamePadPreview(source, gameplayScreen);
      if (useImportedModel && imported?.pair) {
        const controller = normalizedController(source, 12);
        return { children: [controller] };
      }
      const left = normalizedController(source, 5.2);
      left.position.x -= 3.2;
      if (useImportedModel && imported?.standalone) return { children: [left] };
      const right = left.clone(true);
      right.position.x += 6.4;
      return { children: [left, right] };
    })();
    controllerSceneCache.set(key, task);
    task.catch(() => { if (controllerSceneCache.get(key) === task) controllerSceneCache.delete(key); });
  }
  return controllerSceneCache.get(key);
}
function renderDisplayObject() {
  if (!displayObject) return;
  const type = effectiveDisplayType();
  const label = DISPLAY_LABELS[type];
  const showPlinth = type === "tv";
  let option = editTarget.querySelector('option[value="display"]');
  if (label) {
    if (!option) {
      option = new Option(label, "display");
      editTarget.add(option);
    }
    option.textContent = label;
  } else {
    option?.remove();
    if (selectedObjectName === "display") selectedObjectName = "";
  }
  const plinthOption = editTarget.querySelector('option[value="plinth"]');
  if (showPlinth && !plinthOption) editTarget.add(new Option("Plinth", "plinth"));
  if (!showPlinth) {
    plinthOption?.remove();
    if (selectedObjectName === "plinth") selectedObjectName = "";
  }
  monitorTypeSelect.value = type;
  if (label && !displayModels.has(type)) {
    const placeholder = createDisplayPrimitive(type, gameplayScreen);
    if (showPlinth) placeholder.position.y = TV_PLINTH_HEIGHT;
    displayModels.set(type, placeholder);
  }
  const display = displayModels.get(type);
  if (displayObject.children[0] !== display) {
    displayObject.clear();
    if (display) attachViewContent(displayObject, display);
  }
  const plinth = showPlinth ? televisionPlinth : undefined;
  if (plinthObject.children[0] !== plinth) {
    plinthObject.clear();
    if (plinth) attachViewContent(plinthObject, plinth);
  }
  if (showPlinth && !tvModelLoad) {
    tvModelLoad = new GLTFLoader().loadAsync(tvModelUrl).then(({ scene: model }) => {
      const plinth = prepareTelevision(model, gameplayScreen, environment.plinthMaterial);
      const placeholder = displayModels.get("tv");
      const placeholderPlinth = televisionPlinth;
      displayModels.set("tv", model);
      televisionPlinth = plinth;
      if (effectiveDisplayType() === "tv") {
        renderDisplayObject();
        syncObjectEditor();
      }
      placeholderPlinth.geometry.dispose();
      for (const mesh of placeholder.children) {
        mesh.geometry.dispose();
        if (mesh.material !== gameplayScreen) mesh.material.dispose();
      }
    }).catch(error => console.warn("Using the TV placeholder because the bundled model could not be loaded.", error));
  }
  displayObject.position.fromArray(settings.displayPosition);
  displayObject.rotation.fromArray(settings.displayRotation);
  displayObject.scale.fromArray(settings.displayScale);
  plinthObject.position.fromArray(settings.plinthPosition);
  plinthObject.rotation.fromArray(settings.plinthRotation);
  plinthObject.scale.fromArray(settings.plinthScale);
}
function effectiveDisplayType() {
  if (studio.runtime && activePlatform.libraryPresentation?.display) {
    return libraryDisplay(activePlatform) === "built-in" ? "none" : "tv";
  }
  return settings.displayType;
}
function applyLibraryAccessoryOffset(model, pose) {
  if (!pose) return;
  model.position.add(new THREE.Vector3(pose.x, pose.y, pose.z).multiplyScalar(3));
  model.rotation.x += THREE.MathUtils.degToRad(pose.pitch);
  model.rotation.y += THREE.MathUtils.degToRad(pose.yaw);
  model.rotation.z += THREE.MathUtils.degToRad(pose.roll);
  model.scale.multiplyScalar(pose.zoom);
}
function renderPole() {
  if (!pole) return;
  poleScopeSelect.value = studio.editAllPoles ? "all" : "profile";
  poleEnabledSelect.value = settings.poleEnabled ? "yes" : "no";
  pole.root.visible = settings.poleEnabled;
  pole.root.position.fromArray(settings.polePosition);
  pole.root.rotation.fromArray(settings.poleRotation);
  pole.root.scale.fromArray(settings.poleScale);
  const option = editTarget.querySelector('option[value="pole"]');
  if (settings.poleEnabled && !option) editTarget.add(new Option("Totem pole", "pole"));
  if (!settings.poleEnabled) {
    option?.remove();
    if (selectedObjectName === "pole") selectedObjectName = "";
  }
}

function renderControllers() {
  if (!supportObjects) return;
  const deviceType = studio.type;
  const canShow = !["handheld", "device-only"].includes(deviceType);
  const usesStudioVisibility = activePlatform.kind !== "arcade" && activePlatform.libraryPresentation?.showControllers === undefined;
  document.querySelector("#controllers-row").hidden = !canShow || !usesStudioVisibility;
  controllersSelect.value = settings.controllersEnabled ? "yes" : "no";
  const platformId = activePlatform?.id;
  const show = canShow && libraryShowsControllers(activePlatform, settings.controllersEnabled)
    && (studio.runtime || platformId !== "wiiu");
  const option = editTarget.querySelector('option[value="controllers"]');
  if (show && !option) editTarget.add(new Option("Controllers", "controllers"));
  if (!show) {
    option?.remove();
    if (selectedObjectName === "controllers") selectedObjectName = "";
  }
  controllerObjects.position.fromArray(settings.controllerPosition);
  controllerObjects.rotation.fromArray(settings.controllerRotation);
  controllerObjects.scale.fromArray(settings.controllerScale);
  const poses = studio.runtime ? activePlatform?.libraryPresentation?.accessories : null;
  const key = JSON.stringify([show, platformId, poses?.controller, poses?.controller2]);
  if (key === renderedControllers) return;
  renderedControllers = key;
  controllerObjects.clear();
  const request = ++controllerSceneRequest;
  if (show) {
    void loadControllerScene(platformId).then(({ children }) => {
      if (request !== controllerSceneRequest) return;
      controllerObjects.name = "Controllers";
      children.forEach((child, index) => {
        const model = child.clone(true);
        applyLibraryAccessoryOffset(model, index === 0 ? poses?.controller : poses?.controller2);
        attachViewContent(controllerObjects, model);
      });
      syncObjectEditor();
    }).catch((error) => console.warn("Could not load the matching controller model.", error));
  }
}
renderSettings();

const categoryLabels = ["ALL", "RECENTLY PLAYED", "FAVOURITES"];
let activeCategoryIndex = 0;
let metadataRequest = 0;
let metadataPending = null;
let metadataQueued = null;
const categoryLabel = document.querySelector("#active-category");
const titlePrefix = document.querySelector("#featured-title-prefix");
const titleMain = document.querySelector("#featured-title");
const gameDescription = document.querySelector(".game-description");
const titleSubtitle = document.querySelector("#featured-subtitle");
const searchInput = document.querySelector("#game-search");
const genreFilter = document.querySelector("#genre-filter");
const menuPanel = document.querySelector("#game-menu");
const gameFilterStatus = document.querySelector("#game-filter-status");
const gameFilterPosition = document.querySelector("#game-filter-position");
const gameFilterGroups = [...document.querySelectorAll("#game-filter-groups > .pf-group")];
const filterPicker = mountFilterPicker(menuPanel, searchInput, genreFilter);
const gameCategoryInputs = [...document.querySelectorAll('input[name="game-category"]')];
let gameFilterDraft = null;
let gameFilterOriginal = null;
let gameFilterOpener = null;
let activeGameFilterGroup = 0;
const inputFeedback = document.querySelector("#input-feedback");
let feedbackTimer;
function showInputFeedback(message, duration = 1600) {
  if (!inputFeedback) return;
  inputFeedback.textContent = message;
  inputFeedback.classList.add("is-visible");
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => inputFeedback.classList.remove("is-visible"), duration);
}
function gameMatchesFilters(game, query, genre) {
  const categoryMatches = activeCategoryIndex === 0
    || (activeCategoryIndex === 1 && game.dataset.recent === "true")
    || (activeCategoryIndex === 2 && game.dataset.favorite === "true");
  const queryMatches = !query || game.textContent.toLowerCase().includes(query);
  const genreMatches = genre === "all" || game.dataset.genre === genre;
  return categoryMatches && queryMatches && genreMatches;
}
function refreshGameList() {
  const query = searchInput.value.trim().toLowerCase();
  const genre = genreFilter.value;
  const nextVisibleGames = [];
  let selectedIsVisible = false;
  for (const game of railGames) {
    const visible = gameMatchesFilters(game, query, genre);
    game.hidden = !visible;
    if (visible) {
      nextVisibleGames.push(game);
      if (game === selectedGame) selectedIsVisible = true;
    }
  }
  visibleGames = nextVisibleGames;
  if (!selectedIsVisible && visibleGames.length) selectGame(visibleGames[0]);
  else titleRail.center(selectedGame);
  gameInformation.setAvailable(studio.runtime && studio.native && Boolean(selectedGame && !selectedGame.hidden));
  if (!visibleGames.length) {
    showInputFeedback("No games match these filters");
  }
}
const gameInformation = mountGameInformation(
  document.querySelector("#game-info-open"),
  document.querySelector("#game-info"),
  () => studio.active && selectedGame && !selectedGame.hidden ? liveGames.get(selectedGame.dataset.game) : null,
  gameId => studioInvoke("get_indexed_game_diagnostics", { gameId }),
);
function showGameDetails(game, emptyMessage = "No indexed games for this platform.") {
  if (!game) gameDescription.classList.remove("is-expanded");
  ++mediaRequest;
  setGameplayRegions();
  arcadeCabinet?.setVideoSize(0, 0);
  arcadeCabinet?.setArtwork("banner");
  arcadeCabinet?.setArtwork("bezel");
  gameplayScreen.color.setHex(0x000000);
  video.pause();
  if (video.hasAttribute("src")) {
    video.removeAttribute("src");
    video.load();
  }
  void setTitleArtwork(null);
  titlePrefix.textContent = game?.dataset.titlePrefix || "";
  titleMain.textContent = game?.dataset.title || "No games";
  const isOdyssey = !studio.runtime && studio.type === "handheld" && !activePlatform.id
    && game?.dataset.game === "mario-odyssey";
  const liveGame = game && liveGames.get(game.dataset.game);
  gameInformation.setAvailable(studio.runtime && studio.native && Boolean(liveGame && !game.hidden));
  renderLiveGameMetadata(game, liveGame, isOdyssey, emptyMessage);
  cover.visible = isOdyssey;
  if (cover.material.map !== gameCoverTexture) {
    cover.material.map?.dispose();
    cover.material.map = gameCoverTexture;
    cover.material.needsUpdate = true;
  }
  if (isOdyssey && !studio.runtime && isTauri()) {
    video.removeAttribute("src");
    playGameplay();
  }
  if (liveGame) {
    void updateLiveGame(liveGame);
    void requestLiveGameMetadata(liveGame, platformRequest);
  } else renderTitlePreview();
}
function renderLiveGameMetadata(game, liveGame, isOdyssey = false, emptyMessage = "No indexed games for this platform.") {
  const metadata = liveGame?.metadata?.found ? liveGame.metadata : null;
  const releaseDate = metadata?.firstReleaseDate ? new Date(metadata.firstReleaseDate * 1000) : null;
  const releaseYear = releaseDate && !Number.isNaN(releaseDate.getTime()) ? String(releaseDate.getUTCFullYear()) : "";
  const genres = metadata?.genres || [];
  titleMain.textContent = metadata?.name || liveGame?.title || game?.dataset.title || "No games";
  titleSubtitle.textContent = isOdyssey ? "NINTENDO · 2017" : liveGame ? [activePlatform.name, releaseYear].filter(Boolean).join(" · ") : game ? "GAME PREVIEW" : "";
  document.querySelector(".title-rule").textContent = isOdyssey ? "A GLOBE-TROTTING 3D ADVENTURE" : liveGame ? genres.join(" · ") || activePlatform.name : game ? "DEMO GAME SELECTION" : "";
  gameDescription.textContent = liveGame
    ? metadata?.summary || liveGame.description || "No description available."
    : isOdyssey ? odyssey.description : game ? "Demo selection. Artwork and metadata for this game have not been configured yet." : emptyMessage;
  document.querySelector('[data-ui-element="rating-value"]').textContent = isOdyssey ? odyssey.releaseDate.slice(0, 4) : releaseYear || "—";
  document.querySelector('[data-ui-element="rating-count"]').textContent = isOdyssey ? "27 October" : releaseDate && !Number.isNaN(releaseDate.getTime()) ? releaseDate.toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" }) : "Released";
  document.querySelector('[data-ui-element="players-value"]').textContent = isOdyssey ? odyssey.players : metadata?.playerCount || "—";
  document.querySelector('[data-ui-element="duration-value"]').textContent = isOdyssey ? odyssey.publisher : metadata?.publishers?.join(", ") || "—";
  document.querySelector('[data-ui-element="duration-label"]').textContent = "Publisher";
  document.querySelectorAll(".game-tags span").forEach((tag, index) => { tag.textContent = isOdyssey ? odyssey.tags[index] : genres[index] || "—"; });
  document.querySelector('[data-ui-element="game-developer"]').textContent = isOdyssey ? odyssey.developer : metadata?.developers?.join(", ") || "";
}
function selectGame(game) {
  if (!game) return;
  const previous = selectedGame;
  selectedGame = game;
  if (previous !== game) gameDescription.classList.remove("is-expanded");
  const updateButton = (item, active) => {
    if (!item) return;
    item.classList.toggle("rail-active", active);
    item.dataset.uiStyle = active ? "game-button-active" : "game-button-inactive";
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
    if (studio.runtime && !uiEditMode) applyUiStyle(item);
  };
  if (studio.runtime && !uiEditMode) {
    if (previous !== game) updateButton(previous, false);
    updateButton(game, true);
  } else {
    for (const item of railGames) updateButton(item, item === game);
  }
  metadataRequest++;
  showGameDetails(game);
  if (!studio.runtime || uiEditMode) applyUiDesign();
  else titleRail.center(selectedGame);
}
function moveSelection(step) {
  if (!visibleGames.length) return;
  const currentIndex = visibleGames.indexOf(selectedGame);
  selectGame(visibleGames[(currentIndex + step + visibleGames.length) % visibleGames.length]);
}
function stepCategory(step) {
  activeCategoryIndex = (activeCategoryIndex + step + categoryLabels.length) % categoryLabels.length;
  categoryLabel.textContent = categoryLabels[activeCategoryIndex];
  refreshGameList();
}
function syncGameFilterControls(filters) {
  searchInput.value = filters.query;
  genreFilter.value = filters.genre;
  for (const input of gameCategoryInputs) input.checked = Number(input.value) === filters.category;
}
function updateGameFilterGroup(focus = false) {
  activeGameFilterGroup = (activeGameFilterGroup + gameFilterGroups.length) % gameFilterGroups.length;
  gameFilterPosition.textContent = `${activeGameFilterGroup + 1} / ${gameFilterGroups.length}`;
  gameFilterGroups.forEach((group, index) => group.classList.toggle("pf-active", index === activeGameFilterGroup));
  if (focus) {
    const group = gameFilterGroups[activeGameFilterGroup];
    (group.querySelector("input:checked") ?? group.querySelector("input, select"))?.focus();
  }
}
function moveGameFilterGroup(step) {
  activeGameFilterGroup = (activeGameFilterGroup + step + gameFilterGroups.length) % gameFilterGroups.length;
  updateGameFilterGroup(true);
}
function moveGameFilterOption(step) {
  const footerButtons = [...menuPanel.querySelectorAll("[data-game-filter-action]")];
  if (footerButtons.includes(document.activeElement)) {
    if (step < 0) updateGameFilterGroup(true);
    return;
  }
  const group = gameFilterGroups[activeGameFilterGroup];
  const active = group?.contains(document.activeElement) ? document.activeElement : null;
  if (!active) {
    group?.querySelector("input:checked, input, select")?.focus();
    return;
  }
  if (active instanceof HTMLSelectElement) {
    if (step > 0) footerButtons.find(button => button.dataset.gameFilterAction === "apply")?.focus();
    return;
  }
  if (active instanceof HTMLInputElement && active.type === "radio") {
    const radios = [...menuPanel.querySelectorAll(`input[type="radio"][name="${active.name}"]`)];
    const index = radios.indexOf(active);
    if (step > 0 && index === radios.length - 1) {
      footerButtons.find(button => button.dataset.gameFilterAction === "apply")?.focus();
      return;
    }
    const option = radios[(index + step + radios.length) % radios.length];
    option?.click();
    option?.focus();
    return;
  }
  if (step > 0) footerButtons.find(button => button.dataset.gameFilterAction === "apply")?.focus();
}
function clearGameFilterDraft() {
  gameFilterDraft = { category: 0, query: "", genre: "all" };
  syncGameFilterControls(gameFilterDraft);
  gameFilterStatus.textContent = "All filters cleared. Apply to update the game list.";
}
function finishGameFilters(accepted) {
  if (accepted && gameFilterDraft) {
    activeCategoryIndex = gameFilterDraft.category;
    categoryLabel.textContent = categoryLabels[activeCategoryIndex];
    syncGameFilterControls(gameFilterDraft);
    refreshGameList();
  } else if (gameFilterOriginal) {
    syncGameFilterControls(gameFilterOriginal);
  }
  toggleMenu(false);
}
function handleGameFilterAction(action, input = "") {
  const back = action === "escape" || action === "filters";
  const confirm = ["enter", "launch-game", "select"].includes(action) || (input === "a" && action === "none");
  if (filterPicker.active) {
    filterPicker.handle(back ? "back" : confirm ? "confirm"
      : ["up", "down", "left", "right"].includes(input) ? input
      : action === "previous-category" ? "left" : action === "next-category" ? "right" : action);
    return;
  }
  if (action === "escape" || action === "filters") finishGameFilters(false);
  else if (action === "clear-filters") clearGameFilterDraft();
  else if (confirm) {
    const focused = document.activeElement;
    if (focused === searchInput || focused === genreFilter) filterPicker.open(focused);
    else if (focused.matches("[data-game-filter-action]")) focused.click();
    else finishGameFilters(true);
  }
  else if (["left", "right"].includes(input) && document.activeElement.matches("[data-game-filter-action]")) {
    const buttons = [...menuPanel.querySelectorAll("[data-game-filter-action]")];
    buttons[(buttons.indexOf(document.activeElement) + (input === "left" ? -1 : 1) + buttons.length) % buttons.length].focus();
  }
  else if (action === "previous-category" || action === "previous-filter" || input === "left" || input === "lb") moveGameFilterGroup(-1);
  else if (action === "next-category" || action === "next-filter" || input === "right" || input === "rb") moveGameFilterGroup(1);
  else if (action === "up" || input === "up") moveGameFilterOption(-1);
  else if (action === "down" || input === "down") moveGameFilterOption(1);
}
function goBack() {
  if (studio.runtime) parent.postMessage({gameChooser:"back"},location.origin);
  else showInputFeedback("Platform selection is available in Totem");
}
function toggleMenu(forceOpen) {
  const shouldOpen = forceOpen ?? menuPanel.hidden;
  if (shouldOpen === !menuPanel.hidden) return;
  if (shouldOpen) {
    gameFilterOpener = document.activeElement;
    gameFilterOriginal = { category: activeCategoryIndex, query: searchInput.value, genre: genreFilter.value };
    gameFilterDraft = { ...gameFilterOriginal };
    syncGameFilterControls(gameFilterDraft);
    menuPanel.hidden = false;
    refreshGameFilterArtwork();
    activeGameFilterGroup = 0;
    updateGameFilterGroup(true);
    gameFilterStatus.textContent = "Choose filters, then Apply or Cancel.";
  } else {
    filterPicker.close();
    menuPanel.hidden = true;
    gameFilterDraft = null;
    gameFilterOriginal = null;
    gameFilterOpener?.focus();
    gameFilterOpener = null;
  }
  studio.refreshBarLabels();
}
menuPanel.addEventListener("focusin", event => {
  const index = gameFilterGroups.indexOf(event.target.closest(".pf-group"));
  if (index >= 0) {
    activeGameFilterGroup = index;
    updateGameFilterGroup();
  }
});
railGames.forEach((game) => game.addEventListener("click", () => selectGame(game)));
searchInput.addEventListener("input", () => { if (gameFilterDraft) gameFilterDraft.query = searchInput.value; });
genreFilter.addEventListener("change", () => { if (gameFilterDraft) gameFilterDraft.genre = genreFilter.value; });
gameCategoryInputs.forEach(input => input.addEventListener("change", () => {
  if (!gameFilterDraft) return;
  gameFilterDraft.category = Number(input.value);
  updateGameFilterGroup();
}));
const filterArtwork = {
  "previous-group": ["previous-filter", "lb", "PageUp"],
  "next-group": ["next-filter", "rb", "PageDown"],
  clear: ["clear-filters", "x", "Delete"],
  apply: ["select", "a", "Enter"],
  cancel: ["escape", "b", "Escape"],
};
function refreshGameFilterArtwork() {
  for (const button of menuPanel.querySelectorAll("[data-game-filter-action]")) {
    const [action, xbox, key] = filterArtwork[button.dataset.gameFilterAction];
    const artwork = actionArtwork(action);
    const image = button.querySelector("img");
    image.src = artwork.source ?? (artwork.keyboard ? keyboardGlyph(key) : controllerIcon(xbox));
  }
}
for (const button of menuPanel.querySelectorAll("[data-game-filter-action]")) {
  const image = document.createElement("img");
  image.alt = "";
  button.prepend(image);
  button.addEventListener("click", () => {
    switch (button.dataset.gameFilterAction) {
      case "previous-group": moveGameFilterGroup(-1); break;
      case "next-group": moveGameFilterGroup(1); break;
      case "clear": clearGameFilterDraft(); break;
      case "apply": finishGameFilters(true); break;
      case "cancel": finishGameFilters(false); break;
    }
  });
}
menuPanel.addEventListener("keydown", event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "Tab") {
    const controls = [...menuPanel.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled)")]
      .filter(control => control.getClientRects().length);
    if (!controls.length) return;
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    return;
  }
  if (["Enter", "Space"].includes(event.code) && event.target.closest("button")) return;
  if (event.key === "Escape") { event.preventDefault(); handleGameFilterAction("escape"); return; }
  if (filterPicker.active && event.key.startsWith("Arrow")) {
    event.preventDefault();
    filterPicker.handle(event.key.slice(5).toLowerCase());
    return;
  }
  if (event.target === genreFilter && ["Enter", " ", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  if (event.target.closest("#game-search") && !["Escape", "Enter"].includes(event.key)) return;
  const gameAction = appKeyboardAction("game", event.code);
  const action = gameAction === "none" ? appKeyboardAction("platform", event.code) : gameAction;
  if (event.code === "ArrowLeft" || event.code === "PageUp") handleGameFilterAction("previous-category");
  else if (event.code === "ArrowRight" || event.code === "PageDown") handleGameFilterAction("next-category");
  else if (action !== "none") handleGameFilterAction(action);
  else return;
  event.preventDefault();
});
document.querySelector("[data-controller-action='back']").addEventListener("click", goBack);
document.addEventListener("pointerdown", event => {
  if (menuPanel.hidden || menuPanel.contains(event.target) || event.target.closest('#bottom-nav [data-nav-action="filters"]')) return;
  toggleMenu(false);
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
let activeGamepadButtons = new Set();
let emulatorExitActive = false;
let emulatorExitNeedsRelease = false;
function pressedGamepadButtons() {
  return pressedControllerInputs(navigator.getGamepads?.().find(pad => pad?.connected));
}
function pollGamepadControls(now) {
  const pad = navigator.getGamepads?.().find(pad => pad?.connected);
  const currentButtons = pressedControllerInputs(pad);
  const previous = activeGamepadButtons;
  activeGamepadButtons = currentButtons;
  if ((emulatorExitActive && !document.hasFocus()) || emulatorExitNeedsRelease) {
    alphabetJump.cancel();
    if (document.hasFocus() && !currentButtons.size) emulatorExitNeedsRelease = false;
    return;
  }
  if ([...currentButtons].some(input => !previous.has(input))) useInputMode("xbox");
  if (alphabetJump.poll(now, currentButtons, previous,
      Boolean(pad && studio.runtime && studio.active && document.hasFocus() && !document.hidden &&
        !gameInformation.open && menuPanel.hidden && !launchingGame),
      input => appControllerAction("game", input))) return;
  if (!studio.runtime || gameInformation.open) return;
  for (const input of currentButtons) {
    const gameAction = appControllerAction("game", input);
    const platformAction = appControllerAction("platform", input);
    const action = !menuPanel.hidden && (platformAction === "clear-filters" || gameAction === "none")
      ? platformAction : gameAction;
    if (!previous.has(input)) {
      if (!menuPanel.hidden) handleGameFilterAction(action, input);
      else if (!["none", "previous-letter", "next-letter"].includes(action)) studio.onAction(action);
      else continue;
      break;
    }
  }
}
window.addEventListener("gamepadconnected", (event) => showInputFeedback(`${event.gamepad.id} connected`));
window.addEventListener("totem:action-mappings-changed", () => {
  applyUiDesign();
  refreshGameFilterArtwork();
});
trackInputMode();
window.addEventListener(inputModeEvent, () => {
  refreshBackArtwork();
  refreshGameFilterArtwork();
  studio.refreshBarLabels();
});
window.addEventListener("keydown", (event) => {
  if (!studio.runtime || event.defaultPrevented || event.isComposing || event.altKey ||
      event.ctrlKey || event.metaKey || gameInformation.open) return;
  if (event.key === "Escape" && !menuPanel.hidden) {
    event.preventDefault();
    toggleMenu(false);
    return;
  }
  if (event.target.closest("input, textarea, select, [contenteditable], .scene-controls summary")) return;
  if (["Enter", "Space"].includes(event.code) && event.target.closest("button, a")) return;
  const action = appKeyboardAction("game", event.code);
  if (action === "none") return;
  event.preventDefault();
  if (!event.repeat || ["up", "down", "previous-category", "next-category"].includes(action)) studio.onAction(action);
});

handheld = new THREE.Group();
handheld.position.fromArray(settings.switchPosition);
handheld.rotation.fromArray(settings.switchRotation);
handheld.scale.fromArray(settings.switchScale);
scene.add(handheld);
let platformRequest = 0;
const platformModelCache = new Map();
const arcadeCabinets = new WeakMap();
watchConsoleSkins(() => {
  for (const model of handheld?.children ?? []) {
    if (model.userData.platformId) applyConsoleSkin(model, model.userData.platformId);
  }
});
let liveGames = new Map();
window.addEventListener("message", event => {
  if (event.source !== parent || event.origin !== location.origin) return;
  if (["pause", "prepare", "open"].includes(event.data?.gameChooser)) {
    gameInformation.close();
    alphabetJump.cancel();
  }
  if (event.data?.gameChooser === "emulator-exit") {
    const { phase, message } = event.data.status;
    if (phase === "active" || phase === "ended") {
      emulatorExitActive = phase === "active";
      emulatorExitNeedsRelease = true;
    }
    if (message && studio.active) {
      if (launchingGame) launchExitNotice = message;
      showInputFeedback(message, 10000);
    }
  }
});
let launchingGame = false, launchUsedCinematic = false;
let launchExitNotice;
async function launchSelectedGame() {
  if (!studio.runtime || !studio.native) {
    showInputFeedback("Launch game is available in the Totem desktop game chooser.");
    return;
  }
  if (!studio.active || launchingGame) return;
  const game = liveGames.get(selectedGame?.dataset.game);
  if (!game) {
    showInputFeedback("Select a game to launch.");
    return;
  }
  launchingGame = true;
  launchUsedCinematic = false;
  launchExitNotice = null;
  const revision = platformRequest;
  showInputFeedback(`Launching ${game.title}…`, 5000);
  try {
    const emulator = await studioInvoke("launch_game", { gameId: game.id });
    if (studio.active && platformRequest === revision) {
      if (!launchUsedCinematic) video.pause();
      showInputFeedback(launchExitNotice ?? `Launched ${game.title} with ${emulator}.`, 5000);
    }
  } catch (error) {
    if (studio.active && platformRequest === revision)
      showInputFeedback(`Could not launch ${game.title}: ${error.message ?? error}`, 8000);
  } finally {
    launchingGame = false;
  }
}
const demoRailMarkup=document.querySelector('.rail-list').innerHTML;
let mediaRequest = 0;
function createDefaultPlatformPrimitive(type) {
  const root = new THREE.Group();
  root.userData.placeholder = true;
  root.position.y = SWITCH_PREVIEW_BASELINE_Y;
  const body = new THREE.MeshStandardMaterial({color:'#344052',roughness:0.58,metalness:0.12});
  const trim = new THREE.MeshStandardMaterial({color:'#17202b',roughness:0.42,metalness:0.18});
  const screenMaterial = gameplayScreen;
  const addBox = (width,height,depth,material,x,y,z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),material);
    mesh.position.set(x,y,z);root.add(mesh);return mesh;
  };
  if (type === 'handheld') {
    addBox(0.4,0.2,0.036,body,0,0.1,0);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.24,0.135),screenMaterial);
    screen.name='GameplayPreviewSurface';screen.position.set(0,0.1,0.019);root.add(screen);
    for (const x of [-0.155,0.155]) {
      const button = new THREE.Mesh(new THREE.CylinderGeometry(0.016,0.016,0.009,12),trim);
      button.rotation.x=Math.PI/2;button.position.set(x,0.1,0.021);root.add(button);
    }
  } else if (type === 'console') {
    addBox(0.3,0.12,0.22,body,0,0.06,0);
    addBox(0.08,0.035,0.018,trim,0,0.07,0.119);
  } else if (type === 'arcade') {
    addBox(0.3,0.42,0.2,body,0,0.21,0);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.2,0.14),screenMaterial);
    screen.name='GameplayPreviewSurface';screen.position.set(0,0.28,0.102);root.add(screen);
  } else if (type === 'computer') {
    addBox(0.34,0.24,0.025,body,0,0.24,0);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.28,0.17),screenMaterial);
    screen.name='GameplayPreviewSurface';screen.position.set(0,0.24,0.014);root.add(screen);
    addBox(0.04,0.12,0.04,trim,0,0.06,0);
    addBox(0.2,0.025,0.12,body,0,0.012,0);
  } else {
    addBox(0.24,0.16,0.16,body,0,0.08,0);
  }
  return root;
}
async function changePlatform(platform, type, games) {
  const request = ++platformRequest;
  if (studio.runtime) {
    ++mediaRequest;
    gameplayScreen.color.setHex(0x000000);
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  activePlatform = platform || {id:null,name:`Default ${type}`,kind:type};
  if (mediaObject) {
    mediaObject.removeFromParent();
    disposeImported(mediaObject);
    mediaObject = null;
  }
  if (studio.runtime && platform && libraryShowsMedia(platform)) {
    const format = libraryAccessoryOptions(platform).find(([id]) => id === "media")?.[1];
    if (format) {
      const model = createLibraryMedia(platform, format);
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      model.scale.setScalar(3.2 / Math.max(size.x, size.y, size.z));
      mediaObject = new THREE.Group();
      mediaObject.add(model);
      attachViewContent(supportObjects, mediaObject);
    }
  }
  const deviceName = type === "handheld" ? "Handheld" : type[0].toUpperCase() + type.slice(1);
  editTarget.querySelector('option[value="switch"]').textContent = deviceName;
  const hasBox = type !== "device-only" && libraryShowsMedia(activePlatform);
  if (hasBox && !editTarget.querySelector('option[value="game-box"]')) editTarget.add(new Option("Game Box", "game-box"));
  if (!hasBox) editTarget.querySelector('option[value="game-box"]')?.remove();
  if (selectedObjectName === "game-box" && !hasBox) selectedObjectName = "";
  gameBox.visible = hasBox;
  renderSettings();
  document.querySelector('.platform').textContent = activePlatform.name.toUpperCase();
  if (studio.runtime) gameRail.inert = true;
  liveGames.clear();
  showGameDetails(null, "Loading games…");
  arcadeCabinet = null;
  titleMain.textContent = "Loading…";
  for (const model of handheld.children) {
    setModelAnimationProgress(model, model.userData.closeWhenActive ? 0 : 1, null, 0, false);
    setModelActivity(model, false, 0, 0, true);
  }
  handheld.clear();
  syncTransformGizmo();
  try {
    if (!platform) {
      if(request!==platformRequest)return;
      attachViewContent(handheld, createDefaultPlatformPrimitive(type));renderSettings();
    } else {
    const device = studio.runtime ? platform : displayPlatform(platform, "studio");
    const cacheKey=[device.id,device.recordRevision,device.modelFile?.id,device.bundledModel?.sha256,device.usePlaceholder].join(':');
    if(!platformModelCache.has(cacheKey)) {
      const task=(async()=>{
      let model;
    const bundled = Boolean(platform.bundledModel && !platform.usePlaceholder &&
      (!platform.modelFile || platform.modelFile.id.startsWith(`${platform.bundledModel.sha256}.`)));
    const readBundledModel = (path, sha256) => (studio.runtime ? studio.native : isTauri())
      ? studioInvoke('read_bundled_model', { path, sha256 })
      : readBrowserBundledModel(path);
    if(platform.id === 'switch' && bundled) {
      // The original Switch scene units are part of its saved Studio layout.
      const loader = new GLTFLoader();
      const { path, sha256 } = device.bundledModel;
      const gltf = device === platform
        ? await loader.loadAsync(switchModelUrl)
        : await loader.parseAsync(await readBundledModel(path, sha256), "");
      model = gltf.scene;
    } else {
      model = await loadPlatformModel(device,{
        readAsset: reference => studioInvoke('read_platform_asset',{id:reference.id}),
        readBundledModel,
      }, false, { separateGamePad: studio.runtime });
      const bounds=new THREE.Box3().setFromObject(model);const size=bounds.getSize(new THREE.Vector3());
      const scale=0.22 / Math.max(size.x,size.y,size.z);model.scale.multiplyScalar(scale);
      bounds.setFromObject(model);const centre=bounds.getCenter(new THREE.Vector3());model.position.sub(centre);model.position.y+=SWITCH_PREVIEW_BASELINE_Y-new THREE.Box3().setFromObject(model).min.y;
    }
    const screen = studio.runtime && platform.libraryPresentation?.screenMesh
      ? findScreen(model, platform.libraryPresentation.screenMesh) : null;
    const cabinet = platform.id === "arcade" && bundled && !model.userData.placeholder
      ? prepareArcadeCabinet(model, gameplayScreen) : null;
    if (cabinet) arcadeCabinets.set(model, cabinet);
    const bound = cabinet?.screen ?? bindDeviceScreen(model, platform.id, gameplayScreen, {
      bundled: bundled && !model.userData.placeholder, selected: screen,
    });
    if (!bound) {
      const named = findScreen(model);
      if (named) named.material = gameplayScreen;
    }

        return model;
      })();
      platformModelCache.set(cacheKey,task);
      task.catch(()=>{if(platformModelCache.get(cacheKey)===task)platformModelCache.delete(cacheKey);});
    }
    const model=await platformModelCache.get(cacheKey);
    if(request!==platformRequest)return;
    arcadeCabinet = arcadeCabinets.get(model);
    applyConsoleSkin(model, platform.id);
    if (studio.runtime) {
      setModelAnimationProgress(model, model.userData.closeWhenActive ? 0 : 1, null, 0, false);
      setModelActivity(model, false, 0, 0, true);
    }
    attachViewContent(handheld, model);renderSettings();
    }
  } catch(error) {
    if (request !== platformRequest) return;
    attachViewContent(handheld, createDefaultPlatformPrimitive(type));renderSettings();showInputFeedback(`Using placeholder for ${activePlatform.name}`);console.error(error);
  }
  if (effectiveDisplayType() === "tv") await tvModelLoad;
  if (request !== platformRequest) return;
  selectedGame = null;
  activeCategoryIndex = 0;
  categoryLabel.textContent = 'ALL';
  if (!studio.runtime) {
    gameRail.innerHTML=demoRailMarkup;
    railGames=[...gameRail.querySelectorAll('.rail-game')];
    if (platform || type !== "handheld") {
      railGames.forEach((button, index) => {
        const title = `Game title ${index + 1}`;
        button.dataset.title = title;
        button.dataset.titlePrefix = "";
        button.querySelector(".rail-labels").textContent = title;
      });
    }
    railGames.forEach(button=>button.onclick=()=>selectGame(button));
    visibleGames = railGames.filter((button) => !button.hidden);
    selectGame(railGames.find(button=>button.dataset.game==='mario-odyssey'));
  } else {
    const list = games || [];
    liveGames=new Map(list.map(game=>[game.id,game]));
    railGames=list.map(game=>{const button=document.createElement('button');button.type='button';button.className='rail-game';button.dataset.uiStyle='game-button-inactive';button.dataset.game=game.id;button.dataset.title=game.title;button.dataset.titlePrefix='';button.dataset.genre='adventure';button.dataset.recent='true';const text=document.createElement('span');text.className='rail-labels';text.textContent=game.title;button.append(text);button.onclick=()=>selectGame(button);return button;});
    gameRail.replaceChildren(...railGames);
    visibleGames = railGames.filter((button) => !button.hidden);
    applyUiDesign();
    selectedGame = railGames[0] ?? null;
    if(selectedGame) selectGame(selectedGame);
    else showGameDetails(null);
    gameRail.inert = false;
  }
  handheld.visible = true;
  populateUiTargetOptions();renderUiEditor();
}
function requestLiveGameMetadata(game, platformRevision, request = metadataRequest) {
  if (!studio.native || !studio.active || !game || game.metadata) return;
  const next = { game, platformRevision, request };
  if (metadataPending) {
    metadataQueued = metadataPending.game === game ? null : next;
    return;
  }
  metadataPending = next;
  void studioInvoke("get_library_game_metadata", { gameId: game.id }).then(metadata => {
    if (platformRevision !== platformRequest || !studio.active
        || selectedGame?.dataset.game !== game.id || liveGames.get(game.id) !== game) return;
    game.metadata = metadata;
    renderLiveGameMetadata(selectedGame, game, false);
  }).catch(error => {
    if (request === metadataRequest && platformRevision === platformRequest && studio.active
        && selectedGame?.dataset.game === game.id)
      console.warn(`IGDB metadata unavailable for ${game.title}`, error);
  }).finally(() => {
    metadataPending = null;
    const queued = metadataQueued;
    metadataQueued = null;
    if (queued && queued.request === metadataRequest && queued.platformRevision === platformRequest && studio.active)
      requestLiveGameMetadata(queued.game, queued.platformRevision, queued.request);
  });
}
async function updateLiveGame(game) {
  const request=++mediaRequest;
  if (arcadeCabinet) {
    for (const type of ["banner", "bezel"]) {
      void loadArcadeArtwork(arcadeCabinet, game.id, type, request);
    }
  }
  const data=await studioInvoke('get_library_game_artwork',{gameId:game.id}).catch(()=>({}));
  if(request!==mediaRequest)return;
  void setTitleArtwork(data.logo, game.title);
  if(gameBox.visible && data.cover){const texture=new THREE.TextureLoader().load(data.cover);texture.colorSpace=THREE.SRGBColorSpace;cover.material.map=texture;cover.material.needsUpdate=true;cover.visible=true;}else cover.visible=false;
  const dualDemo = matchedDualScreenDemo(activePlatform.id, game.title);
  if (dualDemo && handheld.getObjectByName(SECONDARY_PREVIEW)) {
    setGameplayRegions(dualDemo.regions);
    video.src = new URL(dualDemo.path, document.baseURI).href;
    if (!studio.runtime || studio.active) playGameplay();
    return;
  }
  try {
    const url = await studioInvoke('get_library_game_video',{gameId:game.id});
    if(request!==mediaRequest)return;
    video.src = studio.runtime ? url : convertFileSrc(url);
    if (!studio.runtime || studio.active) playGameplay();
  } catch {
    if(request!==mediaRequest)return;
    gameplayScreen.color.setHex(0x000000);
    video.pause();video.removeAttribute('src');video.load();
  }
}

async function loadArcadeArtwork(cabinet, gameId, type, request) {
  const source = await gameThumbnail(gameId, type);
  if (!source || request !== mediaRequest) return;
  const texture = await new THREE.TextureLoader().loadAsync(source).catch(() => null);
  if (!texture) return;
  if (request !== mediaRequest) {
    texture.dispose();
    return;
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  cabinet.setArtwork(type, texture);
}

function setGameplayRegions(regions) {
  setPreviewRegion(handheld.getObjectByName(PRIMARY_PREVIEW), regions?.[0]);
  setPreviewRegion(handheld.getObjectByName(SECONDARY_PREVIEW), regions?.[1]);
}
studio.mount({
  gameplay: video,
  onGameplayBackdrop(value) {
    gameplayBackdrop = value;
    environment.gameplayBackdrop.apply(value);
    studio.save(sceneSnapshot());
    studio.rememberEdit();
  },
  getSnapshot:sceneSnapshot,
  apply:snapshot=>{
    gameplayBackdrop = snapshot.gameplayBackdrop;
    if (!sharedStage) environment.gameplayBackdrop.apply(gameplayBackdrop);
    studio.videoPanel?.setValue(gameplayBackdrop);
    settings=normalizeSettings({...snapshot.settings,...snapshot.pole});uiDesign=normalizeUiDesign(snapshot.uiDesign);uiSelection.clear();undoStack=[];redoStack=[];uiUndoStack=[];uiRedoStack=[];lastCommitted=cloneSettings(settings);lastCommittedUiDesign=structuredClone(uiDesign);applyUiDesign();renderSettings();populateUiTargetOptions();renderUiEditor();
  },
  onPlatform:changePlatform,
  onInspector(mode) {
    objectPanel.classList.toggle("is-closed", mode !== "objects");
    if (mode === "objects") {
      placeObjectPanel();
      syncObjectEditor();
    } else {
      selectSceneObject("");
    }
    panelOpen = mode === "scene" || mode === "camera";
    if (mode === "camera") {
      editMode = "camera";
      syncObjectEditor();
      document.querySelector("#camera-section").open = true;
    }
    sidenavPanelOpen = mode === "sidenav" || mode === "layout";
    studio.setBottomPanelOpen(mode === "bottom");
    studio.inspector = mode === "layout" ? "layout" : "sidenav";
    uiSelection.clear();
    document.body.dataset.inspector = studio.inspector;
    sidenavPanel.querySelector("strong").textContent = mode === "layout" ? "2D Elements" : "SideNav Menu";
    sidenavPanel.querySelector(".sidenav-scope").hidden = mode === "layout";
    // The 2D and SideNav panels share the same accordion.
    if (sidenavPanelOpen) sidenavPanel.querySelector(".control-section").open = true;
    populateUiTargetOptions();
    if (!currentUiElement()) uiSelectedTarget = uiElementSelect.options[0]?.value;
    renderUiEditor();
    updatePanelVisibility();
    updateSidenavPanelVisibility();
    if (mode === "camera") document.querySelector("#camera-section summary").focus({ preventScroll:true });
  },
  getToggleState(state) {
    if (state === "audio") return !video.muted;
    if (state === "playback") return !video.paused && !video.ended;
    return !menuPanel.hidden;
  },
  onResume() {
    activeGamepadButtons = pressedGamepadButtons();
    titleRail.center(selectedGame);
    playGameplay();
    requestLiveGameMetadata(liveGames.get(selectedGame?.dataset.game), platformRequest);
  },
  onPlatformError: showInputFeedback,
  onAction: action => {
    if (gameInformation.open) return;
    if (!menuPanel.hidden) { handleGameFilterAction(action); return; }
    ({
      enter: toggleGameplay, escape: goBack, filters: () => toggleMenu(),
      'launch-game': launchSelectedGame,
      [toggleDetailsAction]: () => {
        if (selectedGame && !selectedGame.hidden) gameDescription.classList.toggle("is-expanded");
      },
      up: () => moveSelection(-1), down: () => moveSelection(1),
      'previous-category': () => stepCategory(-1), 'next-category': () => stepCategory(1),
      'previous-letter': () => alphabetJump.jump(-1), 'next-letter': () => alphabetJump.jump(1),
      'previous-platform': () => studio.stepPlatform(-1), 'next-platform': () => studio.stepPlatform(1),
      video: toggleGameplay,
      'toggle-mute': () => { video.muted = !video.muted; },
    })[action]?.();
  },
});
panelOpen=false;sidenavPanelOpen=false;updatePanelVisibility();updateSidenavPanelVisibility();
if(!studio.runtime) changePlatform(null,'handheld');

const clock = new THREE.Clock();
function resize() {
  const { clientWidth: width, clientHeight: height } = canvas;
  if (!sharedStage) renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  composer?.setSize(width, height);
  titleRail.center(selectedGame);
}
addEventListener("resize", resize);
resize();

function updateFrame(now, dt) {
  if (studio.runtime && !studio.active) return;
  if (cinematicShot) {
    alphabetJump.cancel();
    const previous = activeGamepadButtons;
    activeGamepadButtons = pressedGamepadButtons();
    if ([...activeGamepadButtons].some(input => !previous.has(input) && appControllerAction("game", input) === "escape"))
      cancelCinematic();
    cinematicShot.tick(now);
    return;
  }
  pollGamepadControls(now);
  controls.update();
  if (studio.runtime) return;
  for (const model of handheld?.children ?? []) {
    setModelAnimationProgress(model, model.userData.closeWhenActive ? 0 : 1, null, dt);
    setModelActivity(model, true, dt, 1, false, camera);
  }
}
let cinematicShot, cancelCinematic, sampleCinematicGpu, cinematicPicture = false;
function prepareCinematic(platformId, createShot, cancel) {
  if (!studio.active || activePlatform.id !== platformId || renderer.getContext().isContextLost()) return null;
  const external = Object.hasOwn(DISPLAY_LABELS, effectiveDisplayType());
  const display = external ? displayObject : handheld;
  let mesh;
  display.traverseVisible(part => {
    if (part.isMesh && part.material === gameplayScreen && part.name !== SECONDARY_PREVIEW
      && (!mesh || part.name === PRIMARY_PREVIEW)) mesh = part;
  });
  let fallback;
  if (!mesh) {
    fallback = createDisplayPrimitive("tv", gameplayScreen);
    fallback.position.y = TV_PLINTH_HEIGHT;
    displayObject.add(fallback);
    mesh = fallback.children.find(part => part.material === gameplayScreen);
  }
  const focused = document.activeElement;
  const stageTabIndex = stage.getAttribute("tabindex");
  const wasPlaying = !video.paused;
  const controls = [...stage.children].filter(node => node !== canvas && node !== video && !node.inert);
  const stop = event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();
  };
  const shot = createShot({
    mesh, camera, uncroppedUV: uncroppedPreviewUV(mesh),
    onLock(locked, sampleGpu) {
      cinematicShot = locked ? shot : null;
      cancelCinematic = locked ? cancel : null;
      sampleCinematicGpu = sampleGpu;
      for (const node of controls) node.inert = locked;
      if (locked) {
        launchUsedCinematic = true;
        stage.tabIndex = -1;
        stage.focus({ preventScroll: true });
        window.addEventListener("keydown", stop, true);
        video.pause();
      } else {
        fallback?.removeFromParent();
        fallback?.traverse(part => {
          part.geometry?.dispose();
          if (part.material && part.material !== gameplayScreen) part.material.dispose();
        });
        window.removeEventListener("keydown", stop, true);
        if (stageTabIndex === null) stage.removeAttribute("tabindex");
        else stage.setAttribute("tabindex", stageTabIndex);
        if (document.hasFocus()) focused?.focus({ preventScroll: true });
        if (wasPlaying && video.paused) playGameplay();
      }
      activeGamepadButtons = pressedGamepadButtons();
    },
    onPicture(active) {
      cinematicPicture = active;
      stage.classList.toggle("cinematic-picture", active);
      parent.document.body.classList.toggle("cinematic-picture-active", active);
    },
    onSuspend(suspended) {
      if (!suspended && wasPlaying && video.paused) playGameplay();
      return sharedStage.setCinematicSuspended(suspended);
    },
  });
  return shot;
}
const backdropTexture = () => !cinematicPicture && video.hasAttribute('src') && !video.error ? gameplayTexture : null;
if (sharedStage) {
  sharedStage.registerView("gameChooser", {
    content: scene, camera, update: updateFrame, gameplayTexture: backdropTexture, prepareCinematic,
    cinematicGpu: () => cinematicPicture ? sampleCinematicGpu : null,
    depthOfField: () => ({ enabled: !cinematicPicture && settings.depthOfFieldEnabled, blur: settings.depthOfFieldBlur, focus: handheld || gameBox }),
  });
  document.documentElement.classList.add("shared-environment");
  document.body.classList.add("shared-environment");
} else {
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    environment.setContentRoots([handheld,gameBox,supportObjects]);
    environment.update(clock.elapsedTime);
    updateFrame(clock.elapsedTime * 1000, dt);
    environment.gameplayBackdrop.update(backdropTexture(), canvas.clientWidth || 1, canvas.clientHeight || 1);
    depthOfField.update({enabled:settings.depthOfFieldEnabled,blur:settings.depthOfFieldBlur},camera,handheld || gameBox);
    composer.render();
  });
  if (!studio.runtime && hasTotemAsset) {
    const runtime = { scene, camera, renderer, environment, activeView: { content: scene } };
    void import("../src/totem-personality-integration.js")
      .then(({ createTotemCompanion }) => createTotemCompanion({
        getRuntime: () => runtime,
        standaloneChooser: true,
        sceneInteractive: () => !isEditingObjects() && !uiEditMode && !gameInformation.open,
      }))
      .catch(error => console.error("Could not start the Studio Totem companion", error));
  }
}
if (studio.runtime && parent !== window) parent.postMessage({ gameChooser: 'ready' }, location.origin);
