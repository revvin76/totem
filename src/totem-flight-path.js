import { Box3, Matrix4, Plane, Ray, Vector3 } from 'three';
import { CHOOSER_LEFT_EDGE, sceneObjects } from './totem-perches.js';

const CELL = .08;
const MIN_X = -1.76, MIN_Y = -1.76;
const COLUMNS = 45, ROWS = 45;
const POINTS = Array.from({ length: COLUMNS * ROWS }, (_, index) => [
  MIN_X + (index % COLUMNS) * CELL, MIN_Y + Math.floor(index / COLUMNS) * CELL,
]);
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const onScreen = ([x, y]) => Math.abs(x) <= 1 && Math.abs(y) <= 1;

function intersects(a, b, bounds, padX, padY) {
  let enter = 0, exit = 1;
  for (let axis = 0; axis < 2; axis++) {
    const delta = b[axis] - a[axis];
    const padding = axis === 0 ? padX : padY;
    const min = bounds[axis] - padding, max = bounds[axis + 2] + padding;
    if (delta === 0) {
      if (a[axis] < min || a[axis] > max) return false;
      continue;
    }
    const first = (min - a[axis]) / delta, last = (max - a[axis]) / delta;
    enter = Math.max(enter, Math.min(first, last));
    exit = Math.min(exit, Math.max(first, last));
    if (enter > exit) return false;
  }
  return true;
}

