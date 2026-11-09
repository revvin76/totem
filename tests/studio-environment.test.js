import test from 'node:test';
import assert from 'node:assert/strict';
import { Color, Group, MeshDepthMaterial, PerspectiveCamera, Scene } from 'three';
import { createStudioEnvironment } from '../src/studio-environment.js';

test('floor captures are limited to the reflections sampled by the current pass', () => {
  const scene = new Scene();
  const content = new Group();
  scene.add(content);
  const color = new Color(0x123456);
  const sceneTarget = {};
  const captures = [];
  let target = sceneTarget;
  let alpha = 0.8;
  const renderer = {
    getPixelRatio: () => 1,
    getClearColor: (result) => result.copy(color),
    getClearAlpha: () => alpha,
    setClearColor(value, opacity) { color.set(value); alpha = opacity; },
    getRenderTarget: () => target,
    setRenderTarget(value) { target = value; },
    xr: { enabled: false },
    shadowMap: { autoUpdate: false },
    state: { buffers: { depth: { setMask() {} } } },
    render(currentScene) {
      assert.equal(currentScene, scene);
      captures.push({ target, contentVisible: content.visible, alpha });
    },
  };
  const environment = createStudioEnvironment(scene, renderer, {});
  environment.setContentRoots([content]);
  const { floor } = environment;
  const room = { target: floor.getRenderTarget(), contentVisible: false, alpha: 0.8 };
  const consoleCapture = { target: scene.children.find(object => object.isReflector && object !== floor).getRenderTarget(),
    contentVisible: true, alpha: 0 };
  const camera = new PerspectiveCamera(36, 1, 0.01, 160);
  camera.position.set(0, 10, 15);
  camera.lookAt(0, 4, 0);
  camera.updateMatrixWorld();
  scene.updateMatrixWorld();

  function drawFloor(material, expected) {
    captures.length = 0;
    const background = scene.background;
    floor.onBeforeRender(renderer, scene, camera, floor.geometry, material);
    assert.deepEqual(captures, expected);
    assert.equal(floor.visible, true);
    assert.equal(content.visible, true);
    assert.equal(scene.background, background);
    assert.equal(target, sceneTarget);
    assert.equal(color.getHex(), 0x123456);
    assert.equal(alpha, 0.8);
  }

  const depth = new MeshDepthMaterial();
  drawFloor(floor.material, [consoleCapture, room]);
  drawFloor(depth, []);
  environment.apply({ consoleReflection: 0 });
  drawFloor(floor.material, [room]);
  drawFloor(depth, []);
  environment.apply({ consoleReflection: 0.1 });
  drawFloor(floor.material, [consoleCapture, room]);
});
