import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { BufferAttribute, BufferGeometry, Group, InterleavedBuffer, InterleavedBufferAttribute, Mesh, PerspectiveCamera, Scene, Vector3 } from "three";
import { frameCarousel, frameCarouselEnvironment, worldXAtScreenColumn } from "../src/framing.js";
import { createSharedSceneRuntime, adoptViewBuffers } from "../src/shared-scene-runtime.js";
import { resolveStudioEnvironment, normalizeEnvironmentSettings } from "../src/studio-environment-settings.js";
import { createStudioEnvironment } from "../src/studio-environment.js";
import { platformChooserSettings, scalePlatformPole } from "../src/studio-page-settings.js";
import { createPlatformSceneTools } from "../src/platform-scene-tools.js";
import { defaultLayout, platformSceneLayout, readPlatformSceneLayout } from "../src/layout.js";

test("the saved Platform Chooser scene supplies geometry without replacing the runtime collection", () => {
  const layout = defaultLayout();
  layout.consoles.pitch = 35;
  layout.consoles.yaw = 6;
  const saved = platformSceneLayout({
    layout, deviceOverrides: {}, inactiveDeviceOverrides: {}, openWhenActive: {},
    selectedPlatform: "megadrive", enabledPlatformIds: ["megadrive"],
  });
  const document = { pages: { platformChooser: { sceneLayout: saved } } };
  assert.deepEqual(readPlatformSceneLayout(document, ["megadrive", "wiiu"]), saved);
  assert.equal(Object.hasOwn(saved, "selectedPlatform"), false);
  assert.equal(Object.hasOwn(saved, "enabledPlatformIds"), false);
  assert.equal(readPlatformSceneLayout({}, ["megadrive"]), null);
  saved.layout.consoles.pitch = 1000;
  assert.throws(() => readPlatformSceneLayout(document, ["megadrive"]), /Invalid consoles/);
});

test("existing Studio defaults supply the environment without importing object or camera layout", () => {
  const document = { defaults: { handheld: { settings: { brightness: 0.45, consoleReflection: 0.06, lightReflection: 0, cameraZ: 24, switchPosition: [12,6,-8] } } } };
  const original = structuredClone(document);
  const settings = resolveStudioEnvironment(document);
  assert.equal(settings.brightness, 0.45);
  assert.equal(settings.lightReflection, 0);
  assert.equal(settings.consoleReflection, 0.06);
  assert.equal(settings.cameraZ, undefined);
  assert.equal(settings.switchPosition, undefined);
  assert.deepEqual(document, original);
});

test("the explicit shared environment takes precedence and rejects non-finite values", () => {
  assert.equal(resolveStudioEnvironment({ environment: {brightness:0.7}, defaults:{handheld:{settings:{brightness:2}}} }).brightness,0.7);
  assert.equal(normalizeEnvironmentSettings({brightness:Infinity}).brightness,1.2);
});

test("home and chooser switch content without replacing the renderer, scene, or environment", async () => {
  const scene = new Scene(), homeContent = new Group(), chooser = new Group();
  scene.add(homeContent);
  const homeCamera = new PerspectiveCamera(), chooserCamera = new PerspectiveCamera();
  let roots, homeLighting, frames = 0, updates = 0, compiled = 0;
  const renderer = { initTexture() {}, async compileAsync() {assert.equal(homeLighting,false);compiled++;} };
  const environment = {setContentRoots(value){roots=value;},setPlatformChooserActive(value){homeLighting=value;},update(){updates++;}};
  const runtime = createSharedSceneRuntime({scene,renderer,environment,homeContent,homeCamera});
  runtime.registerView("chooser",{content:chooser,camera:chooserCamera,update(){frames++;}});
  await runtime.prepareView("chooser");
  assert.equal(homeLighting,true);
  for(let i=0;i<3;i++) {
    runtime.activateView("chooser");
    assert.equal(homeContent.visible,false);
    assert.equal(chooser.visible,true);
    assert.equal(runtime.camera,chooserCamera);
    assert.equal(homeLighting,false);
    assert.equal(runtime.update(i*100,0.016),true);
    runtime.activateView();
    assert.equal(runtime.camera,homeCamera);
    assert.equal(homeContent.visible,true);
    assert.equal(chooser.visible,false);
    assert.deepEqual(roots,[homeContent]);
    assert.equal(homeLighting,true);
  }
  assert.equal(runtime.renderer,renderer);
  assert.equal(runtime.scene,scene);
  assert.equal(runtime.environment,environment);
  assert.equal(scene.children.filter(p=>p===chooser).length,1);
  assert.equal(frames,3);assert.equal(updates,3);assert.equal(compiled,1);
});

