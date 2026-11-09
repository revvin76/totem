import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { frameCarousel, consoleFocusScale } from "../src/framing.js";
import { orbitPosition, orbitOrientation } from "../src/orbit.js";
import { liftGameFromOrbit } from "../src/game-framing.js";

const orbit = { zoom: 0.78, pitch: -12, yaw: 7, roll: -4, rotation: 0, panX: 0, panY: 0.4, panZ: -1 };
function pose(camera, angle, count, lift = true, inspection = 0) {
  const position = orbitPosition(angle, orbit, new Vector3(), camera.quaternion);
  const rotation = orbitOrientation(angle, camera.quaternion);
  rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), inspection));
  const scale = lift ? liftGameFromOrbit(position, camera, angle, count) : consoleFocusScale(angle, count);
  return new Matrix4().compose(position, rotation, new Vector3(scale, scale, scale));
}
function corners(matrix, camera) {
  // Covers the normalized wide SNES box and tall Xbox case, including thickness.
  const result = [];
  for (const x of [-1.65, 1.65]) for (const y of [-1.65, 1.65]) for (const z of [-0.3, 0.3]) {
    result.push(new Vector3(x, y, z).applyMatrix4(matrix).applyMatrix4(camera.matrixWorldInverse));
  }
  return result;
}

test("selected game geometry stays ahead of all other cases, including during a back inspection", () => {
  for (const [width, height] of [[1920, 820], [1440, 720], [640, 500]]) {
    const camera = new PerspectiveCamera(36, 1, 0.1, 100); frameCarousel(camera, width, height);
    // This fixture reproduces the original overlapping camera-space depths.
    const before = corners(pose(camera, 0, 17, false), camera).map(p => p.z);
    const neighbour = corners(pose(camera, -2 * Math.PI / 17, 17, false), camera).map(p => p.z);
    if (width > 650) assert.ok(Math.max(...neighbour) > Math.min(...before));
    for (const count of [1, 2, 3, 7, 17, 40]) {
      const others = [];
      for (let i = 1; i < count; i++) others.push(...corners(pose(camera, i * 2 * Math.PI / count, count), camera).map(p => p.z));
      for (const inspection of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
        const selected = corners(pose(camera, 0, count, true, inspection), camera).map(p => p.z);
        assert.ok(Math.min(...selected) > Math.max(...others), `Foreground clearance: ${width}px, ${count} cases, turn ${inspection}`);
        assert.ok(Math.max(...selected) < -camera.near);
      }
    }
  }
});

test("lifting a game preserves its projected framing and changes depth smoothly", () => {
  const camera = new PerspectiveCamera(36, 1, 0.1, 100); frameCarousel(camera, 1440, 720);
  for (const angle of [0, 0.05, -0.05, 0.3, Math.PI, Math.PI * 2]) {
    const before = pose(camera, angle, 17, false), after = pose(camera, angle, 17);
    for (const point of [new Vector3(), new Vector3(1.2, 1.65, 0), new Vector3(-1.2, -1.65, 0)]) {
      const a = point.clone().applyMatrix4(before).project(camera), b = point.clone().applyMatrix4(after).project(camera);
      assert.ok(Math.abs(a.x - b.x) < 1e-10 && Math.abs(a.y - b.y) < 1e-10);
    }
  }
  const at = angle => new Vector3().setFromMatrixPosition(pose(camera, angle, 17));
  assert.ok(at(0).distanceTo(at(0.00001)) < 0.001);
  assert.ok(at(0).distanceTo(at(2 * Math.PI)) < 1e-10);
});
