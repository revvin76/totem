import { Mesh, PlaneGeometry } from "three";

export const PRIMARY_PREVIEW = "GameplayPreviewSurface";
export const SECONDARY_PREVIEW = "GameplayPreviewTouchSurface";
export const WII_U_PREVIEW = "Totem Wii U GamePad video";

const placements = {
  ndslite: [
    { part: "Glass_07_-_Default_0", size: [47.5, 35.3], position: [110.91, -115.31, 8.95], rotation: [-0.0105, 0, Math.PI] },
    { part: "base_03_-_Default_0", size: [45.2, 34.1], position: [110.74, -63.62, 2.39], rotation: [0, 0, Math.PI] },
  ],
  "3ds": [
    { part: "LidBezel - Lid", size: [0.0758, 0.0445], position: [0.0001, -0.0006, 0.00012], rotation: [Math.PI / 9, 0, 0] },
    { part: "LowerTouchDigitizer - Part 01 - Bottom", size: [0.0611, 0.0458], position: [0, 0, 0.0003] },
  ],
  gwmulti: [
    { part: "LowerRearPolarizer - Lid", size: [0.0548, 0.0364], position: [0, 0.0714, 0.00845], rotation: [Math.PI / 18, 0, 0] },
    { part: "LowerRearPolarizer - Bottom", size: [0.0548, 0.0364], position: [0, -0.0019, 0.0042] },
  ],
};

export const STACKED_SCREENS = [[0, .5, 1, .5], [0, 0, 1, .5]];
export const MARIO_3D_LAND_SCREENS = [STACKED_SCREENS[0], [.1, 0, .8, .5]];

export const dualScreenDemos = {
  "3ds": { title: "Super Mario 3D Land", path: "/assets/demos/3ds-super-mario-3d-land.mp4", regions: MARIO_3D_LAND_SCREENS },
  ndslite: { title: "Super Monkey Ball: Touch & Roll", path: "/assets/demos/ds-super-monkey-ball.mp4", regions: STACKED_SCREENS },
  gwmulti: { title: "Donkey Kong", path: "/assets/demos/game-watch-donkey-kong.mp4", regions: [[0, 325 / 632, 1, 307 / 632], [0, 0, 1, 305 / 632]] },
};

const partnersInTime = { path: "/assets/demos/ds-partners-in-time.mp4", regions: STACKED_SCREENS };

export function matchedDualScreenDemo(platformId, title) {
  const demo = dualScreenDemos[platformId];
  const normalize = value => value?.split(/[([]/, 1)[0].toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  const key = normalize(title);
  if (demo && key === normalize(demo.title)) return demo;
  if (platformId === "gwmulti" && key === "gnwdkong") return demo;
  if (platformId === "ndslite" && key === "marioandluigipartnersintime") return partnersInTime;
  return null;
}

export function addPreviewSurface(model, placement, name, material) {
  if (!placement) return;
  const part = model.getObjectByName(placement.part);
  if (!part?.isMesh) return;
  const surface = new Mesh(new PlaneGeometry(...placement.size), material);
  surface.name = name;
  surface.position.fromArray(placement.position);
  if (placement.rotation) surface.rotation.fromArray(placement.rotation);
  part.add(surface);
  return surface;
}

export function dualScreenPlacement(platformId, index) {
  return placements[platformId]?.[index];
}

export function addWiiUGamePadPreview(model, material) {
  const host = model.getObjectByName("polySurface1_blinn1_0");
  if (!host?.isMesh) return;
  const surface = new Mesh(new PlaneGeometry(14.34, 8.23), material);
  surface.name = WII_U_PREVIEW;
  surface.position.set(0, 7.70, 1.70);
  surface.rotation.x = -.2641;
  model.add(surface);
  host.attach(surface);
  return surface;
}

const fullScreen = [0, 0, 1, 1];
const originalUVs = new WeakMap();

export function uncroppedPreviewUV(surface) {
  const uv = surface?.geometry.getAttribute("uv");
  return uv && originalUVs.get(uv);
}

export function setPreviewRegion(surface, region = fullScreen) {
  const uv = surface?.geometry.getAttribute("uv");
  if (!uv || (!originalUVs.has(uv) && region === fullScreen)) return;
  if (!originalUVs.has(uv)) originalUVs.set(uv, uv.clone());
  const original = originalUVs.get(uv);
  const [x, y, width, height] = region;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, x + width * original.getX(i), y + height * original.getY(i));
  }
  uv.needsUpdate = true;
}
