import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, Group, Mesh, Object3D, Raycaster, Vector3 } from "three";
import { applyGizmo, objectCenter, pickSceneObject, positionGizmo } from "../light-study/object-gizmo.js";

test("scene picking finds the closest visible object through nested meshes", () => {
  const gameBox = new Group();
  const console = new Group();
  const shell = new Mesh(new BoxGeometry(2, 2, 2));
  const cover = new Mesh(new BoxGeometry(2, 2, 2));
  gameBox.add(cover);
  console.add(shell);
  console.position.z = -3;
  const objects = { console, gameBox };
  const ray = new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
  assert.equal(pickSceneObject(ray, objects), "gameBox");
  cover.visible = false;
  assert.equal(pickSceneObject(ray, objects), "console");
  console.visible = false;
  assert.equal(pickSceneObject(ray, objects), "");
});

test("the gizmo centres on the visible model and transforms it around that centre", () => {
  const parent = new Group();
  parent.position.set(2, 4, -6);
  parent.rotation.y = 0.3;
  const model = new Group();
  const gizmo = new Object3D();
  parent.add(model, gizmo);
  model.position.set(-12.5, 0, -18);
  model.rotation.y = 0.7;
  model.scale.set(1, 2, 3);
  const body = new Mesh(new BoxGeometry(6, 10, 2));
  body.position.set(0, 5, 0);
  const hiddenMesh = new Mesh(new BoxGeometry(5, 5, 5));
  hiddenMesh.position.x = 50;
  hiddenMesh.visible = false;
  model.add(body, hiddenMesh);

  const center = objectCenter(model, new Vector3());
  assert.ok(center.distanceTo(new Vector3(0, 5, 0)) < 1e-9);
  const savedPosition = model.position.clone();
  positionGizmo(gizmo, model, center);
  assert.deepEqual(model.position, savedPosition);
  assert.ok(gizmo.getWorldPosition(new Vector3()).distanceTo(body.getWorldPosition(new Vector3())) < 1e-9);

  gizmo.position.x += 6;
  applyGizmo(gizmo, model, center);
  assert.ok(model.position.distanceTo(savedPosition.add(new Vector3(6, 0, 0))) < 1e-9);
  const movedCenter = body.getWorldPosition(new Vector3());
  gizmo.rotateZ(0.9);
  gizmo.scale.multiplyScalar(1.5);
  applyGizmo(gizmo, model, center);
  assert.ok(body.getWorldPosition(new Vector3()).distanceTo(movedCenter) < 1e-9);
});
