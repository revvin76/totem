import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Quaternion, Texture, Vector3,
} from "three";
import { disposeConsoleActivity, prepareConsoleActivity, prepareNintendoScreenDemo, prepareOffscreenDemo, prepareSwitchScreenDemo, setShowcaseStartupVideo, showcaseBackdropFrame, updateConsoleActivity } from "../src/console-activity.js";
import { disposeImported, parseModel } from "../src/platform-assets.js";
import examples from "../disc-examples.json" with { type: "json" };

const travel = 1.53;

function shell() {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
  return scene;
}

function assertRearFacingViewer(model, camera) {
  const rear = new Vector3(0, 0, -1).applyQuaternion(model.getWorldQuaternion(new Quaternion()));
  const toViewer = camera.getWorldPosition(new Vector3())
    .sub((model.parent ?? model).getWorldPosition(new Vector3())).normalize();
  assert.ok(rear.dot(toViewer) > .999999);
}

test("a console with no display shows its startup, fades to black, then uses the original gameplay video", () => {
  const model = shell(), elements = [];
  prepareOffscreenDemo(model, "n64", {
    url: "http://asset.localhost/Super%20Mario%2064%20(USA).mp4",
    filename: "Super Mario 64 (USA).mp4",
  }, "http://asset.localhost/Startup.mp4");
  globalThis.document = { baseURI: "http://localhost/", createElement(kind) {
    const element = { kind, paused: true, readyState: 2, duration: 20, currentTime: 0,
      async play() { this.paused = false; },
      pause() { this.paused = true; },
      removeAttribute() {},
      load() {},
    };
    elements.push(element);
    return element;
  } };
  try {
    updateConsoleActivity(model, true, .1, 0);
    assert.equal(elements.length, 0);
    updateConsoleActivity(model, true, .1);
    assert.equal(showcaseBackdropFrame(model).texture.image, elements[0]);
    elements[0].ended = true;
    updateConsoleActivity(model, true, .1);
    updateConsoleActivity(model, true, .14);
    assert.equal(showcaseBackdropFrame(model).brightness, .5);
    assert.equal(elements.length, 1);
    updateConsoleActivity(model, true, .14);
    assert.equal(showcaseBackdropFrame(model).texture.image, elements[1]);
    assert.deepEqual(elements.map(element => element.kind), ["video", "video"]);
    assert.equal(elements[1].currentTime, 6);
    elements[1].error = { code: 4 };
    updateConsoleActivity(model, true, .1);
    assert.ok(elements[1].paused);
    assert.equal(elements[2].kind, "audio");
    assert.equal(elements[2].paused, false);
    assert.equal(showcaseBackdropFrame(model), null);
    updateConsoleActivity(model, false);
    assert.equal(showcaseBackdropFrame(model), null);
    assert.ok(elements.every(element => element.paused));
    disposeConsoleActivity(model);
  } finally {
    delete globalThis.document;
  }
});

test("Jaguar starts its intro on selection before the rail reaches the resting position", () => {
  const model = shell();
  prepareOffscreenDemo(model, "jaguar", null, "http://asset.localhost/Startup.mp4");
  const intro = {
    paused: true, readyState: 2, duration: 20, currentTime: 0,
    async play() { this.paused = false; },
    pause() { this.paused = true; },
    removeAttribute() {},
    load() {},
  };
  globalThis.document = { baseURI: "http://localhost/", createElement: () => intro };
  try {
    updateConsoleActivity(model, false, .016, 0);
    assert.ok(intro.paused);
    updateConsoleActivity(model, true, .016, 0);
    assert.equal(showcaseBackdropFrame(model)?.texture.image, intro);
    updateConsoleActivity(model, false, .016, 0);
    assert.ok(intro.paused);
  } finally {
    disposeConsoleActivity(model);
    delete globalThis.document;
  }
});

test("disc preparation adds no console lamps or emissive colour effects", async () => {
  const model = shell();
  const body = model.children[0];
  const material = body.material;
  const original = material.color.toArray();
  await prepareConsoleActivity(model, "wii");
  updateConsoleActivity(model, true, travel / 2, 0.5);
  assert.equal(body.material, material);
  assert.deepEqual(material.color.toArray(), original);
  assert.equal(material.emissive.getHex(), 0);
  assert.ok(model.children.every((part) => !/indicator/i.test(part.name)));
});

