import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TotemLedDisplay } from './totem-led-display.js';
import { TotemPersonality } from './totem-personality.js';
import { createTotemFlightPlanner, onScreen } from './totem-flight-path.js';
import { CHOOSER_LEFT_EDGE, findTotemPerch, polePerchPose, polePerchVisible, sceneObjects } from './totem-perches.js';
import { planTotemCorkscrew, planTotemHop, planTotemForegroundPass } from './totem-ring-flight.js';

const [modelUrl] = Object.values(import.meta.env ? import.meta.glob('../public/assets/models/tiko.glb', {
  eager: true, query: '?url', import: 'default',
}) : {});
export const hasTotemAsset = Boolean(modelUrl);
export const FLIGHT_PITCH = THREE.MathUtils.degToRad(50);
const HEAD_LEVEL_PITCH = THREE.MathUtils.degToRad(45);
const FLIGHT_LOOK_UP = THREE.MathUtils.degToRad(8);
const POINTER_CLICK_MS = 4000;
const POINTER_NEAR_MS = 1300;
const PEEK_WAIT = 1000;
const PEEK_IN = 450;
const PEEK_HOLD = 950;
const PEEK_OUT = 420;
let assetPromise;
const WING_MOTION = {
  normal: { amplitude: .09, rate: 1.45, lift: 0 },
  flight: { amplitude: .46, rate: 2.5, lift: -.06 },
  flutter: { amplitude: .44, rate: 3.1, lift: .06 },
  burst: { amplitude: .56, rate: 3.7, lift: .04 },
  slow: { amplitude: .055, rate: .65, lift: -.14 },
  fold: { amplitude: .025, rate: .65, lift: -.26 },
  stretch: { amplitude: .31, rate: 1.45, lift: .13 },
};
// Source geometry/materials are shared by host and Settings. Only the display
// material and 800-byte texture belong to an instance. Release the source once,
// after all instances, on application teardown.
export async function loadTotemAsset() {
  assetPromise ??= new GLTFLoader().loadAsync(modelUrl).catch(error => { assetPromise = null; throw error; });
  return assetPromise;
}
export function releaseTotemAsset(asset) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  asset.scene.traverse(part => {
    if (part.geometry) geometries.add(part.geometry);
    for (const material of part.isMesh ? (Array.isArray(part.material) ? part.material : [part.material]) : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const value of [...textures, ...materials, ...geometries]) value.dispose();
  assetPromise = null;
}

function joint(model, name, position, parts) {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.set(...position);
  model.add(pivot);
  // The supplied geometry is baked in place. Attach preserves its rest pose.
  for (const part of parts) pivot.attach(part);
  return pivot;
}

export function createTotemMascot(asset, config, random = Math.random, onVoice) {
  const model = asset.scene.clone(true);
  const visor = model.getObjectByName('Curved_dark_face_screen');
  if (!visor?.isMesh) throw Error('Supplied Totem model has no verified curved face screen.');
  visor.geometry.computeBoundingBox();
  const bounds = visor.geometry.boundingBox;
  if (Math.abs(bounds.min.x + 1.02597) > .01 || Math.abs(bounds.max.y - 1.610886) > .01) throw Error('Totem visor geometry changed; alignment needs review.');
  const display = new TotemLedDisplay(visor, { bounds: [-.8969, .5704, 2, 1] });
  const body = new THREE.Group(); body.name = 'Totem body animation';
  const parts = model.children.slice();
  const crown = parts.find(part => part.name === 'Head_crown');
  const box = new THREE.Box3(), core = new THREE.Box3();
  // Keep the original body origin and perch fit. The crown adds head clearance.
  for (const part of parts) {
    if (part === crown) continue;
    box.expandByObject(part);
    if (!/^(Left|Right)_/.test(part.name)) core.expandByObject(part);
  }
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const poleFit = { bodyWidth: (core.max.x - core.min.x) / size.x, baseOffset: (center.y - core.min.y) / size.x };
  const headParts = parts.filter(part => part !== crown &&
    (/^(Head_|Bezel_|Recessed_violet_screen_gasket$)/.test(part.name) || part === visor));
  const head = joint(model, 'Totem neck pivot', [.05, .20, .14], headParts);
  head.rotation.order = 'YXZ';
  // Level the head around the back of the neck so the shell clears the chest.
  // Looking around still uses the original pivot.
  const neckHinge = new THREE.Vector3(.05, .20, -.55);
  const leveledNeck = head.position.clone().sub(neckHinge)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), -HEAD_LEVEL_PITCH).add(neckHinge);
  // The neck moves monotonically along this arc. Bank correction rotates
  // around the shared Z axis, so it does not move the gaze pivot.
  const neckSweep = new THREE.Box3().setFromPoints([head.position, leveledNeck]);
  const neckOffset = neckSweep.max.sub(center).max(center.clone().sub(neckSweep.min)).length();
  const wings = ['Left', 'Right'].map((side, index) => joint(model, `Totem ${side.toLowerCase()} wing pivot`, [index === 0 ? -.98 : .98, -.29, .15], parts.filter(part => part.name.startsWith(`${side}_`))));
  // Enclose each joint's entire sweep so the flight planner still clears consoles.
  let radius = size.length() / 2;
  for (const pivot of [head, ...wings]) {
    const jointBounds = new THREE.Box3().setFromObject(pivot);
    const reach = jointBounds.max.sub(pivot.position).max(pivot.position.clone().sub(jointBounds.min)).length();
    const offset = pivot === head ? neckOffset : center.distanceTo(pivot.position);
    radius = Math.max(radius, offset + reach);
  }
  const headCenter = new THREE.Box3().setFromObject(head).getCenter(new THREE.Vector3()).sub(center).divideScalar(size.x);
  if (crown) {
    // The crown tapers to a point. Measure its vertices so the invisible upper
    // corners of its bounding box don't take up clearance on flight routes.
    const vertex = new THREE.Vector3();
    let crownReach = 0;
    crown.traverse(part => {
      if (!part.isMesh) return;
      const positions = part.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(part.matrixWorld);
        crownReach = Math.max(crownReach, vertex.distanceToSquared(head.position));
      }
    });
    radius = Math.max(radius, neckOffset + Math.sqrt(crownReach));
    head.attach(crown);
  }
  const headLevel = joint(model, 'Totem flight neck pivot', neckHinge.toArray(), [head]);
  const bodyParts = model.children.filter(part => part !== headLevel && part.visible);
  model.position.sub(center); const normalizer = new THREE.Group(); normalizer.scale.setScalar(1 / size.x); normalizer.add(model); body.add(normalizer);
  const root = new THREE.Group(); root.name = 'Totem mascot'; root.add(body);
  root.userData.isTotemMascot = true;
  root.traverse(part => { if (part.isMesh) part.frustumCulled = false; });
  const personality = new TotemPersonality({ display, config, random, onVoice }); personality.configure(config);
  let disposed = false;
  let wingPhase = 0;
  let lastReaction;
  const neckY = head.position.y;
  let voiceOffset = 0;
  function updateVoice(event, dt, reduced) {
    const elapsed = event?.elapsed() ?? -1;
    const speaking = elapsed >= 0 && elapsed < event.plan.duration;
    const syllable = speaking ? event.gesture(elapsed) : null;
    const face = speaking ? event.plan.face : null;
    display.setVoiceFace(personality.active ? null : face, face && (reduced ? face : syllable ? 'surprised' : 'neutral'), reduced);
    if (reduced) voiceOffset = 0;
    else if (voiceOffset || syllable) {
      let lift = 0;
      if (syllable) {
        const phase = (elapsed - syllable.start) / (syllable.end - syllable.start);
        const rising = syllable.pitch.at(-1).hz >= syllable.pitch[0].hz;
        lift = Math.sin(phase * Math.PI) * syllable.accent * (rising ? .083 : -.038);
      }
      voiceOffset = THREE.MathUtils.damp(voiceOffset, lift, 22, dt / 1000);
      if (Math.abs(voiceOffset) < .0001) voiceOffset = 0;
    }
    head.position.y = neckY + voiceOffset;
  }
  function resetArticulation() {
    head.rotation.set(0, 0, 0);
    headLevel.rotation.set(0, 0, 0);
    for (const wing of wings) wing.rotation.set(0, 0, 0);
    wingPhase = 0;
  }
  return {
    root, body, model, head, headCenter, wings, visor, display, personality, resetArticulation, updateVoice,
    radius: radius / size.x, poleFit,
    wingsAvailable: wings.every(wing => wing.children.length > 0),
    showHeadOnly(enabled) { for (const part of bodyParts) part.visible = !enabled; },
    setFlightPose(pitch, bank, heading) {
      const { pose } = personality;
      body.rotation.set(pitch, heading, bank + pose.roll + .16 * Math.sin(pose.pitch) + .18 * Math.sin(pose.yaw), 'YZX');
      const lean = pitch / FLIGHT_PITCH;
      headLevel.rotation.set(-HEAD_LEVEL_PITCH * lean, 0, -bank * lean);
    },
    interact(travel = {}) {
      if (disposed || !root.visible || !personality.config.reactions || personality.bootUntil != null) return false;
      personality.navigation();
      const choices = ['wing_stretch', 'laugh', 'sneeze', 'excited_reaction', 'playful_roll', ...Object.keys(travel)].filter(name => name !== lastReaction && (name !== 'playful_roll' || !personality.history.at(-1)?.spin));
      const name = choices[Math.floor(random() * choices.length)];
      if (!personality.play(name, 2, 'REACTING')) return false;
      lastReaction = name;
      travel[name]?.();
      return true;
    },
    update(dt, reduced, flying = false, look = null, perched = false) {
      if (disposed) return;
      personality.update(dt, reduced);
      const pose = personality.pose;
      body.position.set(pose.x, pose.y, 0); body.rotation.set(pose.pitch, pose.yaw, pose.roll);
      root.visible = personality.visible;
      if (personality.reducedMotion || !personality.visible) { resetArticulation(); return; }
      const seconds = Number.isFinite(dt) ? Math.min(100, Math.max(0, dt)) / 1000 : 0;
      const follow = (from, to, damping = 14) => THREE.MathUtils.damp(from, to, damping, seconds);
      const gazePitch = look?.pitch ?? pose.headPitch;
      // Looking too far up can tuck the back of the shell into the chest.
      const leveling = flying || headLevel.rotation.x < -.05;
      head.rotation.x = follow(head.rotation.x, leveling ? Math.max(-FLIGHT_LOOK_UP, gazePitch) : gazePitch);
      head.rotation.y = follow(head.rotation.y, look?.yaw ?? pose.headYaw);
      head.rotation.z = follow(head.rotation.z, pose.headRoll);
      const cue = pose.wing === 'normal' && flying ? 'flight' : pose.wing;
      const { amplitude, rate, lift } = WING_MOTION[cue];
      wingPhase = (wingPhase + seconds * rate * personality.config.speed * Math.PI * 2) % (Math.PI * 2);
      const flap = cue !== 'normal' || (!perched && personality.config.ambient && personality.active?.definition.body !== 'freeze');
      const stroke = Math.sin(wingPhase);
      for (const [index, wing] of wings.entries()) {
        const side = index === 0 ? -1 : 1;
        wing.rotation.z = follow(wing.rotation.z, flap ? side * (lift + amplitude * stroke) : 0, 32);
        wing.rotation.y = follow(wing.rotation.y, flap ? side * amplitude * (.23 + .36 * Math.cos(wingPhase)) : 0, 32);
      }
    },
    dispose() { if (disposed) return; disposed = true; personality.dispose(); display.dispose(); root.removeFromParent(); },
  };
}

