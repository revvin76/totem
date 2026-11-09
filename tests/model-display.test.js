import test from 'node:test';
import assert from 'node:assert/strict';
import variants from '../model-display-variants.json' with { type: 'json' };
import { displayPlatform } from '../src/model-display.js';

const id = 'gbcolor';
const entry = variants.platforms[id];
const fixture = () => ({ id, name: 'Game Boy Color', bundledModel: { ...entry.source, showcaseScale: 1.5, hiddenMaterials: ['fixture'] } });

test('derivatives require exact catalogue source hash and preserve display transforms', () => {
  const platform = fixture();
  const before = structuredClone(platform);
  const result = displayPlatform(platform, 'preview');
  assert.equal(result.bundledModel.path, entry.preview.path);
  assert.equal(result.bundledModel.sha256, entry.preview.sha256);
  assert.equal(result.bundledModel.showcaseScale, 1.5);
  assert.deepEqual(result.bundledModel.hiddenMaterials, ['fixture']);
  assert.deepEqual(platform, before);
  const mismatch = { ...platform, bundledModel: { ...platform.bundledModel, sha256: 'different-source' } };
  assert.equal(displayPlatform(mismatch, 'display'), mismatch);
  assert.equal(displayPlatform(mismatch, 'preview').usePlaceholder, true);
});

test('custom imports never inherit bundled derivatives; exact-source imports may use them', () => {
  const custom = { ...fixture(), modelFile: { id: `${'a'.repeat(64)}.glb`, kind: 'model' } };
  assert.equal(displayPlatform(custom, 'display'), custom);
  const preview = displayPlatform(custom, 'preview');
  assert.equal(preview.usePlaceholder, true);
  assert.equal(preview.modelFile, custom.modelFile);
  const exact = { ...fixture(), modelFile: { id: `${entry.sourceSha256}.glb`, kind: 'model' } };
  const result = displayPlatform(exact, 'preview');
  assert.equal(result.bundledModel.path, entry.preview.path);
  assert.equal(result.modelFile, undefined);
  assert.notEqual(exact.modelFile, undefined);
});

test('Studio uses lightweight models and keeps the actual asset for custom platforms', () => {
  const platform = fixture();
  const studio = displayPlatform(platform, 'studio');
  assert.equal(studio.bundledModel.sha256, entry.preview.sha256);
  assert.equal(studio.carouselDisplaySha256, entry.display.sha256);
  const custom = { ...platform, modelFile: { id: 'custom.glb', kind: 'model' } };
  assert.equal(displayPlatform(custom, 'studio'), custom);
});

test('explicit placeholder choice is authoritative for every tier', () => {
  const platform = { ...fixture(), usePlaceholder: true };
  assert.equal(displayPlatform(platform, 'display'), platform);
  assert.equal(displayPlatform(platform, 'preview'), platform);
  const unavailable = { id: 'not-in-the-manifest', modelFile: { id: 'custom.glb' } };
  assert.equal(displayPlatform(unavailable, 'display'), unavailable);
  assert.equal(displayPlatform(unavailable, 'preview').usePlaceholder, true);
});
