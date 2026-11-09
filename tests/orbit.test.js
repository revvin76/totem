import { test } from "node:test";
import assert from "node:assert/strict";
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { frameCarousel } from "../src/framing.js";
import {
  DEFAULT_ORBIT,
  nearestSlot,
  orbitOrientation,
  orbitPosition,
  wrapIndex,
} from "../src/orbit.js";

test("devices stay upright while outward yaw follows the slot", () => {
  for (const cameraOrientation of [
    new Quaternion(),
    new Quaternion().setFromEuler(new Euler(-0.4, 0.15, 0.1)),
  ]) {
    const expectedUp = new Vector3(0, 1, 0).applyQuaternion(cameraOrientation);
    for (let i = 0; i < 28; i++) {
      const angle = (i * Math.PI) / 14;
      const orientation = orbitOrientation(angle, cameraOrientation);
      const front = new Vector3(0, 0, 1).applyQuaternion(orientation);
      const outward = new Vector3(
        Math.sin(angle) * 7.4,
        0,
        Math.cos(angle) * 5.4,
      )
        .normalize()
        .applyQuaternion(cameraOrientation);
      assert.ok(front.dot(outward) > 1 - 1e-10);
      const up = new Vector3(0, 1, 0).applyQuaternion(orientation);
      assert.ok(up.dot(expectedUp) > 1 - 1e-10);
      assert.ok(
        orientation.angleTo(
          orbitOrientation(angle + Math.PI * 2, cameraOrientation),
        ) < 1e-7,
      );
    }
    assert.ok(
      orbitOrientation(0, cameraOrientation).angleTo(cameraOrientation) < 1e-7,
    );
  }
});

test("selected front projects square-on regardless of orbit tilt or window framing", () => {
  for (const [width, height] of [
    [1440, 634],
    [640, 500],
  ]) {
    const camera = new PerspectiveCamera(36, 1, 0.1, 100);
    frameCarousel(camera, width, height);
    for (const settings of [DEFAULT_ORBIT, { pitch: 35, yaw: -35, roll: 30 }]) {
      const position = orbitPosition(0, settings);
      const orientation = orbitOrientation(0, camera.quaternion);
      const project = (x, y) =>
        new Vector3(x, y, 0)
          .applyQuaternion(orientation)
          .add(position)
          .project(camera);
      const bottomLeft = project(-1, -1),
        topLeft = project(-1, 1);
      const bottomRight = project(1, -1),
        topRight = project(1, 1);
      assert.ok(Math.abs(bottomLeft.x - topLeft.x) < 1e-10);
      assert.ok(Math.abs(bottomRight.x - topRight.x) < 1e-10);
      assert.ok(Math.abs(topLeft.y - topRight.y) < 1e-10);
      assert.ok(Math.abs(bottomLeft.y - bottomRight.y) < 1e-10);
    }
  }
});

test("the lower showcase position exposes both front and top faces", () => {
  for (const [width, height] of [
    [1440, 634],
    [640, 500],
  ]) {
    const camera = new PerspectiveCamera(36, 1, 0.1, 100);
    frameCarousel(camera, width, height);
    for (const settings of [DEFAULT_ORBIT, { pitch: 35, yaw: -35, roll: 30 }]) {
      const position = orbitPosition(0, settings);
      const orientation = orbitOrientation(0, camera.quaternion);
      const towardsCamera = camera.position.clone().sub(position).normalize();
      const front = new Vector3(0, 0, 1).applyQuaternion(orientation);
      const top = new Vector3(0, 1, 0).applyQuaternion(orientation);
      assert.ok(front.dot(towardsCamera) > 0.8);
      assert.ok(top.dot(towardsCamera) > 0.05);
    }
  }
});

test("tilting the orbit keeps the foreground selection anchored below the camera", () => {
  for (const settings of [
    DEFAULT_ORBIT,
    { pitch: 35, yaw: -35, roll: 30 },
    { pitch: 0, yaw: 0, roll: 0 },
  ]) {
    const p = orbitPosition(0, settings);
    assert.ok(Math.abs(p.x) < 1e-10);
    assert.ok(Math.abs(p.y + 2.3) < 1e-10);
  }
});
test("orbit closes with real depth and vertical travel", () => {
  const a = orbitPosition(0.75, DEFAULT_ORBIT),
    b = orbitPosition(0.75 + Math.PI * 2, DEFAULT_ORBIT);
  assert.ok(a.distanceTo(b) < 1e-10);
  const front = orbitPosition(0, DEFAULT_ORBIT),
    back = orbitPosition(Math.PI, DEFAULT_ORBIT);
  assert.ok(front.z - back.z > 9);
  assert.ok(Math.abs(front.y - back.y) > 1);
});
test("navigation wraps both ways and direct selection uses the shortest arc", () => {
  assert.equal(wrapIndex(-1, 7), 6);
  assert.equal(wrapIndex(7, 7), 0);
  assert.equal(nearestSlot(6, 0, 7), 7);
  assert.equal(nearestSlot(0, 6, 7), -1);
  assert.equal(nearestSlot(100, 3, 7), 101);
});
