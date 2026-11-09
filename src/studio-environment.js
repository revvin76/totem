import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { DEFAULT_ENVIRONMENT_SETTINGS, DEFAULT_PLATFORM_LIGHT, normalizeEnvironmentSettings } from "./studio-environment-settings.js";
import { createGameplayBackdrop } from "./gameplay-backdrop.js";

// Shared by the standalone Studio and every view in the main executable.
export function createStudioEnvironment(scene, renderer, initialSettings, viewport = {}) {
  const innerWidth = viewport.width || 1440;
  const innerHeight = viewport.height || 900;
  const devicePixelRatio = renderer.getPixelRatio();
  let settings = normalizeEnvironmentSettings(initialSettings);
  let contentRoots = [];
  let platformChooser = false;
  let platformLights = {};
  scene.background = new THREE.Color("#09041c");
  scene.fog = new THREE.FogExp2("#100426", 0.008);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
const lightSources = new THREE.Group();
const lightRig = new THREE.Group();
scene.add(lightSources);
lightSources.add(lightRig);
const hemisphere = new THREE.HemisphereLight("#a9a8ff", "#10051f", 0.22);
lightSources.add(hemisphere);
const ambient = new THREE.AmbientLight("#201040", 0.16);
lightSources.add(ambient);
const consoleKey = new THREE.DirectionalLight("#f0f4ff", 3.8);
consoleKey.position.set(4, 23, 32);
consoleKey.target.position.set(4, 13, 5);
lightSources.add(consoleKey, consoleKey.target);
const consoleFill = new THREE.DirectionalLight("#55cfff", 1.7);
consoleFill.position.set(-13, 11, 17);
consoleFill.target.position.set(4, 13, 5);
lightSources.add(consoleFill, consoleFill.target);
const platformSpot = new THREE.SpotLight(0xffffff, 0, 22, Math.PI / 5, 0.7, 2);
platformSpot.name = "Active platform spotlight";
platformSpot.visible = false;
lightSources.add(platformSpot, platformSpot.target);

// The floor keeps a fixed room reflection and composites a separately masked
// handheld and game-box reflection controlled by Console Reflection.
const floor = new Reflector(new THREE.PlaneGeometry(1000, 1000), {
  clipBias: 0.003,
  textureWidth: Math.min(2048, Math.floor(innerWidth * devicePixelRatio)),
  textureHeight: Math.min(2048, Math.floor(innerHeight * devicePixelRatio)),
  color: 0xffffff,
});
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, 0, -36);
const environmentReflectionOpacity = 0.65;
floor.material.uniforms.reflectionOpacity = { value: environmentReflectionOpacity };
floor.material.uniforms.floorColor = { value: new THREE.Color("#09041c") };
const consoleReflectionCapture = new Reflector(new THREE.PlaneGeometry(1000, 1000), {
  clipBias: 0.003,
  textureWidth: Math.min(2048, Math.floor(innerWidth * devicePixelRatio)),
  textureHeight: Math.min(2048, Math.floor(innerHeight * devicePixelRatio)),
  color: 0xffffff,
});
consoleReflectionCapture.rotation.x = -Math.PI / 2;
consoleReflectionCapture.position.set(0, 0, -36);
consoleReflectionCapture.visible = false;
scene.add(consoleReflectionCapture);
floor.material.uniforms.consoleReflectionOpacity = { value: settings.consoleReflection };
floor.material.uniforms.tConsoleReflection = { value: consoleReflectionCapture.getRenderTarget().texture };
floor.material.fragmentShader = floor.material.fragmentShader
  .replace("uniform vec3 color;", "uniform vec3 color;\nuniform float reflectionOpacity;\nuniform float consoleReflectionOpacity;\nuniform sampler2D tConsoleReflection;\nuniform vec3 floorColor;")
  .replace(
    "gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );",
    "vec3 combinedReflection = blendOverlay( base.rgb, color );\n" +
      "if ( consoleReflectionOpacity > 0.0 ) {\n" +
      "  vec4 consoleSample = texture2DProj( tConsoleReflection, vUv );\n" +
      "  combinedReflection = mix( combinedReflection, consoleSample.rgb, consoleSample.a * consoleReflectionOpacity );\n" +
      "}\n" +
      "gl_FragColor = vec4( mix( floorColor, combinedReflection, reflectionOpacity ), 1.0 );"
  );
