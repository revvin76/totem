export const poseLimits = {
  zoom: [0.1, 2], x: [-10, 10], y: [-10, 10], z: [-10, 10],
  pitch: [-180, 180], yaw: [-180, 180], roll: [-180, 180],
};

export const devicePose = { zoom: 0.72, x: 0, y: -1.8, z: 0, pitch: 0, yaw: 0, roll: 0 };
export const accessoryPose = { ...devicePose, zoom: 1, y: 0 };
export const accessoryIds = ["media", "controller", "controller2"];

export function isPortable(platform) {
  return platform.kind === "handheld" || platform.kind === "hybrid";
}

export function libraryDisplay(platform) {
  return platform.libraryPresentation?.display ??
    (isPortable(platform) ? "built-in" : "tv");
}

export function libraryShowsControllers(platform, studioEnabled = true) {
  return platform.libraryPresentation?.showControllers ?? (platform.kind !== "arcade" && studioEnabled);
}

export function libraryShowsMedia(platform) {
  return platform.libraryPresentation?.showMedia ?? platform.kind !== "arcade";
}

export function validateLibraryPose(pose) {
  for (const [key, [min, max]] of Object.entries(poseLimits)) {
    const value = pose?.[key];
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error(`Invalid game library ${key} setting.`);
  }
}