test("the Wii starts its audible intro just before the disc slides inward", async () => {
  const model = shell(), videos = [];
  await prepareConsoleActivity(model, "wii");
  prepareOffscreenDemo(model, "wii", null, "http://asset.localhost/Startup.mp4");
  globalThis.document = { baseURI: "http://localhost/", createElement() {
    const video = { readyState: 2, duration: 12, currentTime: 0, paused: true,
      async play() { this.paused = false; },
      pause() { this.paused = true; },
      removeAttribute() {},
      load() {},
    };
    videos.push(video);
    return video;
  } };
  try {
    updateConsoleActivity(model, true, travel - .21);
    assert.equal(videos.length, 0);
    updateConsoleActivity(model, true, .05);
    assert.equal(videos.length, 1);
    assert.equal(videos[0].muted, false);
    assert.ok(model.userData.consoleActivity.elapsed < 1);
    assert.equal(showcaseBackdropFrame(model).texture.image, videos[0]);
  } finally {
    disposeConsoleActivity(model);
    delete globalThis.document;
  }
});

test("the modelled power lens illuminates at active rest without lighting the shared case material", async () => {
  const model = shell();
  const body = model.children[0];
  const lens = new Mesh(new BoxGeometry(), body.material);
  lens.name = "PowerLEDLens";
  model.add(lens);
  await prepareConsoleActivity(model, "gba");
  updateConsoleActivity(model, true, 0, .9);
  assert.equal(lens.material.emissiveIntensity, 0);
  updateConsoleActivity(model, true);
  assert.ok(lens.material.emissiveIntensity > 0);
  assert.equal(body.material.emissive.getHex(), 0);
  updateConsoleActivity(model, false);
  assert.equal(lens.material.emissiveIntensity, 0);
});

test("the 3DS seats its cartridge before playing one synchronized video across both screens", async () => {
  const model = shell();
  const lid = new Group();
  const cartridge = new Group();
  cartridge.name = "TotemCartridge";
  cartridge.userData = { travel: [0, .045, 0], enclosed: true };
  model.add(cartridge, lid);
  model.userData.platformId = "3ds";
  model.userData.animationTracks = [{ id: "3ds-lid", pivot: lid }];
  await prepareConsoleActivity(model, "3ds");
  prepareNintendoScreenDemo(model, model);
  const { lcd, touch } = model.userData.consoleActivity.screenDemo;
  const video = { paused: true, readyState: 2, currentTime: 0,
    async play() { this.paused = false; },
    pause() { this.paused = true; },
    removeAttribute() {},
    load() {},
  };
  globalThis.document = { baseURI: "http://localhost/", createElement: () => video };
  try {
    updateConsoleActivity(model, true, 1.5);
    assert.ok(cartridge.visible);
    assert.ok(video.paused);
    updateConsoleActivity(model, true, 2.4);
    assert.equal(cartridge.visible, false);
    assert.equal(lcd.parent, lid);
    assert.ok(lcd.visible && touch.visible);
    assert.equal(video.muted, false);
    assert.equal(lcd.material.map, touch.material.map);
    assert.equal(Math.min(...[0, 1, 2, 3].map(i => lcd.geometry.attributes.uv.getY(i))), .5);
    assert.equal(Math.max(...[0, 1, 2, 3].map(i => touch.geometry.attributes.uv.getY(i))), .5);
    updateConsoleActivity(model, false);
    assert.equal(lcd.visible || touch.visible, false);
    assert.ok(video.paused);
    disposeConsoleActivity(model);
    assert.equal(touch.material.map, null);
  } finally {
    delete globalThis.document;
  }
});