floor.material.needsUpdate = true;
scene.add(floor);

const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 500),
  new THREE.MeshStandardMaterial({ color: "#0b0620", roughness: 0.9, metalness: 0.02 })
);
backdrop.position.set(0, 250, -66);
scene.add(backdrop);
const gameplayBackdrop = createGameplayBackdrop(scene, backdrop, floor);

const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.18, 0.45, 1.1);
bloom.threshold = 1.1;
bloom.strength = 0.18;
bloom.radius = 0.45;

const accents = [
  { x: -39, color: "#00aaff", power: 5000, size: 1.05 },
  { x: -14, color: "#5024ff", power: 3800, size: 0.9 },
  { x: 14, color: "#f000ff", power: 5800, size: 1.05 },
  { x: 39, color: "#ff7908", power: 5200, size: 1.1 },
];
const bulbs = [];
for (const [index, { x, color, power, size }] of accents.entries()) {
  const id = ["blue", "violet", "pink", "orange"][index];
  const c = new THREE.Color(color);
  // Keep the colored emitters above the handheld silhouette so the Switch
  // cannot cast them into shadow; the wider range also reaches the backdrop.
  const light = new THREE.PointLight(c, power, 105, 1.35);
  light.position.set(x, 15, -30);
  lightRig.add(light);
  // The home accents face the backdrop. Their cones fall away from the
  // foreground carousel, even when the room light rig is moved in Studio.
  const wallLight = new THREE.SpotLight(c, power, 105, Math.PI / 3, 0.75, 1.35);
  wallLight.position.copy(light.position);
  wallLight.target.position.copy(wallLight.position);
  wallLight.target.position.z -= 36;
  wallLight.visible = false;
  lightRig.add(wallLight, wallLight.target);

  // A faint, flat primitive gives the reflective floor a visible color pool.
  const beam = new THREE.Mesh(new THREE.CircleGeometry(size * 11, 64), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: c.clone() }, uOpacity: { value: 0.24 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; void main() { float r = length((vUv - 0.5) * 2.0); float glow = 1.0 - smoothstep(0.08, 1.0, r); gl_FragColor = vec4(uColor, glow * uOpacity); }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  }));
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(x, 0.035, -5);
  lightRig.add(beam);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(size * 0.07, 16, 10),
    new THREE.MeshBasicMaterial({ color: c, toneMapped: false })
  );
  bulb.position.copy(light.position);
  lightRig.add(bulb);
  bulbs.push({ id, x, bulb, light, wallLight, beam, phase: x * 0.03, base: power, color: c.clone() });
}

