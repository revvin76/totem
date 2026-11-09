import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Texture, Vector3, VideoTexture } from 'three';
import { createCinematicState } from '../src/cinematic-launch/state.js';
import { createCinematicCoordinator, decodeCinematicFrame } from '../src/cinematic-launch/coordinator.js';
import { createCinematicShot } from '../src/cinematic-launch/shot.js';

function pixels(value = 32) {
  const buffer = new ArrayBuffer(36);
  const fields = new DataView(buffer);
  fields.setUint32(0, 2, true);
  fields.setUint32(4, 2, true);
  fields.setUint32(8, 1250, true);
  new Uint8Array(buffer, 20).fill(value);
  return buffer;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(overrides = {}) {
  const events = [];
  const shot = {
    lock: () => events.push('lock'),
    frame: () => events.push('texture'),
    black: () => events.push('black'),
    animate: async value => { events.push(value ? 'in' : 'out'); },
    suspend: () => events.push('suspend'),
    resume: frame => events.push(`resume:${frame?.width ?? 'preview'}`),
    dispose: () => events.push('dispose'),
    ...overrides.shot,
  };
  const backend = {
    async start(id) {
      events.push(`spawn:${id}`);
      return { emulator: 'Test emulator', sessionId: 1, captureAvailable: true };
    },
    async control(id, action) { assert.equal(id, 1); events.push(action); },
    async frame() { events.push('capture'); return pixels(); },
    async waitForReturn() { events.push('wait for exit'); },
    ...overrides.backend,
  };
  const coordinator = createCinematicCoordinator({
    launch: async id => { events.push(`legacy:${id}`); return 'Legacy'; },
    backend,
    previewMs: overrides.previewMs ?? 0,
    report: message => events.push(message),
  });
  const abort = new AbortController();
  const options = { enabled: true, gameId: 'game', createShot: () => shot, signal: abort.signal };
  return { events, play: props => coordinator.play({ ...options, ...props }), abort };
}

test('OFF and unsupported screens use legacy without native capture or camera work', async () => {
  const { play, events } = fixture();
  assert.equal(await play({ enabled: false, createShot: () => assert.fail('OFF prepared the scene') }), 'Legacy');
  assert.equal(await play({ createShot: () => null }), 'Legacy');
  assert.deepEqual(events, ['legacy:game', 'This display has no supported cinematic screen.', 'legacy:game']);
});

test('states require the complete sequence and reject illegal transitions', () => {
  const state = createCinematicState();
  assert.equal(state.current, 'DISABLED');
  assert.throws(() => state.move('CAPTURING'), /Invalid cinematic transition/);
  state.move('IDLE');
  for (const next of ['LAUNCHING', 'WAITING_FOR_WINDOW', 'CAPTURING', 'ZOOMING_IN', 'HANDING_OFF',
    'NATIVE_GAMEPLAY', 'RESTORING', 'ZOOMING_OUT', 'COMPLETED', 'IDLE']) state.move(next);
  assert.equal(state.current, 'IDLE');
});

test('successful transition returns on emulator exit, twice with one capture lifetime each', async () => {
  const { play, events } = fixture();
  const cycle = ['lock', 'spawn:game', 'discover', 'capture', 'texture', 'in', 'handoff', 'suspend',
    'wait for exit', 'resume:preview', 'out', 'Cinematic transition and return completed.', 'cancel', 'dispose'];
  assert.equal(await play(), 'Test emulator');
  assert.equal(await play(), 'Test emulator');
  assert.deepEqual(events, [...cycle, ...cycle]);
});

test('live frames continue during the preview before zoom starts', async () => {
  const { play, events } = fixture({ previewMs: 150 });
  await play();
  assert.ok(events.slice(0, events.indexOf('in')).filter(event => event === 'texture').length >= 2);
  assert.ok(events.indexOf('handoff') > events.indexOf('in'));
});

test('a black emulator boot frame does not start the zoom', async () => {
  let frames = 0;
  const { play, events } = fixture({ backend: { async frame() { return pixels(frames++ ? 32 : 0); } } });
  await play();
  assert.equal(frames, 2);
  assert.equal(events.filter(event => event === 'texture').length, 1);
  assert.ok(events.includes('suspend'));
});

test('an unvalidated emulator zooms in on black and returns to the preview without requesting capture', async () => {
  const { play, events } = fixture({ backend: {
    async start(id) {
      events.push(`spawn:${id}`);
      return { emulator: 'Test emulator', sessionId: 1, captureAvailable: false };
    },
  } });
  assert.equal(await play(), 'Test emulator');
  assert.deepEqual(events, ['lock', 'spawn:game', 'discover', 'black', 'in', 'handoff', 'suspend',
    'wait for exit', 'resume:preview', 'out', 'Black-screen transition and return completed.', 'cancel', 'dispose']);
});

test('the chooser gets launch acknowledgement and handoff waits for the startup video', async () => {
  let end, zoomed, acknowledged;
  const video = new Promise(resolve => { end = resolve; });
  const animation = new Promise(resolve => { zoomed = resolve; });
  const { play, events } = fixture({
    backend: { async start() { return { emulator: 'Dolphin', sessionId: 1, captureAvailable: true }; } },
    shot: {
      async startup(url) {
        assert.equal(url, 'startup.mp4');
        events.push('startup');
        return { durationMs: 5000, waitForEnd: () => video };
      },
      async animate(value, ms) {
        if (value) { assert.equal(ms, 5000); await animation; }
      },
    },
  });
  const playing = play({ startupUrl: async () => 'startup.mp4', onLaunched: name => { acknowledged = name; } });
  await tick();
  assert.equal(acknowledged, 'Dolphin');
  assert.ok(events.includes('startup'));
  assert.ok(!events.includes('handoff'));
  zoomed();
  await tick();
  assert.ok(!events.includes('handoff'));
  end();
  await playing;
  assert.ok(events.includes('handoff'));
  assert.ok(events.includes('resume:preview'));
  assert.ok(events.includes('capture'));
  assert.ok(!events.includes('texture'));
});

test('a failed startup video uses the existing black transition', async () => {
  const { play, events } = fixture({
    backend: { async start() { return { emulator: 'Dolphin', sessionId: 1, captureAvailable: false }; } },
    shot: { async startup() { throw new Error('Unsupported video'); } },
  });
  await play({ startupUrl: async () => 'startup.mp4' });
  assert.ok(events.indexOf('black') < events.indexOf('handoff'));
  assert.ok(events.includes('resume:preview'));
});

test('a camera failure does not interrupt startup playback', async () => {
  let end;
  const video = new Promise(resolve => { end = resolve; });
  const { play, events } = fixture({
    shot: {
      async startup() {
        return { durationMs: 5000, waitForEnd: () => video };
      },
      async animate(destination) {
        if (destination) throw new Error('Camera stopped rendering');
      },
    },
  });
  const playing = play({ startupUrl: async () => 'startup.mp4' });
  await tick();
  assert.ok(!events.includes('handoff'));
  end();
  await playing;
  assert.ok(events.includes('handoff'));
});

test('startup plays during discovery and emulator audio releases the video and zoom gate', async () => {
  let discovered, audioStarted;
  const discovery = new Promise(resolve => { discovered = resolve; });
  const audio = new Promise(resolve => { audioStarted = resolve; });
  const { play, events } = fixture({
    backend: {
      async control(_, action) {
        events.push(action);
        if (action === 'discover') await discovery;
      },
      waitForAudio: () => audio,
    },
    shot: {
      async startup() {
        events.push('startup');
        return {
          durationMs: 5000,
          waitForEnd: () => new Promise(() => {}),
          stop: () => events.push('stop startup'),
        };
      },
      async animate(destination) {
        if (destination) await new Promise(() => {});
      },
    },
  });
  const playing = play({ startupUrl: async () => 'startup.mp4' });
  await tick();
  assert.ok(events.includes('startup'));
  assert.ok(!events.includes('handoff'));
  audioStarted(true);
  await tick();
  assert.ok(events.includes('stop startup'));
  assert.ok(!events.includes('handoff'));
  discovered();
  assert.equal(await playing, 'Test emulator');
  assert.ok(events.indexOf('stop startup') < events.indexOf('handoff'));
});

test('a manual return can use a fresh snapshot, while exit restores the chooser preview', async () => {
  for (const reason of ['focus', 'exit']) {
    const received = [];
    const { play, events } = fixture({
      backend: { async waitForReturn() { return reason; }, async snapshot() { received.push('snapshot'); return pixels(64); } },
      shot: { resume: frame => received.push(frame?.pixels[0] ?? 'preview') },
    });
    await play();
    assert.ok(events.includes('suspend'));
    assert.deepEqual(received, reason === 'focus' ? ['snapshot', 64] : ['preview']);
  }
});

test('the exit shortcut presents Totem and finishes the hold and fade before closing the emulator', async () => {
  let present, finishFade;
  const presented = new Promise(resolve => { present = resolve; });
  const faded = new Promise(resolve => { finishFade = resolve; });
  const { play, events } = fixture({
    backend: {
      async waitForReturn() { return 'shortcut'; },
      async snapshot() { events.push('return snapshot'); return pixels(64); },
    },
    shot: {
      resume(frame, { fade }) {
        assert.equal(frame.pixels[0], 64);
        assert.equal(fade, false);
        events.push('resume live frame');
        return presented;
      },
      fadeToBlack(holdMs, fadeMs) {
        assert.deepEqual([holdMs, fadeMs], [2000, 500]);
        events.push('hold and fade');
        return faded;
      },
    },
  });
  const playing = play();
  await tick();
  assert.deepEqual(events.slice(-3), ['return snapshot', 'resume live frame', 'returnFocus']);
  present();
  await tick();
  assert.equal(events.at(-1), 'hold and fade');
  assert.ok(!events.includes('close'));
  finishFade();
  await playing;
  assert.ok(events.includes('close'));
  assert.ok(events.indexOf('close') < events.indexOf('out'));
});

test('the shortcut still closes when Windows denies the return focus', async () => {
  const calls = [];
  const { play, events } = fixture({
    backend: {
      async waitForReturn() { return 'shortcut'; },
      async control(_id, action) {
        calls.push(action);
        if (action === 'returnFocus') throw new Error('Focus denied');
      },
    },
    shot: { resume: () => new Promise(() => {}) },
  });
  await play();
  assert.ok(calls.includes('close'));
  assert.ok(events.includes('out'));
});

test('capture failure before or during zoom uses black for the rest of the session', async () => {
  for (const firstFrame of [false, true]) {
    let requests = 0;
    let allowZoom;
    const zoom = new Promise(resolve => { allowZoom = resolve; });
    const { play, events } = fixture({
      backend: { async frame() {
        if (++requests === 1 && firstFrame) return pixels();
        throw new Error('GPU device lost');
      } },
      shot: {
        black() { events.push('black'); allowZoom(); },
        async animate(value) {
          events.push(value ? 'in' : 'out');
          if (value) await zoom;
        },
      },
    });
    assert.equal(await play(), 'Test emulator');
    assert.equal(requests, firstFrame ? 2 : 1);
    assert.equal(events.indexOf('black') > events.indexOf('in'), firstFrame);
    assert.ok(events.includes('resume:preview'));
    assert.ok(events.includes('Black-screen transition and return completed. Live capture: GPU device lost'));
    assert.equal(events.filter(event => event.startsWith('spawn')).length, 1);
  }
});

test('rapid Play and an OFF toggle cannot interfere with an active launch', async () => {
  let exited;
  const exit = new Promise(resolve => { exited = resolve; });
  const { play, events } = fixture({ backend: { waitForReturn: () => exit } });
  const first = play();
  await tick();
  await assert.rejects(play(), /already active/);
  await assert.rejects(play({ enabled: false }), /already active/);
  assert.ok(events.includes('suspend'));
  exited();
  await first;
  assert.equal(await play({ enabled: false }), 'Legacy');
  assert.equal(events.filter(event => event.startsWith('spawn')).length, 1);
});

test('missing window falls back to the already launched emulator', async () => {
  const attempts = [];
  const { play, events } = fixture({ backend: {
    async control(_, action) {
      attempts.push(action);
      if (action === 'discover') throw new Error('Timed out waiting for a window.');
      if (action === 'handoff') throw new Error('No owned window.');
    },
  } });
  assert.equal(await play(), 'Test emulator');
  assert.deepEqual(attempts, ['discover', 'handoff', 'cancel']);
  assert.equal(events.at(-1), 'dispose');
  assert.ok(events.indexOf('in') > events.indexOf('black'));
  assert.match(events.at(-2), /handing off/);
});

test('a failed zoom recovers without a second launch', async () => {
  const actions = [];
  const { play, events } = fixture({
    backend: { async control(_, action) { actions.push(action); } },
    shot: { async animate() { throw new Error('The emulator exited during zoom'); } },
  });
  assert.equal(await play(), 'Test emulator');
  assert.deepEqual(actions, ['discover', 'handoff', 'cancel']);
  assert.equal(events.at(-1), 'dispose');
  assert.ok(!events.includes('suspend'));
  assert.equal(events.filter(event => event.startsWith('spawn')).length, 1);
});

test('failed foreground handoff never suspends Totem and never retries process launch', async () => {
  const { play, events } = fixture({ backend: {
    async control(_, action) {
      if (action === 'handoff') throw new Error('Windows denied focus.');
    },
  } });
  assert.equal(await play(), 'Test emulator');
  assert.ok(!events.includes('suspend'));
  assert.match(events.at(-2), /handing off/);
  assert.equal(events.at(-1), 'dispose');
});

test('failed spawn does not retry through the legacy launcher', async () => {
  const { play, events } = fixture({ backend: { async start() { throw new Error('File unavailable'); } } });
  await assert.rejects(play(), /File unavailable/);
  assert.ok(!events.includes('legacy:game'));
  assert.equal(events.at(-1), 'dispose');
});

test('shutdown or cancellation closes capture and restores the launcher during gameplay', async () => {
  const { play, events, abort } = fixture({ backend: {
    waitForReturn() { return new Promise(() => {}); },
  } });
  const running = play();
  await tick();
  assert.ok(events.includes('suspend'));
  abort.abort();
  abort.abort();
  await running;
  assert.deepEqual(events.slice(-3), ['Transition canceled.', 'cancel', 'dispose']);
});

test('screen frames preserve aspect, release their texture on handoff, and restore the exact camera', async () => {
  const camera = new PerspectiveCamera(43, 16 / 9, 0.1, 160);
  camera.position.set(3, 4, 7);
  camera.lookAt(1, 0, 0);
  camera.zoom = 1.3;
  camera.updateProjectionMatrix();
  const original = { position: camera.position.toArray(), rotation: camera.quaternion.toArray(),
    near: camera.near, fov: camera.fov, zoom: camera.zoom, projection: camera.projectionMatrix.toArray() };
  const originalMaterial = new MeshBasicMaterial({ map: new Texture() });
  const mesh = new Mesh(new PlaneGeometry(3, 2), originalMaterial);
  mesh.rotation.y = 0.2;
  const events = [];
  const shot = createCinematicShot({
    mesh, camera,
    onLock: active => events.push(`input:${active}`),
    onPicture: active => events.push(`picture:${active}`),
    onSuspend: active => events.push(`render suspended:${active}`),
  });
  const frame = decodeCinematicFrame(pixels());
  assert.equal(frame.ageMs, 1.25);
  shot.lock();
  shot.frame(frame);
  const texture = mesh.material.map;
  assert.equal(texture.repeat.x, 1.5);
  texture.addEventListener('dispose', () => events.push('texture disposed'));
  const signal = new AbortController().signal;
  const inward = shot.animate(1, 1200, signal);
  shot.tick(500);
  shot.tick(1700);
  await inward;
  const center = new Vector3(0, 0, 0).project(camera);
  assert.ok(Math.hypot(center.x, center.y) < 1e-10);
  shot.suspend();
  assert.equal(mesh.material, originalMaterial);
  assert.ok(events.includes('texture disposed'));
  shot.resume(frame);
  assert.notEqual(mesh.material.map, texture);
  const outward = shot.animate(0, 1200, signal);
  shot.tick(2000);
  shot.tick(2600);
  assert.equal(mesh.material.color.r, 0.5);
  shot.tick(3200);
  await outward;
  assert.equal(mesh.material.color.getHex(), 0);
  shot.dispose();
  assert.deepEqual({ position: camera.position.toArray(), rotation: camera.quaternion.toArray(),
    near: camera.near, fov: camera.fov, zoom: camera.zoom, projection: camera.projectionMatrix.toArray() }, original);
  assert.deepEqual(events, ['input:true', 'picture:true', 'render suspended:true', 'texture disposed',
    'render suspended:false', 'picture:false', 'input:false']);
  assert.equal(mesh.material, originalMaterial);
});

test('return from a black launch uses the chooser preview from the first frame', () => {
  const original = new MeshBasicMaterial({ map: new Texture() });
  const mesh = new Mesh(new PlaneGeometry(3, 2), original);
  const camera = new PerspectiveCamera();
  camera.position.z = 4;
  const shot = createCinematicShot({ mesh, camera, onLock() {}, onPicture() {}, onSuspend() {} });
  shot.lock();
  shot.frame(decodeCinematicFrame(pixels()));
  let disposed = false;
  mesh.material.map.addEventListener('dispose', () => { disposed = true; });
  shot.black();
  assert.equal(disposed, true);
  assert.equal(mesh.material.map, null);
  assert.equal(mesh.material.color.getHex(), 0);
  shot.suspend();
  assert.equal(mesh.material, original);
  shot.resume(null);
  assert.equal(mesh.material, original);
  assert.ok(mesh.material.map);
  shot.dispose();
  assert.equal(mesh.material, original);
  assert.equal(camera.position.z, 4);
});

test('shortcut return holds the screen at full brightness, then fades it in place', async () => {
  for (const frame of [decodeCinematicFrame(pixels()), null]) {
    const original = new MeshBasicMaterial({ map: new Texture() });
    const mesh = new Mesh(new PlaneGeometry(3, 2), original);
    const camera = new PerspectiveCamera();
    camera.position.z = 4;
    const shot = createCinematicShot({ mesh, camera, onLock() {}, onPicture() {}, onSuspend() {} });
    shot.lock();
    shot.black();
    shot.suspend();
    shot.resume(frame, { fade: false });
    const position = camera.position.clone();
    const fade = shot.fadeToBlack(2000, 500, new AbortController().signal);
    shot.tick(100);
    shot.tick(2100);
    assert.equal(mesh.material.color.r, 1);
    shot.tick(2350);
    assert.equal(mesh.material.color.r, 0.5);
    assert.ok(camera.position.equals(position));
    shot.tick(2600);
    await fade;
    assert.equal(mesh.material.color.getHex(), 0);
    assert.equal(original.color.getHex(), 0xffffff);
    shot.dispose();
    assert.equal(mesh.material, original);
  }
});

test('the return skips a black preview intro and keeps the first visible frame', async t => {
  const video = Object.assign(new EventTarget(), { readyState: 2, videoWidth: 1280, videoHeight: 720, duration: 60 });
  let currentTime = 0;
  Object.defineProperty(video, 'currentTime', {
    get: () => currentTime,
    set(value) {
      currentTime = value;
      queueMicrotask(() => video.dispatchEvent(new Event('seeked')));
    },
  });
  const canvas = { getContext: () => ({
    drawImage(source, x, y, width, height) {
      assert.equal(source, video);
      assert.deepEqual([x, y, width, height], [0, 0, 640, 360]);
    },
    getImageData(x, y, width, height) {
      return { data: new Uint8ClampedArray(width * height * 4).fill(currentTime >= 3 ? 64 : 0) };
    },
  }) };
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: tag => { assert.equal(tag, 'canvas'); return canvas; },
  } });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  const original = new MeshBasicMaterial({ map: new VideoTexture(video), color: 0x000000 });
  const mesh = new Mesh(new PlaneGeometry(3, 2), original);
  const camera = new PerspectiveCamera();
  camera.position.z = 4;
  const shot = createCinematicShot({ mesh, camera, onLock() {}, onPicture() {}, onSuspend() {} });
  shot.lock();
  shot.black();
  shot.suspend();
  await shot.preparePreview(new AbortController().signal);
  assert.equal(currentTime, 3);
  video.readyState = 0;
  shot.resume();
  assert.equal(mesh.material.map.image, canvas);
  assert.equal(mesh.material.color.getHex(), 0xffffff);
  let disposed = false;
  mesh.material.map.addEventListener('dispose', () => { disposed = true; });
  shot.dispose();
  assert.equal(disposed, true);
  assert.equal(mesh.material, original);
});
