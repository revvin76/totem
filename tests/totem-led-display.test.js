import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { LED_FACES, EXPRESSION_NAMES, validateLedFaces, TotemLedMatrix, TotemLedDisplay } from '../src/totem-led-display.js';

test('import preserves supplied masks byte-for-byte and validates every expression', () => {
  const data = JSON.parse(readFileSync(new URL('../src/totem-led-faces.json', import.meta.url)));
  assert.deepEqual(LED_FACES, data);
  assert.equal(EXPRESSION_NAMES.length, 12);
  for (const name of EXPRESSION_NAMES) {
    const matrix = new TotemLedMatrix(); matrix.setExpression(name, 0);
    if (name === 'blink') matrix.setMouth('blink', 0);
    const { eyes, mouth } = data.expressions[name].layers;
    const expected = [...eyes.join('')].map((value, index) => value === '1' || mouth.join('')[index] === '1' ? 255 : 0);
    assert.deepEqual([...matrix.intensity], expected, name);
  }
  for (const mutate of [data => data.grid.width = 41, data => data.grid.origin = 'bottom-left', data => data.expressions.happy.layers.eyes.pop(), data => data.expressions.sad.layers.mouth[0] = 'x'.repeat(40), data => delete data.expressions.cheeky]) {
    const invalid = structuredClone(data); mutate(invalid); assert.throws(() => validateLedFaces(invalid));
  }
});

test('eyes and mouth compose with max intensity; blink preserves live mouth and restores eyes', () => {
  const matrix = new TotemLedMatrix(); matrix.setExpression('happy', 0); matrix.blink(); matrix.setMouth('surprised', 0);
  for (let i = 0; i < 800; i++) assert.equal(matrix.intensity[i], Math.max(matrix.masks.blink.eyes[i], matrix.masks.surprised.mouth[i]) * 255);
  matrix.update(140);
  matrix.update(76);
  for (let i = 0; i < 800; i++) assert.equal(matrix.intensity[i], Math.max(matrix.masks.happy.eyes[i], matrix.masks.surprised.mouth[i]) * 255);
});

test('LEDs snap on, step down twice, and relight immediately during an interruption', () => {
  const matrix = new TotemLedMatrix(); matrix.setExpression('happy', 0);
  const lit = name => matrix.masks[name].eyes.map((eye, index) => Math.max(eye, matrix.masks[name].mouth[index]));
  const happy = lit('happy'), sad = lit('sad');
  const outgoing = happy.findIndex((value, index) => value && !sad[index]);
  const incoming = sad.findIndex((value, index) => value && !happy[index]);
  assert.equal(matrix.intensity[outgoing], 255);
  matrix.setExpression('sad');
  assert.equal(matrix.intensity[incoming], 255);
  assert.equal(matrix.intensity[outgoing], 128);
  matrix.update(38); assert.equal(matrix.intensity[outgoing], 64);
  matrix.update(38); assert.equal(matrix.intensity[outgoing], 0);
  matrix.setExpression('happy'); assert.equal(matrix.intensity[outgoing], 255);
  assert.equal(matrix.intensity[incoming], 128);
  matrix.setExpression('sad'); assert.equal(matrix.intensity[incoming], 255);
  matrix.blink(); matrix.setExpression('excited', 0); matrix.update(1000);
  assert.equal(matrix.layers.eyes.name, 'excited'); assert.equal(matrix.blinkRemaining, 0);
  assert.throws(() => matrix.setExpression('missing')); assert.equal(matrix.expression, 'excited');
});

test('animation and message frames share the same trail while authored dim levels remain available', () => {
  const matrix = new TotemLedMatrix(), frame = new Uint8Array(800);
  frame[0] = 255; frame[2] = 145; matrix.presentFrame(frame, 'animation');
  frame[0] = 0; frame[1] = 255; matrix.presentFrame(frame, 'message');
  assert.deepEqual([...matrix.intensity.slice(0, 3)], [128, 255, 145]);
  matrix.update(38); assert.deepEqual([...matrix.intensity.slice(0, 3)], [64, 255, 145]);
  matrix.update(38); assert.deepEqual([...matrix.intensity.slice(0, 3)], [0, 255, 145]);
  matrix.presentFrame(null); assert.equal(matrix.intensity[1], 128);
});

test('fixed texture uploads only on changes and disposal restores shared materials without disposing geometry', () => {
  const geometry = new THREE.PlaneGeometry(2, 1), original = new THREE.MeshBasicMaterial(), visor = new THREE.Mesh(geometry, original);
  let geometryDisposals = 0, sourceDisposals = 0, textureDisposals = 0, materialDisposals = 0;
  geometry.addEventListener('dispose', () => geometryDisposals++); original.addEventListener('dispose', () => sourceDisposals++);
  const display = new TotemLedDisplay(visor, { bounds: [-1, -.5, 2, 1] });
  display.texture.addEventListener('dispose', () => textureDisposals++); display.material.addEventListener('dispose', () => materialDisposals++);
  const texture = display.texture, buffer = texture.image.data, version = texture.version;
  for (let i = 0; i < 100; i++) display.update(16);
  assert.equal(texture.version, version); assert.equal(texture.image.data, buffer);
  display.setExpression('happy'); display.update(50); assert.ok(texture.version > version); assert.equal(display.texture, texture);
  display.configure({ brightness: 100, glow: -1, color: '#123456', displayEnabled: false });
  assert.equal(display.material.uniforms.brightness.value, 1.5); assert.equal(display.material.uniforms.glow.value, 0);
  assert.equal(display.material.uniforms.ledColor.value.getHexString(), '123456'); assert.equal(display.material.uniforms.displayEnabled.value, false);
  assert.throws(() => display.configure({ color: 'red' }));
  display.dispose(); display.dispose();
  assert.equal(visor.material, original); assert.equal(sourceDisposals, 0); assert.equal(geometryDisposals, 0);
  assert.equal(textureDisposals, 1); assert.equal(materialDisposals, 1); assert.equal(display.matrix.update(16), false);
  assert.throws(() => new TotemLedDisplay(visor, { bounds: [0, 0, 1, 1] }));
});