test("the foreground light stays neutral at high room brightness and follows the platform", () => {
  const scene=new Scene(), model=new Group();
  model.position.set(3,6,4);scene.add(model);
  const environment=createStudioEnvironment(scene,{getPixelRatio:()=>1},{brightness:2.4,hue:100,lightZ:15});
  const lights=()=>{const result=[];environment.lightSources.traverseVisible(object=>{if(object.isLight)result.push(object);});return result;};
  environment.setPlatformChooserActive(true);
  environment.update(1);
  environment.focusPlatform(model,1);
  const spot=scene.getObjectByName("Active platform spotlight");
  assert.equal(spot.color.getHex(),0xffffff);
  assert.deepEqual(spot.target.position.toArray(),[3,6,4]);
  assert.deepEqual(spot.position.toArray(),[3,12,9]);
  assert.ok(lights().filter(light=>light.isDirectionalLight).every(light=>light.intensity<=0.85));
  assert.ok(lights().every(light=>!light.isPointLight));
  for(const wall of lights().filter(light=>light.isSpotLight && light!==spot)) {
    const toDevice=model.position.clone().sub(wall.getWorldPosition(new Vector3())).normalize();
    const beam=wall.target.getWorldPosition(new Vector3()).sub(wall.getWorldPosition(new Vector3())).normalize();
    assert.ok(toDevice.dot(beam)<Math.cos(wall.angle));
  }
  environment.setPlatformChooserActive(false);
  assert.equal(spot.visible,false);
  assert.equal(lights().filter(light=>light.isPointLight).length,4);
});

test("Platform Chooser light overrides follow the device and stay out of Game Chooser", () => {
  const scene = new Scene(), model = new Group();
  scene.add(model);
  model.position.set(3, 6, 4);
  const environment = createStudioEnvironment(scene, { getPixelRatio: () => 1 }, {});
  const { lights } = platformChooserSettings({ pages: { platformChooser: { lights: {
    spot: { x: 2, y: -3, intensity: .25, color: "#ffcc99" },
    key: { enabled: false },
    pink: { x: 12, intensity: 0 },
  } } } });
  environment.setPlatformChooserActive(true);
  environment.apply({}, lights);
  environment.update(1);
  environment.focusPlatform(model, 1);
  const { key, spot, pink } = environment.platformLightObjects;
  assert.equal(key.intensity, 0);
  assert.equal(pink.intensity, 0);
  assert.equal(spot.intensity, 16.25);
  assert.equal(spot.color.getHexString(), "ffcc99");
  assert.deepEqual(spot.position.toArray(), [5, 9, 9]);
  model.position.x = 7;
  environment.focusPlatform(model, 1);
  assert.equal(spot.position.x, 9);
  environment.setPlatformChooserActive(false);
  assert.equal(spot.visible, false);
  assert.ok(key.intensity > 0);
  assert.deepEqual(key.position.toArray(), [4, 23, 32]);
  environment.setPlatformChooserActive(true);
  assert.equal(key.intensity, 0);
});