test("the GBA starts its intro halfway through insertion without slowing the cartridge", async () => {
  const model = shell();
  const card = new Group();
  card.name = "TotemCartridge";
  card.userData = { travel: [0, .045, 0], enclosed: true };
  const lcd = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  lcd.name = "Totem GBA showcase LCD";
  model.add(card, lcd);
  await prepareConsoleActivity(model, "gba");
  setShowcaseStartupVideo(model, "http://asset.localhost/Startup.mp4");
  const videos = [];
  globalThis.document = { baseURI: "http://localhost/", createElement() {
    const video = { paused: true, readyState: 2, duration: 5, currentTime: 0,
      async play() { this.paused = false; },
      pause() { this.paused = true; },
      removeAttribute() {},
      load() {},
    };
    videos.push(video);
    return video;
  } };
  try {
    updateConsoleActivity(model, true, 3.6 * .48);
    assert.equal(videos.length, 0);
    updateConsoleActivity(model, true, 3.6 * .06);
    assert.equal(videos.length, 1);
    assert.ok(card.position.y / .045 > .3 && card.position.y / .045 < .5);
    assert.equal(videos[0].src, "http://asset.localhost/Startup.mp4");
    assert.equal(videos[0].crossOrigin, "anonymous");
    updateConsoleActivity(model, true, 3.6 * .15);
    assert.equal(card.position.y, 0);
    assert.equal(videos[0].currentTime, 0);
    assert.equal(videos.length, 1);
    videos[0].currentTime = 5;
    videos[0].ended = true;
    updateConsoleActivity(model, true, .01);
    assert.equal(card.position.y, 0);
    assert.equal(lcd.material.color.r, 1);
    updateConsoleActivity(model, true, .14);
    assert.ok(lcd.material.color.r > 0 && lcd.material.color.r < 1);
    updateConsoleActivity(model, true, .2);
    assert.equal(lcd.material.color.r, 0);
    assert.equal(videos.length, 1);
    updateConsoleActivity(model, true, 1.1);
    assert.equal(videos.length, 2);
    assert.ok(videos[1].src.endsWith("/gba-sonic-advance.mp4"));
  } finally {
    disposeConsoleActivity(model);
    delete globalThis.document;
  }
});

test("the 3DS keeps its rear view and normal insertion speed when startup begins", async () => {
  const model = shell();
  const camera = new PerspectiveCamera();
  camera.position.set(1, 1, 5);
  const lid = new Group(), card = new Group();
  card.name = "TotemCartridge";
  card.userData = { travel: [0, .045, 0], enclosed: true };
  model.add(card, lid);
  model.userData.platformId = "3ds";
  model.userData.animationTracks = [{ id: "3ds-lid", pivot: lid }];
  await prepareConsoleActivity(model, "3ds");
  prepareNintendoScreenDemo(model, model);
  setShowcaseStartupVideo(model, "http://asset.localhost/Startup.mp4");
  const { screenDemo } = model.userData.consoleActivity;
  const boot = {
    paused: true, currentTime: 0, duration: 6, readyState: 2,
    async play() { this.paused = false; },
    pause() { this.paused = true; },
    removeAttribute() {},
    load() {},
  };
  globalThis.document = { baseURI: "http://localhost/", createElement: () => boot };
  try {
    updateConsoleActivity(model, true, 3.6 * .50, 1, false, camera);
    assert.equal(boot.paused, true);
    assertRearFacingViewer(model, camera);
    updateConsoleActivity(model, true, 3.6 * .04, 1, false, camera);
    assert.equal(boot.paused, false);
    assert.ok(card.visible);
    assertRearFacingViewer(model, camera);
    updateConsoleActivity(model, true, 3.6 * .15, 1, false, camera);
    assert.equal(card.position.y, 0);
    assert.equal(card.visible, false);
    assert.equal(screenDemo.requested, false);
  } finally {
    disposeConsoleActivity(model);
    delete globalThis.document;
  }
});

test("the Wii U GamePad shows black until the gameplay video can display a frame", async () => {
  const model = shell();
  const gamePad = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  gamePad.name = "polySurface1_blinn1_0";
  model.add(gamePad);
  model.userData.platformId = "wiiu";
  await prepareConsoleActivity(model, "wiiu");
  prepareNintendoScreenDemo(model, model);
  const { lcd, glass } = model.userData.consoleActivity.screenDemo;
  const video = {
    paused: true, readyState: 0, currentTime: 0,
    async play() { this.paused = false; },
    pause() { this.paused = true; },
  };
  globalThis.document = { baseURI: "http://localhost/", createElement: () => video };
  try {
    assert.ok(lcd.visible);
    assert.equal(lcd.material.color.getHex(), 0);
    updateConsoleActivity(model, true, 1.5);
    assert.ok(video.paused);
    assert.equal(lcd.material, glass);
    updateConsoleActivity(model, true, 1.6);
    assert.equal(video.paused, false);
    assert.equal(video.muted, false);
    assert.equal(lcd.material, glass);
    video.readyState = 2;
    updateConsoleActivity(model, true);
    assert.ok(lcd.material.map.isVideoTexture);
    updateConsoleActivity(model, false);
    assert.ok(video.paused && lcd.visible);
    assert.equal(lcd.material, glass);
  } finally {
    delete globalThis.document;
  }
});

