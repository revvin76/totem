import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { addStudioLighting, configureStudioRenderer } from "./lighting.js";
import { bundledLogo } from "./platform-artwork.js";
import { mountBoxArtEditor } from "./box-art-editor.js";
import { confirmEditorLeave } from "./settings-navigation.js";
import { animationMembership } from "./animation-membership.js";
import { accessoryPose, devicePose, isPortable, libraryDisplay } from "./library-presentation.js";
import { layoutLibraryAccessories, loadLibraryAccessories, visibleLibraryAccessories } from "./library-accessories.js";
import {
  loadPlatformModel,
  parseModel,
  disposeImported,
  setModelAnimationProgress,
  validateModelAnimations,
  normalizePlatformAnimations,
  setModelMeshHighlight,
  LIBRARY_TV_MODEL_PATH,
  LIBRARY_TV_MODEL_SHA256,
} from "./platform-assets.js";

export function mountPlatformEditor(store, getCatalogue, onSaved, onPreview) {
  const $ = (id) => document.getElementById(id);
  const dialog = $("platform-editor");
  const form = $("platform-form");
  let draft,
    original,
    dirty = false,
    pendingLogo = null,
    pendingModel = null;
  let previewModel,
    renderer,
    camera,
    scene,
    orbit,
    previewRevision = 0,
    logoUrl;
  let saving = false,
    generation = 0,
    logoRevision = 0,
    previewBuffer = null,
    previewProgress = 0,
    selectedAnimationGroup = "",
    selectedMeshKeys = new Set(),
    meshSelectionAnchor = null,
    highlightMeshMode = false;
  let initialCredits = {};
  let videoSurfaceHighlight = false;
  let isolateMode = false;
  const isolateOriginalVisibility = new Map();
  let libraryTvModel = null, libraryTvRequest = 0;
  let accessoryModels = new Map(), accessoryRequest = 0;
  const libraryObject = $("editor-library-object");
  const field = (key) => form.elements.namedItem(key);
  function selectEditorTab(tab, focus = false, gameId) {
    for (const button of form.querySelectorAll("[data-editor-tab]")) {
      const selected = button.dataset.editorTab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of form.querySelectorAll("[data-editor-panel]"))
      panel.hidden = panel.dataset.editorPanel !== tab;
    if (focus) form.querySelector(`[data-editor-tab="${tab}"]`)?.focus();
    dialog.dispatchEvent(new CustomEvent("totem:platform-tab", { detail: { tab, gameId } }));
  }
  for (const button of form.querySelectorAll("[data-editor-tab]")) {
    button.addEventListener("click", () => selectEditorTab(button.dataset.editorTab));
    button.addEventListener("keydown", (event) => {
      const tabs = [...form.querySelectorAll("[data-editor-tab]")];
      const index = tabs.indexOf(button);
      const next = event.key === "ArrowRight" || event.key === "ArrowDown"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); selectEditorTab(tabs[next].dataset.editorTab, true); }
    });
  }
  const status = (message) => {
    $("editor-status").textContent = message;
  };
  const boxArtEditor = mountBoxArtEditor(store, () => { dirty = true; status("Unsaved Box Art changes. Save platform to apply."); });
  function invalidatePreview() {
    previewRevision++;
    isolateOriginalVisibility.clear();
    if (previewModel) {
      scene?.remove(previewModel);
      if (previewModel.userData.imported) disposeImported(previewModel);
      previewModel = null;
    }
  }
  function setupPreview() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    configureStudioRenderer(renderer);
    $("editor-preview").append(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "3D device preview. Drag to inspect; use Reset preview to restore the view.",
    );
    renderer.domElement.tabIndex = 0;
    scene = new THREE.Scene();
    const generator = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = generator.fromScene(room, 0.04).texture;
    room.dispose();
    generator.dispose();
    camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
    addStudioLighting(scene, camera);
    orbit = new OrbitControls(camera, renderer.domElement);
    orbit.listenToKeyEvents(renderer.domElement);
    orbit.enableDamping = true;
    new ResizeObserver(() => {
      const { width, height } = $("editor-preview").getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }).observe($("editor-preview"));
    renderer.setAnimationLoop(() => {
      if (dialog.open && !document.hidden) {
        orbit.update();
        renderer.render(scene, camera);
      }
    });
  }
  function resetPreview() {
    if (!camera) return;
    const bounds = new THREE.Box3();
    for (const model of [previewModel, libraryTvModel, ...accessoryModels.values()]) {
      if (model?.visible) bounds.union(new THREE.Box3().setFromObject(model));
    }
    if (bounds.isEmpty()) { camera.position.set(4.5, 3, 6.5); orbit.target.set(0, 0, 0); }
    else {
      const center = bounds.getCenter(new THREE.Vector3());
      const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
      const vertical = THREE.MathUtils.degToRad(camera.fov);
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
      const distance = radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.08;
      camera.position.copy(center).add(new THREE.Vector3(4.5, 3, 6.5).normalize().multiplyScalar(distance));
      orbit.target.copy(center);
      camera.far = Math.max(100, distance * 4); camera.updateProjectionMatrix();
    }
    orbit.update();
  }
  function applyLibraryPoseToPreview() {
    if (!previewModel) return;
    const { pose } = libraryPresentation();
    previewModel.position.set(pose.x, pose.y, pose.z + 1.6);
    previewModel.rotation.set(
      THREE.MathUtils.degToRad(pose.pitch),
      THREE.MathUtils.degToRad(pose.yaw),
      THREE.MathUtils.degToRad(pose.roll),
    );
    previewModel.scale.setScalar(pose.zoom);
    layoutLibraryAccessories(accessoryModels, libraryPresentation().accessories,
      new THREE.Box3().setFromObject(previewModel), 0.62);
  }
  function clearAccessories() {
    accessoryRequest++;
    for (const model of accessoryModels.values()) {
      model.removeFromParent();
      disposeImported(model);
    }
    accessoryModels.clear();
  }
  async function previewAccessories() {
    clearAccessories();
    const request = accessoryRequest;
    try {
      const models = await loadLibraryAccessories(draft, store);
      if (request !== accessoryRequest || !dialog.open) {
        for (const model of models.values()) disposeImported(model);
        return;
      }
      accessoryModels = models;
      for (const model of accessoryModels.values()) scene.add(model);
      if (previewModel) { applyLibraryPoseToPreview(); resetPreview(); }
    } catch (error) {
      if (request === accessoryRequest) status(`Accessory preview unavailable: ${error.message ?? error}`);
    }
  }
  async function loadLibraryTv() {
    if (libraryTvModel || !scene) return;
    const request = ++libraryTvRequest;
    try {
      const model = await parseModel(await store.readBundledModel(LIBRARY_TV_MODEL_PATH, LIBRARY_TV_MODEL_SHA256));
      if (request !== libraryTvRequest || !dialog.open) { disposeImported(model); return; }
      libraryTvModel = model;
      libraryTvModel.scale.setScalar(0.78);
      libraryTvModel.position.set(0, -0.15, 0.4);
      libraryTvModel.visible = libraryDisplay(draft) !== "built-in";
      scene.add(libraryTvModel);
      if (previewModel) resetPreview();
    } catch (error) {
      if (request === libraryTvRequest) $("editor-model-status").textContent = `TV preview unavailable: ${error.message ?? error}`;
    }
  }
  async function preview(buffer = null, { resetView = false } = {}) {
    if (buffer) previewBuffer = buffer;
    invalidatePreview();
    const revision = previewRevision;
    $("editor-model-status").textContent = "Preparing preview…";
    try {
      const model = buffer
        ? await parseModel(buffer, [], [0, 0, 0], [], draft.id, draft.modelAnimations, true)
        : await loadPlatformModel(draft, store, true, { separateGamePad: true });
      if (revision !== previewRevision) {
        if (model.userData.imported) disposeImported(model);
        return;
      }
      previewModel = model;
      applyLibraryPoseToPreview();
      scene.add(model);
      setModelAnimationProgress(model, previewProgress, selectedAnimationGroup);
      renderAnimationEditor();
      renderLibraryPresentation();
      if (resetView) resetPreview();
      const stats = model.userData.modelStats;
      $("editor-model-status").textContent = model.userData.modelLoadError
        ? `Model unavailable: ${model.userData.modelLoadError}. Placeholder shown.`
        : stats
        ? `${stats.meshes} meshes · ${stats.triangles.toLocaleString()} triangles · ${stats.textures} textures${stats.textureSize ? ` · largest map ${stats.textureSize}px` : ""}${!buffer && draft.bundledModel?.kind === "cad" && !draft.modelFile ? " · CAD-derived; photographic finish pending" : ""} · visual review required`
        : "Procedural placeholder · no external 3D file";
    } catch (error) {
      console.error("Platform preview failed", error);
      $("editor-model-status").textContent =
        `Preview unavailable: ${error.message}`;
    }
  }
  const animationSettings = () => {
    draft.modelAnimations = normalizePlatformAnimations(
      draft.id,
      draft.modelAnimations,
      previewModel?.userData.meshList ?? [],
    );
    return draft.modelAnimations;
  };
  function libraryPresentation() {
    return draft.libraryPresentation ??= { screenMesh: "", pose: { ...devicePose } };
  }
  const poseFields = {
    zoom: "editor-library-zoom", x: "editor-library-x", y: "editor-library-y", z: "editor-library-z",
    pitch: "editor-library-pitch", yaw: "editor-library-yaw", roll: "editor-library-roll",
  };
  const visibilityFields = {
    showControllers: "editor-library-controllers", showMedia: "editor-library-media",
  };
  function selectedPose() {
    const { pose, accessories } = libraryPresentation();
    return libraryObject.value === "device" ? pose : accessories?.[libraryObject.value] ?? accessoryPose;
  }
  function renderPoseFields() {
    const pose = selectedPose();
    for (const [key, input] of Object.entries(poseFields)) $(input).value = pose[key];
  }
  function renderLibraryPresentation() {
    const settings = libraryPresentation();
    const builtIn = libraryDisplay(draft) === "built-in";
    if (libraryTvModel) libraryTvModel.visible = !builtIn;
    const meshSelect = $("editor-library-screen");
    const previous = settings.screenMesh;
    meshSelect.replaceChildren(new Option("Automatic screen", ""));
    for (const mesh of previewModel?.userData.meshList ?? [])
      meshSelect.add(new Option(`${mesh.name} · ${mesh.key}`, mesh.key));
    if ([...meshSelect.options].some((option) => option.value === previous))
      meshSelect.value = previous;
    $("editor-library-display").value = libraryDisplay(draft);
    $("editor-library-screen-row").hidden = !builtIn;
    $("editor-library-highlight").hidden = !builtIn;
    $("editor-library-highlight").disabled = !meshSelect.value;
    for (const [key, id] of Object.entries(visibilityFields)) {
      const select = $(id);
      select.options[0].text = draft.kind === "arcade" ? "Default (Hide)"
        : key === "showControllers" ? "Use Studio layout" : "Default (Show)";
      select.value = settings[key] === undefined ? "" : settings[key] ? "show" : "hide";
    }
    const selectedObject = libraryObject.value;
    libraryObject.replaceChildren(new Option(isPortable(draft) ? "Handheld" : "Console", "device"),
      ...visibleLibraryAccessories(draft).map(([id, label]) => new Option(label, id)));
    if ([...libraryObject.options].some(option => option.value === selectedObject)) libraryObject.value = selectedObject;
    renderPoseFields();
    $("editor-library-highlight").setAttribute("aria-pressed", String(videoSurfaceHighlight));
  }
  function highlightVideoSurface() {
    const key = libraryPresentation().screenMesh;
    const available = (previewModel?.userData.meshList ?? []).some((mesh) => mesh.key === key);
    if (videoSurfaceHighlight && available) setModelMeshHighlight(previewModel, [key]);
    else {
      videoSurfaceHighlight = false;
      setModelMeshHighlight(previewModel, highlightMeshMode ? [...selectedMeshKeys] : []);
    }
    $("editor-library-highlight").setAttribute("aria-pressed", String(videoSurfaceHighlight));
  }
  function applyMeshIsolation() {
    if (!previewModel) return;
    if (!isolateMode) {
      for (const [mesh, visible] of isolateOriginalVisibility) mesh.visible = visible;
      isolateOriginalVisibility.clear();
      return;
    }
    previewModel.traverse((part) => {
      if (!part.isMesh) return;
      if (!isolateOriginalVisibility.has(part))
        isolateOriginalVisibility.set(part, part.visible);
      part.visible = isolateOriginalVisibility.get(part) && selectedMeshKeys.has(part.userData.animationMeshKey);
    });
  }
  function renderAnimationEditor() {
    const settings = animationSettings();
    const groupSelect = $("editor-animation-group");
    const previous = selectedAnimationGroup;
    groupSelect.replaceChildren(new Option("Select a group", ""));
    for (const group of settings.groups) groupSelect.add(new Option(group.name, group.id));
    if (settings.groups.some((group) => group.id === previous)) selectedAnimationGroup = previous;
    else selectedAnimationGroup = settings.groups[0]?.id ?? "";
    groupSelect.value = selectedAnimationGroup;
    const group = settings.groups.find((item) => item.id === selectedAnimationGroup);
    const delayControl = $("editor-animation-delay");
    delayControl.value = String(settings.transitionDelayMs);
    delayControl.disabled = false;
    if (isolateMode && !selectedMeshKeys.size) isolateMode = false;
    const values = {
      "editor-animation-name": group?.name ?? "",
      "editor-animation-axis": group?.axis ?? "x",
      "editor-animation-closed-angle": group?.closedAngle ?? 90,
      "editor-animation-open-angle": group?.openAngle ?? 0,
      "editor-animation-pivot-x": group?.pivot[0] ?? 0,
      "editor-animation-pivot-y": group?.pivot[1] ?? 0,
      "editor-animation-pivot-z": group?.pivot[2] ?? 0,
      "editor-animation-enabled": group?.enabled ?? true,
    };
    for (const [id, value] of Object.entries(values)) {
      const control = $(id);
      control.type === "checkbox" ? (control.checked = value) : (control.value = value);
      control.disabled = !group;
    }
    $("editor-animation-remove").disabled = !group;
    $("editor-animation-add-to-group").disabled = !group || selectedMeshKeys.size === 0;
    $("editor-animation-remove-from-group").disabled = !group || !selectedMeshKeys.size ||
      ![...selectedMeshKeys].some((key) => group.meshes.includes(key));
    $("editor-animation-assign").disabled = !group || selectedMeshKeys.size === 0;
    $("editor-animation-isolate").disabled = !previewModel || selectedMeshKeys.size === 0;
    $("editor-animation-isolate").setAttribute("aria-pressed", String(isolateMode));
    $("editor-animation-isolate").textContent = isolateMode ? "Show all meshes" : "Isolate selected";
    const list = $("editor-animation-meshes");
    list.replaceChildren();
    const meshes = previewModel?.userData.meshList ?? [];
    for (const mesh of meshes) {
      const assignedGroup = settings.groups.find((item) => item.meshes.includes(mesh.key));
      const membershipState = animationMembership(mesh, group, assignedGroup);
      const { inCurrentGroup } = membershipState;
      const row = document.createElement("div");
      row.className = "editor-animation-mesh-row";
      row.setAttribute("role", "listitem");
      row.dataset.inGroup = String(inCurrentGroup);
      row.dataset.selected = String(selectedMeshKeys.has(mesh.key));
      const select = document.createElement("button");
      select.type = "button";
      select.className = "editor-animation-mesh-select";
      select.setAttribute("aria-pressed", String(selectedMeshKeys.has(mesh.key)));
      select.textContent = mesh.name;
      select.title = mesh.name;
      select.addEventListener("click", (event) => {
        const range = event.shiftKey && meshSelectionAnchor
          ? [meshes.findIndex((item) => item.key === meshSelectionAnchor), meshes.findIndex((item) => item.key === mesh.key)]
          : null;
        if (range && range.every((index) => index >= 0)) {
          if (!event.ctrlKey && !event.metaKey) selectedMeshKeys = new Set();
          const [first, last] = range.sort((a, b) => a - b);
          for (let index = first; index <= last; index++) selectedMeshKeys.add(meshes[index].key);
        } else if (event.ctrlKey || event.metaKey) {
          if (selectedMeshKeys.has(mesh.key)) selectedMeshKeys.delete(mesh.key);
          else selectedMeshKeys.add(mesh.key);
          meshSelectionAnchor = mesh.key;
        } else {
          selectedMeshKeys = new Set([mesh.key]);
          meshSelectionAnchor = mesh.key;
        }
        renderAnimationEditor();
        if (highlightMeshMode) status(`Highlighted ${selectedMeshKeys.size} mesh${selectedMeshKeys.size === 1 ? "" : "es"} in the preview.`);
      });
      const badge = document.createElement("span");
      badge.className = "editor-animation-mesh-membership";
      badge.textContent = assignedGroup
        ? assignedGroup.id === group?.id ? "In current group" : `In ${assignedGroup.name}`
        : "Not grouped";
      const membership = document.createElement("button");
      membership.type = "button";
      membership.className = "editor-animation-membership-toggle";
      membership.textContent = membershipState.action;
      membership.disabled = membershipState.disabled;
      membership.setAttribute("aria-label", membershipState.label);
      membership.setAttribute("aria-pressed", String(inCurrentGroup));
      membership.addEventListener("click", async () => {
        if (!group || membership.disabled) return;
        group.meshes = inCurrentGroup
          ? group.meshes.filter((key) => key !== mesh.key)
          : [...group.meshes, mesh.key];
        animationSettings().configured = true;
        await updateAnimationPreview();
      });
      row.append(select, badge, membership);
      list.append(row);
    }
    if (!meshes.length) {
      const empty = document.createElement("p");
      empty.textContent = "No imported model meshes are available to select.";
      list.append(empty);
    }
    $("editor-animation-add").disabled = meshes.length === 0 || selectedMeshKeys.size === 0;
    $("editor-animation-add-to-group").disabled = !group || selectedMeshKeys.size === 0;
    $("editor-animation-highlight").setAttribute("aria-pressed", String(highlightMeshMode));
    $("editor-animation-highlight").textContent = highlightMeshMode ? "Stop highlighting" : "Highlight piece";
    const highlightedMeshes = new Set(highlightMeshMode ? [...selectedMeshKeys] : []);
    if (videoSurfaceHighlight && libraryPresentation().screenMesh)
      highlightedMeshes.add(libraryPresentation().screenMesh);
    setModelMeshHighlight(previewModel, [...highlightedMeshes]);
    applyMeshIsolation();
    setModelAnimationProgress(previewModel, previewProgress, selectedAnimationGroup);
  }
  async function updateAnimationPreview() {
    dirty = true;
    status("Unsaved animation settings. Save platform to apply.");
    const settings = animationSettings();
    settings.configured = true;
    settings.transitionDelayMs = Number($("editor-animation-delay").value);
    if (!Number.isFinite(settings.transitionDelayMs) || settings.transitionDelayMs < 0 || settings.transitionDelayMs > 5000) {
      status("Transition delay must be between 0 and 5000 ms.");
      return;
    }
    const group = settings.groups.find((item) => item.id === selectedAnimationGroup);
    if (group) {
      group.name = $("editor-animation-name").value.trim() || group.name;
      group.axis = $("editor-animation-axis").value;
      group.closedAngle = Number($("editor-animation-closed-angle").value);
      group.openAngle = Number($("editor-animation-open-angle").value);
      group.pivot = ["x", "y", "z"].map((axis) => Number($("editor-animation-pivot-" + axis).value));
      group.enabled = $("editor-animation-enabled").checked;
      try { validateModelAnimations(settings); } catch (error) { status(error.message); return; }
    }
    renderAnimationEditor();
    await preview(previewBuffer);
  }
  function drawList() {
    const query = $("editor-search").value.trim().toLowerCase();
    const all = getCatalogue();
    const records = all.filter(
      (p) =>
        (!$("editor-priority").checked || p.upgradePriority) &&
        `${p.name} ${p.maker}`.toLowerCase().includes(query),
    );
    $("editor-list-count").textContent =
      `${records.length} shown · ${all.length} platforms · ${all.filter((p) => p.upgradePriority).length} upgrades requested`;
    $("editor-list").replaceChildren();
    for (const record of records.sort(
      (a, b) => a.maker.localeCompare(b.maker) || a.name.localeCompare(b.name),
    )) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "editor-record";
      button.setAttribute("aria-current", String(record.id === draft?.id));
      const name = document.createElement("strong");
      name.textContent = record.name;
      const meta = document.createElement("span");
      meta.textContent = `${record.maker} · ${record.modelFile || record.bundledModel ? "3D asset" : "Placeholder"}${record.upgradePriority ? " · Upgrade requested" : ""}`;
      button.append(name, meta);
      button.addEventListener("click", () => switchRecord(record));
      $("editor-list").append(button);
    }
  }
  async function showLogo() {
    const revision = ++logoRevision;
    if (logoUrl) URL.revokeObjectURL(logoUrl);
    logoUrl = null;
    $("editor-logo-preview").hidden = true;
    $("editor-logo-description").textContent =
      pendingLogo?.name ?? draft.logoFile?.name ?? (bundledLogo(draft) ? "Bundled system logo · CoinOPS collection" : "No logo assigned");
    if (pendingLogo) logoUrl = URL.createObjectURL(pendingLogo);
    else if (draft.logoFile) {
      const id = draft.id;
      try {
        const url = await store.logoUrl(draft.logoFile);
        if (draft.id !== id || revision !== logoRevision) {
          URL.revokeObjectURL(url);
          return;
        }
        logoUrl = url;
      } catch (error) {
        status(`Logo unavailable: ${error.message}`);
      }
    }
    const previewUrl = logoUrl ?? bundledLogo(draft);
    if (previewUrl) {
      $("editor-logo-preview").src = previewUrl;
      $("editor-logo-preview").hidden = false;
    }
  }
  function bind(record) {
    generation++;
    original = structuredClone(record);
    draft = structuredClone(record);
    dialog.dispatchEvent(new CustomEvent("totem:platform-context", { detail: record }));
    libraryObject.value = "device";
    draft.modelAnimations = normalizePlatformAnimations(draft.id, draft.modelAnimations);
    previewBuffer = null;
    previewProgress = 0;
    selectedAnimationGroup = "";
    selectedMeshKeys = new Set();
    meshSelectionAnchor = null;
    highlightMeshMode = false;
    isolateMode = false;
    isolateOriginalVisibility.clear();
    videoSurfaceHighlight = false;
    $("editor-animation-closed").setAttribute("aria-pressed", "true");
    $("editor-animation-open").setAttribute("aria-pressed", "false");
    pendingLogo = pendingModel = null;
    dirty = false;
    for (const key of [
      "name",
      "maker",
      "kind",
      "color",
      "assetSource",
      "assetAuthor",
      "assetLicense",
    ])
      field(key).value =
        draft[key] ??
        draft.bundledModel?.[
          {
            assetSource: "source",
            assetAuthor: "author",
            assetLicense: "license",
          }[key]
        ] ??
        "";
    initialCredits = {};
    for (const [key, property] of [
      ["assetSource", "source"],
      ["assetAuthor", "author"],
      ["assetLicense", "license"],
    ]) {
      const bundled = draft.bundledModel && !draft.modelFile;
      if (bundled) field(key).value = draft.bundledModel[property] ?? "";
      field(key).readOnly = !!bundled;
      initialCredits[key] = field(key).value;
    }
    $("editor-device-id").textContent = `ID: ${draft.id}`;
    $("editor-quality").textContent = draft.upgradePriority
      ? "High-resolution upgrade requested · not yet accepted"
      : "Placeholder retained unless replaced";
    const asset =
      draft.modelFile ?? (!draft.usePlaceholder ? draft.bundledModel : null);
    $("editor-restore-bundled").hidden = !draft.bundledModel;
    $("editor-file-description").textContent = asset
      ? `${asset.name} · ${(asset.bytes / 1048576).toFixed(1)} MB · ${draft.modelFile ? "managed import" : "bundled asset"}`
      : `Generated in code · ${draft.model.profile} profile · ${draft.coverage}`;
    $("editor-logo-input").value = $("editor-model-input").value = "";
    status("Ready. Changes apply after Save platform.");
    $("editor-library-location").textContent =
      `Local library: ${store.libraryLocation()}`;
    drawList();
    renderLibraryPresentation();
    showLogo();
    preview(null, { resetView: true });
    void previewAccessories();
    boxArtEditor.bind(record);
  }
  function switchRecord(record) {
    if (!canClose(null, () => switchRecord(record))) return;
    const changedPlatform = draft?.id !== record.id;
    bind(record);
    if (changedPlatform && dialog.classList.contains("inline-platform-editor")) selectEditorTab("main", true);
  }
  form.addEventListener("input", (event) => {
    if (event.target === libraryObject || event.target.closest("#box-art-section, #editor-panel-sources")) return;
    dirty = true;
    status("Unsaved changes.");
  });
  $("editor-library-display").addEventListener("change", () => {
    libraryPresentation().display = $("editor-library-display").value;
    renderLibraryPresentation();
    resetPreview();
    dirty = true;
    status("Unsaved changes.");
  });
  $("editor-library-screen").addEventListener("change", () => {
    libraryPresentation().screenMesh = $("editor-library-screen").value;
    $("editor-library-highlight").disabled = !$("editor-library-screen").value;
    if (videoSurfaceHighlight) highlightVideoSurface();
    dirty = true;
    status("Unsaved changes.");
  });
  $("editor-library-highlight").addEventListener("click", () => {
    videoSurfaceHighlight = !videoSurfaceHighlight;
    highlightVideoSurface();
  });
  for (const [key, id] of Object.entries(visibilityFields)) {
    $(id).addEventListener("change", () => {
      const settings = libraryPresentation();
      const value = $(id).value;
      if (value === "") delete settings[key];
      else settings[key] = value === "show";
      renderLibraryPresentation();
      void previewAccessories();
    });
  }
  field("kind").addEventListener("change", () => {
    draft.kind = field("kind").value;
    renderLibraryPresentation();
    void previewAccessories();
  });
  libraryObject.addEventListener("change", renderPoseFields);
  $("editor-library-reset-pose").addEventListener("click", () => {
    const settings = libraryPresentation();
    if (libraryObject.value === "device") settings.pose = { ...devicePose };
    else if (settings.accessories) delete settings.accessories[libraryObject.value];
    renderPoseFields();
    applyLibraryPoseToPreview();
    dirty = true;
    status("Unsaved changes.");
  });
  for (const [key, id] of Object.entries(poseFields)) $(id).addEventListener("input", () => {
    const input = $(id);
    if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) return;
    const settings = libraryPresentation();
    const target = libraryObject.value;
    const pose = target === "device" ? settings.pose :
      ((settings.accessories ??= {})[target] ??= { ...accessoryPose });
    pose[key] = input.valueAsNumber;
    applyLibraryPoseToPreview();
    dirty = true;
    status("Unsaved changes.");
  });
  $("editor-search").addEventListener("input", drawList);
  $("editor-priority").addEventListener("change", drawList);
  $("editor-new").addEventListener("click", () => {
    if (saving || dirty) {
      status("Save or discard your current changes first.");
      return;
    }
    bind({
      id: `user-${crypto.randomUUID()}`,
      name: "New platform",
      maker: "Your manufacturer",
      kind: "console",
      color: "#77d9ff",
      short: "CUSTOM",
      year: "—",
      era: "YOUR COLLECTION",
      tagline: "Your platform. Your collection.",
      coverage: "Custom procedural placeholder",
      model: {
        profile: "cartridge",
        width: 3,
        height: 0.4,
        depth: 2,
        color: "#708296",
      },
    });
    dirty = true;
    field("name").focus();
    field("name").select();
  });
  $("editor-discard").addEventListener("click", () => {
    if (!saving) bind(original);
  });
  $("editor-reset-preview").addEventListener("click", resetPreview);
  $("editor-animation-closed").addEventListener("click", () => {
    previewProgress = 0;
    setModelAnimationProgress(previewModel, previewProgress, selectedAnimationGroup);
    $("editor-animation-closed").setAttribute("aria-pressed", "true");
    $("editor-animation-open").setAttribute("aria-pressed", "false");
  });
  $("editor-animation-open").addEventListener("click", () => {
    previewProgress = 1;
    setModelAnimationProgress(previewModel, previewProgress, selectedAnimationGroup);
    $("editor-animation-closed").setAttribute("aria-pressed", "false");
    $("editor-animation-open").setAttribute("aria-pressed", "true");
  });
  $("editor-animation-group").addEventListener("change", () => {
    selectedAnimationGroup = $("editor-animation-group").value;
    animationSettings();
    selectedMeshKeys = new Set();
    meshSelectionAnchor = null;
    isolateMode = false;
    renderAnimationEditor();
    setModelAnimationProgress(previewModel, previewProgress, selectedAnimationGroup);
  });
  for (const id of [
    "editor-animation-name", "editor-animation-axis", "editor-animation-closed-angle",
    "editor-animation-open-angle", "editor-animation-pivot-x", "editor-animation-pivot-y",
    "editor-animation-pivot-z", "editor-animation-enabled", "editor-animation-delay",
  ]) $(id).addEventListener("change", updateAnimationPreview);
  $("editor-animation-add").addEventListener("click", async () => {
    const meshes = [...selectedMeshKeys];
    if (!meshes.length) { status("Select at least one mesh to create an animation group."); return; }
    const id = `mesh-group-${crypto.randomUUID().slice(0, 8)}`;
    const meshCentres = new Map((previewModel?.userData.meshList ?? []).map((mesh) => [mesh.key, mesh.centre]));
    const pivot = [0, 1, 2].map((axis) => meshes.reduce((sum, key) => sum + (meshCentres.get(key)?.[axis] ?? 0), 0) / meshes.length);
    animationSettings().configured = true;
    animationSettings().groups.push({ id, name: `Hinge ${animationSettings().groups.length + 1}`, meshes, pivot, axis: "x", closedAngle: 90, openAngle: 0, enabled: true });
    selectedAnimationGroup = id;
    await updateAnimationPreview();
  });
  $("editor-animation-assign").addEventListener("click", async () => {
    const settings = animationSettings();
    settings.configured = true;
    const group = settings.groups.find((item) => item.id === selectedAnimationGroup);
    if (!group || !selectedMeshKeys.size) return;
    const conflicts = settings.groups.find((item) => item.id !== group.id && item.meshes.some((key) => selectedMeshKeys.has(key)));
    if (conflicts) { status(`Remove the selected mesh from “${conflicts.name}” before assigning it to this group.`); return; }
    group.meshes = [...selectedMeshKeys];
    await updateAnimationPreview();
  });
  $("editor-animation-add-to-group").addEventListener("click", async () => {
    const settings = animationSettings();
    settings.configured = true;
    const group = settings.groups.find((item) => item.id === selectedAnimationGroup);
    if (!group || !selectedMeshKeys.size) return;
    const conflicts = settings.groups.find((item) => item.id !== group.id &&
      item.meshes.some((key) => selectedMeshKeys.has(key)));
    if (conflicts) {
      status(`Cannot add selection; one or more meshes already belong to “${conflicts.name}”.`);
      return;
    }
    group.meshes = [...new Set([...group.meshes, ...selectedMeshKeys])];
    await updateAnimationPreview();
  });
  $("editor-animation-remove-from-group").addEventListener("click", async () => {
    const settings = animationSettings();
    settings.configured = true;
    const group = settings.groups.find((item) => item.id === selectedAnimationGroup);
    if (!group || !selectedMeshKeys.size) return;
    const originalCount = group.meshes.length;
    group.meshes = group.meshes.filter((key) => !selectedMeshKeys.has(key));
    if (group.meshes.length === originalCount) {
      status("Select one or more meshes tagged as part of the current group.");
      return;
    }
    await updateAnimationPreview();
  });
  $("editor-animation-highlight").addEventListener("click", () => {
    highlightMeshMode = !highlightMeshMode;
    setModelMeshHighlight(previewModel, highlightMeshMode ? [...selectedMeshKeys] : []);
    renderAnimationEditor();
    status(highlightMeshMode ? "Highlight mode on. Click a mesh name to light it up in the preview." : "Highlight mode off.");
  });
  $("editor-animation-isolate").addEventListener("click", () => {
    if (!selectedMeshKeys.size) return;
    isolateMode = !isolateMode;
    renderAnimationEditor();
    status(isolateMode
      ? `Isolating ${selectedMeshKeys.size} selected mesh${selectedMeshKeys.size === 1 ? "" : "es"}.`
      : "All model meshes are visible.");
  });
  $("editor-animation-remove").addEventListener("click", async () => {
    const settings = animationSettings();
    settings.configured = true;
    settings.groups = settings.groups.filter((group) => group.id !== selectedAnimationGroup);
    selectedAnimationGroup = settings.groups[0]?.id ?? "";
    selectedMeshKeys = new Set();
    meshSelectionAnchor = null;
    isolateMode = false;
    await updateAnimationPreview();
  });
  for (const [id, factor] of [
    ["editor-zoom-in", 0.8],
    ["editor-zoom-out", 1.25],
  ])
    $(id).addEventListener("click", () => {
      const offset = camera.position
        .clone()
        .sub(orbit.target)
        .multiplyScalar(factor);
      if (offset.length() > 0.2 && offset.length() < 50)
        camera.position.copy(orbit.target).add(offset);
      orbit.update();
    });
  for (const [id, sign] of [
    ["editor-turn-left", -1],
    ["editor-turn-right", 1],
  ])
    $(id).addEventListener("click", () => {
      const offset = camera.position.clone().sub(orbit.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), (sign * Math.PI) / 8);
      camera.position.copy(orbit.target).add(offset);
      orbit.update();
    });
  $("editor-logo-input").addEventListener("change", async () => {
    const file = $("editor-logo-input").files[0];
    if (!file) return;
    pendingLogo = file;
    dirty = true;
    await showLogo();
    status("Logo selected; Save platform to import it.");
  });
  $("editor-model-input").addEventListener("change", async () => {
    const file = $("editor-model-input").files[0];
    if (!file) return;
    const id = draft.id;
    const token = generation;
    try {
      if (file.size > 128 * 1048576) throw new Error("Model limit is 128 MB.");
      const buffer = await file.arrayBuffer();
      const checked = await parseModel(buffer);
      disposeImported(checked);
      if (draft.id !== id || generation !== token) return;
      pendingModel = file;
      draft.usePlaceholder = false;
      dirty = true;
      for (const key of ["assetSource", "assetAuthor", "assetLicense"]) {
        field(key).readOnly = false;
        if (field(key).value === initialCredits[key]) field(key).value = "";
      }
      $("editor-file-description").textContent =
        `${file.name} · pending import`;
      await preview(buffer);
      status("Model validated. Save platform to import it.");
    } catch (error) {
      status(`Model not selected: ${error.message}`);
      $("editor-model-input").value = "";
    }
  });
  $("editor-remove-logo").addEventListener("click", () => {
    pendingLogo = null;
    delete draft.logoFile;
    dirty = true;
    showLogo();
    status("Logo removed from draft. Save to apply.");
  });
  $("editor-remove-model").addEventListener("click", () => {
    pendingModel = null;
    delete draft.modelFile;
    draft.usePlaceholder = true;
    dirty = true;
    $("editor-file-description").textContent =
      "Procedural placeholder will be restored on Save.";
    preview();
    status("Model removed from draft. Save to apply.");
  });
  $("editor-restore-bundled").addEventListener("click", () => {
    if (!draft.bundledModel) return;
    pendingModel = null;
    delete draft.modelFile;
    draft.usePlaceholder = false;
    dirty = true;
    for (const [key, property] of [
      ["assetSource", "source"],
      ["assetAuthor", "author"],
      ["assetLicense", "license"],
    ]) {
      field(key).value = draft.bundledModel[property] ?? "";
      field(key).readOnly = true;
    }
    $("editor-file-description").textContent =
      `${draft.bundledModel.name} · bundled asset`;
    preview();
    status("Bundled model restored in draft. Save to apply.");
  });
  async function savePlatform() {
    if (saving) return false;
    if (!form.reportValidity()) {
      const invalid = form.querySelector(":invalid");
      const panel = invalid?.closest("[data-editor-panel]");
      if (panel) selectEditorTab(panel.dataset.editorPanel);
      invalid?.focus();
      return false;
    }
    const focused = document.activeElement;
    saving = true;
    $("editor-fields").disabled = true;
    $("editor-save").disabled = true;
    status("Importing assets and saving platform…");
    let committed;
    try {
      const record = structuredClone(draft);
      const boxArt = await boxArtEditor.forSave();
      if (boxArt) record.boxArt = boxArt;
      for (const key of [
        "name",
        "maker",
        "kind",
        "color",
        "assetSource",
        "assetAuthor",
        "assetLicense",
      ])
        record[key] = field(key).value.trim();
      if (pendingLogo)
        record.logoFile = await store.importAsset(pendingLogo, "logo");
      if (pendingModel)
        record.modelFile = await store.importAsset(pendingModel, "model");
      const saved = await store.save(record);
      committed = saved;
      await onSaved(saved);
      bind(saved);
      status(
        "Platform saved and applied to the carousel. Files are stored locally.",
      );
      return true;
    } catch (error) {
      if (committed) {
        bind(committed);
        status(
          `Platform saved, but carousel refresh failed: ${error.message ?? error}. Reopen the app to reload it.`,
        );
        return true;
      }
      status(`Not saved: ${error.message ?? error}`);
      return false;
    } finally {
      saving = false;
      $("editor-fields").disabled = false;
      $("editor-save").disabled = false;
      if (dialog.open && document.activeElement === document.body) {
        if (focused !== document.body && focused?.getClientRects().length) focused.focus();
        if (document.activeElement === document.body) $("editor-status").focus();
      }
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePlatform();
  });
  $("editor-show-carousel").addEventListener("click", async () => {
    if (!dialog.dispatchEvent(new Event("totem:platform-sources-can-leave", { cancelable: true }))) return;
    if (dirty || saving || !getCatalogue().some((p) => p.id === draft.id)) {
      status(
        "Save this platform before opening it in the carousel, or discard changes to an existing platform.",
      );
      return;
    }
    dialog.close();
    await onPreview(draft.id);
  });
  function canClose(event, resume) {
    if (!dialog.dispatchEvent(new CustomEvent("totem:platform-sources-can-leave", { cancelable: true, detail: resume }))) {
      event?.preventDefault();
      return false;
    }
    if (saving || dirty) {
      event?.preventDefault();
      status(
        saving
          ? "Wait for saving to finish."
          : "Save or discard your changes before closing.",
      );
      if (!saving && resume) confirmEditorLeave({
        title: "Unsaved platform changes",
        save: savePlatform,
        discard: () => bind(original),
        leave: resume,
      });
      return false;
    }
    return true;
  }
  function close(event) { if (canClose(event, () => close())) dialog.close(); }
  dialog.addEventListener("totem:platform-editor-can-close", event => canClose(event, event.detail));
  $("editor-close").addEventListener("click", close);
  dialog.addEventListener("cancel", close);
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    boxArtEditor.close();
    clearAccessories();
    invalidatePreview();
    ++libraryTvRequest;
    if (libraryTvModel) { scene?.remove(libraryTvModel); disposeImported(libraryTvModel); libraryTvModel = null; }
    if (!$("folder-settings").open) ($("navigation-toggle") ?? $("editor-toggle")).focus();
  });
  const home = document.createComment("Platform editor host");
  dialog.before(home);
  return {
    open(id, tab = "main", inlineHost, gameId) {
      if (dialog.open && !canClose()) return false;
      if (inlineHost) {
        inlineHost.append(dialog);
        dialog.classList.add("inline-platform-editor");
      } else {
        home.after(dialog);
        dialog.classList.remove("inline-platform-editor");
      }
      if (!dialog.open) {
        if (inlineHost) dialog.show();
        else dialog.showModal();
      }
      setupPreview();
      loadLibraryTv();
      bind(getCatalogue().find((p) => p.id === id) ?? getCatalogue()[0]);
      selectEditorTab(tab, false, gameId);
      return true;
    },
  };
}