test("Platform Chooser separates Free Look, light handles and pole transforms", (t) => {
  const dom = new EventTarget();
  const input = Object.assign(new EventTarget(), {
    style: {}, getRootNode: () => dom, classList: { toggle() {} },
    setAttribute() {}, focus() {}, remove() {},
  });
  const lifetime = new EventTarget();
  const originalDocument = globalThis.document, originalListener = globalThis.addEventListener;
  const originalFrame = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
  globalThis.document = { createElement: () => input };
  globalThis.addEventListener = lifetime.addEventListener.bind(lifetime);
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => {
    lifetime.dispatchEvent(new Event("pagehide"));
    globalThis.document = originalDocument;
    globalThis.addEventListener = originalListener;
    globalThis.requestAnimationFrame = originalFrame;
    globalThis.cancelAnimationFrame = originalCancel;
  });
  const camera = new PerspectiveCamera();
  camera.position.set(1, 4, 12);
  camera.lookAt(0, 2, 0);
  const position = camera.position.clone(), rotation = camera.quaternion.clone();
  const scene = new Scene();
  const light = new Group();
  light.color = { getHexString: () => "ffffff" };
  scene.add(light);
  const tools = createPlatformSceneTools({ scene, camera, host: { append() {} }, lights: { key: light }, activeModel: () => null });
  tools.setFreeLook(true);
  assert.notEqual(tools.camera, camera);
  assert.ok(tools.camera.position.distanceTo(position) < 1e-9);
  tools.camera.position.x += 5;
  tools.camera.rotateY(.4);
  tools.setFreeLook(false);
  assert.equal(tools.camera, camera);
  assert.ok(camera.position.equals(position));
  assert.ok(camera.quaternion.equals(rotation));

  tools.selectLight("key");
  tools.showLights(true);
  const transform = scene.children.find(object => object.isTransformControlsRoot).controls;
  const lightPivot = transform.object;
  const pole = new Group();
  scene.add(pole);
  pole.scale.set(2, 4, 3);
  tools.selectPole(pole);
  tools.setPoleMode("scale");
  assert.equal(transform.object, pole);
  assert.equal(transform.mode, "scale");
  let recordedScale;
  tools.onPoleTransform = object => { recordedScale = object.scale.toArray(); };
  transform.axis = "YZ";
  transform.dispatchEvent({ type: "mouseDown" });
  pole.scale.y = 6;
  transform.dispatchEvent({ type: "objectChange" });
  assert.deepEqual(recordedScale, [3, 6, 4.5]);
  tools.selectPole(null);
  assert.equal(transform.object, lightPivot);
  assert.equal(transform.mode, "translate");
  tools.setActive(false);
  assert.equal(transform.object, undefined);
  assert.equal(input.hidden, true);
});

test("unified pole scale preserves saved proportions within the allowed range", () => {
  assert.deepEqual(scalePlatformPole([2, 3, 4], 3), [3, 4.5, 6]);
  assert.deepEqual(scalePlatformPole([2, 4, 8], 15), [3.75, 7.5, 15]);
});

test("iframe geometry is adopted into the renderer realm without changing coordinates", () => {
  const foreign = vm.runInNewContext("new Float32Array([1,2,3,4,5,6,7,8,9])");
  assert.equal(foreign instanceof Float32Array,false);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position",new BufferAttribute(foreign,3));
  const root = new Group();root.add(new Mesh(geometry));
  adoptViewBuffers(root);
  const result=geometry.attributes.position.array;
  assert.equal(result instanceof Float32Array,true);
  assert.deepEqual([...result],[1,2,3,4,5,6,7,8,9]);
  adoptViewBuffers(root);
  assert.equal(geometry.attributes.position.array,result);
});

test("late chooser geometry is adopted at attachment while steady frames only update the view", async () => {
  const scene = new Scene(), homeContent = new Group(), chooser = new Group();
  const camera = new PerspectiveCamera();
  const renderer = { initTexture() {}, async compileAsync() {} };
  const environment = { setContentRoots() {}, setPlatformChooserActive() {}, update() {} };
  const runtime = createSharedSceneRuntime({ scene, renderer, environment, homeContent, homeCamera: camera });
  let updates = 0, scans = 0;
  const traverse = chooser.traverse;
  chooser.traverse = function (visitor) { scans++; traverse.call(this, visitor); };
  runtime.registerView("chooser", { content: chooser, camera, update() { updates++; } });
  await runtime.prepareView("chooser");
  runtime.activateView("chooser");
  const initialScans = scans;

  const geometry = new BufferGeometry();
  const positions = vm.runInNewContext("new Float32Array([1,2,3,4,5,6,7,8,9])");
  const indices = vm.runInNewContext("new Uint16Array([0,1,2])");
  const interleaved = new InterleavedBuffer(positions, 3);
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.setAttribute("position", new InterleavedBufferAttribute(interleaved, 3, 0));
  geometry.morphAttributes.position = [new BufferAttribute(positions, 3)];
  const replacement = new Mesh(geometry);
  runtime.adoptContent(replacement);
  chooser.add(replacement);
  assert.ok(geometry.index.array instanceof Uint16Array);
  assert.ok(interleaved.array instanceof Float32Array);
  assert.ok(geometry.morphAttributes.position[0].array instanceof Float32Array);
  assert.deepEqual([...geometry.index.array], [...indices]);
  assert.deepEqual([...interleaved.array], [...positions]);
  assert.deepEqual([...geometry.morphAttributes.position[0].array], [...positions]);

  for (let frame = 0; frame < 12; frame++) runtime.update(frame * 16, 0.016);
  assert.equal(updates, 12);
  assert.equal(scans, initialScans);
});