test("the Wii U disc completes at normal speed while a long startup continues", async () => {
  const model = shell();
  const gamePad = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  gamePad.name = "polySurface1_blinn1_0";
  model.add(gamePad);
  model.userData.platformId = "wiiu";
  await prepareConsoleActivity(model, "wiiu");
  prepareNintendoScreenDemo(model, model);
  setShowcaseStartupVideo(model, "http://asset.localhost/Startup.mp4");
  const { front, screenDemo } = model.userData.consoleActivity;
  const boot = {
    paused: true, readyState: 2, duration: 16, currentTime: 0,
    async play() { this.paused = false; },
    pause() { this.paused = true; },
    removeAttribute() {},
    load() {},
  };
  globalThis.document = { baseURI: "http://localhost/", createElement: () => boot };
  try {
    updateConsoleActivity(model, true, travel);
    assert.ok(front.disc.visible);
    assert.ok(front.disc.position.distanceTo(front.face) < 1e-9);
    boot.currentTime = 3;
    updateConsoleActivity(model, true, travel);
    assert.equal(front.disc.visible, false);
    assert.ok(front.disc.position.distanceTo(front.loaded) < 1e-9);
    assert.ok(screenDemo.lcd.material.map.isVideoTexture);
    assert.equal(screenDemo.requested, false);
  } finally {
    disposeConsoleActivity(model);
    delete globalThis.document;
  }
});

test("slot discs take 1.53 seconds per leg regardless of platform focus", async () => {
  for (const id of ["wii", "wiiu", "ps3", "ps4", "ps5", "xboxone", "xboxseriesx"]) {
    const model = shell();
    await prepareConsoleActivity(model, id);
    const front = model.userData.consoleActivity.front;
    updateConsoleActivity(model, false);
    assert.equal(front.disc.visible, false);
    updateConsoleActivity(model, true, travel / 2, 0.5);
    assert.ok(Math.abs(front.disc.position.distanceTo(front.face) - front.radius / 2) < 1e-9);
    updateConsoleActivity(model, true, travel / 2, 1);
    assert.equal(front.disc.visible, true);
    assert.ok(front.disc.position.distanceTo(front.face) < 1e-9);
    updateConsoleActivity(model, true, travel, 1);
    assert.equal(front.disc.visible, false);
    assert.ok(front.disc.position.distanceTo(front.loaded) < 1e-9);
  }
});

test("focus-driven trays retract with the disc and extend at the same speed", async () => {
  for (const id of ["xbox", "xbox360", "segacd", "3do"]) {
    const model = shell();
    await prepareConsoleActivity(model, id);
    const { tray, disc, radius } = model.userData.consoleActivity.front;
    updateConsoleActivity(model, false);
    const open = tray.position.clone();
    assert.equal(tray.visible, true);
    assert.equal(disc.visible, false);
    updateConsoleActivity(model, true, travel / 2, 0.9);
    assert.equal(disc.parent, tray);
    assert.equal(disc.visible, true);
    assert.ok(Math.abs(tray.position.distanceTo(open) - radius * 0.8) < 1e-9);
    updateConsoleActivity(model, true, travel / 2, 1);
    assert.equal(tray.visible, false);
    assert.equal(disc.visible, false);
    updateConsoleActivity(model, false, travel);
    assert.ok(tray.position.distanceTo(open) < 1e-9);
    assert.equal(tray.visible, true);
  }
});

