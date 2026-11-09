import { Box3, MathUtils, Matrix3, Quaternion, Raycaster, Vector3 } from 'three';

export function sceneObjects(content) {
  return content.children.flatMap(object => {
    if (!object.visible || object.isTransformControlsRoot || object.userData.isTotemMascot) return [];
    return object.name === 'Studio support objects' ? object.children.filter(child => child.visible) : [object];
  });
}

const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
const perchYaw = new Quaternion();
export const CHOOSER_LEFT_EDGE = -.38;

export function polePerchPose(pole, fit, position, rotation, across = new Vector3()) {
  const { anchor, width, mascotScale = 1, mascotYaw = 0 } = pole.userData.totemRest;
  pole.localToWorld(position.fromArray(anchor));
  pole.getWorldQuaternion(rotation);
  if (mascotYaw) rotation.multiply(perchYaw.setFromAxisAngle(UP, MathUtils.degToRad(mascotYaw)));
  const scale = across.setFromMatrixColumn(pole.matrixWorld, 0).length() * width * mascotScale / fit.bodyWidth;
  position.add(across.set(0, fit.baseOffset * scale, 0).applyQuaternion(rotation));
  return scale;
}

export function polePerchVisible({ x, y, z }, chooser) {
  // The pole has an authored position and width. Keep its anchor in frame
  // even when the camera-facing flight clearance would reject that spot.
  return Math.abs(x) < .95 && Math.abs(y) < .95 && Math.abs(z) < 1 && (!chooser || x >= CHOOSER_LEFT_EDGE);
}

export function findTotemPerch(content, camera, scaleAt, clear, random, {
  device, chooser = !device, safeRest = () => true, poleFit,
} = {}) {
  if (!content?.visible) return null;
  const bounds = new Box3(), normal = new Vector3(), normalMatrix = new Matrix3();
  const ray = new Raycaster(), origin = new Vector3(), screen = new Vector3();
  const groups = [];
  for (const object of sceneObjects(content)) {
    const meshes = [];
    bounds.makeEmpty();
    object.traverseVisible(mesh => {
      if (!mesh.isMesh || !mesh.geometry || mesh.material?.visible === false || !mesh.layers.test(camera.layers)) return;
      meshes.push(mesh);
      bounds.expandByObject(mesh);
    });
    if (meshes.length && !bounds.isEmpty()) groups.push({ object, meshes, bounds: bounds.clone() });
  }
  const meshes = groups.flatMap(group => group.meshes);
  if (!meshes.length) return null;
  const ceiling = Math.max(...groups.map(group => group.bounds.max.y)) + 1;
  function top(x, z) {
    ray.set(origin.set(x, ceiling, z), DOWN);
    return ray.intersectObjects(meshes, false)[0];
  }
  // Draw without replacement so a randomly picked object with no safe surface
  // cannot prevent another object from being tried.
  const choices = device ? groups.filter(group => group.object === device) : groups;
  while (choices.length) {
    const [{ object, meshes: candidates, bounds: box }] = choices.splice(Math.floor(random() * choices.length), 1);
    if (object.userData.totemRest && poleFit) {
      const perch = { mesh: object, pole: object, fit: poleFit };
      const landing = new Vector3(), rotation = camera.quaternion.clone();
      polePerchPose(object, poleFit, landing, rotation);
      screen.copy(landing).project(camera);
      if (!polePerchVisible(screen, chooser)) continue;
      for (const lift of [.8, 1.4, 2.4, 3.6, 5.2]) {
        const above = landing.clone().addScaledVector(UP, lift * scaleAt(landing));
        screen.copy(above).project(camera);
        const goal = [screen.x, screen.y];
        if (Math.abs(screen.z) < 1 && clear(goal)) return { ...perch, above, goal };
      }
      continue;
    }
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = box.min.x + (box.max.x - box.min.x) * (device && attempt === 0 ? .5 : .12 + random() * .76);
      const z = box.min.z + (box.max.z - box.min.z) * (device && attempt === 0 ? .5 : .12 + random() * .76);
      const hit = top(x, z);
      if (!hit?.face || !candidates.includes(hit.object)) continue;
      normal.copy(hit.face.normal).applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
      if (normal.y < .82) continue;
      const scale = scaleAt(hit.point);
      const landing = hit.point.clone().addScaledVector(UP, .32 * scale);
      screen.copy(landing).project(camera);
      if ((chooser && screen.x < CHOOSER_LEFT_EDGE) || Math.abs(screen.z) >= 1 || !safeRest([screen.x, screen.y])) continue;
      // Check the feet and the wing span for raised details and nearby objects.
      const offsets = [[-.13, 0], [.13, 0], [0, -.12], [0, .12], [-.48, 0], [.48, 0]];
      if (offsets.some(([dx, dz], index) => {
        const nearby = top(x + dx * scale, z + dz * scale);
        if (index < 4 && (!nearby || !candidates.includes(nearby.object) || nearby.point.y < hit.point.y - .10 * scale)) return true;
        return nearby && nearby.point.y > hit.point.y + (index < 4 ? .09 : .24) * scale;
      })) continue;
      for (const height of [1.4, 2.4, 3.6, 5.2]) {
        const above = landing.clone().addScaledVector(UP, height * scale);
        screen.copy(above).project(camera);
        const goal = [screen.x, screen.y];
        if (Math.abs(screen.z) >= 1 || !clear(goal)) continue;
        return { mesh: hit.object, anchor: hit.object.worldToLocal(hit.point.clone()),
          normal: hit.face.normal.clone(), above, goal };
      }
    }
  }
  return null;
}
