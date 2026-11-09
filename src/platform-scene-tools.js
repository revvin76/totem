import { Group, MathUtils, Mesh, MeshBasicMaterial, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { applyPlatformCameraPose } from './framing.js';
import { normalizeCameraSettings, scalePlatformPole } from './studio-page-settings.js';

export function createPlatformSceneTools({ scene, camera, host, lights, activeModel }) {
  const input = document.createElement('div');
  input.className = 'studio-scene-input';
  input.hidden = true;
  input.tabIndex = 0;
  input.setAttribute('role', 'region');
  input.setAttribute('aria-label', 'Studio scene. Drag to orbit, scroll to zoom, or use the arrow keys to pan in Free Look.');
  host.append(input);

  const look = camera.clone();
  const orbit = new OrbitControls(look, input);
  orbit.enabled = false;
  orbit.minDistance = 1;
  orbit.maxDistance = 115;
  orbit.listenToKeyEvents(input);

  const transform = new TransformControls(camera, input);
  transform.setSize(.8);
  transform.enabled = false;
  const gizmo = transform.getHelper();
  const markers = new Group(), pivot = new Group();
  markers.userData.studioHelper = true;
  markers.visible = false;
  scene.add(markers, pivot, gizmo);
  const geometry = new SphereGeometry(1, 16, 12);
  for (const id of Object.keys(lights)) {
    const marker = new Mesh(geometry, new MeshBasicMaterial({ toneMapped: false, depthTest: false, depthWrite: false }));
    marker.userData.lightId = id;
    marker.renderOrder = 20;
    markers.add(marker);
  }

  const world = new Vector3(), last = new Vector3(), delta = new Vector3();
  const pointer = new Vector2(), ray = new Raycaster();
  const savedTarget = new Vector3();
  let freeLook = false, showMarkers = false, sceneActive = true, selected, press, suppressCameraChanges = false, cameraNoticeTimer, lastCameraNotice = 0;
  let pole = null, poleMode = 'translate', poleAligned = false, startingScale;
  camera.getWorldDirection(world);
  const initialModel = activeModel();
  const initialDistance = initialModel ? camera.position.distanceTo(initialModel.getWorldPosition(last)) : 24;
  savedTarget.copy(camera.position).addScaledVector(world, Math.max(1, initialDistance));
  orbit.target.copy(savedTarget);
  orbit.update();

  function cameraSettings() {
    const offset = look.position.clone().sub(orbit.target);
    const distance = offset.length() || 1;
    return {
      target: orbit.target.toArray(),
      yaw: MathUtils.radToDeg(Math.atan2(offset.x, offset.z)),
      pitch: MathUtils.radToDeg(Math.asin(MathUtils.clamp(offset.y / distance, -1, 1))),
      distance,
      fov: look.fov,
    };
  }
  function copyLookToCamera() {
    camera.position.copy(look.position);
    camera.quaternion.copy(look.quaternion);
    camera.fov = look.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
  function setCameraSettings(value) {
    if (!value) return;
    const settings = normalizeCameraSettings(value);
    suppressCameraChanges = true;
    savedTarget.fromArray(settings.target);
    orbit.target.copy(savedTarget);
    applyPlatformCameraPose(look, settings);
    orbit.update();
    copyLookToCamera();
    suppressCameraChanges = false;
  }
  const tools = {
    onPick: null, onMove: null, onExitLook: null, onCameraChange: null,
    onSceneClick: null, onObjectPick: null, onPoleTransform: null,
    get camera() { return freeLook ? look : camera; },
    get editing() { return sceneActive && (freeLook || showMarkers || Boolean(pole)); },
    get poleSelected() { return Boolean(pole); },
    selectPole(object) {
      if (pole === object) return;
      pole = object;
      syncInput();
    },
    setPoleMode(mode) {
      poleMode = mode;
      transform.showX = mode !== 'translate' || !poleAligned;
      if (pole) transform.setMode(mode);
    },
    setPoleAligned(aligned) {
      poleAligned = aligned;
      if (pole) transform.showX = poleMode !== 'translate' || !aligned;
    },
    cameraSettings,
    setCameraSettings,
    applyCameraSettings(value) { if (value) setCameraSettings(value); },
    setFreeLook(enabled) {
      if (enabled === freeLook) return;
      freeLook = enabled;
      if (enabled) {
        look.copy(camera);
        orbit.target.copy(savedTarget);
        orbit.update();
      }
      transform.camera = tools.camera;
      syncInput();
      if (enabled) input.focus({ preventScroll: true });
    },
    syncProjection() {
      if (!freeLook) return;
      look.aspect = camera.aspect;
      look.view = camera.view ? { ...camera.view } : null;
      look.updateProjectionMatrix();
      look.projectionMatrix.copy(camera.projectionMatrix);
      look.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    },
    showLights(enabled) {
      showMarkers = enabled;
      syncInput();
    },
    setActive(active) {
      if (sceneActive === active) return;
      sceneActive = active;
      syncInput();
    },
    selectLight(id) {
      selected = id;
      lights[id].getWorldPosition(pivot.position);
      last.copy(pivot.position);
      if (markers.visible && !pole) transform.attach(pivot);
    },
    color(id) { return '#' + lights[id].color.getHexString(); },
    update() {
      if (!markers.visible) return;
      for (const marker of markers.children) {
        const id = marker.userData.lightId, light = lights[id];
        light.getWorldPosition(marker.position);
        marker.scale.setScalar(Math.min(1.2, Math.max(.22, tools.camera.position.distanceTo(marker.position) / 65)));
        marker.material.color.copy(light.color);
        if (id === selected && !transform.dragging) {
          pivot.position.copy(marker.position);
          last.copy(pivot.position);
        }
      }
    },
  };
  function notifyCameraChange() {
    const now = performance.now(), wait = Math.max(0, 50 - (now - lastCameraNotice));
    clearTimeout(cameraNoticeTimer);
    if (wait) {
      cameraNoticeTimer = setTimeout(() => {
        cameraNoticeTimer = null;lastCameraNotice = performance.now();
        tools.onCameraChange?.(cameraSettings());
      }, wait);
    } else {
      lastCameraNotice = now;
      tools.onCameraChange?.(cameraSettings());
    }
  }
  orbit.addEventListener('change', () => {
    savedTarget.copy(orbit.target);
    copyLookToCamera();
    if (!suppressCameraChanges) notifyCameraChange();
  });
  orbit.addEventListener('end', () => {
    if (!cameraNoticeTimer) return;
    clearTimeout(cameraNoticeTimer);cameraNoticeTimer = null;lastCameraNotice = performance.now();
    tools.onCameraChange?.(cameraSettings());
  });
  function syncInput() {
    input.hidden = !tools.editing;
    input.classList.toggle('is-free-look', freeLook);
    orbit.enabled = sceneActive && freeLook && !transform.dragging;
    markers.visible = sceneActive && showMarkers;
    const object = sceneActive ? pole ?? (markers.visible && selected ? pivot : null) : null;
    transform.enabled = Boolean(object);
    if (object) {
      transform.setMode(pole ? poleMode : 'translate');
      transform.showX = !pole || poleMode !== 'translate' || !poleAligned;
      transform.attach(object);
    }
    else transform.detach();
  }
  transform.addEventListener('dragging-changed', () => { orbit.enabled = sceneActive && freeLook && !transform.dragging; });
  transform.addEventListener('mouseDown', () => { startingScale = pole?.scale.toArray(); });
  transform.addEventListener('mouseUp', () => { startingScale = null; });
  transform.addEventListener('objectChange', () => {
    if (pole) {
      if (poleMode === 'scale' && startingScale) {
        const axes = transform.axis ?? 'XYZ';
        const axis = axes.includes('X') ? 0 : axes.includes('Y') ? 1 : 2;
        pole.scale.fromArray(scalePlatformPole(startingScale, pole.scale.getComponent(axis), axis));
      }
      tools.onPoleTransform?.(pole);
      return;
    }
    delta.subVectors(pivot.position, last);
    last.copy(pivot.position);
    tools.onMove?.(selected, delta);
  });
  input.addEventListener('pointerdown', event => {
    press = event.button === 0 && !transform.dragging ? { x: event.clientX, y: event.clientY } : null;
  });
  input.addEventListener('pointerup', event => {
    const start = press;
    press = null;
    if (!start || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 5) return;
    const rect = input.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    ray.setFromCamera(pointer, tools.camera);
    const hit = markers.visible && ray.intersectObjects(markers.children, false)[0];
    if (hit) tools.onPick?.(hit.object.userData.lightId);
    else tools.onSceneClick?.(event);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && freeLook) tools.onExitLook?.();
    else if (event.key === 'Escape' && pole) tools.onObjectPick?.(null);
    event.stopPropagation();
  });
  let controllerFrame, controllerTime = performance.now(), controllerMoving = false;
  const deadzone = value => Math.abs(value) < .14 ? 0 : Math.sign(value) * (Math.abs(value) - .14) / .86;
  const updateController = now => {
    const dt = Math.min((now - controllerTime) / 1000, .05);
    controllerTime = now;
    const pad = freeLook && sceneActive ? [...(navigator.getGamepads?.() ?? [])].find(item => item?.connected && item.mapping === 'standard') : null;
    if (pad) {
      const leftX = deadzone(pad.axes[0] ?? 0), leftY = deadzone(pad.axes[1] ?? 0);
      const rightX = deadzone(pad.axes[2] ?? 0), rightY = deadzone(pad.axes[3] ?? 0);
      const zoom = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
      if (leftX || leftY || rightX || rightY || zoom) {
        const value = cameraSettings();
        value.yaw += rightX * 90 * dt;
        value.pitch = MathUtils.clamp(value.pitch + rightY * 70 * dt, -85, 85);
        value.distance = MathUtils.clamp(value.distance * Math.exp(-zoom * 1.8 * dt), 1, 115);
        const right = new Vector3(1, 0, 0).applyQuaternion(look.quaternion);
        const up = new Vector3(0, 1, 0).applyQuaternion(look.quaternion);
        const pan = new Vector3().fromArray(value.target);
        pan.addScaledVector(right, -leftX * value.distance * .45 * dt);
        pan.addScaledVector(up, leftY * value.distance * .45 * dt);
        value.target = pan.toArray();
        setCameraSettings(value);
        controllerMoving = true;
        notifyCameraChange();
      }
    } else if (controllerMoving) {
      controllerMoving = false;
      notifyCameraChange();
    }
    controllerFrame = requestAnimationFrame(updateController);
  };
  controllerFrame = requestAnimationFrame(updateController);
  addEventListener('pagehide', () => {
    cancelAnimationFrame(controllerFrame);
    clearTimeout(cameraNoticeTimer);
    orbit.dispose();
    transform.dispose();
    geometry.dispose();
    for (const marker of markers.children) marker.material.dispose();
    markers.removeFromParent();
    pivot.removeFromParent();
    gizmo.removeFromParent();
    input.remove();
  }, { once: true });
  return tools;
}