test("the PS2 cycles its tray once and lights only the power and disc lenses", async () => {
  const model = shell();
  const resetButton = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  resetButton.name = "Object_19";
  resetButton.material.name = "PS2_Reset_Button_Material";
  const ejectButton = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  ejectButton.name = "Object_21";
  ejectButton.material.name = "Trey_Out_Button_Material";
  model.add(resetButton, ejectButton);
  await prepareConsoleActivity(model, "ps2");
  const { disc, tray, radius } = model.userData.consoleActivity.front;
  const power = resetButton.children[0].material;
  const read = ejectButton.children[0].material;
  assert.ok(power.emissive.r > power.emissive.g);
  assert.ok(power.emissiveIntensity > 0);
  assert.equal(read.emissiveIntensity, 0);
  const closed = tray.position.clone();
  const offset = disc.getWorldPosition(disc.position.clone()).sub(tray.getWorldPosition(tray.position.clone()));
  updateConsoleActivity(model, true, travel / 2);
  const opening = tray.position.distanceTo(closed);
  assert.ok(opening > 0 && opening < 1.6 * radius);
  assert.ok(power.emissive.g > power.emissive.r);
  assert.equal(read.emissiveIntensity, 0);
  updateConsoleActivity(model, true, travel / 2);
  assert.ok(Math.abs(tray.position.distanceTo(closed) - 1.6 * radius) < 1e-9);
  assert.equal(disc.visible, true);
  assert.equal(disc.parent, tray);
  const openOffset = disc.getWorldPosition(disc.position.clone()).sub(tray.getWorldPosition(tray.position.clone()));
  assert.ok(openOffset.distanceTo(offset) < 1e-9);
  updateConsoleActivity(model, true, travel / 2);
  assert.ok(Math.abs(tray.position.distanceTo(closed) - opening) < 1e-9);
  updateConsoleActivity(model, true, travel / 2);
  for (const delta of [0, 2, 15]) {
    updateConsoleActivity(model, true, delta);
    assert.equal(tray.visible, false);
    assert.equal(disc.visible, false);
    assert.ok(tray.position.distanceTo(closed) < 1e-9);
    assert.ok(read.emissiveIntensity > 0 && read.emissive.b > read.emissive.g);
    assert.equal(resetButton.material.emissive.getHex(), 0);
    assert.equal(ejectButton.material.emissive.getHex(), 0);
  }
  updateConsoleActivity(model, false);
  assert.ok(power.emissive.r > power.emissive.g);
  assert.equal(read.emissiveIntensity, 0);
  updateConsoleActivity(model, true, travel / 2);
  assert.ok(Math.abs(tray.position.distanceTo(closed) - opening) < 1e-9);
});

test("every example disc has a packaged image and recorded provenance", async () => {
  for (const entry of Object.values(examples)) {
    assert.ok(entry.game && entry.source && entry.type.startsWith("disc"));
    const bytes = await readFile(new URL(`../public/${entry.artwork}`, import.meta.url));
    assert.ok(bytes[0] === 0x89 && bytes[1] === 0x50 || bytes[0] === 0xff && bytes[1] === 0xd8);
  }
});

test("the Lynx loads rear-on without flipping the card, then plays and releases the gameplay video", async () => {
  const model = shell();
  model.rotation.set(.17, .12, -.08);
  const front = model.quaternion.clone();
  const camera = new PerspectiveCamera();
  camera.position.set(-2, 1, 5);
  const card = new Group();
  card.name = "TotemCartridge";
  card.userData = { travel: [-2, 0, 0], enclosed: true };
  const door = new Group();
  door.name = "TotemCardDoor";
  const power = new Group();
  power.name = "TotemLynxPower";
  const title = new Texture();
  const lcd = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map: title }));
  lcd.name = "TotemLynxLCD";
  model.add(card, door, power, lcd);
  await prepareConsoleActivity(model, "lynx");
  assert.equal(card.visible, false);
  assert.equal(lcd.visible, false);

  const video = {
    paused: true, readyState: 2, currentTime: 0,
    async play() { this.paused = false; },
    pause() { this.paused = true; },
    removeAttribute(name) { delete this[name]; },
    load() {},
  };
  globalThis.document = { baseURI: "http://localhost/", createElement: () => video };
  try {
    model.userData.detailTier = "preview";
    updateConsoleActivity(model, true, 10);
    assert.equal(card.visible, false);
    assert.equal(lcd.visible, false);
    model.userData.detailTier = "display";
    updateConsoleActivity(model, true, 1.5, 1, false, camera);
    assert.equal(card.visible, true);
    assert.equal(card.position.x, -2);
    assert.ok(door.rotation.y < -1);
    assert.equal(lcd.visible, true);
    assert.equal(lcd.material.map, title);
    assert.equal(video.paused, true);
    assertRearFacingViewer(model, camera);
    const artNormal = new Vector3(0, 0, 1).applyQuaternion(card.quaternion);
    assert.ok(artNormal.z < -.999999);
    const cardOrientation = card.quaternion.clone();
    updateConsoleActivity(model, true, .8, 1, false, camera);
    assertRearFacingViewer(model, camera);
    assert.equal(card.visible, true);
    assert.ok(card.position.x > -2 && card.position.x < 0);
    assert.ok(card.quaternion.equals(cardOrientation));
    updateConsoleActivity(model, true, .45, 1, false, camera);
    assert.equal(card.visible, false);
    assert.equal(card.position.x, 0);
    assert.equal(lcd.visible, true);
    assert.equal(lcd.material.map, title);
    assert.equal(lcd.material.color.r, 1);
    updateConsoleActivity(model, true, .14, 1, false, camera);
    assert.ok(lcd.material.color.r > 0 && lcd.material.color.r < 1);
    updateConsoleActivity(model, true, 1.6, 1, false, camera);
    assert.ok(model.quaternion.equals(front));
    assert.equal(door.rotation.y, 0);
    assert.equal(lcd.material.color.r, 0);
    assert.equal(video.paused, true);
    updateConsoleActivity(model, true, .016);
    assert.equal(video.paused, false);
    assert.equal(lcd.material.map.isVideoTexture, true);
    assert.equal(lcd.material.map.flipY, false);
    video.currentTime = 3;
    updateConsoleActivity(model, false);
    assert.equal(lcd.visible, false);
    assert.equal(lcd.material.map, title);
    assert.equal(video.paused, true);
    assert.equal(video.currentTime, 0);
    updateConsoleActivity(model, true, .05, 1, true);
    assert.equal(card.visible, false);
    assert.equal(lcd.visible, true);
    assert.equal(lcd.material.map, title);
    disposeConsoleActivity(model);
    assert.equal(video.src, undefined);
  } finally {
    delete globalThis.document;
  }
});

