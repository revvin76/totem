import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTotemMascot, attachTotemToScene, releaseTotemAsset } from '../src/totem-mascot.js';
import { createTotemPole } from '../src/totem-pole.js';
import { findTotemPerch, polePerchPose } from '../src/totem-perches.js';
import { createTotemFlightPlanner } from '../src/totem-flight-path.js';
import { drawVisorMessage } from '../src/totem-visor-programs.js';

test('the details panel blocks a straight flight but can be bypassed around its edge', () => {
  const planner = createTotemFlightPlanner(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  planner.refresh(camera, new THREE.Group(), .2, 5);
  planner.setPanel(camera, [-.25, -.25, .25, .25], 5);
  const front = new THREE.Vector3(0, 0, -4), behind = new THREE.Vector3(0, 0, -6);
  assert.equal(planner.hitsPanel(front, front, .2), false);
  assert.equal(planner.hitsPanel(front, behind, .2), true);
  assert.equal(planner.hitsPanel(behind, behind, .2), true);
  assert.equal(planner.hitsPanel(new THREE.Vector3(-2, 0, -7), new THREE.Vector3(2, 0, -7), .2), true);
  assert.equal(planner.hitsPanel(new THREE.Vector3(2, 0, -4), new THREE.Vector3(2, 0, -6), .2), false);
  const route = planner.route([-.6, 0], [.6, 0], false);
  assert.ok(route.length > 2);
  assert.ok(route.slice(1).every((point, index) => planner.clear(route[index], point)));
});

async function asset() {
  const buffer = await readFile(new URL('../rainbow-mascot-toon.glb', import.meta.url));
  const loader = new GLTFLoader();
  // Node exercises articulation and bounds without decoding the browser's PNG.
  loader.register(() => ({ name: 'Node texture placeholder', loadTexture: async () => new THREE.Texture() }));
  return loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
}

function assertInSafeArea(mascot, camera) {
  const vertex = new THREE.Vector3();
  mascot.root.traverseVisible(part => {
    if (!part.isMesh) return;
    part.geometry.computeBoundingBox();
    const { min, max } = part.geometry.boundingBox;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      vertex.set(x, y, z).applyMatrix4(part.matrixWorld).project(camera);
      assert.ok(Math.abs(vertex.x) <= .9 && Math.abs(vertex.y) <= .9, 'entire mesh stays inside the overscan margin');
    }
  });
}
test('supplied curved screen uses existing surface without UV/geometry changes, follows the model, and has safe shared ownership', async () => {
  const source = await asset(), a = createTotemMascot(source), b = createTotemMascot(source);
  const original = source.scene.getObjectByName('Curved_dark_face_screen');
  assert.equal(a.visor.geometry, original.geometry); assert.equal(a.visor.material.side, original.material.side);
  assert.equal(a.visor.geometry.attributes.uv, undefined); assert.equal(source.animations.length, 0); assert.equal(a.wingsAvailable, true);
  const before = new THREE.Vector3(); a.visor.getWorldPosition(before);
  a.root.position.x = 3; a.root.rotation.y = .4; a.root.updateMatrixWorld(true);
  const after = new THREE.Vector3(); a.visor.getWorldPosition(after); assert.ok(after.distanceTo(before) > 2);
  a.dispose(); assert.notEqual(b.visor.material, original.material); assert.equal(a.visor.material, original.material);
  b.dispose(); releaseTotemAsset(source);
});

test('the real model articulates at the neck and wing roots while preserving its rest pose and the visor attachment', async () => {
  const source = await asset(), mascot = createTotemMascot(source, { ambient: false });
  source.scene.updateMatrixWorld(true);
  mascot.root.updateMatrixWorld(true);
  for (const original of source.scene.children) {
    const clone = mascot.model.getObjectByName(original.name);
    const rest = mascot.model.matrixWorld.clone().invert().multiply(clone.matrixWorld);
    assert.ok(rest.elements.every((value, index) => Math.abs(value - original.matrixWorld.elements[index]) < 1e-8), original.name);
  }
  assert.equal(mascot.visor.parent, mascot.head);
  const crown = mascot.model.getObjectByName('Head_crown');
  assert.equal(crown.parent, mascot.head);
  mascot.showHeadOnly(true);
  assert.ok(crown.visible && crown.parent.visible);
  mascot.showHeadOnly(false);
  assert.equal(mascot.head.children.length, 9);
  assert.deepEqual(mascot.wings.map(wing => wing.children.length), [11, 11]);

  const neckRest = mascot.head.position.clone(), visorRest = mascot.visor.matrix.clone();
  const yaw = [], pitch = [], tilt = [], flap = [];
  mascot.personality.show();
  mascot.personality.play('wing_stretch');
  for (let frame = 0; frame < 72; frame++) {
    mascot.update(50, false);
    yaw.push(mascot.head.rotation.y);
    pitch.push(mascot.head.rotation.x);
    tilt.push(mascot.head.rotation.z);
    flap.push(mascot.wings[0].rotation.z);
    assert.ok(Math.abs(mascot.wings[0].rotation.z + mascot.wings[1].rotation.z) < 1e-8);
  }
  assert.ok(Math.max(...yaw) > .27 && Math.min(...yaw) < -.27);
  assert.ok(Math.min(...pitch) < -.12 && Math.max(...tilt) > .12);
  assert.ok(Math.max(...flap) - Math.min(...flap) > .5);
  assert.deepEqual(mascot.head.position, neckRest);
  assert.deepEqual(mascot.visor.matrix, visorRest);
  assert.equal(source.scene.getObjectByName(mascot.visor.name).parent, source.scene);

  mascot.update(16, true);
  for (const pivot of [mascot.head, ...mascot.wings]) assert.deepEqual(pivot.rotation.toArray().slice(0, 3), [0, 0, 0]);
  mascot.dispose(); releaseTotemAsset(source);
});
test('scene integration preserves callbacks, pauses while hidden and restores ownership on teardown', async () => {
  const source = await asset(), mascot = createTotemMascot(source), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  let priorCalls = 0, hidden = false; const callback = () => priorCalls++; scene.onBeforeRender = callback;
  camera.position.set(1, 3, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const { detach } = attachTotemToScene({ scene, camera }, mascot, { hidden: () => hidden, reducedMotion: () => true });
  scene.onBeforeRender(null, scene, camera); assert.equal(priorCalls, 1); assert.equal(mascot.root.parent, scene);
  assertInSafeArea(mascot, camera);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(mascot.body.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(forward.dot(camera.position.clone().sub(mascot.root.position).normalize()) > .9999);
  const viewerPosition = mascot.root.position.clone();
  scene.onBeforeRender(null, scene, new THREE.PerspectiveCamera()); assert.deepEqual(mascot.root.position, viewerPosition);
  hidden = true; const time = mascot.personality.now; scene.onBeforeRender(null, scene, camera); assert.equal(mascot.personality.now, time); assert.equal(mascot.root.visible, false);
  detach(); assert.equal(scene.onBeforeRender, callback); assert.equal(mascot.root.parent, null); releaseTotemAsset(source);
});

test('Little Totem flies in again after being hidden on the same screen', async () => {
  const source = await asset(), mascot = createTotemMascot(source, { ambient: false });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  let time = 0, hidden = false;
  const { detach } = attachTotemToScene({ scene, camera }, mascot, {
    hidden: () => hidden, now: () => time, random: () => 0, storage: () => null,
  });
  const render = () => { time += 50; scene.onBeforeRender(null, scene, camera); };
  for (let i = 0; i < 40; i++) render();
  assertInSafeArea(mascot, camera);
  hidden = true; render();
  assert.equal(mascot.root.visible, false);
  hidden = false; render();
  assert.ok(mascot.root.position.clone().project(camera).x > 1.2, 'resumes beyond the right edge');
  for (let i = 0; i < 40; i++) render();
  assert.ok(mascot.root.visible);
  assertInSafeArea(mascot, camera);
  detach(); releaseTotemAsset(source);
});

test('Little Totem can perch on a Studio pole that belongs only to the Game Chooser', async () => {
  const source = await asset(), mascot = createTotemMascot(source, { ambient: false });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1.6, .01, 160);
  camera.position.set(0, 5, 18); camera.lookAt(0, 2, 0); camera.updateMatrixWorld();
  const home = new THREE.Group(), chooser = new THREE.Group(), support = new THREE.Group();
  home.name = 'Home screen content';
  support.name = 'Studio support objects';
  scene.add(home, chooser);
  chooser.add(support);
  const pole = createTotemPole();
  support.add(pole.root);
  pole.root.position.x = 3;
  pole.root.rotation.set(.08, -.9, .12);
  pole.root.scale.set(2, 1.8, 2.2);
  chooser.visible = false;
  const runtime = { scene, camera };
  let time = 0;
  const { detach } = attachTotemToScene(runtime, mascot, {
    hidden: () => false, now: () => time, random: () => .5, storage: () => null,
  });
  function render() {
    scene.updateMatrixWorld(true);
    scene.onBeforeRender(null, scene, camera);
  }
  render();
  assert.equal(home.getObjectByName('Totem pole'), undefined);
  chooser.visible = true;
  runtime.activeView = { content: chooser };
  render();
  const entry = mascot.root.getWorldPosition(new THREE.Vector3()).project(camera);
  assert.ok(Math.abs(entry.x) > 1 || Math.abs(entry.y) > 1, 'enters from outside the frame');
  for (; time < 7000; time += 50) render();
  const position = mascot.root.getWorldPosition(new THREE.Vector3());
  const rotation = mascot.root.getWorldQuaternion(new THREE.Quaternion());
  const scale = mascot.root.getWorldScale(new THREE.Vector3()).x;
  const base = new THREE.Vector3(0, -mascot.poleFit.baseOffset * scale, 0).applyQuaternion(rotation).add(position);
  assert.ok(base.distanceTo(pole.root.localToWorld(new THREE.Vector3(0, 1.27, 0))) < .001, 'the mascot sits on the pole top');
  assert.ok(Math.abs(scale * mascot.poleFit.bodyWidth - 2.08) < .001, 'the body matches the top tier width');
  assert.ok(rotation.angleTo(pole.root.getWorldQuaternion(new THREE.Quaternion())) < .001, 'the mascot follows the pole orientation');
  pole.root.visible = false;
  time += 50;
  render();
  assert.ok(mascot.root.position.distanceTo(position) > .001, 'leaves the perch when its pole is hidden');
  detach();
  pole.dispose();
  releaseTotemAsset(source);
});

test('Studio holds Mini Totem on the selected pole with live scale and facing edits', async () => {
  const source = await asset(), mascot = createTotemMascot(source, { flight: false, enabled: false });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1.6, .01, 160);
  camera.position.set(0, 8, 18); camera.lookAt(0, 5, 0); camera.updateMatrixWorld();
  const home = new THREE.Group();
  home.name = 'Home screen content';
  home.position.y = 8;
  scene.add(home);
  const pole = createTotemPole();
  home.add(pole.root);
  const runtime = { scene, camera, editorPerch: pole.root };
  const binding = attachTotemToScene(runtime, mascot, { hidden: () => false });
  try {
    const render = () => {
      scene.updateMatrixWorld(true);
      scene.onBeforeRender(null, scene, camera);
    };
    function assertPerched() {
      assert.equal(mascot.root.visible, true);
      const rotation = mascot.root.getWorldQuaternion(new THREE.Quaternion());
      const scale = mascot.root.getWorldScale(new THREE.Vector3()).x;
      const base = new THREE.Vector3(0, -mascot.poleFit.baseOffset * scale, 0).applyQuaternion(rotation)
        .add(mascot.root.getWorldPosition(new THREE.Vector3()));
      assert.ok(base.distanceTo(pole.root.localToWorld(new THREE.Vector3(0, 1.27, 0))) < .001);
      return { rotation, scale };
    }
    render();
    const original = assertPerched();
    pole.root.position.set(2, 1, -3);
    pole.root.scale.setScalar(2);
    Object.assign(pole.root.userData.totemRest, { mascotScale: .75, mascotYaw: 90 });
    render();
    const edited = assertPerched();
    assert.ok(Math.abs(edited.scale / original.scale - 1.5) < .001);
    assert.ok(Math.abs(edited.rotation.angleTo(original.rotation) - Math.PI / 2) < .001);
    runtime.editorPerch = null;
    render();
    assert.equal(mascot.root.visible, false);
  } finally {
    binding.detach();
    pole.dispose();
    releaseTotemAsset(source);
  }
});

