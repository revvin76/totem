import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Object3D, PerspectiveCamera, Vector3 } from "three";
import startup from "../startup-layout.json" with { type: "json" };
import catalogue from "../platforms.json" with { type: "json" };
import {
  applyConsoleControls,
  applyDeviceControls,
  defaultLayout,
  makeLayoutSnapshot,
  neutralDeviceControls,
  parseLayoutSnapshot,
} from "../src/layout.js";
import { disposeImported, loadPlatformModel } from "../src/platform-assets.js";
import { frameCarousel } from "../src/framing.js";
import { orbitPosition, orbitOrientation } from "../src/orbit.js";
import { mockModelImages } from "./glb-fixture.js";

test("device transforms compose with the shared pose and leave other devices untouched", () => {
  const camera = new PerspectiveCamera().quaternion;
  const shared = defaultLayout().consoles;
  shared.zoom = 1.05;
  const a = new Object3D(),
    b = new Object3D();
  for (const model of [a, b]) applyConsoleControls(model, shared, camera, 1.5);
  const before = b.matrix.clone();
  applyDeviceControls(
    a,
    { ...neutralDeviceControls(), panY: -0.5, yaw: 15, zoom: 0.9 },
    camera,
  );
  assert.equal(a.position.y, -0.5);
  assert.ok(Math.abs(a.scale.x - 1.05 * 1.5 * 0.9) < 1e-10);
  assert.ok(a.quaternion.angleTo(camera) > 0.2);
  assert.deepEqual(b.matrix, before);
  assert.equal(b.position.y, 0);
  assert.equal(shared.zoom, 1.05);
});

test("v3 snapshots retain independent device overrides and reject malformed ones", () => {
  const ids = catalogue.map((p) => p.id);
  const saved = makeLayoutSnapshot(
    startup.layout,
    "wii",
    {},
    startup.enabledPlatformIds,
    startup.deviceOverrides,
  );
  const restored = parseLayoutSnapshot(JSON.stringify(saved), ids);
  assert.deepEqual(restored.deviceOverrides, startup.deviceOverrides);
  restored.deviceOverrides.wii.panY = 2;
  assert.equal(saved.deviceOverrides.wii.panY, -0.5);
  for (const override of [
    null,
    [],
    { unknown: neutralDeviceControls() },
    { wii: { panY: 0 } },
    { wii: { ...neutralDeviceControls(), zoom: 99 } },
  ]) {
    assert.throws(() =>
      parseLayoutSnapshot(
        JSON.stringify({ ...saved, deviceOverrides: override }),
        ids,
      ),
    );
  }
  for (const version of [1, 2]) {
    const legacy = { ...saved, schemaVersion: version };
    delete legacy.deviceOverrides;
    assert.deepEqual(
      parseLayoutSnapshot(JSON.stringify(legacy), ids).deviceOverrides,
      {},
    );
  }
});

test("the approved baseline preserves the saved shared settings and fits bundled upright devices", async (t) => {
  mockModelImages(t);
  assert.deepEqual(startup.layout, {
    orbit: {
      panX: 0,
      panY: 0.5,
      panZ: 0,
      pitch: -12,
      roll: 12,
      rotation: 2,
      yaw: 7,
      zoom: 1.7,
    },
    consoles: {
      panX: 0,
      panY: 0.8,
      panZ: 0,
      pitch: 22,
      roll: 0,
      yaw: 12,
      zoom: 1.05,
    },
  });
  const original = globalThis.document;
  globalThis.document = {
    createElement: () => ({ getContext: () => ({ fillText() {} }) }),
  };
  try {
    const camera = new PerspectiveCamera(36, 1, 0.1, 100);
    frameCarousel(camera, 1920, 743);
    for (const id of ["wii", "gameboy"]) {
      const platform = catalogue.find((record) => record.id === id);
      const model = await loadPlatformModel(platform, {
        readBundledModel: async (path) => new Uint8Array(await readFile(new URL(`../public/${path}`, import.meta.url))).buffer,
      });
      assert.equal(model.userData.modelLoadError, undefined, id);
      assert.equal(model.userData.imported, true, id);
      orbitPosition(0, startup.layout.orbit, model.position, camera.quaternion);
      orbitOrientation(0, camera.quaternion, model.quaternion);
      applyConsoleControls(
        model,
        startup.layout.consoles,
        camera.quaternion,
        1.5,
      );
      applyDeviceControls(
        model,
        startup.deviceOverrides[id],
        camera.quaternion,
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
    globalThis.document = original;
  }
});