test("the Game Gear presents its rear before the cartridge slides and restores its showcase pose", async () => {
  const camera = new PerspectiveCamera();
  camera.position.set(1, 2, 7);
  const model = shell();
  const holder = new Group();
  holder.position.set(-2, 0, 1);
  holder.rotation.set(.16, -.24, .08);
  holder.add(model);
  const front = model.quaternion.clone();
  const card = new Group();
  card.name = "TotemCartridge";
  card.userData.travel = [0, 2, 0];
  model.add(card);
  await prepareConsoleActivity(model, "gamegear");

  updateConsoleActivity(model, true, 1, 1, false, camera);
  assert.equal(card.visible, false);
  updateConsoleActivity(model, true, .4, 1, false, camera);
  assert.equal(card.visible, true);
  assert.equal(card.position.y, 2);
  assertRearFacingViewer(model, camera);
  const orientation = card.quaternion.clone();
  updateConsoleActivity(model, true, .8, 1, false, camera);
  assertRearFacingViewer(model, camera);
  assert.ok(card.position.y > 0 && card.position.y < 2);
  assert.ok(card.quaternion.equals(orientation));
  updateConsoleActivity(model, true, 1.7, 1, false, camera);
  assert.ok(model.quaternion.equals(front));
  assert.equal(card.position.y, 0);
  assert.equal(card.visible, true);
  updateConsoleActivity(model, false);
  assert.equal(card.visible, false);
  assert.ok(model.quaternion.equals(front));
  updateConsoleActivity(model, true, 0, 1, true, camera);
  assert.equal(card.position.y, 0);
  assert.ok(model.quaternion.equals(front));
});

test("the Game Gear powers on and plays Sonic only after settling", async () => {
  const model = shell();
  const card = new Group();
  card.name = "TotemCartridge";
  card.userData.travel = [0, 2, 0];
  const glass = new MeshStandardMaterial();
  const lcd = new Mesh(new BoxGeometry(), glass);
  lcd.name = "TotemGameGearLCD";
  const led = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  led.name = "TotemGameGearPowerLED";
  model.add(card, lcd, led);
  const video = {
    paused: true, readyState: 0, currentTime: 0,
    async play() { this.paused = false; },
    pause() { this.paused = true; },
    removeAttribute(name) { delete this[name]; },
    load() {},
  };
  globalThis.document = { baseURI: "http://localhost/", createElement: () => video };
  try {
    await prepareConsoleActivity(model, "gamegear");
    updateConsoleActivity(model, true, 3.5);
    assert.equal(led.material.emissiveIntensity, 0);
    assert.equal(lcd.material, glass);
    assert.equal(video.src, undefined);

    updateConsoleActivity(model, true, .4);
    assert.ok(led.material.emissiveIntensity > 0);
    assert.match(video.src, /\/game-gear-sonic-2\.mp4$/);
    assert.equal(video.muted, false);
    assert.equal(lcd.material, glass);
    video.readyState = 2;
    updateConsoleActivity(model, true);
    assert.equal(lcd.material.map.isVideoTexture, true);

    video.currentTime = 2;
    updateConsoleActivity(model, false);
    assert.equal(led.material.emissiveIntensity, 0);
    assert.equal(lcd.material, glass);
    assert.equal(video.paused, true);
    assert.equal(video.currentTime, 0);
  } finally {
    disposeConsoleActivity(model);
    delete globalThis.document;
  }
});