test('the pole near the edge of Game Chooser remains a possible perch alongside other objects', () => {
  const camera = new THREE.PerspectiveCamera(43, 16 / 9, .1, 160);
  camera.position.set(-1.945, 4.543, 28.822);
  camera.lookAt(0, 9, -8);
  camera.updateMatrixWorld();
  const pole = createTotemPole(), content = new THREE.Group();
  pole.root.position.set(11.338, -.062, 7.18);
  pole.root.rotation.y = -1.038;
  pole.root.scale.setScalar(5);
  const other = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 4), new THREE.MeshBasicMaterial());
  other.position.set(0, 1, 0);
  content.add(pole.root, other);
  content.updateMatrixWorld(true);
  const planner = createTotemFlightPlanner();
  const scaleAt = point => camera.position.distanceTo(point) * .09;
  planner.refresh(camera, content, .4, 5);
  const options = { safeRest: planner.safeRest, poleFit: { bodyWidth: .53, baseOffset: .312 } };
  assert.equal(findTotemPerch(content, camera, scaleAt, planner.clear, () => .01, options)?.pole, pole.root);
  assert.equal(findTotemPerch(content, camera, scaleAt, planner.clear, () => .99, options)?.mesh, other);
  pole.dispose();
  other.geometry.dispose();
  other.material.dispose();
});

test('summoning Little Totem keeps him on the pole for at least four seconds with ambient movement off', async () => {
  const source = await asset(), mascot = createTotemMascot(source, { ambient: false });
  const scene = new THREE.Scene(), content = new THREE.Group(), camera = new THREE.PerspectiveCamera(42, 1.6, .01, 160);
  camera.position.set(0, 5, 18);
  camera.lookAt(0, 2, 0);
  camera.updateMatrixWorld();
  const perch = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 2), new THREE.MeshBasicMaterial());
  const pole = createTotemPole();
  perch.position.set(3, 1, 0);
  pole.root.position.x = -5.5;
  pole.root.scale.setScalar(2);
  pole.root.visible = false;
  content.add(perch, pole.root);
  scene.add(content);
  let time = 0;
  const binding = attachTotemToScene({ scene, camera, activeView: { content } }, mascot, {
    hidden: () => false, now: () => time, random: () => .04, storage: () => null,
  });
  const render = () => {
    time += 50;
    scene.updateMatrixWorld(true);
    scene.onBeforeRender(null, scene, camera);
  };
  for (let i = 0; i < 100; i++) render();
  assert.ok(mascot.root.position.x > 1, 'starts on the other perch');
  pole.root.visible = true;
  binding.summonPole(pole.root);
  const onPole = () => Math.abs(mascot.root.position.x + 5.5) < .01 && Math.abs(mascot.root.position.z) < .01
    && Math.abs(mascot.root.position.y - 2.54 - mascot.poleFit.baseOffset * mascot.root.scale.x) < .01;
  const requestedAt = time;
  while (!onPole() && time - requestedAt < 8000) render();
  assert.ok(onPole(), 'reaches the clicked pole');
  const arrivedAt = time;
  while (onPole() && time - arrivedAt < 5000) render();
  assert.ok(!onPole() && time - arrivedAt >= 4000 && time - arrivedAt < 5000, 'takes off after at least four seconds');
  binding.detach();
  pole.dispose();
  perch.geometry.dispose();
  perch.material.dispose();
  releaseTotemAsset(source);
});

test('a clicked Platform Chooser pole still summons Totem immediately after a previous visit', async () => {
  const source = await asset(), mascot = createTotemMascot(source, { ambient: false });
  const scene = new THREE.Scene(), content = new THREE.Group(), camera = new THREE.PerspectiveCamera(42, 1.6, .01, 160);
  content.name = 'Home screen content';
  camera.position.set(0, 5, 18);
  camera.lookAt(0, 2, 0);
  camera.updateMatrixWorld();
  const pole = createTotemPole();
  pole.root.position.x = -5.5;
  pole.root.scale.setScalar(2);
  content.add(pole.root);
  scene.add(content);
  let time = 0;
  const binding = attachTotemToScene({ scene, camera }, mascot, {
    hidden: () => false, now: () => time, random: () => .04, storage: () => null,
  });
  const render = () => {
    time += 50;
    scene.updateMatrixWorld(true);
    scene.onBeforeRender(null, scene, camera);
  };
  const onPole = () => Math.abs(mascot.root.position.x + 5.5) < .01 && Math.abs(mascot.root.position.z) < .01;
  const advanceUntil = (condition, limit) => {
    const end = time + limit;
    while (!condition() && time < end) render();
    assert.ok(condition());
  };
  try {
    for (let i = 0; i < 100; i++) render();
    binding.summonPole(pole.root);
    advanceUntil(onPole, 4000);
    advanceUntil(() => !onPole(), 5000);
    binding.summonPole(pole.root);
    advanceUntil(onPole, 4000);
  } finally {
    binding.detach();
    pole.dispose();
    releaseTotemAsset(source);
  }
});

