import { Box3, CatmullRomCurve3, CurvePath, LineCurve3, QuadraticBezierCurve3, Vector3 } from 'three';

function obstacles(objects) {
  const meshBounds = new Box3();
  return objects.flatMap(object => {
    const bounds = new Box3();
    object.traverseVisible(mesh => {
      if (!mesh.isMesh || !mesh.geometry) return;
      const geometry = mesh.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      bounds.union(meshBounds.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
    });
    return bounds.isEmpty() ? [] : [{ object, bounds }];
  });
}

function clears(curve, boxes, radiusAt, floor = -Infinity, escapeStart = false) {
  const point = new Vector3();
  const steps = Math.max(12, Math.ceil(curve.getLength() / .15));
  const leaving = new Set();
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    curve.getPointAt(progress, point);
    const radius = radiusAt(point, progress) + .08;
    if (point.y - radius < floor) return false;
    for (const box of boxes) {
      if (box.bounds.distanceToPoint(point) >= radius) leaving.delete(box);
      else if (escapeStart && i === 0) leaving.add(box);
      else if (!leaving.has(box)) return false;
    }
  }
  return leaving.size === 0;
}

export function planTotemForegroundPass(points, objects, radiusAt) {
  const boxes = obstacles(objects);
  const path = new CurvePath();
  for (let i = 1; i < points.length; i++) {
    const segment = new LineCurve3(points[i - 1], points[i]);
    // A visible hover or a real perch can already overlap the conservative
    // collision sphere. Allow leaving that overlap, never entering another.
    const arrival = i === 3;
    const check = arrival ? new LineCurve3(points[i], points[i - 1]) : segment;
    if (!clears(check, boxes, radiusAt, -Infinity, i === 1 || arrival)) return null;
    path.add(segment);
  }
  return path;
}

export function planTotemHop(start, destination, objects, support, radiusAt) {
  const boxes = obstacles(objects);
  const source = boxes.find(({ object }) => object === support);
  if (!source) return null;
  const lift = start.clone();
  lift.y = Math.max(start.y + .4, source.bounds.max.y + radiusAt(start, 0) + .25);
  const takeoff = new LineCurve3(start.clone(), lift);
  const crest = lift.clone().lerp(destination, .5);
  crest.y = Math.max(lift.y, destination.y) + .9;
  const arc = new QuadraticBezierCurve3(lift, crest, destination);
  const liftShare = takeoff.getLength() / (takeoff.getLength() + arc.getLength());
  if (!clears(takeoff, boxes.filter(box => box !== source), (point, t) => radiusAt(point, t * liftShare))) return null;
  if (!clears(arc, boxes, (point, t) => radiusAt(point, liftShare + t * (1 - liftShare)))) return null;
  const path = new CurvePath();
  path.add(takeoff);
  path.add(arc);
  return path;
}

export function planTotemCorkscrew(start, objects, floor, radiusAt) {
  const boxes = obstacles(objects);
  const devices = boxes.filter(({ object }) => object.userData.platformId && Number.isFinite(object.userData.orbitAngle));
  if (devices.length < 2) return null;
  const ring = new Box3();
  for (const { bounds } of devices) ring.union(bounds);
  const center = ring.getCenter(new Vector3()), size = ring.getSize(new Vector3());
  const clearance = radiusAt(center) + .25;
  const over = ring.max.y + clearance;
  const under = Math.max(floor + clearance, ring.min.y - clearance);
  const phase = Math.atan2((start.z - center.z) / size.z, (start.x - center.x) / size.x);
  for (const [width, depth] of [[.64, .46], [.79, .46], [.79, .74]]) {
    for (const underside of [1, -1]) {
      const lowSide = devices.filter(({ bounds }) => (underside > 0 ? bounds.max.z >= center.z : bounds.min.z <= center.z));
      const low = Math.max(under, Math.min(...lowSide.map(({ bounds }) => bounds.min.y)) - clearance);
      for (const offset of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI]) {
        const points = Array.from({ length: 32 }, (_, index) => {
          const angle = phase + offset + 2 * Math.PI * index / 32;
          const sine = Math.sin(angle);
          const height = Math.max(0, Math.min(1, .5 - sine * underside * 1.2));
          return new Vector3(center.x + Math.cos(angle) * size.x * width,
            low + height * (over - low), center.z + sine * size.z * depth);
        });
        const loop = new CatmullRomCurve3(points, true);
        if (!clears(loop, boxes, radiusAt, floor)) continue;
        const entry = [start.clone(), points[0]];
        if (!clears(new LineCurve3(...entry), boxes, radiusAt, floor)) {
          // Enter from above if a foreground model cuts across the direct approach.
          const crest = Math.max(over + clearance, start.y, points[0].y);
          entry.splice(1, 0, new Vector3(start.x, crest, start.z), new Vector3(points[0].x, crest, points[0].z));
        }
        const segments = entry.slice(1).map((point, index) => new LineCurve3(entry[index], point));
        if (!segments.every(segment => clears(segment, boxes, radiusAt, floor))) continue;
        const path = new CurvePath();
        for (const segment of segments) path.add(segment);
        path.add(loop);
        for (let index = entry.length - 1; index > 0; index--) path.add(new LineCurve3(entry[index], entry[index - 1]));
        return path;
      }
    }
  }
  return null;
}