test("the carousel Switch loops gameplay only while active and leaves its original glass in place", async () => {
  const bytes = await readFile(new URL("../public/assets/models/switch.glb", import.meta.url));
  const model = await parseModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), [], [], [], "switch");
  const glass = model.getObjectByName("DisplayGlass - Tablet");
  const originalMaterial = glass.material;
  const video = {
    paused: true, readyState: 0, currentTime: 0,
    async play() { this.paused = false; },
    pause() { this.paused = true; },
    removeAttribute(name) { delete this[name]; },
    load() {},
  };
  globalThis.document = { baseURI: "http://localhost/", createElement: () => video };
  try {
    assert.equal(model.userData.consoleActivity.screenDemo, undefined, "loading a chooser model alone does not attach the carousel demo");
    prepareSwitchScreenDemo(model);
    const lcd = model.userData.consoleActivity.screenDemo.lcd;
    assert.equal(lcd.parent, glass);
    updateConsoleActivity(model, false);
    assert.equal(video.src, undefined);
    updateConsoleActivity(model, true);
    assert.match(video.src, /\/switch-mario-kart-8-deluxe\.mp4$/);
    assert.equal(video.muted, false);
    assert.equal(video.loop, true);
    assert.equal(lcd.visible, false);
    video.readyState = 2;
    updateConsoleActivity(model, true);
    assert.equal(lcd.visible, true);
    assert.equal(lcd.material.map.flipY, true);
    assert.equal(glass.material, originalMaterial);
    video.currentTime = 5;
    updateConsoleActivity(model, false);
    assert.equal(video.paused, true);
    assert.equal(video.currentTime, 0);
    assert.equal(lcd.visible, false);
  } finally {
    disposeImported(model);
    delete globalThis.document;
  }
});

test("the PSP holds its rear view until the UMD is seated and lights the screen facing forward", async () => {
  const model = shell();
  const door = new Group();
  door.name = "TotemPspDoor";
  const umd = new Group();
  umd.name = "TotemPspUMD";
  umd.userData.travel = 1.52;
  umd.position.y = .768;
  const lcd = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  lcd.name = "TotemPspLCD";
  door.add(umd);
  model.add(door, lcd);
  await prepareConsoleActivity(model, "psp");
  assert.equal(umd.visible, false);
  assert.equal(lcd.visible, false);

  updateConsoleActivity(model, true, 1.65);
  const rearYaw = model.rotation.y;
  assert.ok(Math.abs(rearYaw - Math.PI) < .4);
  assert.ok(Math.abs(door.rotation.x + 23 * Math.PI / 180) < 1e-8);
  assert.ok(umd.position.y > 2.2);
  assert.equal(umd.visible, true);

  updateConsoleActivity(model, true, 1.36);
  assert.equal(model.rotation.y, rearYaw);
  assert.equal(umd.position.y, .768);
  assert.equal(lcd.visible, false);
  updateConsoleActivity(model, true, 1.5);
  assert.equal(model.rotation.y, 0);
  assert.equal(door.rotation.x, 0);
  assert.equal(umd.visible, false);
  assert.equal(lcd.visible, true);

  updateConsoleActivity(model, false);
  model.userData.detailTier = "preview";
  updateConsoleActivity(model, true, 10);
  assert.equal(lcd.visible, false);
  assert.equal(umd.visible, false);
  model.userData.detailTier = "display";
  updateConsoleActivity(model, true, .1, 1, true);
  assert.equal(lcd.visible, true);
  assert.equal(door.rotation.x, 0);
});

