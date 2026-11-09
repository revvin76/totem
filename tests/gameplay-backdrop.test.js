import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mesh, Scene, Texture } from 'three';
import { createStudioEnvironment } from '../src/studio-environment.js';
import { normalizeGameplayBackdrop, VIDEO_PRESETS } from '../src/gameplay-backdrop-settings.js';

test('gameplay backdrop defaults to a full-stage 40% copy of the current gameplay texture', () => {
  const scene = new Scene(), console = new Mesh();
  scene.add(console);
  const { backdrop: wall, floor, gameplayBackdrop: backdrop } =
    createStudioEnvironment(scene, { getPixelRatio: () => 1 }, undefined, { width: 64, height: 64 });
  const video = { videoWidth: 320, videoHeight: 240, readyState: 1 };
  const texture = new Texture(video);
  backdrop.update(texture, 1600, 900);
  assert.equal(backdrop.mesh.visible, false);

  video.readyState = 2;
  backdrop.update(texture, 1600, 900);
  assert.equal(backdrop.mesh.visible, true);
  assert.ok(wall.renderOrder < backdrop.mesh.renderOrder && backdrop.mesh.renderOrder < console.renderOrder);
  assert.ok(floor.renderOrder < backdrop.mesh.renderOrder, 'video also overlays the floor');
  const { footage, frame, effects, crop } = backdrop.mesh.material.uniforms;
  assert.equal(footage.value, texture);
  assert.deepEqual(frame.value.toArray(), [0, 0, 1, 1]);
  assert.equal(effects.value.x, .4);
  assert.deepEqual(crop.value.toArray(), [1, .75]);

  backdrop.apply({ enabled: false });
  backdrop.update(texture, 1600, 900);
  assert.equal(backdrop.mesh.visible, false);
  assert.equal(footage.value, null);
  backdrop.apply();
  backdrop.update(null, 1600, 900);
  assert.equal(backdrop.mesh.visible, false);
});

test('all six presets resolve to distinct, editable settings that survive a save and reload', () => {
  const presets = Object.values(VIDEO_PRESETS).map(([, patch]) => normalizeGameplayBackdrop(patch));
  assert.equal(new Set(presets.map(value => JSON.stringify(value))).size, 6);
  for (const preset of presets) {
    const document = JSON.parse(JSON.stringify({ gameplayBackdrop: { ...preset, opacity: 19 } }));
    assert.deepEqual(normalizeGameplayBackdrop(document.gameplayBackdrop), { ...preset, opacity: 19 });
  }
});
