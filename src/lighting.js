import {
  ACESFilmicToneMapping,
  DirectionalLight,
  Group,
  HemisphereLight,
} from "three";

// A restrained environment preserves material colour; directional lights reveal
// case edges, keys and vents. Keep the rig in view space as layouts are tuned.
export function addStudioLighting(scene, camera) {
  scene.environmentIntensity = 0.28;
  const rig = new Group();
  rig.name = "Studio lighting";
  rig.add(new HemisphereLight("#edf3ff", "#273344", 0.28));
  for (const [name, colour, intensity, position] of [
    ["Key", "#fff4e9", 1.25, [-6, 7, 1]],
    ["Front fill", "#e5efff", 0.55, [6, 1, 2]],
    ["Edge light", "#b9ddff", 0.75, [3, 5, -15]],
  ]) {
    const light = new DirectionalLight(colour, intensity);
    light.name = name;
    light.position.set(...position);
    light.target.position.set(0, 0, -8);
    rig.add(light, light.target);
  }
  camera.add(rig);
  scene.add(camera);
  return rig;
}

export function configureStudioRenderer(renderer) {
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.75;
}
