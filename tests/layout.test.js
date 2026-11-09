import { test } from "node:test";
import assert from "node:assert/strict";
import { Euler, Object3D, Quaternion, Vector3 } from "three";
import {
  applyConsoleControls,
  defaultLayout,
  makeLayoutSnapshot,
  parseLayoutSnapshot,
  validateLayout,
} from "../src/layout.js";
import { orbitOrientation, orbitPosition } from "../src/orbit.js";

test("layout snapshots round-trip every control and own their values", () => {
  const layout = defaultLayout();
  Object.assign(layout.orbit, {
    zoom: 1.4,
    panX: 2,
    panY: -1,
    panZ: -3,
    pitch: 25,
    yaw: -50,
    roll: 120,
    rotation: 65,
  });
  Object.assign(layout.consoles, {
    zoom: 0.75,
    panX: -2,
    panY: 3,
    panZ: 1,
    pitch: 15,
    yaw: 30,
    roll: -20,
  });
  const snapshot = makeLayoutSnapshot(layout, "gamecube", {
    viewport: { width: 1440, height: 634 },
  });
  const restored = parseLayoutSnapshot(JSON.stringify(snapshot), [
    "playstation",
    "gamecube",
  ]);
  assert.deepEqual(restored.layout, layout);
  assert.deepEqual(restored.view.viewport, { width: 1440, height: 634 });
  layout.orbit.panX = 0;
  assert.equal(snapshot.layout.orbit.panX, 2);
  assert.equal(defaultLayout().orbit.panX, 0);
});

test("invalid or incomplete imports are rejected without changing the draft", () => {
  const draft = defaultLayout();
  const before = structuredClone(draft);
  for (const mutate of [
    (value) => {
      value.layout.orbit.zoom = 10;
    },
    (value) => {
      value.layout.consoles.pitch = "90";
    },
    (value) => {
      delete value.layout.orbit.panZ;
    },
    (value) => {
      value.layout.consoles.extra = 0;
    },
    (value) => {
      value.selectedPlatform = "unknown";
    },
    (value) => {
      value.schemaVersion = 4;
    },
    (value) => {
      value.layout.orbit.panX = 0.12345;
    },
  ]) {
    const invalid = makeLayoutSnapshot(draft, "playstation");
    mutate(invalid);
    assert.throws(() =>
      parseLayoutSnapshot(JSON.stringify(invalid), ["playstation"]),
    );
    assert.deepEqual(draft, before);
  }
  const invalid = defaultLayout();
  invalid.orbit.zoom = NaN;
  assert.throws(() => validateLayout(invalid));
});

test("orbit zoom changes spacing while preserving the foreground anchor", () => {
  const layout = defaultLayout();
  const anchor = orbitPosition(0, layout.orbit);
  const side = orbitPosition(Math.PI / 2, layout.orbit);
  layout.orbit.zoom = 2;
  assert.ok(orbitPosition(0, layout.orbit).distanceTo(anchor) < 1e-10);
  assert.ok(
    Math.abs(
      orbitPosition(Math.PI / 2, layout.orbit).distanceTo(anchor) -
        side.distanceTo(anchor) * 2,
    ) < 1e-10,
  );
});

test("orbit phase moves the resting slot and pan follows camera axes", () => {
  const layout = defaultLayout();
  Object.assign(layout.orbit, { pitch: 0, yaw: 0, roll: 0, rotation: 90 });
  const base = orbitPosition(0, layout.orbit);
  assert.ok(base.distanceTo(new Vector3(7.4, -2.3, 0)) < 1e-10);
  Object.assign(layout.orbit, { panX: 2, panY: -3, panZ: 1 });
  const camera = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));
  const moved = orbitPosition(0, layout.orbit, undefined, camera);
  assert.ok(moved.distanceTo(base.add(new Vector3(1, -3, -2))) < 1e-10);
});

test("console transforms change hardware without modifying its orbit path", () => {
  const layout = defaultLayout();
  const camera = new Quaternion().setFromEuler(new Euler(-0.3, 0.2, 0));
  const point = orbitPosition(0, layout.orbit);
  const model = new Object3D();
  model.position.copy(point);
  model.quaternion.copy(orbitOrientation(0, camera));
  applyConsoleControls(model, layout.consoles, camera, 1.5);
  assert.ok(model.position.distanceTo(point) < 1e-10);
  assert.ok(model.quaternion.angleTo(camera) < 1e-7);
  assert.equal(model.scale.x, 1.5);
  Object.assign(layout.consoles, {
    zoom: 2,
    panX: 3,
    panY: -2,
    panZ: 1,
    pitch: 90,
  });
  applyConsoleControls(model, layout.consoles, camera, 1.5);
  assert.ok(
    model.position.distanceTo(
      point.clone().add(new Vector3(3, -2, 1).applyQuaternion(camera)),
    ) < 1e-10,
  );
  assert.equal(model.scale.x, 3);
  assert.ok(
    new Vector3(0, 0, 1)
      .applyQuaternion(model.quaternion)
      .dot(new Vector3(0, -1, 0).applyQuaternion(camera)) >
      1 - 1e-10,
  );
  assert.ok(orbitPosition(0, layout.orbit).distanceTo(point) < 1e-10);
});
