// Use an off-axis view so the foreground slot fills the left of the screen
// without rotating the ring or making consoles turn towards the camera.
export function frameCarousel(camera, width, height) {
  camera.aspect = width / height;
  if (width > 650) {
    camera.position.set(0, 2.2, 12.3);
    camera.lookAt(0, -2.6, 0);
    // Reframe the lower resting position without tilting the upright devices.
    camera.setViewOffset(
      width,
      height,
      width * 0.2,
      height * 0.2,
      width,
      height,
    );
  } else {
    camera.clearViewOffset();
    camera.position.set(0, 3.4, 25);
    camera.lookAt(0, -0.7, 0);
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

// A continuous focus envelope drives both the resting-pose blend and scale.
export function consoleFocusAmount(angle, count = 7) {
  const exponent = count <= 9 ? 8 : (count * count) / 2;
  return Math.max(0, Math.cos(angle)) ** exponent;
}

export function consoleFocusScale(angle, count = 7) {
  const spacingScale = Math.min(1, 9 / Math.max(1, count));
  return spacingScale + (1.5 - spacingScale) * consoleFocusAmount(angle, count);
}

export function applyPlatformCameraPose(camera, { target, yaw, pitch, distance, fov }) {
  const azimuth = yaw * Math.PI / 180;
  const elevation = pitch * Math.PI / 180;
  const horizontal = distance * Math.cos(elevation);
  camera.position.set(
    target[0] + horizontal * Math.sin(azimuth),
    target[1] + distance * Math.sin(elevation),
    target[2] + horizontal * Math.cos(azimuth),
  );
  camera.lookAt(...target);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

// Intersect the requested screen column with the line through the point
// parallel to world X. This keeps the pole's authored height and depth.
export function worldXAtScreenColumn(camera, point, column) {
  const v = camera.matrixWorldInverse.elements;
  const p = camera.projectionMatrix.elements;
  const view = point.clone().applyMatrix4(camera.matrixWorldInverse);
  const slope = p[0] * v[0] + (p[8] + column) * v[2];
  if (Math.abs(slope) < .0001) return point.x;
  const shift = -(p[0] * view.x + (p[8] + column) * view.z) / slope;
  return view.z + v[2] * shift < -camera.near ? point.x + shift : point.x;
}

// Expand the old carousel viewport to fill the environment canvas while keeping
// the console projection at the same on-screen pixels as the saved layout.
export function frameCarouselEnvironment(camera, bounds, viewport, worldYOffset = 0, savedCamera) {
  frameCarousel(camera, bounds.width, bounds.height);
  const x = camera.view?.enabled ? camera.view.offsetX : 0;
  const y = camera.view?.enabled ? camera.view.offsetY : 0;
  camera.setViewOffset(bounds.width, bounds.height,
    x + viewport.left - bounds.left, y + viewport.top - bounds.top,
    viewport.width, viewport.height);
  camera.position.y += worldYOffset;
  camera.updateMatrixWorld();
  if (savedCamera) applyPlatformCameraPose(camera, savedCamera);
}