// Project only the current view's obstacles. The mascot shares its content
// group for reflections but is excluded from obstacle and perch queries.
export function createTotemFlightPlanner() {
  const rectangles = [];
  const rectangleDepths = [];
  const devices = [];
  const collisionMeshes = [];
  const transforms = new WeakMap();
  const worldBounds = new Box3(), sweptBounds = new Box3(), localBounds = new Box3();
  const before = new Matrix4(), after = new Matrix4();
  const from = new Vector3(), to = new Vector3(), localPadding = new Vector3();
  const ray = new Ray(), hit = new Vector3();
  const panelPlanes = Array.from({ length: 5 }, () => new Plane());
  let panelBounds, panelCamera;
  let frame = 0;
  const projectionView = new Matrix4(), transform = new Matrix4();
  const parent = new Int16Array(POINTS.length), queue = new Int16Array(POINTS.length);
  let focalX, focalY, offsetX, offsetY, radius, cameraDistance, footprint = 1;
  let laneLimit = Infinity;

  function refresh(camera, content, mascotRadius, mascotDistance) {
    rectangles.length = 0;
    rectangleDepths.length = 0;
    devices.length = 0;
    collisionMeshes.length = 0;
    frame++;
    const projection = camera.projectionMatrix.elements;
    focalX = projection[0]; focalY = projection[5];
    offsetX = projection[8]; offsetY = projection[9];
    radius = mascotRadius; cameraDistance = mascotDistance;
    if (!content?.visible) return;
    projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    for (const object of sceneObjects(content)) {
      const isDevice = object.userData.platformId && Number.isFinite(object.userData.orbitAngle);
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      let nearestDepth = Infinity;
      object.traverseVisible(mesh => {
        if (!mesh.isMesh || !mesh.geometry || !mesh.layers.test(camera.layers)) return;
        const geometry = mesh.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        if (!box || box.isEmpty()) return;
        if (isDevice && mesh.material?.visible !== false) {
          let entry = transforms.get(mesh);
          if (!entry) {
            entry = { mesh, current: new Matrix4(), previous: new Matrix4(), frame: -1 };
            transforms.set(mesh, entry);
          }
          entry.previous.copy(entry.frame === frame - 1 ? entry.current : mesh.matrixWorld);
          entry.current.copy(mesh.matrixWorld);
          entry.frame = frame;
          collisionMeshes.push(entry);
        }
        const m = transform.multiplyMatrices(projectionView, mesh.matrixWorld).elements;
        let nearest = Infinity, farthest = -Infinity;
        let left = Infinity, bottom = Infinity, right = -Infinity, top = -Infinity;
        for (let corner = 0; corner < 8; corner++) {
          const x = corner & 1 ? box.max.x : box.min.x;
          const y = corner & 2 ? box.max.y : box.min.y;
          const z = corner & 4 ? box.max.z : box.min.z;
          const w = m[3] * x + m[7] * y + m[11] * z + m[15];
          nearest = Math.min(nearest, w); farthest = Math.max(farthest, w);
          if (w <= camera.near) continue;
          const sx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
          const sy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
          left = Math.min(left, sx); bottom = Math.min(bottom, sy);
          right = Math.max(right, sx); top = Math.max(top, sy);
        }
        if (farthest <= camera.near || nearest > camera.far) return;
        nearestDepth = Math.min(nearestDepth, nearest);
        if (nearest <= camera.near) { left = bottom = -1; right = top = 1; }
        bounds[0] = Math.min(bounds[0], left); bounds[1] = Math.min(bounds[1], bottom);
        bounds[2] = Math.max(bounds[2], right); bounds[3] = Math.max(bounds[3], top);
      });
      if (bounds[0] > 1 || bounds[1] > 1 || bounds[2] < -1 || bounds[3] < -1) continue;
      const visibleBounds = [
        Math.max(-1, bounds[0]), Math.max(-1, bounds[1]),
        Math.min(1, bounds[2]), Math.min(1, bounds[3]),
      ];
      rectangles.push(visibleBounds);
      rectangleDepths.push(nearestDepth);
      if (isDevice) {
        const world = object.matrixWorld.elements, view = camera.matrixWorldInverse.elements;
        const depth = -(view[2] * world[12] + view[6] * world[13] + view[10] * world[14] + view[14]);
        if (depth > camera.near) devices.push({ object, bounds: visibleBounds, depth });
      }
    }
  }

  function setLane(depth) {
    // Near-camera flight only needs to avoid objects that reach that lane.
    // Allow for the mascot's larger world scale on the outermost viewport rays.
    const edgeRay = Math.hypot(1, (1.76 + Math.abs(offsetX)) / focalX, (1.76 + Math.abs(offsetY)) / focalY);
    laneLimit = depth ? depth * (1 + radius * edgeRay / cameraDistance) + .08 : Infinity;
  }

  function hitsConsole(start, end, radius, support, currentOnly = false) {
    sweptBounds.setFromPoints([start, end]).expandByScalar(radius);
    for (const { mesh, current, previous: last } of collisionMeshes) {
      // A perch deliberately touches its supporting surface.
      if (mesh === support) continue;
      const previous = currentOnly ? current : last;
      const box = mesh.geometry.boundingBox;
      worldBounds.copy(box).applyMatrix4(current);
      localBounds.copy(box).applyMatrix4(previous);
      if (!worldBounds.union(localBounds).intersectsBox(sweptBounds)) continue;
      if (!current.determinant() || !previous.determinant()) continue;
      before.copy(previous).invert();
      after.copy(current).invert();
      from.copy(start).applyMatrix4(before);
      to.copy(end).applyMatrix4(after);
      // Sweep in mesh space so a console can hit a stationary mascot even
      // when both endpoints are clear. Account for nonuniform model scale.
      const a = before.elements, b = after.elements;
      for (let axis = 0; axis < 3; axis++) {
        localPadding.setComponent(axis, radius * Math.max(
          Math.hypot(a[axis], a[axis + 4], a[axis + 8]),
          Math.hypot(b[axis], b[axis + 4], b[axis + 8]),
        ));
      }
      localBounds.copy(box).expandByVector(localPadding);
      if (localBounds.containsPoint(from) || localBounds.containsPoint(to)) return true;
      const length = ray.direction.subVectors(to, from).length();
      if (!length) continue;
      ray.origin.copy(from);
      ray.direction.multiplyScalar(1 / length);
      if (ray.intersectBox(localBounds, hit) && hit.distanceToSquared(from) <= length ** 2) return true;
    }
    return false;
  }

  function setPanel(camera, bounds, depth) {
    panelBounds = bounds;
    panelCamera = camera;
    if (!bounds) return;
    const [left, bottom, right, top] = bounds;
    const [x, y] = [camera.projectionMatrix.elements[8], camera.projectionMatrix.elements[9]];
    // The panel also occludes everything behind its outline. Sweep against
    // that camera-space volume so a stop behind the panel counts as blocked.
    panelPlanes[0].normal.set(1, 0, (left + x) / focalX).normalize();
    panelPlanes[1].normal.set(-1, 0, -(right + x) / focalX).normalize();
    panelPlanes[2].normal.set(0, 1, (bottom + y) / focalY).normalize();
    panelPlanes[3].normal.set(0, -1, -(top + y) / focalY).normalize();
    panelPlanes[4].normal.set(0, 0, -1);
    panelPlanes[4].constant = -depth + .04;
  }

  function hitsPanel(start, end, radius) {
    if (!panelBounds) return false;
    from.copy(start).applyMatrix4(panelCamera.matrixWorldInverse);
    to.copy(end).applyMatrix4(panelCamera.matrixWorldInverse);
    let enter = 0, exit = 1;
    for (const plane of panelPlanes) {
      const a = plane.distanceToPoint(from) + radius;
      const b = plane.distanceToPoint(to) + radius;
      if (a < 0 && b < 0) return false;
      if (a < 0) enter = Math.max(enter, a / (a - b));
      else if (b < 0) exit = Math.min(exit, a / (a - b));
      if (enter > exit) return false;
    }
    return true;
  }

  function nearestObject(point) {
    let best = Infinity, target = null;
    for (const bounds of rectangles) {
      const [left, bottom, right, top] = bounds;
      const gap = Math.hypot(point[0] - Math.max(left, Math.min(right, point[0])), point[1] - Math.max(bottom, Math.min(top, point[1])));
      if (gap < best) { best = gap; target = bounds; }
    }
    return target && (devices.find(device => device.bounds === target) ?? { bounds: target });
  }

  function padding(a, b, multiplier) {
    // Bound the mascot's projected sphere along this entire segment. Use the
    // outermost endpoint rays, including the carousel's off-axis projection.
    const edgeX = Math.max(Math.abs(a[0] + offsetX), Math.abs(b[0] + offsetX)) / focalX;
    const edgeY = Math.max(Math.abs(a[1] + offsetY), Math.abs(b[1] + offsetY)) / focalY;
    const depth = cameraDistance / Math.hypot(1, edgeX, edgeY);
    const bodyRadius = radius * multiplier;
    const denominator = depth ** 2 - bodyRadius ** 2;
    if (denominator <= 0) return [Infinity, Infinity];
    const padX = focalX * bodyRadius * (depth * Math.hypot(1, edgeX) + edgeX * bodyRadius) / denominator + .012;
    const padY = focalY * bodyRadius * (depth * Math.hypot(1, edgeY) + edgeY * bodyRadius) / denominator + .012;
    return [padX, padY];
  }

  function clear(a, b = a, escaping = false, multiplier = footprint) {
    if (!rectangles.length && !panelBounds) return true;
    const [padX, padY] = padding(a, b, multiplier);
    if (!Number.isFinite(padX)) return false;
    const [startPadX, startPadY] = escaping ? padding(a, a, multiplier) : [0, 0];
    const blocked = bounds => intersects(a, b, bounds, padX, padY)
      && (!escaping || !intersects(a, a, bounds, startPadX, startPadY));
    return !(panelBounds && blocked(panelBounds)) &&
      !rectangles.some((bounds, index) => rectangleDepths[index] <= laneLimit && blocked(bounds));
  }

  function safeRest(point, multiplier = footprint) {
    const [padX, padY] = padding(point, point, multiplier);
    // Five percent of the viewport on each edge, plus the articulated body.
    return Math.abs(point[0]) + padX <= .90 && Math.abs(point[1]) + padY <= .90;
  }

  function clearsPanel(point, multiplier = footprint) {
    if (!panelBounds) return true;
    const [padX, padY] = padding(point, point, multiplier);
    return Number.isFinite(padX) && !intersects(point, point, panelBounds, padX, padY);
  }

  function fitRest(point) {
    let fitted = point;
    while (!safeRest(fitted) && distance(fitted, [0, 0]) > .001) fitted = fitted.map(value => value * .94);
    return fitted;
  }

  function nearestRest(start, chooser, multiplier = footprint, accept = () => true) {
    let nearest = Infinity, destination = null;
    for (const candidate of POINTS) {
      if (!safeRest(candidate, multiplier) || (chooser && candidate[0] < CHOOSER_LEFT_EDGE)) continue;
      const gap = distance(start, candidate);
      if (gap >= nearest || !clear(candidate, candidate, false, multiplier) || !accept(candidate, gap)) continue;
      nearest = gap;
      destination = candidate;
    }
    return destination;
  }

  function escape(start, chooser, multiplier = footprint, minimumGap = 0) {
    return nearestRest(start, chooser, multiplier, (candidate, gap) => gap >= minimumGap && clear(start, candidate, true, multiplier));
  }

  function route(start, destination, chooser) {
    const allowed = point => !chooser || point[0] >= CHOOSER_LEFT_EDGE;
    if (!clear(start)) return null;
    if (clear(start, destination)) return [start, destination];

    let nearest = Infinity, first = -1;
    for (let index = 0; index < POINTS.length; index++) {
      const point = POINTS[index], gap = distance(start, point);
      if (gap >= nearest || !allowed(point) || !clear(start, point)) continue;
      nearest = gap;
      first = index;
    }
    if (first === -1) return null;

    // Four-neighbour search never cuts corners. Each shortcut below must also
    // clear the continuous segment, not just its sampled grid points.
    parent.fill(-2);
    parent[first] = -1;
    queue[0] = first;
    let tail = 1, goal = -1, bestGap = Infinity, exact = false;
    for (let head = 0; head < tail; head++) {
      const index = queue[head], point = POINTS[index], column = index % COLUMNS;
      if (clear(point, destination)) { goal = index; exact = true; break; }
      const gap = distance(point, destination);
      if (gap < bestGap && safeRest(point)) { goal = index; bestGap = gap; }
      const neighbours = [column > 0 ? index - 1 : -1, column < COLUMNS - 1 ? index + 1 : -1, index - COLUMNS, index + COLUMNS];
      for (const next of neighbours) {
        if (parent[next] !== -2 || !allowed(POINTS[next]) || !clear(point, POINTS[next])) continue;
        parent[next] = index;
        queue[tail++] = next;
      }
    }
    if (goal === -1) return null;
    const path = exact ? [destination] : [];
    for (let index = goal; index >= 0; index = parent[index]) path.push(POINTS[index]);
    path.push(start);
    path.reverse();
    const smoothed = [start];
    for (let from = 0; from < path.length - 1;) {
      let to = path.length - 1;
      while (to > from + 1 && !clear(path[from], path[to])) to--;
      smoothed.push(path[to]);
      from = to;
    }
    return smoothed;
  }

  return { refresh, clear, route, escape, nearestRest, safeRest, fitRest, nearestObject, clearsPanel,
    hitsConsole, setPanel, hitsPanel, setLane, devices, setFootprint(value) { footprint = value; } };
}