const HOVER_SPOTS = [[.73, .68], [-.72, .46]];
// The chooser's left side is occupied by its game list and title.
const CHOOSER_HOVER_SPOTS = [[.73, .68], [.52, .45]];
const ENTRANCES = [
  { id: 'glide', spot: 0, from: [1.28, .68], duration: 1050, arc: .07, bank: -.15 },
  { id: 'drop', spot: 0, from: [.73, 1.28], duration: 1150, arc: -.12, bank: .09 },
  { id: 'swoop', spot: 1, from: [-1.28, 1.22], duration: 1400, arc: -.22, bank: .23 },
];
const ENTRANCE_KEY = 'totem.lastMascotEntrance';
const RELOCATION_MS = 2600;
const RETRY_MS = 250;
const CAMERA_DISTANCE = 5;
const FOREGROUND_REST_DEPTH = 2.4;
const DESCENT_MS = 850;
const CONSOLE_PERCH_SCALE = .65;
const CONSOLE_PERCH_MS = 5500;
const POLE_MIN_PERCH_MS = 4000;
const HOP_PERCH_MS = 1600;
const CORKSCREW_SCALE = .85;
const DEBUG_TRAVEL = new Set(['hide_and_seek', 'panel_peek', 'console_perch', 'console_hops', 'ring_corkscrew', 'hover_relocation', 'ring_visit']);
const DEBUG_ROUTE_FAILURE = {
  hide_and_seek: 'Totem could not find a clear route to a screen edge.',
  panel_peek: 'Totem could not find a clear route around the details panel.',
  console_perch: 'The selected console has no reachable landing spot.',
  console_hops: 'Totem could not find a reachable perch to start hopping.',
  ring_corkscrew: 'Totem could not find a clear loop above and below the ring.',
  hover_relocation: 'Totem could not find a clear route to another rest spot.',
  ring_visit: 'There is no reachable console behind the selection.',
};
const easeOut = t => 1 - (1 - t) ** 3;
const easeInOut = t => t * t * (3 - 2 * t);
const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lerpPoint = (a, b, t) => [THREE.MathUtils.lerp(a[0], b[0], t), THREE.MathUtils.lerp(a[1], b[1], t)];

function chooseEntrance(random, storage) {
  let last;
  try { last = storage()?.getItem(ENTRANCE_KEY); } catch { /* Storage may be unavailable in a preview. */ }
  const choices = ENTRANCES.filter(entrance => entrance.id !== last);
  const chosen = choices[Math.floor(random() * choices.length)];
  try { storage()?.setItem(ENTRANCE_KEY, chosen.id); } catch { /* Entrance still works without storage. */ }
  return chosen;
}

function followPath(path, duration, bank, ease) {
  const length = path.slice(1).reduce((total, point, index) => total + distance(path[index], point), 0);
  return { path, length, duration, bank, ease, index: 1, elapsed: 0 };
}

function beginFlight(planner, start, goal, chooser, duration, arc, bank, ease) {
  let path = Array.from({ length: 9 }, (_, index) => {
    const t = index / 8, point = lerpPoint(start, goal, t);
    point[1] += arc * Math.sin(Math.PI * t);
    return point;
  });
  if (!path.slice(1).every((point, index) => planner.clear(path[index], point))) {
    path = planner.route(start, goal, chooser);
  }
  if (!path) return null;
  return followPath(path, duration, bank, ease);
}

function peekExits(point) {
  const side = point[0] < 0 ? -1 : 1;
  return [[side * 1.65, point[1]], [point[0], 1.65], [-side * 1.65, point[1]], [point[0], -1.65]];
}

function hideAndSeekFlight(planner, point) {
  for (const edge of peekExits(point)) {
    const outbound = beginFlight(planner, point, edge, false, 2100, .08, -.13 * Math.sign(edge[0]), easeInOut);
    if (!outbound || distance(outbound.path.at(-1), edge) > .001) continue;
    return outbound;
  }
  return null;
}

function approachRingDevice(planner, point, device, footprint) {
  const [left, bottom, right, top] = device.bounds;
  const x = (left + right) / 2, y = (bottom + top) / 2;
  const gapX = .05 + .24 * footprint, gapY = .06 + .34 * footprint;
  const spots = [[x, top + gapY], [right + gapX, y], [left - gapX, y], [x, bottom - gapY]];
  for (const goal of spots.sort((a, b) => distance(point, a) - distance(point, b))) {
    if (!planner.safeRest(goal) || !planner.clear(goal)) continue;
    const flight = beginFlight(planner, point, goal, false, 1700, .04, -.12, easeInOut);
    if (flight && distance(flight.path.at(-1), goal) < .001) return flight;
  }
  return null;
}

function advanceFlight(planner, flight, point, dt) {
  const before = flight.elapsed / flight.duration;
  flight.elapsed = Math.min(flight.duration, flight.elapsed + dt);
  let remaining = flight.length * (flight.ease(flight.elapsed / flight.duration) - flight.ease(before));
  // Recheck each swept segment against the current frame's models. A long
  // frame can consume multiple waypoints and must still follow each turn.
  while (flight.index < flight.path.length && remaining > 0) {
    const waypoint = flight.path[flight.index], gap = distance(point, waypoint);
    const next = remaining >= gap - 1e-8 ? waypoint : lerpPoint(point, waypoint, remaining / gap);
    if (!planner.clear(point, next, flight.escaping)) return { point, blocked: true };
    point = next;
    if (point !== waypoint) break;
    flight.index++;
    remaining -= gap;
  }
  return { point, blocked: false };
}