test('a visible panel blocks a pole behind it during startup and summoning', async () => {
  const source = await asset(), mascot = createTotemMascot(source, { ambient: false });
  const scene = new THREE.Scene(), content = new THREE.Group(), camera = new THREE.PerspectiveCamera(42, 1.6, .01, 160);
  content.name = 'Home screen content';
  camera.position.set(0, 5, 18);
  camera.lookAt(0, 2, 0);
  camera.updateMatrixWorld();
  const pole = createTotemPole();
  pole.root.position.x = -5.5;
  pole.root.scale.setScalar(2);
  scene.add(content);
  content.add(pole.root);
  const dock = new THREE.Vector3();
  polePerchPose(pole.root, mascot.poleFit, dock, new THREE.Quaternion());
  const { x, y } = dock.clone().project(camera);
  let panel = [x - .12, y - .16, x + .12, y + .16], time = 0;
  const binding = attachTotemToScene({ scene, camera, platformPanelDepth: 15 }, mascot, {
    hidden: () => false, now: () => time, random: () => .04, storage: () => null, panelBounds: () => panel,
  });
  const render = () => {
    time += 50;
    scene.updateMatrixWorld(true);
    scene.onBeforeRender(null, scene, camera);
  };
  try {
    for (let i = 0; i < 100; i++) render();
    assert.ok(mascot.root.visible);
    binding.summonPole(pole.root);
    const planner = createTotemFlightPlanner();
    planner.refresh(camera, content, mascot.root.scale.x * mascot.radius, 5);
    planner.setPanel(camera, panel, 15);
    let previous = mascot.root.position.clone();
    for (let i = 0; i < 120; i++) {
      render();
      const current = mascot.root.position.clone();
      assert.ok(mascot.root.visible);
      assert.equal(planner.hitsPanel(previous, current, mascot.root.scale.x * mascot.radius), false);
      previous = current;
    }
    assert.ok(previous.distanceTo(dock) > 1);
    panel = null;
    binding.summonPole(pole.root);
    for (let i = 0; i < 80 && mascot.root.position.distanceTo(dock) > .01; i++) render();
    assert.ok(mascot.root.position.distanceTo(dock) <= .01, 'the unobstructed pole is still reachable');
  } finally {
    binding.detach();
    pole.dispose();
    releaseTotemAsset(source);
  }
});

test('flight pitches the body forward while the head stays near upright, then levels off', async () => {
  const source = await asset(), mascot = createTotemMascot(source, { ambient: false });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  let time = 0;
  const { detach } = attachTotemToScene({ scene, camera }, mascot, {
    hidden: () => false, now: () => time, random: () => 0, storage: () => null,
  });
  let peakPitch = 0, leanedAlongPath = false;
  for (; time < 1900; time += 25) {
    const previous = mascot.root.position.clone();
    scene.onBeforeRender(null, scene, camera);
    const pitch = THREE.MathUtils.radToDeg(mascot.body.rotation.x);
    peakPitch = Math.max(peakPitch, pitch);
    const headUp = new THREE.Vector3(0, 1, 0).applyQuaternion(mascot.head.getWorldQuaternion(new THREE.Quaternion()));
    const rootUp = new THREE.Vector3(0, 1, 0).applyQuaternion(mascot.root.quaternion);
    assert.ok(headUp.angleTo(rootUp) < THREE.MathUtils.degToRad(9));
    if (pitch > 42 && time > 400) {
      const horizontal = vector => vector.addScaledVector(rootUp, -vector.dot(rootUp)).normalize();
      const step = horizontal(mascot.root.position.clone().sub(previous));
      const lean = horizontal(new THREE.Vector3(0, 1, 0).applyQuaternion(mascot.body.getWorldQuaternion(new THREE.Quaternion())));
      leanedAlongPath ||= step.dot(lean) > .94 && step.x < -.8;
    }
  }
  assert.ok(peakPitch > 48 && peakPitch <= 50);
  assert.ok(leanedAlongPath, 'the body leans along the sideways entrance');
  assert.ok(Math.abs(mascot.body.rotation.x) < .005);
  for (let i = 0; i < 12; i++) mascot.update(50, false, true, { yaw: .44, pitch: -.28 });
  assert.ok(mascot.head.rotation.y > .4, 'the neck can still turn toward an object');
  assert.ok(mascot.head.rotation.x >= THREE.MathUtils.degToRad(-8.1), 'upward gaze stays within neck clearance');
  detach(); releaseTotemAsset(source);
});

test('MiniTotem follows the mouse across half the screen and watches for four seconds after a click', async () => {
  const source = await asset(), mascot = createTotemMascot(source, { ambient: false, flight: false }, () => 0);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  let time = 0;
  const { detach, interact, watchPointer } = attachTotemToScene({ scene, camera }, mascot, {
    hidden: () => false, now: () => time, random: () => 0,
  });
  const advance = duration => {
    for (const end = time + duration; time < end;) {
      time += 50;
      scene.onBeforeRender(null, scene, camera);
    }
    return mascot.head.rotation.y;
  };
  advance(650);
  const hover = mascot.root.position.clone().project(camera);
  watchPointer({ x: hover.x - 1, y: hover.y });
  assert.ok(advance(300) < -.5, 'looks toward a mouse half a screen width away');
  watchPointer({ x: hover.x - 1.2, y: hover.y });
  assert.ok(advance(600) < -.5, 'holds the gaze as the mouse moves out of range');
  assert.ok(Math.abs(advance(700)) < .1, 'returns to center after the approach gaze expires');
  watchPointer({ x: hover.x, y: hover.y });
  assert.equal(interact(), true);
  watchPointer({ x: hover.x - 1.2, y: hover.y });
  assert.ok(advance(3950) < -.5, 'still follows a mouse that moved far away');
  assert.ok(Math.abs(advance(350)) < .1, 'releases attention after the four-second window');
  mascot.personality.configure({ ambient: true, flight: false, idleMin: 120, idleMax: 120, miniAnimations: false, randomMessages: false });
  assert.ok(advance(7500) < -.5, 'occasionally glances at a distant idle cursor');
  watchPointer(null);
  assert.ok(Math.abs(advance(400)) < .1, 'drops the gaze when the cursor leaves');
  detach(); releaseTotemAsset(source);
});

test('mascot follows the reflected content root without inheriting its offset in the viewer pose', async () => {
  const source = await asset(), mascot = createTotemMascot(source), scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  const home = new THREE.Group(), chooser = new THREE.Group();
  home.name = 'Home screen content';
  home.position.y = 8;
  chooser.position.set(2, 3, -4);
  scene.add(home, chooser);
  camera.updateMatrixWorld();
  const runtime = { scene, camera, activeView: null };
  const { detach } = attachTotemToScene(runtime, mascot, { hidden: () => false, reducedMotion: () => true });
  for (const content of [home, chooser, home]) {
    runtime.activeView = content === home ? null : { content };
    home.visible = content === home;
    chooser.visible = content === chooser;
    scene.updateMatrixWorld(true);
    scene.onBeforeRender(null, scene, camera);
    assert.equal(mascot.root.parent?.uuid, content.uuid);
    const projected = mascot.root.getWorldPosition(new THREE.Vector3()).project(camera);
    assert.ok(projected.x > .5 && projected.x < .8 && projected.y > .35 && projected.y < .75);
  }
  detach(); releaseTotemAsset(source);
});

