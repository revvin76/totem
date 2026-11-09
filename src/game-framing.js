import { Vector3 } from "three";
import { consoleFocusScale } from "./framing.js";

const viewPosition = new Vector3();

// Pull the foreground case off the ring along its camera ray. Compensating
// its scale preserves the existing screen position/size while moving the
// actual geometry ahead of neighbouring cases in the depth buffer.
export function liftGameFromOrbit(position, camera, angle, count) {
  const scale = consoleFocusScale(angle, count);
  const base = Math.min(1, 9 / Math.max(1, count));
  const focus = (scale - base) / (1.5 - base);
  const depth = -viewPosition.copy(position).applyMatrix4(camera.matrixWorldInverse).z;
  if (depth <= 0) return scale;
  const lift = Math.min(3 * focus, Math.max(0, depth - camera.near - 3));
  const ratio = (depth - lift) / depth;
  position.sub(camera.position).multiplyScalar(ratio).add(camera.position);
  return scale * ratio;
}
