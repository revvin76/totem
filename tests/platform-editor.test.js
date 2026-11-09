import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3, PerspectiveCamera, Raycaster, Vector3 } from "three";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import startup from "../startup-layout.json" with { type: "json" };
import { frameCarousel } from "../src/framing.js";
import { orbitOrientation, orbitPosition } from "../src/orbit.js";
import { applyConsoleControls } from "../src/layout.js";
import catalogue from "../platforms.json" with { type: "json" };
import {
  inspectGLB,
  loadPlatformModel,
  parseModel,
  setModelActivity,
  validatePlatform,
  disposeImported,
} from "../src/platform-assets.js";
import { mockModelImages, triangleGLB } from "./glb-fixture.js";
import { displayPlatform } from "../src/model-display.js";
import { prepareOffscreenDemo } from "../src/console-activity.js";

test("opaque-case display corrections fix blended exports without changing other materials", async () => {
  const buffer = triangleGLB({
    nodes: [{ mesh: 0 }, { mesh: 1 }],
    scenes: [{ nodes: [0, 1] }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 0 }, material: 1 }] },
    ],
    materials: [
      {
        name: "case",
        alphaMode: "BLEND",
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.75] },
      },
      {
        name: "glass",
        alphaMode: "BLEND",
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.5] },
      },
    ],
  });
  const original = await parseModel(buffer),
    corrected = await parseModel(buffer, [], [0, 0, 0], ["case"]);
  const find = (model, name) => {
    let found;
    model.traverse((part) => {
      if (part.isMesh && part.material.name === name) found = part.material;
    });
    return found;
  };
  assert.equal(find(original, "case").transparent, true);
  assert.equal(find(original, "case").depthWrite, false);
  assert.equal(find(corrected, "case").transparent, false);
  assert.equal(find(corrected, "case").depthWrite, true);
  assert.equal(find(corrected, "case").opacity, 1);
  assert.equal(find(corrected, "glass").transparent, true);
  assert.equal(find(corrected, "glass").opacity, 0.5);
  disposeImported(original);
  disposeImported(corrected);
});

test("tall bundled models fit the approved showcase without changing saved layout values", async (t) => {
  mockModelImages(t);
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ getContext: () => ({ fillText() {} }) }),
  };
  try {
    for (const id of ["ps5", "xboxseriesx"]) {
      const platform = catalogue.find((p) => p.id === id);
      const bytes = await readFile(
        new URL(`../public/${platform.bundledModel.path}`, import.meta.url),
      );
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
      const model = await loadPlatformModel(
        {
          ...platform,
          modelFile: { id: `${platform.bundledModel.sha256}.glb` },
        },
        { readAsset: async () => buffer },
      );
      assert.equal(model.userData.modelLoadError, undefined, id);
      assert.equal(model.userData.imported, true, id);
      const camera = new PerspectiveCamera(36, 1, 0.1, 100);
      frameCarousel(camera, 1920, 743);
      orbitPosition(0, startup.layout.orbit, model.position, camera.quaternion);
      orbitOrientation(0, camera.quaternion, model.quaternion);
      applyConsoleControls(
        model,
        startup.layout.consoles,
        camera.quaternion,
        1.5,
      );
      model.updateMatrixWorld(true);
      let top = -Infinity,
        bottom = Infinity;
      model.traverseVisible((part) => {
        if (!part.isMesh) return;
        const positions = part.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          const point = new Vector3()
            .fromBufferAttribute(positions, i)
            .applyMatrix4(part.matrixWorld)
            .project(camera);
          top = Math.max(top, point.y);
          bottom = Math.min(bottom, point.y);
        }
      });
      disposeImported(model);
      assert.ok(top < 1, `${id} top ${top}`);
      assert.ok(bottom > -1, `${id} bottom ${bottom}`);
    }
  } finally {
    globalThis.document = previousDocument;
  }
});

test("the requested model upgrades distinguish pending review from shipped replacements", { skip: "Private hardware showcase fixtures are not distributed." }, () => {
  const pending =
    "amiga500 cpc464 atari2600 c64 vic20 dreamcast gwmulti gba gbcolor gameboy gamecube windows megadrive 3ds n64 ndslite nes switch switch2 playstation ps2 ps3 ps4 ps5 psp saturn mastersystem spectrum snes virtualboy wii wiiu xbox xbox360 xboxone xboxseriesx".split(" ");
  assert.deepEqual(
    catalogue
      .filter((p) => p.upgradePriority)
      .map((p) => p.id)
      .sort(),
    pending.sort(),
  );
  for (const id of ["gamegear", "jaguar", "lynx", "segacd"]) {
    const platform = catalogue.find((record) => record.id === id);
    assert.equal(platform?.upgradePriority, false, id);
    assert.ok(platform.bundledModel?.path, id);
  }
  assert.equal(
    catalogue.find((p) => p.id === "windows").model.profile,
    "desktop",
  );
});