// Standard Three scene callback: uses the existing renderer/scene clock and
// camera, including the shared Game Chooser camera. No second render loop.
export function attachTotemToScene(runtime, mascot, {
  hidden = () => document.hidden,
  reducedMotion = () => false,
  previewOpen = () => false,
  voiceEvent,
  stopVoice,
  now = () => performance.now(),
  random = Math.random,
  storage = () => globalThis.localStorage,
  panelBounds = () => null,
} = {}) {
  const { scene } = runtime, previous = scene.onBeforeRender;
  const position = new THREE.Vector3(), cameraPosition = new THREE.Vector3(), cameraForward = new THREE.Vector3(), up = new THREE.Vector3();
  const lastPosition = new THREE.Vector3(), travelDirection = new THREE.Vector3(), gazeDirection = new THREE.Vector3();
  const viewerInverse = new THREE.Quaternion();
  const poleRotation = new THREE.Quaternion(), poleOffset = new THREE.Vector3();
  const cameraRotation = new THREE.Quaternion(), facing = new THREE.Matrix4(), inverseContent = new THREE.Matrix4();
  const worldUp = new THREE.Vector3(0, 1, 0), surface = new THREE.Vector3(), target = new THREE.Vector3();
  const supportNormal = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  const bodyOffset = new THREE.Vector3(), projectedBody = new THREE.Vector3(), gesturePoint = [0, 0];
  const planner = createTotemFlightPlanner();
  const home = scene.getObjectByName('Home screen content');
  let lastTime = null, disposed = false;
  let entrance = null, spot = 0;
  let point = null, flight = null, nextMove = null, retryAt = 0, lastView, lastCanFly, lastEditorPole;
  let landing = null, perched = null, summon = null, lookTarget = null, firstRoam = true, peek = null;
  let firstHomeEntry = true;
  let nextPeek = null, release = null, debugAction = null, hopRun = null, ringFlight = null;
  let foreground = null, foregroundDepth = 0, nearDepth = 0, ringVisit = null, lastRingId;
  let flightPitch = 0, heading = 0, hasPosition = false, lastScale = 0;
  let pointer = null, pointerMovedAt = 0, nearUntil = 0, clickUntil = 0, glanceAt = 0, glanceUntil = 0;
  mascot.root.visible = false;
  scene.add(mascot.root);

  function ringTargets() {
    return foreground && !nearDepth ? planner.devices.filter(device => device !== foreground && device.depth >= foregroundDepth * 1.12 && Math.cos(device.object.userData.orbitAngle) < .9) : [];
  }

  function startRingVisit(devices) {
    const unvisited = devices.filter(device => device.object.userData.platformId !== lastRingId);
    const choices = unvisited.length ? unvisited : devices;
    const device = choices[Math.floor(random() * choices.length)];
    ringVisit = { id: device.object.userData.platformId, origin: point, stage: 'dive', progress: 0, depth: device.depth,
      size: Math.min(1, Math.abs(device.object.scale.x / foreground.object.scale.x)) };
    const [left, bottom, right, top] = device.bounds;
    const drift = lerpPoint(point, [(left + right) / 2, (bottom + top) / 2], .18);
    if (planner.clear(point, drift)) flight = beginFlight(planner, point, drift, false, 1100, .02, -.08, easeInOut);
    lastRingId = ringVisit.id;
    firstRoam = false;
    nextMove = null;
  }

  function startPeek(departure, pass, alreadyOffscreen = false) {
    const exit = alreadyOffscreen ? [1.65, 0] : departure?.path.at(-1) ?? pass?.destination;
    if (!exit) return false;
    const edge = Math.floor(random() * 3), side = edge === 0 ? -1 : 1;
    const fromTop = edge === 2;
    const along = random(), across = (along - .5) * 1.3, height = .05 + along * .55;
    peek = {
      origin: alreadyOffscreen ? null : point, exit, tilt: side, fromTop, elapsed: 0, foreground: Boolean(pass),
      outside: fromTop ? [across, 1.9] : [side * 1.9, height],
      inside: fromTop ? [across, .85] : [side * .85, height],
    };
    flight = departure;
    ringFlight = pass ?? null;
    if (alreadyOffscreen) { point = exit; hasPosition = false; release = null; }
    nextPeek = mascot.personality.now + 90000 + random() * 60000;
    return true;
  }

  function interact() {
    const travel = {};
    const { config } = mascot.personality;
    if (mascot.root.visible && config.reactions && config.flight && config.reducedMotion !== 'always' && !reducedMotion()
      && lastCanFly && lastView === null && !runtime.activeView && point && onScreen(point) && !flight && !landing && !perched && !ringVisit && !peek && !ringFlight) {
      const departure = config.easterEggs && hideAndSeekFlight(planner, point);
      if (departure) travel.hide_and_seek = () => startPeek(departure);
      const devices = ringTargets();
      if (devices.length) travel.console_inspection = () => startRingVisit(devices);
    }
    const reacted = mascot.interact(travel);
    if (reacted && pointer) clickUntil = mascot.personality.now + POINTER_CLICK_MS;
    return reacted;
  }

  function watchPointer(point) {
    if (!point) {
      pointer = null;
      nearUntil = clickUntil = glanceAt = glanceUntil = 0;
      return;
    }
    pointerMovedAt = mascot.personality.now;
    pointer = [point.x, point.y];
  }

  function canSummonPole() {
    const { config } = mascot.personality;
    return lastView !== undefined && lastCanFly && config.enabled && config.flight
      && !mascot.personality.gameplay && config.reducedMotion !== 'always' && !reducedMotion();
  }

  function finishDebug(started, reason) {
    const action = debugAction;
    debugAction = null;
    action?.result?.(started, reason);
  }

  function beforeRender(renderer, renderedScene, camera, ...args) {
    previous?.call(this, renderer, renderedScene, camera, ...args);
    // Floor reflectors recursively render this scene with virtual cameras.
    // They must never advance behaviour or overwrite the viewer-relative pose.
    if (disposed || camera !== runtime.camera) return;
    const personality = mascot.personality;
    const { config } = personality;
    let editorPole = runtime.editorPerch;
    if (!editorPole?.visible) editorPole = null;
    const paused = hidden() || previewOpen() || (!config.enabled && !editorPole) || personality.gameplay;
    if (paused) {
      stopVoice?.();
      mascot.updateVoice(null, 0, true);
      if (debugAction) finishDebug(false, 'Return to the console carousel to play this behaviour.');
      watchPointer(null);
      mascot.root.visible = false; lastTime = null; lastView = undefined; summon = null; return;
    }
    const frameTime = now();
    const dt = lastTime === null ? 0 : Math.min(100, frameTime - lastTime);
    lastTime = frameTime;
    const view = runtime.activeView ?? null;
    const chooser = Boolean(view);
    if (chooser && debugAction) finishDebug(false, 'Return to the console carousel to play this behaviour.');
    // The active content root shares the devices' floor reflection opacity.
    const content = (chooser ? view.content : home) ?? scene;
    if (mascot.root.parent !== content) content.add(mascot.root);
    const reduced = reducedMotion() || config.reducedMotion === 'always';
    const canFly = config.flight && !reduced;
    if (view !== lastView || canFly !== lastCanFly || editorPole !== lastEditorPole) {
      if (view !== lastView) watchPointer(null);
      if (peek) mascot.showHeadOnly(false);
      point = flight = landing = perched = summon = lookTarget = nextMove = null;
      bodyOffset.set(0, 0, 0);
      flightPitch = heading = 0;
      hasPosition = false;
      foregroundDepth = nearDepth = 0;
      ringVisit = peek = release = nextPeek = hopRun = ringFlight = null;
      retryAt = 0;
      firstRoam = true;
      entrance = canFly && !chooser && !editorPole && !lastEditorPole ? chooseEntrance(random, storage) : null;
      spot = entrance?.spot ?? 0;
      lastView = view;
      lastCanFly = canFly;
      lastEditorPole = editorPole;
    }
    personality.show();
    const entryPole = !editorPole && !point && (chooser || firstHomeEntry)
      ? sceneObjects(content).find(object => object.userData.totemRest) : null;
    if (!editorPole && !chooser && firstHomeEntry) firstHomeEntry = false;
    if (entryPole && (!chooser || !canFly)) {
      polePerchPose(entryPole, mascot.poleFit, target, poleRotation, poleOffset);
      target.project(camera);
      if (polePerchVisible(target, false)) {
        point = [target.x, target.y];
        perched = {
          mesh: entryPole, pole: entryPole, fit: mascot.poleFit,
          until: personality.now + CONSOLE_PERCH_MS, entry: true,
        };
        if (!chooser) personality.startDocked();
      }
    }
    if (editorPole) {
      mascot.update(dt, true, false, null, true);
      mascot.root.visible = true;
      const scale = polePerchPose(editorPole, mascot.poleFit, mascot.root.position, mascot.root.quaternion, poleOffset);
      mascot.root.scale.setScalar(scale);
      mascot.body.position.set(0, 0, 0);
      mascot.body.rotation.set(0, 0, 0);
      if (content !== scene) mascot.root.applyMatrix4(inverseContent.copy(content.matrixWorld).invert());
      mascot.root.updateMatrixWorld(true);
      return;
    }
    const changingDepth = ringVisit?.stage === 'dive' || ringVisit?.stage === 'rise';
    mascot.update(dt, reduced, canFly && (!point || Boolean(flight || landing || ringFlight) || changingDepth), lookTarget, Boolean(perched));
    if (voiceEvent) mascot.updateVoice(voiceEvent(), dt, reduced);
    const projection = camera.projectionMatrix.elements;
    const focalX = projection[0], focalY = projection[5];
    const scale = CAMERA_DISTANCE * Math.min(.48 / focalY, .3 / focalX) * (chooser ? .5 : 1);
    camera.getWorldPosition(cameraPosition);
    camera.getWorldDirection(cameraForward);
    const scaleAt = world => scale * cameraPosition.distanceTo(world) / CAMERA_DISTANCE;
    const worldAt = (ndc, out, depth = 0) => {
      out.set(ndc[0], ndc[1], .5).unproject(camera).sub(cameraPosition).normalize();
      return out.multiplyScalar(depth ? depth / out.dot(cameraForward) : CAMERA_DISTANCE).add(cameraPosition);
    };
    planner.refresh(camera, view?.content ?? home, scale * (mascot.radius + .02), CAMERA_DISTANCE);
    planner.setLane(nearDepth);
    planner.setFootprint(1);
    const spots = (chooser ? CHOOSER_HOVER_SPOTS : HOVER_SPOTS).map(planner.fitRest);
    const consoleId = runtime.selectedConsoleId;
    const selectedDevice = !chooser && planner.devices.find(device => device.object.userData.platformId === consoleId);
    const hitsPanel = (from, to) => planner.hitsPanel(from, to,
      Math.max(scaleAt(from), scaleAt(to)) * mascot.radius);
    function foregroundPass(goal, duration, destination, origin = hasPosition ? lastPosition : null) {
      if (!origin) return null;
      const objects = sceneObjects(content);
      const start = origin.clone(), screen = start.clone().project(camera);
      for (const lane of [2.4, 1.6, 1.1]) {
        const entry = worldAt([screen.x, screen.y], new THREE.Vector3(), lane);
        const exit = worldAt(goal, new THREE.Vector3(), lane);
        const points = destination ? [start, entry, exit, destination] : [start, entry, exit];
        if (points.slice(1).some((to, i) => hitsPanel(points[i], to))) continue;
        const curve = planTotemForegroundPass(points, objects, world => scaleAt(world) * mascot.radius);
        if (curve) return { curve, elapsed: 0, duration, selection: consoleId, destination: goal };
      }
      return null;
    }
    function launchPeek() {
      const departure = hideAndSeekFlight(planner, point);
      if (departure) return startPeek(departure);
      for (const goal of peekExits(point)) {
        const pass = foregroundPass(goal, 2100);
        if (pass) return startPeek(null, pass);
      }
      return false;
    }
    function launchPanelPeek() {
      if (!panel || !hasPosition) return false;
      const [left, bottom, right, top] = panel;
      const x = (left + right) / 2, y = (bottom + top) / 2;
      const edges = [[x, top], [left, y]];
      if (random() < .5) edges.reverse();
      for (const edge of edges) {
        const goal = planner.nearestRest(edge, false, 1, candidate => distance(point, candidate) > .12);
        if (!goal) continue;
        const path = planner.route(point, goal, false);
        if (!path || distance(path.at(-1), goal) > .001) continue;
        flight = followPath([...path, ...path.slice(0, -1).reverse()], 4200, .14, easeInOut);
        return true;
      }
      return false;
    }
    function consolePerch(device, size = CONSOLE_PERCH_SCALE, clear = planner.clear) {
      const perch = findTotemPerch(content, camera, world => scaleAt(world) * size, clear, random, {
        device, safeRest: goal => planner.safeRest(goal, size),
      });
      return perch && { ...perch, device, selection: consoleId, size };
    }
    function startConsolePerch(device = selectedDevice?.object, size = CONSOLE_PERCH_SCALE) {
      if (!device) return false;
      const perch = consolePerch(device, size);
      if (perch) {
        const approach = beginFlight(planner, point, perch.goal, false, 1450, .04, -.14, easeInOut);
        if (approach && distance(approach.path.at(-1), perch.goal) < .001) {
          approach.perch = perch;
          flight = approach;
          return true;
        }
      }
      const worldPerch = consolePerch(device, size, () => true);
      if (!worldPerch) return false;
      const pass = foregroundPass(worldPerch.goal, 1900, worldPerch.above);
      if (!pass) return false;
      ringFlight = { ...pass, perch: worldPerch, fromSize: 1 };
      return true;
    }
    function hopSize(device) {
      const selectedScale = Math.abs(selectedDevice?.object.scale.x ?? device.scale.x);
      const ratio = selectedScale > 0 ? Math.abs(device.scale.x) / selectedScale : 1;
      return CONSOLE_PERCH_SCALE * THREE.MathUtils.clamp(ratio, .32, 1);
    }
    function startHopping() {
      if (planner.devices.length < 2) return false;
      const devices = planner.devices.map(device => device.object);
      const selected = selectedDevice?.object;
      const first = (selected && startConsolePerch(selected) && selected) ||
        devices.find(device => device !== selected && startConsolePerch(device, hopSize(device)));
      if (!first) return false;
      hopRun = { visited: new Set([first]), limit: 3 + Math.floor(random() * 3), direction: random() < .5 ? 1 : -1 };
      return true;
    }
    function startNextHop() {
      if (!hopRun || hopRun.visited.size >= hopRun.limit) return false;
      const angle = perched.device.userData.orbitAngle;
      const delta = object => ((object.userData.orbitAngle - angle) * hopRun.direction % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const candidates = planner.devices.map(device => device.object).filter(object => !hopRun.visited.has(object));
      candidates.sort((a, b) => delta(a) - delta(b));
      const objects = sceneObjects(content);
      for (const device of candidates) {
        const perch = consolePerch(device, hopSize(device), () => true);
        if (!perch) continue;
        const curve = planTotemHop(lastPosition, perch.above, objects, perched.device,
          (world, t) => scaleAt(world) * THREE.MathUtils.lerp(perched.size, perch.size, t) * mascot.radius);
        if (!curve) continue;
        ringFlight = { curve, elapsed: 0, duration: 1300, selection: consoleId, perch,
          fromSize: perched.size, takeoff: perched.mesh };
        hopRun.visited.add(device);
        perched = null;
        return true;
      }
      return false;
    }
    function startCorkscrew() {
      let curve = planTotemCorkscrew(lastPosition, sceneObjects(content), runtime.environment?.floor?.position.y ?? 0,
        () => CORKSCREW_SCALE * mascot.radius);
      if (!curve && debugAction && planner.devices.length >= 2) {
        // Tight layouts can block the world-space orbit. Keep the debug preview
        // visible by doing a compact roll in the space in front of the ring.
        const preview = new THREE.CatmullRomCurve3(Array.from({ length: 24 }, (_, index) => {
          const angle = index * Math.PI / 12;
          return worldAt([Math.cos(angle) * .52, Math.sin(angle) * .57], new THREE.Vector3(), 1.8 + .35 * Math.sin(angle));
        }), true);
        curve = new THREE.CurvePath();
        curve.add(new THREE.LineCurve3(lastPosition.clone(), preview.points[0]));
        curve.add(preview);
        curve.add(new THREE.LineCurve3(preview.points[0], lastPosition.clone()));
        ringFlight = { curve, elapsed: 0, duration: 4700, selection: consoleId, preview: true };
        return true;
      }
      if (!curve) return false;
      ringFlight = { curve, elapsed: 0, duration: 6800, selection: consoleId };
      return true;
    }

    foreground = null;
    if (!chooser) for (const device of planner.devices) {
      if (!foreground || Math.cos(device.object.userData.orbitAngle) > Math.cos(foreground.object.userData.orbitAngle)) foreground = device;
    }
    if (foreground) foregroundDepth = foregroundDepth ? THREE.MathUtils.damp(foregroundDepth, foreground.depth, 5, dt / 1000) : foreground.depth;
    const panel = !chooser ? panelBounds() : null;
    const panelDepth = runtime.platformPanelDepth ?? (foregroundDepth || CAMERA_DISTANCE);
    planner.setPanel(camera, panel, panelDepth);
    const ringDevice = ringVisit && planner.devices.find(device => device.object.userData.platformId === ringVisit.id);
    if (ringVisit && ['dive', 'approach', 'inspect'].includes(ringVisit.stage)) {
      if (!ringDevice || ringDevice === foreground || ringDevice.depth < foregroundDepth * 1.07) {
        ringVisit.stage = 'return';
        flight = null;
      } else {
        ringVisit.depth = THREE.MathUtils.damp(ringVisit.depth, ringDevice.depth, 5, dt / 1000);
      }
    }
    if (ringVisit?.stage === 'dive') ringVisit.progress = Math.min(1, ringVisit.progress + dt / 1100);
    if (ringVisit?.stage === 'rise') {
      if (planner.clear(point, point, false, 1)) ringVisit.progress = Math.max(0, ringVisit.progress - dt / 1100);
      else ringVisit.stage = 'return';
      if (ringVisit.progress === 0) ringVisit = null;
    }
    const dive = ringVisit ? easeInOut(ringVisit.progress) : 0;
    let depth = nearDepth || (ringVisit ? THREE.MathUtils.lerp(foregroundDepth, ringVisit.depth, dive) : foregroundDepth);
    let footprint = ringVisit ? foregroundDepth / depth * THREE.MathUtils.lerp(1, ringVisit.size, dive) : 1;

    function nearRest(start) {
      planner.setLane(FOREGROUND_REST_DEPTH);
      const goal = planner.nearestRest(start, chooser, 1, candidate => {
        worldAt(candidate, target, FOREGROUND_REST_DEPTH);
        const radius = scaleAt(target) * mascot.radius;
        return !planner.hitsConsole(target, target, radius, null, true)
          && !planner.hitsPanel(target, target, radius);
      });
      planner.setLane(nearDepth);
      return goal;
    }
    function useNearLane() {
      depth = nearDepth = FOREGROUND_REST_DEPTH;
      planner.setLane(nearDepth);
    }
    function recoverInFront(origin) {
      if (chooser || nearDepth) return false;
      target.copy(origin).project(camera);
      const goal = nearRest([target.x, target.y]);
      if (!goal) return false;
      const pass = foregroundPass(goal, 1250, worldAt(goal, new THREE.Vector3(), FOREGROUND_REST_DEPTH), origin);
      if (!pass) return false;
      ringFlight = { ...pass, laneChange: true };
      flight = release = null;
      useNearLane();
      retryAt = personality.now + 1750;
      return true;
    }
    function returnToRest(size, thrown, origin = lastPosition) {
      target.copy(origin).project(camera);
      point = [target.x, target.y];
      const goal = planner.escape(point, chooser, 1, .24)
        ?? planner.escape(point, chooser);
      if (thrown && config.reactions) personality.play('surprised_reaction', 2, 'REACTING');
      landing = perched = hopRun = ringFlight = null;
      nextMove = null;
      if (!goal && recoverInFront(origin)) return;
      const destination = goal ?? (thrown ? [point[0] < 0 ? -1.44 : 1.44, point[1]] : spots[point[0] < 0 ? 0 : 1]);
      flight = { ...followPath([point, destination], thrown ? 1050 : 1450, Math.sign(destination[0] - point[0]) * (thrown ? -.55 : -.15),
        thrown ? easeOut : easeInOut), escaping: true };
      release = { depth: surface.copy(origin).sub(cameraPosition).dot(cameraForward), size, elapsed: 0 };
    }
    if (debugAction && DEBUG_TRAVEL.has(debugAction.name) && !canFly) {
      finishDebug(false, 'Enable flight and allow full motion in Totem Personality to try this behaviour.');
    }
    if (debugAction && personality.now >= debugAction.deadline) {
      finishDebug(false, DEBUG_ROUTE_FAILURE[debugAction.name] ?? 'Tiko could not find a clear spot to start.');
    }
    if (debugAction && !debugAction.recoveryUntil && hasPosition
      && (flight || landing || perched || peek || ringVisit || ringFlight || release)) {
      if (peek) mascot.showHeadOnly(false);
      const size = ringFlight?.currentSize ?? perched?.size ?? landing?.perch.size ?? footprint;
      peek = ringVisit = null;
      depth = nearDepth || foregroundDepth;
      footprint = 1;
      returnToRest(size, false);
      debugAction.recoveryUntil = personality.now + 1600;
    }
    if (ringFlight && !ringFlight.laneChange && consoleId !== ringFlight.selection) {
      if (peek) { mascot.showHeadOnly(false); peek = null; }
      returnToRest(ringFlight.currentSize ?? 1, Boolean(ringFlight.perch));
    }
    function perchTarget(perch, out) {
      if (perch.pole) return polePerchPose(perch.pole, perch.fit, out, poleRotation, poleOffset);
      perch.mesh.localToWorld(surface.copy(perch.anchor));
      const size = scaleAt(surface) * (perch.size ?? 1);
      out.copy(surface).addScaledVector(worldUp, .32 * size);
      return size;
    }
    const supported = perched ?? landing?.perch ?? flight?.perch ?? ringFlight?.perch;
    if (summon && (!summon.pole.visible || personality.now >= summon.expires)) summon = null;
    if (summon && supported?.pole === summon.pole) {
      supported.summoned = true;
      if (perched) perched.until = Math.max(perched.until, personality.now + POLE_MIN_PERCH_MS);
      summon = null;
    }
    if (supported) {
      let part = supported.mesh;
      while (part && part !== content && part.visible) part = part.parent;
      const switched = supported.device && consoleId !== supported.selection;
      const tipped = supported.device && supportNormal.copy(supported.normal)
        .applyNormalMatrix(normalMatrix.getNormalMatrix(supported.mesh.matrixWorld)).y < .65;
      const targetSize = perchTarget(supported, target);
      const behindPanel = planner.hitsPanel(target, target, targetSize * mascot.radius);
      const releaseSize = supported.pole && hasPosition ? lastScale / scaleAt(lastPosition) : supported.size ?? 1;
      target.project(camera);
      const onScreen = supported.pole ? polePerchVisible(target, chooser && !supported.summoned && !supported.entry)
        : Math.abs(target.z) < 1 && planner.safeRest([target.x, target.y], supported.size);
      if (switched || tipped || part !== content || !onScreen || behindPanel) {
        if (landing || perched || ringFlight) returnToRest(ringFlight?.currentSize ?? releaseSize, Boolean(perched && (switched || tipped)));
        else flight = hopRun = null;
      } else if (perched && summon) {
        returnToRest(releaseSize, false);
      } else if (perched?.device && personality.now >= perched.until) {
        if (!startNextHop()) returnToRest(perched.size, false);
      } else if (canFly && perched && !perched.device && (config.ambient || perched.summoned)
        && personality.now >= perched.until && !(perched.entry && personality.active?.name === 'wake_up')) {
        returnToRest(releaseSize, false);
        retryAt = personality.now + 5000 + random() * 5000;
      }
    }
    if (release) {
      release.elapsed += dt;
      const t = easeInOut(Math.min(1, release.elapsed / 1050));
      depth = THREE.MathUtils.lerp(release.depth, depth || CAMERA_DISTANCE, t);
      footprint = THREE.MathUtils.lerp(release.size, 1, t);
      if (t === 1) release = null;
    }
    planner.setFootprint(footprint);
    if (point && !ringFlight && (!peek || flight) && !landing && !perched && !flight?.escaping && !planner.clear(point)) {
      // The carousel can move a silhouette onto the current hover position.
      // Leave the overlap, including when flight is disabled.
      flight = null;
      if (canFly && personality.now >= retryAt) {
        const destination = planner.escape(point, chooser);
        if (destination) flight = { ...followPath([point, destination], 850, .10, easeInOut), escaping: true };
        else if (!planner.clearsPanel(point)) {
          point = ringVisit = release = peek = null;
        }
        retryAt = personality.now + RETRY_MS;
      } else if (!canFly) point = planner.nearestRest(point, chooser);
    }
    function approachPerch(perch) {
      if (!perch) return false;
      const size = perchTarget(perch, target);
      if (planner.hitsPanel(target, target, size * mascot.radius)) return false;
      const avoidRail = chooser && !perch.summoned && !perch.entry;
      const edges = [[1.38, perch.goal[1]], [avoidRail ? Math.max(CHOOSER_LEFT_EDGE, perch.goal[0]) : perch.goal[0], 1.38]];
      if (!point && random() < .5) edges.reverse();
      for (const start of point ? [point] : edges) {
        const approach = beginFlight(planner, start, perch.goal, avoidRail, 1450, .07, -.14, easeInOut);
        if (approach && distance(approach.path.at(-1), perch.goal) < .001) {
          approach.perch = perch;
          flight = approach;
          point = start;
          return true;
        }
      }
      return false;
    }
    function findRestPerch(device, summoned = false) {
      return findTotemPerch(content, camera, scaleAt, planner.clear, random, {
        device, chooser: chooser && !summoned, safeRest: planner.safeRest, poleFit: mascot.poleFit,
      });
    }
    if (summon && !ringFlight && !landing && !perched && !peek && !ringVisit && !release && personality.now >= retryAt) {
      const perch = findRestPerch(summon.pole, true);
      if (perch && approachPerch({ ...perch, summoned: true })) summon = null;
      else retryAt = personality.now + RETRY_MS;
    }
    if (!summon && chooser && view.content && canFly && !flight && !ringFlight && !landing && !perched && personality.now >= retryAt) {
      const dock = entryPole && findRestPerch(entryPole, true);
      if (!dock || !approachPerch({ ...dock, entry: true })) approachPerch(findRestPerch());
      if (point) retryAt = personality.now + 1800;
    }
    if (!point && personality.now >= retryAt) {
      for (const candidate of [spot, 1 - spot]) {
        const goal = spots[candidate], side = Math.sign(goal[0]);
        const edge = [side * 1.44, goal[1]];
        if (canFly) {
          const arrival = entrance ?? ENTRANCES[0];
          const [fromX, fromY] = arrival.from;
          let start = !entrance ? edge : arrival.id === 'drop' ? [goal[0], fromY] : [side * Math.abs(fromX), fromY];
          if (!planner.clear(start)) {
            start = arrival.id === 'drop' ? [goal[0], 1.44] : [edge[0], start[1]];
          }
          flight = beginFlight(planner, start, goal, chooser, arrival.duration, arrival.arc, arrival.bank, easeOut);
          if (flight && planner.safeRest(flight.path.at(-1))) { point = start; entrance = null; }
          else flight = null;
        } else {
          point = planner.clear(goal) ? goal : planner.route(edge, goal, chooser)?.at(-1) ?? null;
        }
        if (point) { spot = candidate; break; }
      }
      if (!point && canFly) {
        // A blocked approach can still reach a clear hover through the foreground.
        // Start outside the viewport even when the regular entrance is unavailable.
        const preferred = spots[spot];
        const goal = planner.nearestRest(preferred, chooser) ?? (planner.clearsPanel(preferred) ? preferred : null);
        if (goal) {
          for (const start of [[1.55, goal[1]], [goal[0], 1.55], [-1.55, goal[1]], [goal[0], -1.55]]) {
            const arrival = foregroundPass(goal, 1500, worldAt(goal, new THREE.Vector3(), depth),
              worldAt(start, new THREE.Vector3(), depth));
            if (!arrival) continue;
            point = start;
            ringFlight = arrival;
            entrance = null;
            break;
          }
        }
        if (!point && !chooser) {
          const open = nearRest(preferred);
          if (open) {
            planner.setLane(FOREGROUND_REST_DEPTH);
            for (const edge of peekExits(open)) {
              const approach = beginFlight(planner, edge, open, false, 1500, .06, -.12, easeInOut);
              if (!approach || distance(approach.path.at(-1), open) > .001) continue;
              point = edge;
              flight = approach;
              entrance = null;
              useNearLane();
              break;
            }
            if (!point) planner.setLane(nearDepth);
          }
        }
      } else if (!point) {
        point = planner.nearestRest(spots[spot], chooser);
      }
      retryAt = personality.now + RETRY_MS;
    }
    const randomPeekEnabled = !chooser && canFly && config.ambient && config.easterEggs;
    if (randomPeekEnabled) nextPeek ??= personality.now + 30000 + random() * 15000;
    else nextPeek = null;
    const debugPeek = debugAction?.name === 'hide_and_seek';
    // A dense ring can block all normal entrances. If Tiko is already away,
    // start the close-up without waiting for a flight out of an idle spot.
    if (canFly && !peek && !perched && !landing &&
        ((debugPeek && (!point || !onScreen(point))) ||
         (!point && !debugAction && randomPeekEnabled && personality.now >= nextPeek))) {
      startPeek(null, null, true);
      personality.play('hide_and_seek', 2, 'AMBIENT', debugPeek);
      if (debugPeek) finishDebug(true);
    }
    if (!point) { mascot.root.visible = false; hasPosition = false; return; }
    if (nearDepth && foregroundDepth > nearDepth && hasPosition && !debugAction && !peek &&
        !flight && !ringFlight && !landing && !perched && !release && personality.now >= retryAt) {
      planner.setLane(0);
      const goal = planner.nearestRest(point, chooser);
      planner.setLane(nearDepth);
      const pass = goal && foregroundPass(goal, 1600, worldAt(goal, new THREE.Vector3(), foregroundDepth));
      if (pass) {
        ringFlight = { ...pass, laneChange: true };
        nearDepth = 0;
        depth = foregroundDepth;
        planner.setLane(0);
      }
      retryAt = personality.now + 750;
    }
    if (ringVisit && !flight) {
      if (ringVisit.stage === 'dive' && ringVisit.progress === 1) {
        flight = approachRingDevice(planner, point, ringDevice, footprint);
        ringVisit.stage = flight ? 'approach' : 'return';
      } else if (ringVisit.stage === 'approach') {
        ringVisit.stage = 'inspect';
        ringVisit.until = personality.now + 2100;
        if (personality.state === 'IDLE') personality.play('console_inspection');
      } else if (ringVisit.stage === 'inspect' && personality.now >= ringVisit.until) {
        ringVisit.stage = 'return';
      } else if (ringVisit.stage === 'return' && personality.now >= retryAt) {
        const nearby = planner.escape(point, false, 1);
        for (const goal of [ringVisit.origin, ...HOVER_SPOTS, nearby]) {
          if (!goal || !planner.safeRest(goal, 1) || !planner.clear(goal, goal, false, 1)) continue;
          if (distance(point, goal) < .02) { ringVisit.stage = 'rise'; break; }
          const approach = beginFlight(planner, point, goal, false, 1800, .06, .14, easeInOut);
          if (approach && distance(approach.path.at(-1), goal) < .001) { flight = approach; break; }
        }
        if (!flight && ringVisit.stage === 'return') {
          ringVisit = null;
          depth = foregroundDepth;
          returnToRest(footprint, false);
        }
        retryAt = personality.now + RETRY_MS;
      }
    }
    if (peek && !flight && !ringFlight) {
      // Keep the route at its normal depth while the head peeks in separately.
      // Both changes in depth happen with the model beyond the screen edge.
      const withdrawAt = PEEK_WAIT + PEEK_IN + PEEK_HOLD;
      peek.elapsed += dt;
      if (distance(point, peek.exit) > .001) {
        mascot.showHeadOnly(false);
        peek = null;
      } else if (peek.elapsed < PEEK_WAIT) {
        lookTarget = null;
        mascot.root.visible = false;
        return;
      } else if (peek.elapsed < withdrawAt + PEEK_OUT) {
        mascot.showHeadOnly(true);
        const amount = peek.elapsed < withdrawAt
          ? easeOut(Math.min(1, (peek.elapsed - PEEK_WAIT) / PEEK_IN))
          : 1 - easeInOut((peek.elapsed - withdrawAt) / PEEK_OUT);
        worldAt(lerpPoint(peek.outside, peek.inside, amount), position, 1.5);
        up.copy(worldUp).applyQuaternion(camera.getWorldQuaternion(cameraRotation));
        mascot.root.quaternion.setFromRotationMatrix(facing.lookAt(cameraPosition, position, up));
        const zoom = scaleAt(position) * 5;
        mascot.root.scale.setScalar(zoom);
        mascot.body.position.set(0, 0, 0);
        mascot.setFlightPose(0, 0, 0);
        mascot.head.rotation.set(0, 0, 0);
        mascot.body.rotation.z = peek.fromTop ? Math.PI : Math.PI / 4 * peek.tilt;
        mascot.root.position.copy(position).sub(surface.copy(mascot.headCenter).applyQuaternion(mascot.body.quaternion)
          .applyQuaternion(mascot.root.quaternion).multiplyScalar(zoom));
        if (planner.hitsPanel(mascot.root.position, mascot.root.position, zoom * mascot.radius)) {
          mascot.root.visible = false;
          return;
        }
        if (!peek.revealed && peek.elapsed >= PEEK_WAIT + .6 * PEEK_IN && peek.elapsed < withdrawAt) {
          peek.revealed = true;
          personality.playPeekBoo(peek.fromTop);
        }
        if (content !== scene) mascot.root.applyMatrix4(inverseContent.copy(content.matrixWorld).invert());
        mascot.root.updateMatrixWorld(true);
        return;
      } else {
        mascot.showHeadOnly(false);
        if (!peek.origin) {
          point = peek = null;
          hasPosition = mascot.root.visible = false;
          retryAt = personality.now;
          return;
        }
        if (!peek.foreground) flight = beginFlight(planner, point, peek.origin, false, 1900, .06, .12, easeInOut);
        if (!flight) ringFlight = foregroundPass(peek.origin, 1900, worldAt(peek.origin, new THREE.Vector3(), depth));
        hasPosition = false;
        flightPitch = heading = 0;
        peek = null;
      }
    }
    if (canFly && !flight && !ringFlight && !perched && !landing && !onScreen(point) && personality.now >= retryAt) {
      const goal = spots[spot];
      flight = beginFlight(planner, point, goal, chooser, RELOCATION_MS, 0, 0, easeInOut);
      if (!flight || !planner.safeRest(flight.path.at(-1))) {
        const rest = planner.nearestRest(goal, chooser) ?? (planner.clearsPanel(goal) ? goal : null);
        flight = null;
        if (rest) ringFlight = foregroundPass(rest, RELOCATION_MS, worldAt(rest, new THREE.Vector3(), depth));
      }
      retryAt = personality.now + RETRY_MS;
    }
    function roam() {
      const target = point[0] < 0 ? 0 : 1, goal = spots[target];
      const move = beginFlight(planner, point, goal, false, RELOCATION_MS, .08, Math.sign(goal[0] - point[0]) * -.16, easeInOut);
      if (!move || distance(move.path.at(-1), goal) > .001) {
        const rest = planner.clear(goal) ? goal
          : planner.nearestRest(goal, false, 1, candidate => Math.sign(candidate[0]) === Math.sign(goal[0]))
            ?? (planner.clearsPanel(goal) ? goal : null);
        if (rest) ringFlight = foregroundPass(rest, RELOCATION_MS, worldAt(rest, new THREE.Vector3(), depth));
        if (ringFlight) { spot = target; return true; }
        if (!move || distance(point, move.path.at(-1)) < .04) return false;
      }
      spot = target;
      flight = move;
      return true;
    }
    if (hopRun && !flight && !ringFlight && !landing && !perched) hopRun = null;
    const settled = !flight && !ringFlight && !landing && !perched && !ringVisit && !peek && !release;
    const runningDebug = Boolean(debugAction);
    if (settled && debugAction) {
      const { name } = debugAction;
      let started;
      if (name === 'hide_and_seek') started = launchPeek() && personality.play(name, 2, 'AMBIENT', true);
      else if (name === 'panel_peek') started = launchPanelPeek() && personality.play('cheeky_wink', 2, 'AMBIENT', true);
      else if (name === 'console_perch') started = startConsolePerch();
      else if (name === 'console_hops') started = startHopping();
      else if (name === 'ring_corkscrew') started = startCorkscrew() && personality.play('excited_reaction', 2, 'AMBIENT', true);
      else if (name === 'hover_relocation') started = roam() && personality.play('wanderer', 2, 'AMBIENT', true);
      else if (name === 'ring_visit') {
        const devices = ringTargets();
        started = devices.length > 0;
        if (started) startRingVisit(devices);
      } else started = personality.play(name, 2, 'AMBIENT', true);
      nextMove = null;
      const result = started
        ? (name === 'ring_corkscrew' && ringFlight?.preview ? 'Playing a compact corkscrew in front of the ring.' : undefined)
        : DEBUG_ROUTE_FAILURE[name];
      finishDebug(Boolean(started), result);
    }
    const canRoam = settled && !summon && !runningDebug && planner.safeRest(point);
    if (randomPeekEnabled) {
      if (canRoam && !flight && !ringFlight && ['IDLE', 'AMBIENT'].includes(personality.state) && personality.now >= nextPeek) {
        if (launchPeek()) personality.play('hide_and_seek');
        else nextPeek = personality.now + 5000;
      }
    }
    if (!chooser && canFly && config.ambient && canRoam && !flight && !ringFlight) {
      nextMove ??= personality.now + (firstRoam ? 6000 + random() * 4000 : (config.idleMin + random() * (config.idleMax - config.idleMin)) * 1000);
      if (personality.now >= nextMove && personality.state === 'IDLE') {
        const devices = ringTargets();
        const trick = firstRoam ? 1 : random();
        const pole = content.children.find(object => object.visible && object.userData.totemRest);
        const started = (pole && random() < .25 && approachPerch(findRestPerch(pole)))
          || (trick < .24 && startHopping()) || (trick >= .24 && trick < .48 && startCorkscrew());
        if (!started && !(selectedDevice && (firstRoam || random() < .45) && startConsolePerch())) {
          if (devices.length && random() < .4) startRingVisit(devices);
          else roam();
        }
        firstRoam = false;
        nextMove = null;
      }
    }
    let bank = 0;
    const leaning = Boolean(flight || ringFlight || changingDepth);
    if (flight) {
      const step = advanceFlight(planner, flight, point, dt);
      point = step.point;
      bank = flight.bank * Math.sin(Math.PI * flight.elapsed / flight.duration);
      if (step.blocked) {
        const goal = flight.path.at(-1), perch = flight.perch;
        flight = beginFlight(planner, point, goal, chooser, RELOCATION_MS, 0, flight.bank, easeInOut);
        if (peek && (!flight || distance(flight.path.at(-1), goal) > .001)) {
          ringFlight = foregroundPass(peek.exit, 2100);
          if (ringFlight) { flight = null; peek.foreground = true; }
        }
        if (flight && perch && distance(flight.path.at(-1), goal) < .001) flight.perch = perch;
      } else if (flight.elapsed === flight.duration) {
        if (flight.perch) landing = { perch: flight.perch, from: worldAt(point, new THREE.Vector3(), depth), elapsed: 0 };
        flight = null;
      }
    }
    if (!flight && !ringFlight && !landing && !perched && !peek && !planner.safeRest(point)) {
      const rest = planner.nearestRest(point, chooser);
      if (canFly && rest && personality.now >= retryAt) {
        flight = beginFlight(planner, point, rest, chooser, RELOCATION_MS, 0, 0, easeInOut);
        if (!flight) ringFlight = foregroundPass(rest, RELOCATION_MS, worldAt(rest, new THREE.Vector3(), depth));
        retryAt = personality.now + RETRY_MS;
      } else if (!canFly) point = rest ?? planner.fitRest(point);
    }
    up.copy(worldUp).applyQuaternion(camera.getWorldQuaternion(cameraRotation));
    worldAt(point, position, depth);
    let flyingRing = Boolean(ringFlight);
    let takeoffSupport;
    if (ringFlight) {
      ringFlight.elapsed = Math.min(ringFlight.duration, ringFlight.elapsed + dt);
      const progress = ringFlight.elapsed / ringFlight.duration;
      const along = easeInOut(progress);
      ringFlight.curve.getPoint(along, position);
      if (ringFlight.takeoff && along * ringFlight.curve.getLength() <= ringFlight.curve.curves[0].getLength()) {
        takeoffSupport = ringFlight.takeoff;
      }
      const blend = ringFlight.perch ? 1 : Math.min(1, progress * 8, (1 - progress) * 8);
      footprint = ringFlight.perch ? THREE.MathUtils.lerp(ringFlight.fromSize, ringFlight.perch.size, easeInOut(progress))
        : ringFlight.destination ? 1
        : THREE.MathUtils.lerp(1, ringFlight.preview ? .63 : Math.min(1, CORKSCREW_SCALE / scaleAt(position)), blend);
      ringFlight.currentSize = footprint;
      bank = ringFlight.perch || ringFlight.destination ? -.25 * Math.sin(Math.PI * progress) : 2 * Math.PI * easeInOut(progress);
      if (progress === 1) {
        if (ringFlight.destination) point = ringFlight.destination;
        if (ringFlight.perch) landing = { perch: ringFlight.perch, from: position.clone(), elapsed: 0, hop: true };
        ringFlight = null;
      }
    }
    let perch = perched ?? landing?.perch;
    mascot.root.userData.onPole = Boolean(perch?.pole || flight?.perch?.pole);
    let fittedScale, poleBlend = 0;
    if (perch) {
      const landingScale = perchTarget(perch, target);
      if (landing) {
        landing.elapsed = Math.min(DESCENT_MS, landing.elapsed + dt);
        const progress = landing.elapsed / DESCENT_MS;
        footprint = THREE.MathUtils.lerp(landing.hop ? perch.size : 1, perch.size ?? 1, easeInOut(progress));
        if (progress < .46) position.copy(landing.from).lerp(perch.above, easeInOut(progress / .46));
        else position.copy(perch.above).lerp(target, easeOut((progress - .46) / .54));
        if (perch.pole) {
          poleBlend = easeInOut(progress);
          fittedScale = THREE.MathUtils.lerp(scaleAt(position), landingScale, poleBlend);
        }
        if (progress === 1) {
          const normalStay = hopRun ? HOP_PERCH_MS : CONSOLE_PERCH_MS;
          const stay = perch.summoned ? POLE_MIN_PERCH_MS
            : perch.pole ? Math.max(POLE_MIN_PERCH_MS, normalStay) : normalStay;
          perched = { ...perch, until: personality.now + stay };
          landing = null;
          if (perch.device) personality.play('excited_reaction', 1);
        }
      } else {
        position.copy(target); footprint = perch.size ?? 1;
        if (perch.pole) { poleBlend = 1; fittedScale = landingScale; }
      }
    }
    let worldScale = fittedScale ?? (perch || depth || flyingRing ? scaleAt(position) * footprint : scale);
    const support = perch?.mesh ?? takeoffSupport;
    const overlapsConsole = (at, size, support) => planner.hitsConsole(at, at, size * mascot.radius, support, true)
      || planner.hitsPanel(at, at, size * mascot.radius);
    const sweepStart = hasPosition ? lastPosition : position;
    const sweepRadius = (hasPosition ? Math.max(lastScale, worldScale) : worldScale) * mascot.radius;
    const blockedByPanel = planner.hitsPanel(sweepStart, position, sweepRadius);
    if (!chooser && (blockedByPanel || (!release && hasPosition
      ? planner.hitsConsole(lastPosition, position, sweepRadius, support)
      : overlapsConsole(position, worldScale, support)))) {
      if (peek) mascot.showHeadOnly(false);
      peek = ringVisit = null;
      bodyOffset.set(0, 0, 0);
      let movedToNearRest = false;
      if ((!release || blockedByPanel) && hasPosition && !overlapsConsole(lastPosition, lastScale)) {
        position.copy(lastPosition);
        worldScale = lastScale;
      } else {
        target.copy(lastPosition).project(camera);
        const wasOnscreen = hasPosition && onScreen([target.x, target.y]);
        // A moving console can occupy the old position too. Start the
        // recovery from a clear pose, unless that would skip an offscreen entrance.
        let restDepth = nearDepth || foregroundDepth || CAMERA_DISTANCE;
        point = canFly && !wasOnscreen ? null : planner.nearestRest(point, chooser, 1, candidate => {
          worldAt(candidate, target, restDepth);
          return !overlapsConsole(target, scaleAt(target));
        });
        if (!point && wasOnscreen && canFly) {
          target.copy(lastPosition).project(camera);
          point = nearRest([target.x, target.y]);
          if (point) {
            useNearLane();
            restDepth = nearDepth;
            movedToNearRest = true;
            flight = landing = perched = hopRun = ringFlight = release = null;
            retryAt = personality.now + 750;
          }
        }
        if (!point) {
          flight = landing = perched = hopRun = ringFlight = release = null;
          retryAt = personality.now + RETRY_MS;
          mascot.root.visible = false;
          hasPosition = false;
          return;
        }
        worldAt(point, position, restDepth);
        worldScale = scaleAt(position);
      }
      if (canFly && !movedToNearRest) returnToRest(worldScale / scaleAt(position), true, position);
      else {
        target.copy(position).project(camera);
        point = [target.x, target.y];
      }
      perch = null;
      flyingRing = false;
    }
    mascot.root.position.copy(position);
    // Keep the foot plane level while approaching and resting on a surface.
    if (perch) { target.copy(cameraPosition); target.y = position.y; }
    mascot.root.quaternion.setFromRotationMatrix(facing.lookAt(perch ? target : cameraPosition, position, perch ? worldUp : up));
    if (perch?.pole) mascot.root.quaternion.slerp(poleRotation, poleBlend);
    mascot.root.scale.setScalar(worldScale);
    viewerInverse.copy(mascot.root.quaternion).invert();

    // Use the travelled segment, including depth changes and detours. Relax
    // toward the viewer as flight ends, before reaching a perch.
    let pitchTarget = 0, headingTarget = 0;
    if (canFly && leaning && !perch) {
      travelDirection.subVectors(position, lastPosition).applyQuaternion(viewerInverse);
      const horizontal = Math.hypot(travelDirection.x, travelDirection.z);
      if (hasPosition && horizontal > 1e-5) {
        headingTarget = Math.atan2(travelDirection.x, travelDirection.z);
        pitchTarget = FLIGHT_PITCH * horizontal / travelDirection.length();
      } else {
        headingTarget = heading;
        pitchTarget = flightPitch;
      }
    }
    const turn = 1 - Math.exp(-dt / 110);
    heading = wrapAngle(heading + wrapAngle(headingTarget - heading) * turn);
    flightPitch = THREE.MathUtils.damp(flightPitch, pitchTarget, 9, dt / 1000);
    if (pitchTarget === 0 && flightPitch < .001) flightPitch = 0;
    if (headingTarget === 0 && Math.abs(heading) < .001) heading = 0;
    lastPosition.copy(position);
    lastScale = worldScale;
    hasPosition = true;
    if (perch?.pole && poleBlend === 1) mascot.body.rotation.set(0, 0, 0);
    else mascot.setFlightPose(flightPitch, bank, heading);

    lookTarget = null;
    const inspecting = ringVisit && ringDevice && ringVisit.stage !== 'rise' && ringVisit.stage !== 'return';
    const nearby = inspecting ? ringDevice : leaning || landing ? planner.nearestObject(point) : null;
    if (perch?.device) {
      lookTarget = { yaw: 0, pitch: .38 };
    } else if (nearby) {
      const [left, bottom, right, top] = nearby.bounds;
      const look = [(left + right) / 2, (bottom + top) / 2];
      let yaw = (look[0] - point[0]) * 1.6, pitch = (point[1] - look[1]) * 1.35;
      if (nearby.depth) {
        worldAt(look, gazeDirection, nearby.depth).sub(position).applyQuaternion(viewerInverse);
        yaw = Math.atan2(gazeDirection.x, gazeDirection.z);
        pitch = -Math.atan2(gazeDirection.y, Math.hypot(gazeDirection.x, gazeDirection.z));
      }
      lookTarget = { yaw: THREE.MathUtils.clamp(wrapAngle(yaw - heading), -.62, .62), pitch: THREE.MathUtils.clamp(pitch, -.28, .28) };
    } else if (pointer && !leaning && !landing && !reduced) {
      const time = personality.now;
      const idle = config.ambient && personality.state === 'IDLE';
      if (idle) {
        glanceAt ||= time + 7000 + random() * 7000;
        if (time >= glanceAt) {
          glanceUntil = time + 1400;
          glanceAt = time + 9000 + random() * 9000;
        }
      }
      gazeDirection.copy(position).project(camera);
      const dx = pointer[0] - gazeDirection.x, dy = pointer[1] - gazeDirection.y;
      // One unit here is half the viewport width, on either axis.
      const close = Math.hypot(dx, dy * focalX / focalY) <= 1;
      if (config.reactions && close) nearUntil = pointerMovedAt + POINTER_NEAR_MS;
      const reactingToPointer = config.reactions && (time < clickUntil || time < nearUntil);
      if (reactingToPointer || (idle && time < glanceUntil)) {
        lookTarget = { yaw: THREE.MathUtils.clamp(wrapAngle(dx * 1.8 - heading), -.55, .55), pitch: THREE.MathUtils.clamp(-dy * 1.45, -.28, .28) };
      }
    }

    // Gestures translate the body inside its current hover spot. Test that
    // translation separately so an animation cannot invalidate the flight origin.
    if (perch || reduced || flyingRing) bodyOffset.set(0, 0, 0);
    else {
      if (flight || changingDepth || personality.state === 'ENTERING') mascot.body.position.set(0, 0, 0);
      bodyOffset.lerp(mascot.body.position, 1 - Math.exp(-dt / 70));
      if (bodyOffset.lengthSq() > 1e-8) {
        const clearsGesture = fraction => {
          projectedBody.copy(bodyOffset).applyQuaternion(mascot.root.quaternion)
            .multiplyScalar(mascot.root.scale.x * fraction).add(position).project(camera);
          gesturePoint[0] = projectedBody.x;
          gesturePoint[1] = projectedBody.y;
          return (flight || planner.safeRest(gesturePoint)) && planner.clear(point, gesturePoint);
        };
        if (!clearsGesture(1)) {
          let safe = 0, blocked = 1;
          for (let step = 0; step < 6; step++) {
            const fraction = (safe + blocked) / 2;
            if (clearsGesture(fraction)) safe = fraction;
            else blocked = fraction;
          }
          bodyOffset.multiplyScalar(safe);
        }
      }
    }
    mascot.body.position.copy(bodyOffset);
    // Flight and gestures are calculated in world space, including on the raised carousel.
    if (content !== scene) mascot.root.applyMatrix4(inverseContent.copy(content.matrixWorld).invert());
    mascot.root.updateMatrixWorld(true);
  }
  scene.onBeforeRender = beforeRender;
  return {
    interact, watchPointer, canSummonPole,
    summonPole(pole) {
      if (!canSummonPole()) return;
      summon = { pole, expires: mascot.personality.now + 8000 };
      retryAt = 0;
    },
    debug(name, result) { debugAction = { name, result, deadline: mascot.personality.now + 8000 }; },
    detach() { disposed = true; if (scene.onBeforeRender === beforeRender) scene.onBeforeRender = previous; mascot.dispose(); },
  };
}