test('startup chooses distinct offscreen paths and pauses until the launcher is visible', async () => {
  const source = await asset();
  const camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  for (const [roll, startsOffscreen, endsOnRight] of [
    [0, point => point.x > 1, true],
    [.5, point => point.y > 1 && Math.abs(point.x) < 1, true],
    [.9, point => point.x < -1 && point.y > 1, false],
  ]) {
    const mascot = createTotemMascot(source), scene = new THREE.Scene();
    let time = 0, hidden = true;
    const { detach } = attachTotemToScene({ scene, camera }, mascot, {
      hidden: () => hidden, now: () => time, random: () => roll,
    });
    const render = () => scene.onBeforeRender(null, scene, camera);
    const project = () => mascot.root.position.clone().project(camera);
    render();
    time = 5000;
    render();
    assert.equal(mascot.root.visible, false);
    hidden = false;
    render();
    assert.ok(startsOffscreen(project()));
    for (let frame = 0; frame < 15; frame++) { time += 100; render(); }
    const settled = project();
    assert.ok(Math.abs(settled.x) < 1 && Math.abs(settled.y) < 1);
    assert.equal(settled.x > 0, endsOnRight);
    assertInSafeArea(mascot, camera);
    camera.aspect = .65;
    camera.setViewOffset(650, 1000, 60, 70, 650, 1000);
    time += 100; render();
    assertInSafeArea(mascot, camera);
    camera.clearViewOffset();
    camera.aspect = 1.6; camera.updateProjectionMatrix();
    detach();
  }
  releaseTotemAsset(source);
});

test('mascot crosses to another hover spot while facing the viewer, unless movement is disabled', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.position.set(2, 5, 12); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
  for (const [flight, reduced, shouldMove] of [[true, false, true], [false, false, false], [true, true, false]]) {
    const mascot = createTotemMascot(source, { flight, idleMin: 20, idleMax: 20 }, () => .5);
    const scene = new THREE.Scene(), runtime = { scene, camera, activeView: null };
    let time = 0;
    const { detach } = attachTotemToScene(runtime, mascot, {
      hidden: () => false, reducedMotion: () => reduced, now: () => time, random: () => 0,
    });
    let crossedMiddle = false;
    for (; time <= 16000; time += 100) {
      scene.onBeforeRender(null, scene, camera);
      const projected = mascot.root.position.clone().project(camera);
      if (time > 2000 && Math.abs(projected.x) < .15) crossedMiddle = true;
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(mascot.root.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(forward.dot(camera.position.clone().sub(mascot.root.position).normalize()) > .9999);
    }
    assert.equal(crossedMiddle, shouldMove);
    const settled = mascot.root.position.clone().project(camera);
    assert.ok(shouldMove ? settled.x < -.5 : settled.x > .5);
    runtime.activeView = {};
    for (let frame = 0; frame < 16; frame++, time += 100) scene.onBeforeRender(null, scene, camera);
    const chooserPoint = mascot.root.position.clone().project(camera);
    assert.ok(chooserPoint.x > .5 && chooserPoint.x < .8, 'chooser keeps both spots clear of the left list');
    detach();
  }
  releaseTotemAsset(source);
});

test('consecutive launches exclude the entrance saved by the previous launcher instance', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  const saved = new Map();
  const storage = () => ({ getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) });
  const launches = [];
  for (let launch = 0; launch < 3; launch++) {
    const scene = new THREE.Scene(), mascot = createTotemMascot(source);
    const { detach } = attachTotemToScene({ scene, camera }, mascot, { hidden: () => false, random: () => 0, storage });
    scene.onBeforeRender(null, scene, camera);
    const point = mascot.root.position.clone().project(camera);
    launches.push(point.x > 1 ? 'side' : 'top');
    detach();
  }
  assert.deepEqual(launches, ['side', 'top', 'side']);
  releaseTotemAsset(source);
});

test('a console moving into an active flight forces a detour before Little Totem reaches the other side', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene(), home = new THREE.Group();
  home.name = 'Home screen content';
  scene.add(home);
  const consoleModel = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.45, .5), new THREE.MeshBasicMaterial());
  consoleModel.position.set(10, 1.15, -8);
  home.add(consoleModel);
  const mascot = createTotemMascot(source, { idleMin: 20, idleMax: 20 }, () => .5);
  let time = 0, obstacleArrived = false, detoured = false, flewOffscreen = false;
  const { detach } = attachTotemToScene({ scene, camera }, mascot, {
    hidden: () => false, now: () => time, random: () => 0,
  });
  for (; time <= 16000; time += 50) {
    scene.updateMatrixWorld(true);
    scene.onBeforeRender(null, scene, camera);
    const projected = mascot.root.position.clone().project(camera);
    if (time > 6500 && !obstacleArrived && projected.x < .69) {
      consoleModel.position.x = 0;
      obstacleArrived = true;
    }
    if (obstacleArrived && mascot.root.visible && Math.abs(projected.x) < .25) {
      assert.ok(projected.y > .87 || projected.y < -.12, 'flight clears the console silhouette');
      detoured = true;
    }
    if (obstacleArrived) flewOffscreen ||= Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
  }
  assert.ok(obstacleArrived && detoured && flewOffscreen);
  assert.ok(mascot.root.visible && mascot.root.position.clone().project(camera).x < -.55);
  assertInSafeArea(mascot, camera);
  detach();
  consoleModel.geometry.dispose(); consoleModel.material.dispose();
  releaseTotemAsset(source);
});

test('a blocked startup side does not strand Little Totem offscreen', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.setViewOffset(1440, 900, 180, 45, 1440, 900);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene(), home = new THREE.Group();
  home.name = 'Home screen content';
  const obstacle = new THREE.Mesh(new THREE.BoxGeometry(5, 12, .5), new THREE.MeshBasicMaterial());
  obstacle.position.set(-4, 0, -8);
  home.add(obstacle);
  scene.add(home);
  const mascot = createTotemMascot(source);
  let time = 0;
  const { detach } = attachTotemToScene({ scene, camera }, mascot, {
    hidden: () => false, now: () => time, random: () => .9, storage: () => null,
  });
  for (; time <= 4000; time += 50) {
    scene.updateMatrixWorld(true);
    scene.onBeforeRender(null, scene, camera);
  }
  assert.ok(mascot.root.visible);
  assertInSafeArea(mascot, camera);
  detach();
  obstacle.geometry.dispose(); obstacle.material.dispose();
  releaseTotemAsset(source);
});

test('a wander animation beside a console keeps the visible mascot in place and within clearance', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene(), home = new THREE.Group();
  home.name = 'Home screen content'; scene.add(home);
  const obstacle = new THREE.Mesh(new THREE.BoxGeometry(.15, .18, .05), new THREE.MeshBasicMaterial());
  const mascot = createTotemMascot(source, { ambient: false, preset: 'playful' });
  let time = 0;
  const { detach } = attachTotemToScene({ scene, camera }, mascot, {
    hidden: () => false, now: () => time, random: () => 0, storage: () => null,
  });
  const render = () => { scene.updateMatrixWorld(true); scene.onBeforeRender(null, scene, camera); };
  for (; time <= 1800; time += 50) render();
  const start = mascot.root.position.clone().project(camera);
  assert.ok(mascot.root.visible && start.x > .5);
  obstacle.position.set(start.x - .34, start.y, .5).unproject(camera).normalize().multiplyScalar(8);
  home.add(obstacle);
  mascot.personality.play('wanderer');
  let movesAway = false, movesToward = false;
  let previousX = mascot.body.getWorldPosition(new THREE.Vector3()).project(camera).x;
  for (; time <= 8700; time += 50) {
    render();
    const x = mascot.body.getWorldPosition(new THREE.Vector3()).project(camera).x;
    assert.ok(mascot.root.visible && Math.abs(mascot.root.position.clone().project(camera).x - start.x) < .001, 'animation retains the established hover position');
    assert.ok(x > start.x - .10, 'gesture stays clear of the neighbouring console');
    assert.ok(Math.abs(x - previousX) < .025, 'the gesture moves continuously between frames');
    previousX = x;
    movesAway ||= x > start.x + .005;
    movesToward ||= x < start.x - .01;
    assertInSafeArea(mascot, camera);
  }
  assert.ok(movesAway && movesToward, 'the safe portion of the gesture still plays');
  detach(); obstacle.geometry.dispose(); obstacle.material.dispose(); releaseTotemAsset(source);
});