test("the carousel seats each named cartridge and lights the Jaguar without its controller", { skip: "Private hardware showcase fixtures are not distributed." }, async (t) => {
  mockModelImages(t);
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ getContext: () => ({ fillText() {} }) }),
  };
  t.after(() => { globalThis.document = previousDocument; });
  const store = {
    async readBundledModel(path, hash) {
      const bytes = await readFile(new URL(`../public/${path}`, import.meta.url));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
      return Uint8Array.from(bytes).buffer;
    },
  };
  for (const [id, label] of [
    ["jaguar", "Theme Park Jaguar cartridge label"],
    ["mastersystem", "Alex Kidd in Miracle World"],
    ["megadrive", "Sonic the Hedgehog"],
    ["snes", "Super Mario Kart (PAL)"],
  ]) {
    const platform = catalogue.find(entry => entry.id === id);
    const model = await loadPlatformModel(displayPlatform(platform, "display"), store, false, { carouselShowcase: true });
    try {
      const cartridge = model.getObjectByName("TotemCartridge");
      assert.ok(cartridge, id);
      const seatedY = cartridge.position.y;
      const { powerLED, jaguarPowerLED } = model.userData.consoleActivity;
      const indicator = jaguarPowerLED ?? powerLED;
      assert.equal(indicator?.emissiveIntensity, 0, id);
      if (id === "mastersystem") {
        assert.ok(seatedY + .007 < .0635, "the bottom of the shell enters the slot");
      }
      let hasLabel = false;
      cartridge.traverse(part => { hasLabel ||= part.material?.name === label; });
      assert.ok(hasLabel, label);
      assert.equal(cartridge.visible, false);
      if (id === "jaguar") {
        assert.equal(model.getObjectByName("Jaguar_three-button_controller"), undefined);
        assert.equal(jaguarPowerLED?.name, "jagLens");
        const chassis = model.children[0].children[0];
        model.updateMatrixWorld(true);
        const origin = chassis.localToWorld(new Vector3(0, .09, cartridge.position.z));
        const bottom = chassis.localToWorld(new Vector3(0, 0, cartridge.position.z));
        const ray = new Raycaster(origin, bottom.sub(origin).normalize());
        const hit = ray.intersectObject(chassis).find(entry => entry.object.visible && entry.object.parent !== cartridge);
        assert.ok(hit && chassis.worldToLocal(hit.point.clone()).y < .019, "the original shell leaves the bay open");
      }
      setModelActivity(model, true, .25, .6);
      assert.equal(cartridge.visible, false);
      setModelActivity(model, true, .4);
      assert.equal(cartridge.visible, true);
      assert.equal(indicator.emissiveIntensity, 0);
      assert.ok(cartridge.position.y > seatedY);
      setModelActivity(model, true, 3);
      assert.equal(cartridge.position.y, seatedY);
      assert.equal(cartridge.visible, true);
      assert.ok(indicator.emissiveIntensity > 0);
      setModelActivity(model, false);
      assert.equal(cartridge.visible, false);
      assert.equal(indicator.emissiveIntensity, 0);
    } finally {
      disposeImported(model);
    }
  }
});