test("a blocked handheld preview retries on a trusted interaction and cleans up on deselection", async () => {
  const model = shell();
  const door = new Group();
  door.name = "TotemPspDoor";
  const umd = new Group();
  umd.name = "TotemPspUMD";
  umd.userData.travel = 1;
  door.add(umd);
  const lcd = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  lcd.name = "TotemPspLCD";
  model.add(door, lcd);
  await prepareConsoleActivity(model, "psp");
  const handlers = new Map();
  let attempts = 0;
  const video = {
    paused: true, readyState: 2, currentTime: 0,
    async play() {
      if (++attempts === 1) throw new DOMException("Needs interaction", "NotAllowedError");
      this.paused = false;
    },
    pause() { this.paused = true; },
    removeAttribute(name) { delete this[name]; },
    load() {},
  };
  globalThis.document = {
    baseURI: "http://localhost/", createElement: () => video,
    addEventListener: (type, handler) => handlers.set(type, handler),
    removeEventListener: (type) => handlers.delete(type),
  };
  try {
    updateConsoleActivity(model, true, 30, 1, true);
    await Promise.resolve();
    handlers.get("click")({ isTrusted: false });
    assert.equal(attempts, 1);
    handlers.get("keydown")({ isTrusted: true });
    assert.equal(attempts, 2);
    assert.equal(video.paused, false);
    assert.equal(handlers.size, 0);
    updateConsoleActivity(model, false);
    assert.equal(video.paused, true);
  } finally {
    disposeConsoleActivity(model);
    delete globalThis.document;
  }
});

test("32X dust flaps open into the slot before the cartridge seats", async () => {
  const model = shell();
  const cartridge = new Group();
  cartridge.name = "TotemCartridge";
  cartridge.position.set(2.87, 11.76, -4.76);
  cartridge.userData.travel = [0, 5.8, 0];
  const rear = new Group();
  rear.name = "Totem32XRearFlap";
  const front = new Group();
  front.name = "Totem32XFrontFlap";
  model.add(cartridge, rear, front);
  await prepareConsoleActivity(model, "32x");
  assert.equal(cartridge.visible, false);

  updateConsoleActivity(model, true, .8);
  assert.equal(cartridge.visible, true);
  assert.equal(rear.rotation.x, 0);
  assert.equal(front.rotation.x, 0);
  updateConsoleActivity(model, true, 1.15);
  assert.ok(rear.rotation.x > 1.45);
  assert.ok(front.rotation.x < -1.45);
  assert.ok(cartridge.position.y > 11.76);
  updateConsoleActivity(model, true, 1);
  assert.deepEqual(cartridge.position.toArray(), [2.87, 11.76, -4.76]);
  assert.equal(cartridge.visible, true);
  assert.ok(rear.rotation.x > 1.45);

  updateConsoleActivity(model, false);
  assert.equal(cartridge.visible, false);
  assert.equal(rear.rotation.x, 0);
  assert.equal(front.rotation.x, 0);
});

test("a top-loading cartridge covers most of its travel early and slows into the slot", async () => {
  const model = shell();
  const cartridge = new Group();
  cartridge.name = "TotemCartridge";
  cartridge.userData.travel = [0, 1, 0];
  model.add(cartridge);
  await prepareConsoleActivity(model, "n64");

  updateConsoleActivity(model, true, 1.1);
  const halfway = cartridge.position.y;
  assert.ok(halfway > 0 && halfway < .5);
  updateConsoleActivity(model, true, .5);
  const nearSlot = cartridge.position.y;
  assert.ok(nearSlot > 0 && nearSlot < halfway);
  updateConsoleActivity(model, true, .5);
  assert.equal(cartridge.position.y, 0);
  assert.ok(nearSlot < halfway - nearSlot);
});

test("the PAL SNES flap is fully open before the deeper cartridge reaches the deck", async () => {
  const model = shell();
  const cartridge = new Group();
  cartridge.name = "TotemCartridge";
  cartridge.position.y = 10.48;
  cartridge.userData.travel = [0, 14.3, 0];
  const flap = new Group();
  flap.name = "TotemSnesCartridgeFlap";
  model.add(cartridge, flap);
  await prepareConsoleActivity(model, "snes");

  updateConsoleActivity(model, true, .87);
  assert.ok(cartridge.position.y - 7.435 > 10.26);
  assert.equal(flap.rotation.z, Math.PI / 2);
  updateConsoleActivity(model, true, 1.24);
  assert.equal(cartridge.position.y, 10.48);
  assert.equal(flap.rotation.z, Math.PI / 2);
  updateConsoleActivity(model, false);
  assert.equal(flap.rotation.z, 0);
});
