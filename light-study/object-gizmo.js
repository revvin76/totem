import { Box3, Matrix4 } from "three";

export function pickSceneObject(raycaster, objects) {
  const owners = new Map();
  for (const [name, root] of Object.entries(objects)) {
    if (!root) continue;
    root.updateWorldMatrix(true, true);
    root.traverseVisible(part => {
      if (part.isMesh) owners.set(part, name);
    });
  }
  const [hit] = raycaster.intersectObjects([...owners.keys()], false);
  return hit ? owners.get(hit.object) : "";
}

export function objectCenter(object, center) {
  object.updateWorldMatrix(true, true);
  const toLocal = object.matrixWorld.clone().invert();
  const bounds = new Box3();
  const meshBounds = new Box3();
  const meshTransform = new Matrix4();
  object.traverseVisible(mesh => {
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    meshTransform.multiplyMatrices(toLocal, mesh.matrixWorld);
    bounds.union(meshBounds.copy(mesh.geometry.boundingBox).applyMatrix4(meshTransform));
  });
  return bounds.getCenter(center);
}

export function positionGizmo(gizmo, object, center) {
  gizmo.quaternion.copy(object.quaternion);
  gizmo.scale.copy(object.scale);
  gizmo.position.copy(center).multiply(object.scale).applyQuaternion(object.quaternion).add(object.position);
}

export function applyGizmo(gizmo, object, center) {
  object.quaternion.copy(gizmo.quaternion);
  object.scale.copy(gizmo.scale);
  // Keep the centre stationary during rotation and scaling while retaining the
  // model origin used by the saved position controls.
  object.position.copy(center).multiply(object.scale).applyQuaternion(object.quaternion).negate().add(gizmo.position);
}