test("Totem and Studio insert cartridges before starting showcase media", { skip: "Private hardware showcase fixtures are not distributed." }, async (t) => {
  mockModelImages(t);
  const previousDocument = globalThis.document;
  const played = [];
  globalThis.document = {
    baseURI: "http://localhost/",
    createElement: (tag) => tag === "canvas" ? { getContext: () => ({ fillText() {} }) } : {
      volume: 1, paused: true, readyState: 2,
      async play() { played.push(new URL(this.src).pathname); this.paused = false; },
      pause() { this.paused = true; },
      removeAttribute() {},
      load() {},
    },
  };
  t.after(() => { globalThis.document = previousDocument; });
  const store = {
    async readBundledModel(path, hash) {
      const bytes = await readFile(new URL(`../public/${path}`, import.meta.url));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
      return Uint8Array.from(bytes).buffer;
    },
  };
  for (const tier of ["display", "studio"]) {
    for (const [id, elapsed, media] of [
      ["gba", 1.6, "/assets/demos/gba-sonic-advance.mp4"],
      ["3ds", 1.6, "/assets/demos/3ds-super-mario-3d-land.mp4"],
      ["mastersystem", .4, "/assets/demos/offscreen/mastersystem.mp3"],
    ]) {
      played.length = 0;
      const platform = catalogue.find(entry => entry.id === id);
      const model = await loadPlatformModel(displayPlatform(platform, tier), store, false, { carouselShowcase: true });
      try {
        const cartridge = model.getObjectByName("TotemCartridge");
        assert.ok(cartridge, `${tier} ${id} must attach its cartridge`);
        const seated = cartridge.position.clone();
        prepareOffscreenDemo(model, id);
        setModelActivity(model, true, elapsed);
        assert.ok(cartridge.visible && !cartridge.position.equals(seated), `${tier} ${id} must animate`);
        assert.deepEqual(played, [], "media waits for the cartridge");
        setModelActivity(model, true, 4);
        assert.ok(cartridge.position.equals(seated));
        assert.deepEqual(played, [media]);
        const activity = model.userData.consoleActivity;
        const player = (activity.screenDemo ?? activity.offscreenDemo).element;
        setModelActivity(model, false);
        assert.ok(player.paused);
        assert.equal(cartridge.visible, false);
      } finally {
        disposeImported(model);
      }
    }
  }
});

test("GLB import constructs real geometry and normalises its full bounds", async () => {
  const root = await parseModel(triangleGLB());
  assert.equal(root.userData.modelStats.triangles, 1);
  assert.equal(root.userData.imported, true);
  assert.ok(
    Math.abs(new Box3().setFromObject(root).getSize(new Vector3()).x - 3.3) <
      1e-6,
  );
  disposeImported(root);
});
test("invalid, truncated, network-dependent and unsupported compressed GLBs are rejected", () => {
  assert.throws(() => inspectGLB(new ArrayBuffer(2)));
  assert.throws(() =>
    inspectGLB(
      triangleGLB({ buffers: [{ uri: "https://example.com/private.bin" }] }),
    ),
  );
  assert.throws(() =>
    inspectGLB(triangleGLB({ images: [{ uri: "../../texture.png" }] })),
  );
  assert.throws(() =>
    inspectGLB(triangleGLB({ extensionsUsed: ["KHR_draco_mesh_compression"] })),
  );
  const invalid = triangleGLB();
  new DataView(invalid).setUint32(8, 123, true);
  assert.throws(() => inspectGLB(invalid));
});
test("presentation-logo meshes can be hidden without hiding or shrinking the device", async () => {
  const root = await parseModel(
    triangleGLB({
      scenes: [{ nodes: [0, 1, 2] }],
      nodes: [
        { mesh: 0 },
        { mesh: 1, translation: [100, 0, 0] },
        { mesh: 1, translation: [-100, 0, 0] },
      ],
      meshes: [
        { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
        { primitives: [{ attributes: { POSITION: 0 }, material: 1 }] },
      ],
      materials: [{ name: "device" }, { name: "presentation-logos" }],
    }),
    ["presentation-logos"],
  );
  assert.equal(root.userData.modelStats.meshes, 1);
  let hidden = 0;
  root.traverse((part) => {
    if (part.isMesh && !part.visible) hidden++;
  });
  assert.equal(hidden, 2);
  disposeImported(root);
});
test("platform edits preserve stable IDs and reject blank names and unsafe references", () => {
  const ids = catalogue.map((p) => p.id);
  const record = structuredClone(catalogue[0]);
  record.name = "My Game Boy category";
  assert.equal(validatePlatform(record, ids).id, "gameboy");
  record.id = "user-my-platform";
  record.model = {
    profile: "cartridge",
    width: 3,
    height: 0.4,
    depth: 2,
    color: "#778899",
  };
  assert.equal(validatePlatform(record, ids).name, record.name);
  record.name = " ";
  assert.throws(() => validatePlatform(record, ids));
  record.name = "Custom";
  record.id = "../outside";
  assert.throws(() => validatePlatform(record, ids));
  record.id = "user-test";
  record.modelFile = { id: "../../file.glb", name: "file.glb", kind: "model" };
  assert.throws(() => validatePlatform(record, ids));
});