// The plinth faces away from the wall lights. Give the wall finish a polished
// response to their bounced colours without adding another scene capture.
const plinthMaterial = backdrop.material.clone();
plinthMaterial.roughness = 0.36;
const plinthAccentColors = { value: bulbs.map(({ light }) => light.color) };
const plinthAccentX = { value: accents.map(({ x }) => x) };
const plinthLight = { value: new THREE.Vector2() };
plinthMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.studioPlinthLight = plinthLight;
  shader.uniforms.studioAccentColors = plinthAccentColors;
  shader.uniforms.studioAccentX = plinthAccentX;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vPlinthPosition;")
    .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvPlinthPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>
      varying vec3 vPlinthPosition;
      uniform vec2 studioPlinthLight;
      uniform vec3 studioAccentColors[${accents.length}];
      uniform float studioAccentX[${accents.length}];`)
    .replace("#include <opaque_fragment>", `
      vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
      vec3 viewDirection = normalize(cameraPosition - vPlinthPosition);
      vec3 reflectionRay = reflect(-viewDirection, worldNormal);
      for (int i = 0; i < ${accents.length}; i++) {
        float offset = vPlinthPosition.x - studioAccentX[i];
        vec2 distanceToAccent = vec2(offset, offset + 12.0 * reflectionRay.x) / 25.0;
        vec2 response = exp(-2.0 * distanceToAccent * distanceToAccent);
        outgoingLight += studioAccentColors[i] * dot(response, studioPlinthLight);
      }
      #include <opaque_fragment>`);
};
// The console capture contains the Switch and game box. The regular floor
// capture excludes both so Console Reflection controls their opacity together.
const lightReflectionMeshes = bulbs.flatMap(({ bulb, beam }) => [bulb, beam]);
const renderFloorReflection = floor.onBeforeRender;
floor.onBeforeRender = function (renderer, currentScene, camera, _geometry, material) {
  // The depth pass still draws the floor but never samples its reflections.
  if (material?.isMeshDepthMaterial) return;
  if (contentRoots.length && settings.consoleReflection > 0) {
    const visibility = currentScene.children.map((object) => object.visible);
    const lightVisibility = lightReflectionMeshes.map((object) => object.visible);
    const background = currentScene.background;
    const clearColor = renderer.getClearColor(new THREE.Color()).clone();
    const clearAlpha = renderer.getClearAlpha();
    try {
      currentScene.children.forEach((object, index) => {
        object.visible = contentRoots.includes(object) || (object === lightSources && visibility[index]);
      });
      for (const object of lightReflectionMeshes) object.visible = false;
      currentScene.background = null;
      renderer.setClearColor(0x000000, 0);
      consoleReflectionCapture.visible = false;
      consoleReflectionCapture.onBeforeRender(renderer, currentScene, camera);
    } finally {
      currentScene.children.forEach((object, index) => { object.visible = visibility[index]; });
      lightReflectionMeshes.forEach((object, index) => { object.visible = lightVisibility[index]; });
      currentScene.background = background;
      renderer.setClearColor(clearColor, clearAlpha);
    }
  }

  const visibility = currentScene.children.map((object) => object.visible);
  const lightVisibility = lightReflectionMeshes.map((object) => object.visible);
  for (const object of contentRoots) object.visible = false;
  for (const object of currentScene.children) {
    if (object.isTransformControlsRoot || object.userData.studioHelper) object.visible = false;
  }
  consoleReflectionCapture.visible = false;
  gameplayBackdrop.mesh.visible = false;
  for (const object of lightReflectionMeshes) object.visible = false;
  try { return renderFloorReflection.call(this, renderer, currentScene, camera); }
  finally {
    currentScene.children.forEach((object, index) => { object.visible = visibility[index]; });
    lightReflectionMeshes.forEach((object, index) => { object.visible = lightVisibility[index]; });
  }
};

  function lightSettings(id) {
    return (platformChooser && platformLights[id]) || DEFAULT_PLATFORM_LIGHT;
  }
  function applyLightMode() {
    hemisphere.color.set(platformChooser ? 0xffffff : "#a9a8ff");
    hemisphere.groundColor.set(platformChooser ? "#555555" : "#10051f");
    hemisphere.intensity = platformChooser ? 0.28 : 0.22 * settings.brightness;
    ambient.color.set(platformChooser ? 0xffffff : "#201040");
    ambient.intensity = platformChooser ? 0.12 : 0.16 * settings.brightness;
    const key = lightSettings("key"), fill = lightSettings("fill");
    consoleKey.color.set(key.color ?? "#f0f4ff");
    consoleFill.color.set(fill.color ?? (platformChooser ? 0xffffff : "#55cfff"));
    consoleKey.position.set(4 + key.x, 23 + key.y, 32 + key.z);
    consoleFill.position.set(-13 + fill.x, 11 + fill.y, 17 + fill.z);
    consoleKey.intensity = platformChooser ? 0.85 * key.intensity * Number(key.enabled) : 3.8 * settings.brightness;
    consoleFill.intensity = platformChooser ? 0.3 * fill.intensity * Number(fill.enabled) : 1.7 * settings.brightness;
    platformSpot.color.set(lightSettings("spot").color ?? 0xffffff);
    platformSpot.visible = platformChooser;
    for (const { light, wallLight } of bulbs) {
      light.visible = !platformChooser;
      wallLight.visible = platformChooser;
    }
  }
  function apply(value, lights = platformLights) {
    settings = normalizeEnvironmentSettings(value);
    platformLights = lights;
  lightSources.visible = settings.lightsEnabled;
  lightRig.position.set(settings.lightX, settings.lightY, settings.lightZ);
  applyLightMode();
  const hueOffset = (settings.hue - DEFAULT_ENVIRONMENT_SETTINGS.hue) / 360;
  const brightness = settings.lightsEnabled ? settings.brightness : 0;
  plinthLight.value.set(
    0.065 * brightness,
    settings.reflectionsEnabled ? 0.085 * brightness * settings.lightReflection : 0,
  );
  plinthAccentX.value = bulbs.map(({ id, x }) => x + settings.lightX + lightSettings(id).x);
  for (const { id, x, light, wallLight, beam, bulb, color } of bulbs) {
    const local = lightSettings(id);
    const adjusted = color.clone().offsetHSL(hueOffset, 0, 0);
    light.color.copy(adjusted);
    wallLight.color.set(local.color ?? adjusted);
    wallLight.position.set(x + local.x, 15 + local.y, -30 + local.z);
    bulb.position.copy(platformChooser ? wallLight.position : light.position);
    beam.position.set(x + local.x, 0.035, -5 + local.z);
    beam.material.uniforms.uColor.value.copy(wallLight.color);
    bulb.material.color.copy(wallLight.color);
  }
  // Console Reflection adjusts the reflector's scene capture; Light Reflection
  // controls the colored floor pools separately.
  floor.material.uniforms.consoleReflectionOpacity.value = settings.consoleReflection;
  floor.visible = settings.reflectionsEnabled;
  for (const { id, beam } of bulbs) {
    // A faint bounce remains in the room even at zero; this layer is separate
    // from the Switch capture and cannot be faded by Console Reflection.
    beam.material.uniforms.uOpacity.value = 0.1 + 0.14 * settings.lightReflection;
    beam.visible = settings.reflectionsEnabled && lightSettings(id).enabled;
  }

  }
  function update(time) {
    for (const { id, bulb, light, wallLight, phase, base } of bulbs) {
      const pulse = 0.96 + Math.sin(time * 0.48 + phase) * 0.04;
      light.intensity = base * settings.brightness * pulse;
      const local = lightSettings(id);
      wallLight.intensity = light.intensity * local.intensity * Number(local.enabled);
      bulb.scale.setScalar(pulse);
    }
  }
  apply(settings);
  return { bloom, floor, backdrop, gameplayBackdrop, plinthMaterial, lightSources, apply, update,
    platformLightObjects: { key: consoleKey, fill: consoleFill, spot: platformSpot,
      ...Object.fromEntries(bulbs.map(({ id, wallLight }) => [id, wallLight])) },
    setContentRoots(roots) { contentRoots = roots.filter(Boolean); },
    setPlatformChooserActive(active) {
      if (platformChooser === active) return;
      platformChooser = active;
      apply(settings);
    },
    focusPlatform(model, amount) {
      const spot = lightSettings("spot");
      platformSpot.intensity = model ? 65 * amount * spot.intensity * Number(spot.enabled) : 0;
      if (!model) return;
      model.getWorldPosition(platformSpot.target.position);
      platformSpot.position.copy(platformSpot.target.position);
      platformSpot.position.x += spot.x;
      platformSpot.position.y += 6 + spot.y;
      platformSpot.position.z += 5 + spot.z;
    },
  };
}