test('carousel highlights that cover a hover spot move Totem across the current view without a new entrance', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene(), home = new THREE.Group();
  home.name = 'Home screen content'; scene.add(home);
  const consoleModel = new THREE.Mesh(new THREE.BoxGeometry(.95, .95, .4), new THREE.MeshBasicMaterial());
  consoleModel.position.set(20, 0, -8); home.add(consoleModel);
  const mascot = createTotemMascot(source, { ambient: false });
  let time = 0, entrances = 0;
  const storage = () => ({ getItem: () => null, setItem: () => entrances++ });
  const { detach } = attachTotemToScene({ scene, camera }, mascot, { hidden: () => false, now: () => time, random: () => 0, storage });
  const render = () => { scene.updateMatrixWorld(true); scene.onBeforeRender(null, scene, camera); return mascot.root.position.clone().project(camera); };
  let previous;
  for (; time < 2000; time += 50) previous = render();
  const origin = previous.clone();
  for (; time < 4500; time += 50) {
    if (time % 750 === 500) {
      consoleModel.position.copy(previous).unproject(camera).normalize().multiplyScalar(8);
      mascot.personality.navigation();
    }
    const current = render();
    assert.ok(mascot.root.visible && Math.abs(current.x) < 1 && Math.abs(current.y) < 1);
    assert.ok(Math.hypot(current.x - previous.x, current.y - previous.y) < .12);
    previous = current;
  }
  assert.ok(previous.distanceTo(origin) > .1);
  assert.equal(entrances, 1);
  detach(); consoleModel.geometry.dispose(); consoleModel.material.dispose(); releaseTotemAsset(source);
});

test('Mini Totem relocates when platform details cover his hover spot with flight off', async () => {
  const source = await asset(), scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 2.47, .01, 160);
  camera.updateMatrixWorld();
  const mascot = createTotemMascot(source, { ambient: false, flight: false });
  let panel = null, time = 0;
  const { detach } = attachTotemToScene({ scene, camera }, mascot, {
    hidden: () => false, now: () => time, random: () => 0, panelBounds: () => panel,
  });
  const render = () => scene.onBeforeRender(null, scene, camera);
  try {
    render();
    assert.ok(mascot.root.visible);
    const { x, y } = mascot.root.getWorldPosition(new THREE.Vector3()).project(camera);
    panel = [x - .24, y - .28, x + .24, y + .18];
    for (; time <= 1500; time += 50) render();
    const moved = mascot.root.getWorldPosition(new THREE.Vector3()).project(camera);
    assert.ok(mascot.root.visible && (moved.x < panel[0] || moved.x > panel[2] ||
      moved.y < panel[1] || moved.y > panel[3]), 'the mascot settles outside the panel');
    panel = [-1, -1, 1, 1];
    for (; time <= 2500; time += 50) {
      render();
      assert.equal(mascot.root.visible, false, 'no hover is shown when the panel covers every safe spot');
    }
    panel = null;
    for (; time <= 3000; time += 50) render();
    assert.ok(mascot.root.visible, 'the mascot returns when there is space again');
  } finally {
    detach(); releaseTotemAsset(source);
  }
});

test('Tiko takes the panel-edge route without entering the panel footprint and returns to his rest spot', async () => {
  const source = await asset(), scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  const mascot = createTotemMascot(source, { ambient: false });
  let time = 0, started = false;
  const panel = [.36, -.20, .9, .45];
  const { detach, debug } = attachTotemToScene({ scene, camera }, mascot, {
    hidden: () => false, now: () => time, random: () => .8, storage: () => null, panelBounds: () => panel,
  });
  const render = () => scene.onBeforeRender(null, scene, camera);
  for (; time < 2500; time += 50) render();
  const rest = mascot.root.position.clone();
  debug('panel_peek', result => { started = result; });
  let travelled = false;
  const planner = createTotemFlightPlanner();
  planner.refresh(camera, new THREE.Group(), mascot.root.scale.x * mascot.radius, 5);
  planner.setPanel(camera, panel, 5);
  let previous = rest;
  for (; time < 8500; time += 50) {
    render();
    const current = mascot.root.position.clone();
    const { x, y } = current.clone().project(camera);
    assert.ok(mascot.root.visible);
    assert.ok(x < panel[0] || x > panel[2] || y < panel[1] || y > panel[3]);
    assert.equal(planner.hitsPanel(previous, current, mascot.root.scale.x * mascot.radius), false);
    travelled ||= current.distanceTo(rest) > .2;
    previous = current;
  }
  assert.ok(started && travelled);
  assert.ok(mascot.root.position.distanceTo(rest) < .1);
  detach(); releaseTotemAsset(source);
});

test('Mini Totem does not fly into an obscured hover when all resting spots are covered', async () => {
  const source = await asset(), scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 2.47, .01, 160);
  camera.updateMatrixWorld();
  const cues = [];
  const mascot = createTotemMascot(source, { ambient: false }, undefined, expression => cues.push(expression));
  let panel = [-1, -1, 1, 1], time = 0;
  const { detach, debug } = attachTotemToScene({ scene, camera }, mascot, {
    hidden: () => false, now: () => time, random: () => 0, storage: () => null, panelBounds: () => panel,
  });
  const render = () => scene.onBeforeRender(null, scene, camera);
  try {
    for (; time <= 2500; time += 50) {
      render();
      assert.equal(mascot.root.visible, false, 'waits for a clear destination instead of retrying a blocked entrance');
    }
    let started, revealed = false;
    debug('hide_and_seek', result => { started = result; });
    for (; time <= 5500; time += 50) {
      render();
      if (mascot.root.visible) {
        assert.equal(mascot.wings[0].visible, false, 'only the close-up may be shown without a clear hover');
        revealed ||= mascot.display.matrix.mode === 'message';
      }
    }
    assert.ok(started && revealed, 'the debug peek starts while Tiko is already offscreen');
    assert.deepEqual(cues, ['boo']);
    panel = null;
    for (; time <= 8500; time += 50) render();
    assert.ok(mascot.root.visible);
    assertInSafeArea(mascot, camera);
  } finally {
    detach(); releaseTotemAsset(source);
  }
});

test('Tiko stays visible in front of a console that fills the orbit view, then rejoins the orbit', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene(), home = new THREE.Group();
  home.name = 'Home screen content';
  const geometry = new THREE.BoxGeometry(40, 30, 2), material = new THREE.MeshBasicMaterial();
  const consoleModel = new THREE.Mesh(geometry, material);
  consoleModel.userData = { platformId: 'crowded', orbitAngle: 0 };
  consoleModel.position.z = -10;
  home.add(consoleModel);
  scene.add(home);
  const mascot = createTotemMascot(source, { ambient: false });
  let time = 0;
  const { detach } = attachTotemToScene({ scene, camera }, mascot, {
    hidden: () => false, now: () => time, random: () => 0, storage: () => null,
    panelBounds: () => [.36, -.20, .9, .45],
  });
  function render() {
    time += 50;
    scene.updateMatrixWorld(true);
    scene.onBeforeRender(null, scene, camera);
  }
  try {
    for (let i = 0; i < 80; i++) render();
    assert.ok(mascot.root.visible && Math.abs(mascot.root.position.z) < 5, 'finds a safe hover in front of the console');
    assertInSafeArea(mascot, camera);
    const previous = mascot.root.position.clone();
    consoleModel.position.x = 40;
    for (let i = 0; i < 100; i++) {
      render();
      assert.ok(mascot.root.visible, 'return to the orbit stays visible');
      assert.ok(previous.distanceTo(mascot.root.position) < 1, 'return moves continuously');
      previous.copy(mascot.root.position);
    }
    assert.ok(mascot.root.position.z < -6, 'returns to normal depth once the route clears');
    for (let i = 1; i <= 80; i++) {
      consoleModel.position.x = Math.max(0, 40 - i * 2);
      render();
      assert.ok(mascot.root.visible, 'stays visible as the console moves back into his route');
      const bounds = new THREE.Box3().setFromObject(consoleModel);
      assert.ok(bounds.distanceToPoint(mascot.root.position) >= mascot.root.scale.x * mascot.radius);
    }
    assert.ok(Math.abs(mascot.root.position.z) < 5, 'moves back to the foreground lane');
  } finally {
    detach();
    geometry.dispose(); material.dispose();
    releaseTotemAsset(source);
  }
});

