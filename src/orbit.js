import { Euler, Quaternion, Vector3 } from "three";
import { DEFAULT_LAYOUT } from "./layout.js";

export const DEFAULT_ORBIT = DEFAULT_LAYOUT.orbit;
export const wrapIndex = (index, count) => ((index % count) + count) % count;
export function nearestSlot(current, index, count) {
  return current + wrapIndex(index - current + count / 2, count) - count / 2;
}

function orbitTilt(settings) {
  return new Euler(
    (settings.pitch * Math.PI) / 180,
    (settings.yaw * Math.PI) / 180,
    (settings.roll * Math.PI) / 180,
    "XYZ",
  );
}

export function orbitPosition(
  angle,
  settings,
  target = new Vector3(),
  cameraOrientation = new Quaternion(),
) {
  const zoom = settings.zoom ?? 1;
  const phase = angle + ((settings.rotation ?? 0) * Math.PI) / 180;
  target.set(Math.sin(phase) * 7.4 * zoom, 0, Math.cos(phase) * 5.4 * zoom);
  const tilt = orbitTilt(settings);
  target.applyEuler(tilt);
  // Keep the selected (angle = 0) console centred while tilting the orbit.
  const front = new Vector3(0, 0, 5.4).applyEuler(tilt);
  target.x -= front.x * zoom;
  // Rest below the camera so its view includes the device's top surface.
  target.y -= front.y * zoom + 2.3;
  target.z -= front.z * (zoom - 1);
  target.add(
    new Vector3(
      settings.panX ?? 0,
      settings.panY ?? 0,
      settings.panZ ?? 0,
    ).applyQuaternion(cameraOrientation),
  );
  return target;
}

const uprightAxis = new Vector3(0, 1, 0);

// Keep every device upright in the camera's presentation plane. Only the
// outward yaw follows its slot around the ring; orbit tilt affects position
// alone. At the foreground slot, yaw is zero and the front is square-on.
export function orbitOrientation(
  angle,
  cameraOrientation,
  target = new Quaternion(),
) {
  const yaw = Math.atan2(Math.sin(angle) * 7.4, Math.cos(angle) * 5.4);
  return target
    .setFromAxisAngle(uprightAxis, yaw)
    .premultiply(cameraOrientation);
}
