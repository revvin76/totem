import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { inspectGLB } from '../src/platform-assets.js';
import { applyXbox360Artwork, XBOX360_PANELS, xbox360AtlasRect } from '../src/xbox360-case.js';

test('Xbox 360 wrap boundaries agree with the supplied label UVs', async () => {
  const bytes = await readFile(new URL('../public/games/models/xbox360-case.glb', import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const json = inspectGLB(buffer), jsonLength = new DataView(buffer).getUint32(12, true);
  const primitive = json.meshes.find(mesh => mesh.primitives.some(p => json.materials[p.material].name === 'label')).primitives[0];
  const accessor = json.accessors[primitive.attributes.TEXCOORD_0], view = json.bufferViews[accessor.bufferView];
  const uv = new DataView(buffer, 28 + jsonLength + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0));
  const values = Array.from({length: accessor.count}, (_, i) => uv.getFloat32(i * (view.byteStride ?? 8), true));
  for (const seam of [XBOX360_PANELS.back[1], XBOX360_PANELS.front[0]]) {
    assert.ok(values.some(value => Math.abs(value - seam) < 0.00001));
  }
  assert.equal(xbox360AtlasRect('back').x, 0);
  assert.equal(xbox360AtlasRect('front').x + xbox360AtlasRect('front').width, 2048);
});

test('reusing the Xbox 360 template replaces only each instance label and clears missing panels', async () => {
  const previousDocument = globalThis.document;
  const drawings = [];
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
    fillRect() {}, fillText(text) { drawings.push(text); }, drawImage(image) { drawings.push(image); },
    translate() {}, rotate() {}, scale(x, y) { assert.equal(x, 1); assert.equal(y, -1); }, save() {}, restore() {},
  }) }) };
  try {
    function instance() {
      const root = new THREE.Group();
      const plastic = new THREE.MeshStandardMaterial({name: 'material', color: 0x40a000});
      const label = new THREE.MeshStandardMaterial({name: 'label', map: new THREE.Texture()});
      root.add(new THREE.Mesh(new THREE.BoxGeometry(), plastic), new THREE.Mesh(new THREE.PlaneGeometry(), label));
      return {root, plastic, label};
    }
    const first = instance(), second = instance(), plastic = first.plastic;
    const image = {width: 700, height: 1000};
    await applyXbox360Artwork(first.root, {title: 'Halo 3', cover: 'halo.jpg'}, async () => ({image, dispose() {}}));
    await applyXbox360Artwork(second.root, {title: 'Gears of War 2'});
    assert.equal(first.root.children[0].material, plastic);
    assert.notEqual(first.label.map, second.label.map);
    assert.equal(first.label.map.flipY, false);
    assert.equal(first.label.map.colorSpace, THREE.SRGBColorSpace);
    assert.ok(drawings.includes(image));
    assert.ok(drawings.includes('Back artwork unavailable'));
    assert.ok(drawings.includes('Gears of War 2'));
    assert.ok(!drawings.includes('Left 4 Dead 2'));
  } finally { globalThis.document = previousDocument; }
});