test('Peek-a-boo waits offscreen, shows BOO and cues its voice together, then returns', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  let time = 0;
  const cues = [], boo = new Uint8Array(800);
  drawVisorMessage(boo, 'BOO!', 0, 850);
  const scene = new THREE.Scene(), mascot = createTotemMascot(source, { ambient: false }, undefined,
    (expression, { emotion }) => cues.push({ time, expression, emotion }));
  const { detach, debug } = attachTotemToScene({ scene, camera }, mascot, { hidden: () => false, now: () => time, random: () => 0, storage: () => null });
  const render = () => { scene.onBeforeRender(null, scene, camera); return mascot.root.position.clone().project(camera); };
  let previous;
  for (; time < 2000; time += 50) previous = render();
  const origin = previous.clone();
  let started;
  debug('hide_and_seek', result => { started = result; });
  const normalAngularSize = mascot.root.scale.x / mascot.root.position.length();
  let hiddenMs = 0, closeup = false, showedBoo = false, withdrew = false, returned = false;
  let previousCloseup = false, previousVisible = true;
  for (; time < 9500; time += 50) {
    const current = render();
    const visible = mascot.root.visible;
    const headOnly = !mascot.wings[0].visible;
    if (!visible) hiddenMs += 50;
    if (visible && headOnly) {
      const head = mascot.body.localToWorld(mascot.headCenter.clone()).project(camera);
      if (Math.abs(head.x) < 1 && Math.abs(head.y) < 1) {
        assert.ok(head.x < -.75, 'peeks in from the randomly selected left edge');
        assert.ok(Math.abs(mascot.body.rotation.z + Math.PI / 4) < .001, 'side peek tilts inward by 45 degrees');
        assert.ok(mascot.root.scale.x / mascot.root.position.length() > normalAngularSize * 4.5);
        closeup = true;
        if (!showedBoo && mascot.display.matrix.mode === 'message') {
          assert.deepEqual(mascot.display.matrix.frame, boo);
          assert.deepEqual(cues, [{ time, expression: 'boo', emotion: 'playful' }]);
          showedBoo = true;
        }
      }
      withdrew ||= closeup && head.x < -1.65;
    }
    if (visible && previousVisible && !headOnly && !previousCloseup) {
      assert.ok(Math.hypot(current.x - previous.x, current.y - previous.y) < .12, 'normal flight remains continuous');
    }
    returned ||= withdrew && visible && !headOnly && current.distanceTo(origin) < .01;
    previous = current;
    previousCloseup = headOnly;
    previousVisible = visible;
  }
  assert.ok(hiddenMs >= 950 && hiddenMs <= 1050, 'waits about one second offscreen');
  assert.equal(started, true);
  assert.ok(closeup && showedBoo && withdrew && returned);
  assert.equal(cues.length, 1);
  assert.equal(mascot.display.matrix.mode, 'expression');
  assert.ok(previous.distanceTo(origin) < .01 && mascot.wings.every(wing => wing.visible));
  detach(); releaseTotemAsset(source);
});

test('a top-edge peek is upside down and returns to upright flight', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene(), mascot = createTotemMascot(source, { ambient: false });
  let time = 0;
  const { detach, debug } = attachTotemToScene({ scene, camera }, mascot, { hidden: () => false, now: () => time, random: () => .8, storage: () => null });
  const render = () => scene.onBeforeRender(null, scene, camera);
  for (; time < 2000; time += 50) render();
  debug('hide_and_seek');
  let peeked = false, readable = false, returned = false;
  const boo = new Uint8Array(800);
  drawVisorMessage(boo, 'BOO!', 0, 850);
  for (; time < 9500; time += 50) {
    render();
    if (!mascot.root.visible) continue;
    const head = mascot.body.localToWorld(mascot.headCenter.clone()).project(camera);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(mascot.head.getWorldQuaternion(new THREE.Quaternion()));
    if (!mascot.wings[0].visible && head.y < 1) {
      assert.ok(head.y > .75, 'head enters at the top edge');
      assert.ok(up.y < -.9, 'head is upside down');
      peeked = true;
      if (mascot.display.matrix.mode === 'message') {
        assert.deepEqual(mascot.display.matrix.frame.slice().reverse(), boo);
        readable = true;
      }
    } else if (peeked && mascot.wings[0].visible && Math.abs(head.x) < 1 && Math.abs(head.y) < 1) {
      assert.ok(up.y > .8, 'head returns upright');
      returned = true;
    }
  }
  assert.ok(peeked && readable && returned);
  detach(); releaseTotemAsset(source);
});

test('peek-a-boo can pass in front of a blocked silhouette and return to an overscan-safe rest', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene(), home = new THREE.Group();
  home.name = 'Home screen content'; scene.add(home);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(24, 18, .5), new THREE.MeshBasicMaterial());
  wall.position.z = -5.5; home.add(wall);
  const mascot = createTotemMascot(source, { ambient: false });
  let time = 0, started, cameForward = false, peeked = false, flewOut = false;
  const { debug, detach } = attachTotemToScene({ scene, camera }, mascot, {
    hidden: () => false, now: () => time, random: () => 0, storage: () => null,
  });
  const render = () => {
    time += 50; scene.updateMatrixWorld(true); scene.onBeforeRender(null, scene, camera);
    return mascot.root.getWorldPosition(new THREE.Vector3());
  };
  const entry = render().project(camera);
  assert.ok(Math.max(Math.abs(entry.x), Math.abs(entry.y)) > 1.2, 'blocked arrival also starts offscreen');
  while (time < 2000) render();
  const origin = render();
  debug('hide_and_seek', result => { started = result; });
  while (time < 9500) {
    const world = render(), projected = world.clone().project(camera);
    cameForward ||= mascot.wings[0].visible && world.z > origin.z + 1;
    flewOut ||= mascot.wings[0].visible && Math.abs(projected.x) > 1.25;
    peeked ||= mascot.root.visible && !mascot.wings[0].visible;
  }
  assert.equal(started, true);
  assert.ok(cameForward && flewOut && peeked);
  assert.ok(render().distanceTo(origin) < .01);
  assertInSafeArea(mascot, camera);
  detach(); wall.geometry.dispose(); wall.material.dispose(); releaseTotemAsset(source);
});

test('a carousel visit preserves the foreground size and reaches the inactive device at its depth and scale', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene(), home = new THREE.Group();
  home.name = 'Home screen content'; scene.add(home);
  const geometry = new THREE.BoxGeometry(1, .8, .3), material = new THREE.MeshBasicMaterial();
  for (const [platformId, orbitAngle, x, y, depth, scale] of [['front', 0, .10, .15, 8, 1.5], ['ring', 1.4, -.45, .56, 15, .4]]) {
    const model = new THREE.Mesh(geometry, material);
    model.userData = { platformId, orbitAngle };
    model.position.set(x, y, .5).unproject(camera);
    model.position.multiplyScalar(-depth / model.position.z);
    model.scale.setScalar(scale); home.add(model);
  }
  const mascot = createTotemMascot(source, { miniAnimations: false, randomMessages: false }, () => .5);
  let time = 0;
  const { detach } = attachTotemToScene({ scene, camera }, mascot, { hidden: () => false, now: () => time, random: () => 0, storage: () => null });
  const render = () => { scene.updateMatrixWorld(true); scene.onBeforeRender(null, scene, camera); };
  for (; time < 2000; time += 50) render();
  const expectedSize = 5 * Math.min(.48 / camera.projectionMatrix.elements[5], .3 / camera.projectionMatrix.elements[0]);
  const angularSize = () => mascot.root.scale.x / mascot.root.position.length();
  assert.ok(Math.abs(mascot.root.position.z + 8) < .001);
  assert.ok(Math.abs(angularSize() - expectedSize / 5) < .001);
  let arrived = false, looked = false, returned = false, leanedBack = false;
  for (; time <= 17000; time += 50) {
    const previous = mascot.root.position.clone(); render();
    const screen = mascot.root.position.clone().project(camera);
    assert.ok(mascot.root.visible && Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1);
    assert.ok(mascot.root.position.distanceTo(previous) < .7, 'depth and position stay continuous');
    if (mascot.root.position.z < previous.z - .06 && mascot.root.position.z < -9) {
      leanedBack ||= Math.cos(mascot.body.rotation.y) < -.7 && mascot.body.rotation.x > .6;
    }
    if (Math.abs(mascot.root.position.z + 15) < .01 && Math.abs(screen.x + .45) < .24 && Math.abs(screen.y - .56) < .23) {
      arrived = true;
      assert.ok(Math.abs(angularSize() / (expectedSize / 5) - (.4 / 1.5) * (8 / 15)) < .002);
      looked ||= Math.abs(mascot.head.rotation.x) + Math.abs(mascot.head.rotation.y) > .09;
    }
    returned ||= arrived && Math.abs(mascot.root.position.z + 8) < .01 && Math.abs(angularSize() - expectedSize / 5) < .002;
  }
  assert.ok(arrived && looked && returned);
  assert.ok(leanedBack, 'the body turns away from the camera for the dive toward the ring');
  detach(); geometry.dispose(); material.dispose(); releaseTotemAsset(source);
});

