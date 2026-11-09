import { test } from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import { consoleFocusScale, frameCarousel } from "../src/framing.js";
import { DEFAULT_ORBIT, orbitPosition } from "../src/orbit.js";

test("desktop selection is a close-up anchored on the left", () => {
  const camera = new PerspectiveCamera(36, 1, 0.1, 100);
  frameCarousel(camera, 1440, 634);
  const selected = orbitPosition(0, DEFAULT_ORBIT);
  const centre = selected.clone().project(camera);
  assert.ok(Math.abs((centre.x + 1) / 2 - 0.3) < 1e-10);
  assert.ok(Math.abs(centre.y) < 0.25);
  const halfWidth = 1.55 * consoleFocusScale(0);
  const left = selected
    .clone()
    .add(new Vector3(-halfWidth, 0, 0))
    .project(camera);
  const right = selected
    .clone()
    .add(new Vector3(halfWidth, 0, 0))
    .project(camera);
  const screenWidth = (right.x - left.x) / 2;
  assert.ok(screenWidth > 0.35 && screenWidth < 0.5);
  const next = orbitPosition((Math.PI * 2) / 7, DEFAULT_ORBIT).project(camera);
  assert.ok(next.x > 0 && next.x < 1);
});

test("focus enlargement follows the foreground slot smoothly around the ring", () => {
  assert.equal(consoleFocusScale(0), 1.5);
  assert.equal(consoleFocusScale(Math.PI), 1);
  assert.ok(consoleFocusScale((Math.PI * 2) / 7) < 1.02);
  assert.ok(Math.abs(consoleFocusScale(Math.PI * 2) - 1.5) < 1e-10);
  assert.ok(Math.abs(consoleFocusScale(0.4) - consoleFocusScale(-0.4)) < 1e-10);
  assert.ok(consoleFocusScale(0.4) > consoleFocusScale(0.5));
});

test("narrow layout clears the desktop offset and resize restores it", () => {
  const camera = new PerspectiveCamera(36, 1, 0.1, 100);
  frameCarousel(camera, 1440, 634);
  frameCarousel(camera, 640, 500);
  assert.equal(camera.view.enabled, false);
  assert.ok(
    Math.abs(orbitPosition(0, DEFAULT_ORBIT).project(camera).x) < 1e-10,
  );
  frameCarousel(camera, 1440, 634);
  assert.equal(camera.view.enabled, true);
  assert.ok(
    Math.abs(orbitPosition(0, DEFAULT_ORBIT).project(camera).x + 0.4) < 1e-10,
  );
});