test("Studio and home use the same background, fog and light settings", () => {
  const scene = new Scene();
  const environment=createStudioEnvironment(scene,{getPixelRatio:()=>1},{brightness:0.45,consoleReflection:0.06,lightReflection:0});
  assert.equal(scene.background.getHexString(),"09041c");
  assert.equal(scene.fog.density,0.008);
  assert.equal(environment.floor.material.uniforms.consoleReflectionOpacity.value,0.06);
  environment.apply({lightsEnabled:false});
  assert.equal(environment.lightSources.visible,false);
});

test("the full-window environment preserves saved carousel screen framing", () => {
  for (const width of [480,1440]) {
    const camera=new PerspectiveCamera(36,1,0.01,160);
    const bounds={left:0,top:111,width,height:620};
    const viewport={left:0,top:0,width,height:900};
    const point=new Vector3(-2,-1,-5);
    frameCarousel(camera,width,bounds.height);
    const before=point.clone().project(camera);
    const pixelBefore=[(before.x+1)*width/2,(1-before.y)*bounds.height/2+bounds.top];
    frameCarouselEnvironment(camera,bounds,viewport,8);
    const after=point.clone().add(new Vector3(0,8,0)).project(camera);
    const pixelAfter=[(after.x+1)*width/2,(1-after.y)*viewport.height/2];
    assert.ok(Math.abs(pixelBefore[0]-pixelAfter[0])<1e-6);
    assert.ok(Math.abs(pixelBefore[1]-pixelAfter[1])<1e-6);
  }
});

test("carousel framing uses the saved Studio camera across viewport sizes", () => {
  const saved = { target: [1, 6, -14], yaw: -12, pitch: -10, distance: 31, fov: 27 };
  const target = new Vector3(...saved.target);
  const runtime = new PerspectiveCamera(36);
  const studio = new PerspectiveCamera(36);
  frameCarouselEnvironment(runtime, { left: 0, top: 110, width: 1440, height: 620 },
    { left: 0, top: 0, width: 1440, height: 900 }, 8, saved);
  frameCarouselEnvironment(studio, { left: 0, top: 159, width: 1440, height: 570 },
    { left: 0, top: 49, width: 1440, height: 851 }, 8, saved);
  assert.equal(runtime.fov, 27);
  assert.equal(studio.fov, 27);
  assert.ok(runtime.position.equals(studio.position));
  assert.ok(runtime.quaternion.equals(studio.quaternion));
  assert.ok(Math.abs(runtime.position.distanceTo(target) - 31) < 1e-9);
  assert.ok(runtime.getWorldDirection(new Vector3())
    .distanceTo(target.sub(runtime.position).normalize()) < 1e-9);
  assert.equal(runtime.view.height, 900);
  assert.equal(studio.view.height, 851);
});

test("the pole stays centred under the details card in runtime and Studio", () => {
  const saved = { target: [1.62, 6.6, -14.56], yaw: -12.325, pitch: -9.775, distance: 30.9, fov: 27 };
  const camera = new PerspectiveCamera(36);
  for (const [width, height, cardCentre] of [[1920, 1080, 1652], [1920, 962, 1652], [1440, 850, 1206]]) {
    frameCarouselEnvironment(camera, { left: 0, top: 110, width, height: height - 280 },
      { left: 0, top: 0, width, height }, 8, saved);
    const poleCentre = new Vector3(4.58, .51, 6.56);
    const column = cardCentre * 2 / width - 1;
    assert.ok(Math.abs(poleCentre.clone().project(camera).x - column) > .02, "fixed world position drifts");
    poleCentre.x = worldXAtScreenColumn(camera, poleCentre, column);
    const projected = poleCentre.clone().project(camera);
    assert.ok(Math.abs(projected.x - column) < 1e-9);
    assert.ok(Math.abs(projected.z) < 1);
  }
});