test('the visible platform panel does not replace the scheduled Peek-a-boo with a detour', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  for (const easterEggs of [true, false]) {
    const scene = new THREE.Scene(), mascot = createTotemMascot(source, { easterEggs }, () => .5);
    let time = 0, sawPeek = false;
    const { detach } = attachTotemToScene({ scene, camera }, mascot, {
      hidden: () => false, now: () => time, random: () => .25, storage: () => null,
      panelBounds: () => [.36, -.20, .9, .45],
    });
    for (; time <= 60000; time += 100) {
      scene.onBeforeRender(null, scene, camera);
      sawPeek ||= mascot.root.visible && !mascot.wings[0].visible;
    }
    assert.equal(sawPeek, easterEggs);
    assertInSafeArea(mascot, camera);
    detach();
  }
  releaseTotemAsset(source);
});

test('Totem perches on the selection and is thrown clear on a switch or a console impact', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(42, 1.6, .01, 160);
  camera.position.set(0, 5, 18); camera.lookAt(0, 2, 0); camera.updateMatrixWorld();
  const scene = new THREE.Scene(), home = new THREE.Group();
  home.name = 'Home screen content'; scene.add(home);
  const geometry = new THREE.BoxGeometry(3, 2, 2), material = new THREE.MeshBasicMaterial();
  const front = new THREE.Mesh(geometry, material), selected = new THREE.Mesh(geometry, material);
  front.position.set(-4, 1, 0); front.userData = { platformId: 'front', orbitAngle: 0 };
  selected.position.set(2, 1, 0); selected.userData = { platformId: 'selected', orbitAngle: .3 };
  home.add(front, selected);
  for (const impact of ['selection', 'sweep', 'overlap', 'wing overlap', 'tipped perch']) {
    const debugPerch = impact !== 'selection';
    const mascot = createTotemMascot(source, { ambient: !debugPerch }, () => .5);
    const runtime = { scene, camera, selectedConsoleId: 'selected' };
    let time = 0;
    const { detach, debug } = attachTotemToScene(runtime, mascot, {
      hidden: () => false, now: () => time, random: () => 0, storage: () => null,
    });
    const render = () => {
      time += 50; scene.updateMatrixWorld(true); scene.onBeforeRender(null, scene, camera);
      return mascot.root.getWorldPosition(new THREE.Vector3());
    };
    while (time < 1800) render();
    if (debugPerch) debug('console_perch');
    let foot, looked = false, landed = false;
    while (time < 11000) {
      foot = render();
      landed = Math.abs(foot.y - .32 * mascot.root.scale.x - 2) < .02 && Math.abs(foot.x - 2) < 1 && Math.abs(foot.z) < 1
        && mascot.personality.active?.name === 'excited_reaction';
      if (landed) break;
    }
    assert.ok(landed, 'lands on the selected console, even when another console is still closer to the foreground');
    for (let i = 0; i < 8; i++) {
      foot = render();
      looked ||= mascot.head.rotation.x > .25;
      assertInSafeArea(mascot, camera);
    }
    assert.ok(looked, 'looks down at the console');
    if (impact === 'sweep' || impact === 'overlap') {
      // A console can sweep completely through the mascot in one frame,
      // even while his perch and the current selection remain valid.
      front.position.set(foot.x - 6, foot.y, foot.z - 5);
      render();
      front.position.x = foot.x + 6;
      render();
      assert.equal(mascot.personality.active?.name, 'excited_reaction', 'a pass behind the perch misses');
      front.position.set(foot.x - 6, foot.y, foot.z);
      render();
      front.position.x = impact === 'sweep' ? foot.x + 6 : foot.x;
    } else if (impact === 'wing overlap') {
      front.position.set(foot.x - 6, foot.y, foot.z - 5);
      render();
      front.position.x = foot.x + 6;
      render();
      front.position.set(foot.x + 6, foot.y, foot.z);
      render();
      assert.equal(mascot.personality.active?.name, 'excited_reaction');
      front.position.x = foot.x + 1.5 + mascot.root.scale.x * .43;
    } else if (impact === 'tipped perch') {
      selected.rotation.z = Math.PI / 2;
    } else {
      runtime.selectedConsoleId = 'front';
      selected.position.x = -10;
    }
    const impactPosition = render();
    if (impact === 'selection') {
      assert.ok(impactPosition.distanceTo(foot) < 1, 'the toss starts from the last visible position');
    } else {
      assert.ok(mascot.root.visible, 'the mascot stays visible when there is room to recover');
      const obstacle = impact === 'tipped perch' ? selected : front;
      const localPosition = obstacle.worldToLocal(impactPosition.clone());
      assert.ok(geometry.boundingBox.distanceToPoint(localPosition) >= mascot.root.scale.x * mascot.radius,
        `${impact} clears the full mascot on the impact frame`);
    }
    assert.equal(mascot.personality.active?.name, 'surprised_reaction');
    let flew = false;
    for (let i = 0; i < 35; i++) { render(); flew ||= mascot.body.rotation.x > .3; }
    assert.ok(flew);
    assertInSafeArea(mascot, camera);
    const safePosition = render();
    assert.ok(safePosition.distanceTo(foot) > 1);
    if (impact === 'overlap') assert.ok(new THREE.Box3().setFromObject(front).distanceToPoint(safePosition) > .2);
    detach();
    selected.position.x = 2;
    selected.rotation.z = 0;
    front.position.set(-4, 1, 0);
  }
  geometry.dispose(); material.dispose(); releaseTotemAsset(source);
});

test('console hopping lands on the next consoles in ring order and stops when selection changes', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(42, 1.6, .01, 160);
  camera.position.set(0, 9, 21); camera.lookAt(0, 5, 0); camera.updateMatrixWorld();
  const scene = new THREE.Scene(), home = new THREE.Group(); home.name = 'Home screen content'; scene.add(home);
  const geometry = new THREE.BoxGeometry(2, 1, 2), material = new THREE.MeshBasicMaterial();
  const centers = [[0, 4], [4, 0], [0, -4], [-4, 0]];
  centers.forEach(([x, z], index) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, 5, z);
    object.scale.setScalar(index === 0 ? 1 : .45);
    object.userData = { platformId: String(index), orbitAngle: index * Math.PI / 2 };
    home.add(object);
  });
  const runtime = { scene, camera, selectedConsoleId: '0' };
  const mascot = createTotemMascot(source, { ambient: false });
  let time = 0;
  const { detach, debug } = attachTotemToScene(runtime, mascot, {
    hidden: () => false, now: () => time, random: () => 0, storage: () => null,
  });
  const render = () => {
    time += 50; scene.updateMatrixWorld(true); scene.onBeforeRender(null, scene, camera);
    return mascot.root.getWorldPosition(new THREE.Vector3());
  };
  while (time < 2000) render();
  let started;
  debug('console_hops', result => { started = result; });
  const stops = [];
  let firstSize;
  while (time < 16000 && stops.length < 3) {
    const position = render();
    const index = centers.findIndex(([x, z]) => Math.hypot(position.x - x, position.z - z) < .95);
    const top = index === 0 ? 5.5 : 5.225;
    if (index < 0 || index === stops.at(-1) || Math.abs(position.y - .32 * mascot.root.scale.x - top) > .02) continue;
    stops.push(index);
    if (index === 0) firstSize = mascot.root.scale.x;
    else assert.ok(mascot.root.scale.x < firstSize * .8, 'shrinks to fit the smaller inactive console');
  }
  assert.equal(started, true);
  assert.deepEqual(stops, [0, 1, 2]);
  render();
  runtime.selectedConsoleId = '3';
  render();
  assert.equal(mascot.personality.active?.name, 'surprised_reaction');
  for (let frame = 0; frame < 55; frame++) render();
  assertInSafeArea(mascot, camera);
  detach();
  geometry.dispose(); material.dispose(); releaseTotemAsset(source);
});

test('the corkscrew travels above and below the ring, rolls, and returns to its starting position', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(42, 1.6, .01, 160);
  camera.position.set(0, 9, 21); camera.lookAt(0, 5, 0); camera.updateMatrixWorld();
  const scene = new THREE.Scene(), home = new THREE.Group(); home.name = 'Home screen content'; scene.add(home);
  const geometry = new THREE.BoxGeometry(2, 1, 2), material = new THREE.MeshBasicMaterial();
  [[0, 4], [4, 0], [0, -4], [-4, 0]].forEach(([x, z], index) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, 5, z);
    object.userData = { platformId: String(index), orbitAngle: index * Math.PI / 2 };
    home.add(object);
  });
  const mascot = createTotemMascot(source, { ambient: false });
  const runtime = { scene, camera, environment: { floor: { position: { y: 0 } } } };
  let time = 0;
  const { detach, debug } = attachTotemToScene(runtime, mascot, {
    hidden: () => false, now: () => time, random: () => 0, storage: () => null,
  });
  const render = () => {
    time += 50; scene.updateMatrixWorld(true); scene.onBeforeRender(null, scene, camera);
    return mascot.root.getWorldPosition(new THREE.Vector3());
  };
  while (time < 2000) render();
  const origin = render();
  let started, over = false, under = false, left = false, right = false, rolled = false;
  debug('ring_corkscrew', result => { started = result; });
  for (; time < 9800;) {
    const position = render();
    over ||= position.y > 5.8 && position.z < -2;
    under ||= position.y < 4.3 && position.z > 2;
    left ||= position.x < -4;
    right ||= position.x > 4;
    rolled ||= mascot.body.rotation.z > Math.PI;
  }
  assert.equal(started, true);
  assert.ok(over && under && left && right && rolled);
  assert.ok(render().distanceTo(origin) < .01);
  assertInSafeArea(mascot, camera);
  debug('ring_corkscrew');
  for (let i = 0; i < 25; i++) render();
  let interrupted;
  debug('wing_stretch', result => { interrupted = result; });
  for (let i = 0; i < 36; i++) render();
  assert.equal(interrupted, true, 'debug actions interrupt an active flight without waiting for the whole trick');
  assert.equal(mascot.personality.active?.name, 'wing_stretch');
  assertInSafeArea(mascot, camera);
  runtime.environment.floor.position.y = 20; // No entry to the world-space loop clears this floor.
  let previewResult, previewRolled = false;
  debug('ring_corkscrew', (started, reason) => { previewResult = { started, reason }; });
  for (let i = 0; i < 100; i++) {
    render();
    previewRolled ||= mascot.body.rotation.z > Math.PI;
  }
  assert.equal(previewResult.started, true);
  assert.match(previewResult.reason, /compact corkscrew/);
  assert.ok(previewRolled);
  mascot.personality.configure({ flight: false, ambient: false });
  let unavailable;
  debug('ring_corkscrew', (result, reason) => { unavailable = { result, reason }; });
  render();
  assert.equal(unavailable.result, false);
  assert.match(unavailable.reason, /Enable flight/);
  detach();
  geometry.dispose(); material.dispose(); releaseTotemAsset(source);
});

test('chooser entry flies in at half size, looks at a model, and lands on different real surfaces', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(42, 1.6, .01, 160);
  camera.position.set(0, 5, 18); camera.lookAt(0, 2, 0); camera.updateMatrixWorld();
  const landings = [];
  for (const random of [() => .04, () => .95]) {
    const scene = new THREE.Scene(), content = new THREE.Group(); scene.add(content);
    const geometry = new THREE.BoxGeometry(3, 2, 2), material = new THREE.MeshBasicMaterial();
    for (const x of [-1, 5]) { const object = new THREE.Mesh(geometry, material); object.position.set(x, 1, 0); content.add(object); }
    const runtime = { scene, camera, activeView: null }, mascot = createTotemMascot(source);
    let time = 0;
    const { detach } = attachTotemToScene(runtime, mascot, { hidden: () => false, now: () => time, random, storage: () => null });
    const render = () => { scene.updateMatrixWorld(true); scene.onBeforeRender(null, scene, camera); };
    for (; time < 2000; time += 50) render();
    const homeScale = mascot.root.scale.x;
    runtime.activeView = { content }; render();
    let projected = mascot.root.position.clone().project(camera);
    assert.ok(projected.x > 1 || projected.y > 1, 'starts outside the chooser viewport');
    assert.ok(Math.abs(mascot.root.scale.x / homeScale - .5) < .001);
    let tracked = false;
    for (; time < 5400; time += 50) { render(); tracked ||= Math.abs(mascot.head.rotation.x) > .1; }
    assert.ok(tracked, 'head follows a nearby object during flight');
    assert.ok(mascot.root.visible);
    assert.ok(Math.abs(mascot.root.position.y - .32 * mascot.root.scale.x - 2) < .02, 'foot plane meets the model surface');
    assert.equal(mascot.body.rotation.x, 0, 'the body levels off on landing');
    assert.ok(Math.abs(mascot.root.position.z) < 1);
    landings.push(mascot.root.position.x);
    runtime.activeView = null; render();
    projected = mascot.root.position.clone().project(camera);
    assert.ok(Math.abs(projected.x) > 1 || projected.y > 1, 'flies onto home again when returning');
    detach(); geometry.dispose(); material.dispose();
  }
  assert.ok(landings[0] < 1 && landings[1] > 3);
  releaseTotemAsset(source);
});

test('click reactions use different sequences even with the same random draw', async () => {
  const source = await asset(), mascot = createTotemMascot(source, {}, () => 0);
  mascot.personality.show();
  assert.equal(mascot.interact(), true);
  const first = mascot.personality.active.name;
  assert.equal(mascot.interact(), true);
  assert.notEqual(mascot.personality.active.name, first);
  mascot.personality.configure({ reactions: false });
  assert.equal(mascot.interact(), false);
  mascot.dispose(); releaseTotemAsset(source);
});

test('carousel clicks can trigger peek-a-boo or visit different consoles', async () => {
  const source = await asset(), camera = new THREE.PerspectiveCamera(36, 1.6, .01, 160);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene(), home = new THREE.Group();
  home.name = 'Home screen content'; scene.add(home);
  const geometry = new THREE.BoxGeometry(1, .8, .3), material = new THREE.MeshBasicMaterial();
  for (const [platformId, orbitAngle, x, y, depth] of [['front', 0, .1, .15, 8], ['left', 1.4, -.43, .53, 13], ['right', -1.8, .43, .40, 16]]) {
    const device = new THREE.Mesh(geometry, material);
    device.userData = { platformId, orbitAngle };
    device.position.set(x, y, .5).unproject(camera);
    device.position.multiplyScalar(-depth / device.position.z);
    device.scale.setScalar(platformId === 'front' ? 1.5 : .4);
    home.add(device);
  }
  let roll = .78, time = 0, reduced = false;
  const mascot = createTotemMascot(source, { ambient: false }, () => roll);
  const { detach, interact } = attachTotemToScene({ scene, camera }, mascot, {
    hidden: () => false, reducedMotion: () => reduced, now: () => time, random: () => 0, storage: () => null,
  });
  const render = () => {
    time += 50;
    scene.updateMatrixWorld(true);
    scene.onBeforeRender(null, scene, camera);
    return mascot.root.position.clone().project(camera);
  };
  let point;
  for (let i = 0; i < 40; i++) point = render();
  const origin = point;
  assert.equal(interact(), true);
  assert.equal(mascot.personality.active.name, 'hide_and_seek');
  let leftScreen = false;
  let peeked = false;
  for (let i = 0; i < 150; i++) {
    const next = render();
    leftScreen ||= !mascot.root.visible;
    peeked ||= mascot.root.visible && !mascot.wings[0].visible;
    point = next;
  }
  assert.ok(leftScreen && peeked && point.distanceTo(origin) < .01);

  for (const [x, y, depth] of [[-.43, .53, 13], [.43, .40, 16]]) {
    roll = .99;
    assert.equal(interact(), true);
    assert.equal(mascot.personality.active.name, 'console_inspection');
    let inspected = false;
    for (let i = 0; i < 180; i++) {
      point = render();
      assert.ok(mascot.root.visible && Math.abs(point.x) < 1 && Math.abs(point.y) < 1);
      inspected ||= Math.abs(mascot.root.position.z + depth) < .01 && Math.abs(point.x - x) < .24 && Math.abs(point.y - y) < .24
        && Math.abs(mascot.head.rotation.x) + Math.abs(mascot.head.rotation.y) > .09;
    }
    assert.ok(inspected && Math.abs(mascot.root.position.z + 8) < .01);
    roll = 0;
    assert.equal(interact(), true); // An ordinary reaction between visits.
  }

  reduced = true; render(); roll = .99;
  assert.equal(interact(), true);
  assert.ok(!['hide_and_seek', 'console_inspection'].includes(mascot.personality.active.name));
  detach(); geometry.dispose(); material.dispose(); releaseTotemAsset(source);
});
