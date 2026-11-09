import {
  Box3, BoxGeometry, BufferGeometry, CircleGeometry, DoubleSide, Group, MathUtils, Matrix4,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, RingGeometry,
  SRGBColorSpace, TextureLoader, Vector3, VideoTexture,
} from "three";
import examples from "../disc-examples.json" with { type: "json" };
import offscreenClips from "../offscreen-demo-audio.json" with { type: "json" };
import { releaseShowcaseMedia, trackShowcaseMedia } from "./studio-audio.js";
import { SWITCH_SCREEN_PLACEMENT } from "./hardware-profiles.js";
import { addPreviewSurface, addWiiUGamePadPreview, dualScreenDemos, dualScreenPlacement, PRIMARY_PREVIEW, SECONDARY_PREVIEW, setPreviewRegion } from "./dual-screen-preview.js";

export const DREAMCAST_CLOSE_SECONDS = 1.8;
export const DREAMCAST_LID_END_PROGRESS = 0.85;
const MEDIA_TRAVEL_SECONDS = DREAMCAST_CLOSE_SECONDS * DREAMCAST_LID_END_PROGRESS;
const PS3_DISC_READ_SECONDS = .75;
const CARTRIDGE_LOAD_SECONDS = 2.1;
const LYNX_LOAD_SECONDS = 4.4;
const LYNX_CARTRIDGE_SEATED_PROGRESS = .615;
const REAR_CARTRIDGE_LOAD_SECONDS = 3.6;
export const REAR_CARTRIDGE_SEATED_PROGRESS = .68;
const HANDHELD_STARTUP_PROGRESS = .52;
const PSP_LOAD_SECONDS = 4.5;
const PSP_DISC_SEATED_PROGRESS = .66;
const STARTUP_FADE_SECONDS = .28;
const startupClips = import.meta.env ? import.meta.glob("./startup-clips/*.mp4", {
  eager: true, query: "?url&no-inline", import: "default",
}) : {};
export const bundledStartupClip = platformId => startupClips[`./startup-clips/${platformId}.mp4`];

const rearViewAxis = new Vector3(0, 1, 0);
const rearHalfTurn = new Quaternion().setFromAxisAngle(rearViewAxis, Math.PI);
const rearViewMatrix = new Matrix4();
const rearViewCenter = new Vector3();
const rearViewEye = new Vector3();
const rearViewUp = new Vector3();
const rearViewRotation = new Quaternion();
const rearViewTurn = new Quaternion();
const rearViewCorrection = new Quaternion();

const FRONT_LOADERS = {
  segacd: { at: [0.54, 0.6, 1], direction: [0, 0, 1], normal: [0, 1, 0], radiusRatio: 0.23, tray: true },
  "3do": { at: [0.56, 0.6, 1], direction: [0, 0, 1], normal: [0, 1, 0], radiusRatio: 0.23, tray: true },
  wii: { point: [-0.0334, 0, 0.108], direction: [0, 0, 1], normal: [1, 0, 0], radius: 0.06, startupLeadSeconds: .18 },
  wiiu: { point: [0.602, 0.272, -0.025], direction: [1, 0, 0], normal: [0, 1, 0], radius: 0.24 },
  ps2: { at: [0.44, 0.73, 1], direction: [0, 0, 1], normal: [0, 1, 0], radiusRatio: 0.2, tray: true, cycleOnSelect: true,
    driveBadge: "PS2_PlayStation_drive_badge" },
  // Centre of the black slot on the recessed PS3 disc fascia (both model tiers).
  ps3: { point: [4.04, 2.72, 4.4174], direction: [0, 0, 1], normal: [0, 1, 0], radius: 2.15, fullyEject: true },
  ps4: { point: [13.7, 0.9, 4.54], direction: [0, 0, 1], normal: [0, 1, 0], radius: 1.8 },
  ps5: { point: [33, 1, 3.91], direction: [0, 0, 1], normal: [0, 1, 0], radius: 2 },
  xbox: { point: [0.54, 1.24, 1.9], direction: [1, 0, 0], normal: [0, 1, 0], radius: 0.84, tray: true },
  xbox360: { at: [0.53, 0.72, 1], direction: [0, 0, 1], normal: [1, 0, 0], radius: 0.116, tray: true },
  xboxone: { point: [-0.075, 0.001, 0.132], direction: [0, 0, 1], normal: [0, 1, 0], radius: 0.059 },
  xboxseriesx: { point: [-0.062, 0.105, 0.0755], direction: [0, 0, 1], normal: [1, 0, 0], radius: 0.06 },
};

const AUTHORED_LOADER_PLATFORMS = new Set([
  "3do", "3ds", "32x", "gamegear", "gba", "jaguar", "lynx", "mastersystem", "megadrive", "n64", "segacd", "snes",
]);

export function hasInsertionAnimation(platformId) {
  return Boolean(FRONT_LOADERS[platformId]) || AUTHORED_LOADER_PLATFORMS.has(platformId);
}

function pointInBounds(profile, bounds) {
  if (profile.point) return new Vector3(...profile.point);
  const size = bounds.getSize(new Vector3());
  return new Vector3(...profile.at).multiply(size).add(bounds.min);
}

function addFrontLoader(scene, profile, bounds) {
  const maximum = Math.max(...bounds.getSize(new Vector3()).toArray());
  const radius = profile.radius ?? maximum * profile.radiusRatio;
  const direction = new Vector3(...profile.direction);
  const normal = new Vector3(...profile.normal);
  const face = pointInBounds(profile, bounds);
  const loaded = face.clone().addScaledVector(direction, -radius);
  const disc = new Mesh(new RingGeometry(radius * 0.13, radius, 64),
    new MeshStandardMaterial({ color: 0xd6d9e3, metalness: 0.1, roughness: 0.45, side: DoubleSide }));
  disc.name = "Example game disc";
  disc.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
  disc.position.copy(loaded);
  disc.visible = false;
  let tray = null;
  const closedBadge = profile.driveBadge ? scene.getObjectByName(profile.driveBadge) : null;
  if (profile.tray) {
    tray = new Group();
    tray.name = "Optical drive tray";
    const across = normal.clone().cross(direction).normalize();
    tray.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(across, normal, direction));
    const plastic = new MeshStandardMaterial({ color: 0x17191e, roughness: 0.75 });
    tray.add(new Mesh(new BoxGeometry(radius * 2.15, radius * 0.045, radius * 2.3), plastic));
    const lip = new Mesh(new BoxGeometry(radius * 2.2, radius * 0.13, radius * 0.06), plastic);
    lip.position.z = radius * 1.15;
    tray.add(lip);
    if (closedBadge) {
      const badge = closedBadge.clone();
      const badgeCenter = scene.worldToLocal(closedBadge.getWorldPosition(new Vector3()));
      const edge = radius * 1.1 - .25;
      badge.position.set(MathUtils.clamp(badgeCenter.sub(face).dot(across), -edge, edge), 0, radius * .03 + .013);
      badge.quaternion.identity();
      lip.add(badge);
    }
    tray.position.copy(loaded).addScaledVector(normal, -radius * 0.035);
    scene.add(tray);
  }
  if (tray) {
    disc.position.set(0, radius * 0.035, 0);
    disc.rotation.set(-Math.PI / 2, 0, 0);
    tray.add(disc);
  } else {
    scene.add(disc);
  }
  return { disc, tray, closedBadge, direction, normal, radius, loaded, face,
    cycleOnSelect: profile.cycleOnSelect, startupLeadSeconds: profile.startupLeadSeconds,
    discTravel: radius * (profile.fullyEject ? 2 : 1) };
}

// These bundled models include the moving hardware. The named nodes carry
// the closed pose and travel so both display tiers use the same mechanism.
function findAuthoredLoader(scene, platformId) {
  if (platformId === "segacd" || platformId === "3do") {
    const tray = scene.getObjectByName("TotemDiscTray");
    const { radius, travel } = tray?.userData ?? {};
    if (!(Number.isFinite(radius) && radius > 0 && Number.isFinite(travel) && travel > 0)) return null;
    const disc = new Mesh(new RingGeometry(radius * .13, radius, 64),
      new MeshStandardMaterial({ color: 0xd6d9e3, metalness: .32, roughness: .45, side: DoubleSide }));
    disc.name = "Example game disc";
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(0, .16, -radius * 1.05);
    disc.visible = false;
    tray.add(disc);
    return { tray, disc, home: tray.position.clone(), travel, radius };
  }
  if (!AUTHORED_LOADER_PLATFORMS.has(platformId)) return null;
  const cartridge = scene.getObjectByName("TotemCartridge");
  const { travel, enclosed } = cartridge?.userData ?? {};
  if (!Array.isArray(travel) || travel.length !== 3 || !travel.every(Number.isFinite)) return null;
  cartridge.visible = false;
  const door = scene.getObjectByName("TotemCardDoor");
  const flapProfiles = platformId === "32x" ? [
    ["Totem32XRearFlap", 1],
    ["Totem32XFrontFlap", -1],
  ] : platformId === "snes" ? [["TotemSnesCartridgeFlap", 1, "z", .30, .48, 90]] : [];
  const flaps = flapProfiles.flatMap(([name, direction, axis = "x", start = .63, end = .76, angle = 86]) => {
    const pivot = scene.getObjectByName(name);
    return pivot ? [{ pivot, rest: pivot.rotation[axis], direction, axis, start, end, angle }] : [];
  });
  return {
    cartridge, home: cartridge.position.clone(), travel: new Vector3(...travel),
    enclosed, door, doorAngle: door?.rotation.y ?? 0,
    chassis: door || ["gamegear", "3ds", "gba"].includes(platformId) ? scene : null, flaps,
  };
}

function cartridgePowerLED(scene, platformId) {
  let geometry, position, normal;
  let color = 0x3d1110, emissive = 0xff3022;
  const stacked = platformId === "32x" || platformId === "segacd";
  const chassis = stacked ? scene.getObjectByName("MegaDrive") : scene;
  if (!chassis) return null;
  if (platformId === "megadrive" || stacked) {
    geometry = new CircleGeometry(.22, 24);
    position = [2.832, 5.655, 5.710];
    normal = [0, .975, .223];
  } else if (platformId === "snes") {
    geometry = new PlaneGeometry(1.48, .18);
    position = [-28.085, 3.17, -41.99];
    normal = [-1, .011, 0];
  } else if (platformId === "mastersystem") {
    geometry = new BufferGeometry().setFromPoints([
      new Vector3(.04987, .05474, .02009),
      new Vector3(.04165, .05400, .02235),
      new Vector3(.04183, .05542, .01801),
    ]);
    geometry.computeVertexNormals();
    color = 0x095324;
    emissive = 0x23ed58;
  } else {
    return null;
  }
  const material = new MeshStandardMaterial({ color, emissive, emissiveIntensity: 0, side: DoubleSide });
  const lens = new Mesh(geometry, material);
  lens.name = "TotemCartridgePowerLED";
  if (position) {
    lens.position.fromArray(position);
    lens.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...normal).normalize());
  }
  chassis.add(lens);
  return material;
}

function jaguarPowerLED(scene) {
  let lens;
  scene.traverse(part => {
    if (part.isMesh && part.material?.name === "jagLens") lens = part.material;
  });
  if (!lens?.emissive) return;
  lens.emissive.setHex(0xff3022);
  lens.emissiveIntensity = 0;
  return lens;
}

// Match modelled lenses and power marks. Keep the emission local even when
// the source reuses the same material on other parts of the device.
const REST_LIGHTS = {
  "3ds": { mesh: "StatusLED0", color: 0x2583ff },
  "3do": { material: "green", color: 0x42ed57 },
  dreamcast: { mesh: "Triange_on_front_Case_0", color: 0xff7629 },
  gameboy: { mesh: "BatteryLED", color: 0xff3022 },
  gba: { mesh: "PowerLEDLens", color: 0x35ff56 },
  lynx: { mesh: "TotemLynxPower", color: 0x55ef68 },
  n64: { mesh: "PowerLens", color: 0xff3022 },
  nes: { material: "PowerLight", color: 0xff3022 },
  psp: { mesh: "Face_sheet007_Material026_0", color: 0x37ef62 },
  switch: { mesh: "PowerSymbolRing", color: 0xe5efff },
  wii: { mesh: "PowerIndicator", color: 0x37ef62 },
  wiiu: { mesh: "Plane_Material016_0", color: 0x2583ff },
  xboxone: { mesh: "XboxOne_Power_0", color: 0xf2f6ff },
  xboxseriesx: { mesh: "PowerButton", color: 0xf2f6ff },
  c64: { mesh: "lamp_37", color: 0xff3022 },
};

function addRestLens(scene, geometry, position, rotation, color, emissive) {
  const material = new MeshStandardMaterial({ color, emissive, emissiveIntensity: 0 });
  const lens = new Mesh(geometry, material);
  lens.name = "Totem power lens";
  lens.position.fromArray(position);
  lens.rotation.x = rotation;
  scene.add(lens);
  return [material];
}

function preparePs2Indicators(scene) {
  // Both bundled tiers paint the LEDs onto flat button faces. Place a small
  // opaque lens over each painted dot in the button's local coordinates.
  function addLens(name, materialName, z, color, emissive) {
    const button = scene.getObjectByName(name);
    if (!button?.isMesh || button.material.name !== materialName) return null;
    const [lens] = addRestLens(button, new CircleGeometry(.035, 24),
      [-11.001, 4.125, z], -Math.PI / 2, color, emissive);
    return lens;
  }
  const power = addLens("Object_19", "PS2_Reset_Button_Material", -2.663, 0x231618, 0xff2722);
  const read = addLens("Object_21", "Trey_Out_Button_Material", -1.621, 0x151821, 0x2968ff);
  if (power) power.emissiveIntensity = 1.8;
  return { power, read };
}

function preparePs3Indicators(scene) {
  const fascia = scene.getObjectByName("Object_28");
  if (!fascia?.isMesh || fascia.material.name !== "PS3_Front_Lights_Material") return null;
  // Both bundled tiers paint the power and disc indicators into this strip.
  // Mask the baked dots, then draw the narrower light within each housing.
  function addIndicator(x, color) {
    addRestLens(fascia, new PlaneGeometry(.12, .23),
      [x, 5.971, -1.846], -Math.PI / 2, 0x151619, 0x000000);
    const [light] = addRestLens(fascia, new PlaneGeometry(.06, .23),
      [x, 5.973, -1.846], -Math.PI / 2, 0x151619, color);
    return light;
  }
  const power = addIndicator(6.37, 0xff2722);
  power.emissiveIntensity = 1.8;
  const read = addIndicator(6.20, 0x2968ff);
  return { power, read };
}

function prepareRestIndicators(scene, platformId) {
  if (platformId === "gbcolor" && scene.getObjectByName("gameboy_low001_Main_0")) {
    // The lamp is painted into this model's screen bezel.
    return addRestLens(scene, new CircleGeometry(.012, 16), [-.36, .6975, .1183], 0, 0x71150c, 0xff321b);
  }
  if (platformId === "saturn" && scene.getObjectsByProperty("isMesh", true)
    .some(mesh => mesh.material?.name === "Saturn_Outside")) {
    return addRestLens(scene, new PlaneGeometry(.40, .12), [-11.7, 5.564, 10], -Math.PI / 2, 0x1d3e24, 0x47ef67);
  }
  if (platformId === "gamecube") {
    const fascia = scene.getObjectByName("Object_6");
    const geometry = fascia?.geometry;
    const { uv } = geometry?.attributes ?? {};
    if (fascia?.material?.name !== "material" || !geometry?.index || !uv) return [];
    // This shared atlas puts the orange LED in the lower-left quarter.
    const lensIndices = [];
    const bodyIndices = [];
    const index = geometry.index.array;
    for (let i = 0; i < index.length; i += 3) {
      const triangle = [index[i], index[i + 1], index[i + 2]];
      const lamp = triangle.every(vertex => uv.getX(vertex) < .498 && uv.getY(vertex) > .47);
      (lamp ? lensIndices : bodyIndices).push(...triangle);
    }
    if (lensIndices.length !== 12) return [];
    const material = fascia.material.clone();
    material.emissive.setHex(0xff7829);
    material.emissiveIntensity = 0;
    fascia.material = [fascia.material, material];
    geometry.setIndex([...bodyIndices, ...lensIndices]);
    geometry.clearGroups();
    geometry.addGroup(0, bodyIndices.length, 0);
    geometry.addGroup(bodyIndices.length, lensIndices.length, 1);
    return [material];
  }
  const profile = REST_LIGHTS[platformId];
  if (!profile) return [];
  const indicators = new Map();
  scene.traverse(part => {
    if (!part.isMesh || (profile.mesh && part.name !== profile.mesh)) return;
    function isolate(material) {
      if (!material.emissive || (profile.material && material.name !== profile.material)) return material;
      if (indicators.has(material)) return indicators.get(material);
      const lens = material.clone();
      lens.emissive.setHex(profile.color);
      lens.emissiveIntensity = 0;
      indicators.set(material, lens);
      return lens;
    }
    part.material = Array.isArray(part.material) ? part.material.map(isolate) : isolate(part.material);
  });
  return [...indicators.values()];
}

export async function prepareConsoleActivity(scene, platformId) {
  scene.updateMatrixWorld(true);
  const authored = findAuthoredLoader(scene, platformId);
  const front = !authored && FRONT_LOADERS[platformId]
    ? addFrontLoader(scene, FRONT_LOADERS[platformId], new Box3().setFromObject(scene))
    : null;
  const activity = { front, authored, elapsed: 0, example: examples[platformId] ?? null };
  activity.restIndicators = scene.userData.consoleActivity?.restIndicators ?? prepareRestIndicators(scene, platformId);
  if (platformId === "ps2")
    activity.ps2Indicators = scene.userData.consoleActivity?.ps2Indicators ?? preparePs2Indicators(scene);
  if (platformId === "ps3")
    activity.ps3Indicators = scene.userData.consoleActivity?.ps3Indicators ?? preparePs3Indicators(scene);
  if (authored) activity.powerLED = cartridgePowerLED(scene, platformId);
  scene.userData.consoleActivity = activity;
  if (platformId === "jaguar") activity.jaguarPowerLED = jaguarPowerLED(scene);
  activity.gameGear = platformId === "gamegear" && Boolean(authored);
  activity.rearCartridge = Boolean(authored?.cartridge) && (platformId === "3ds" || platformId === "gba");
  if (platformId === "gba" && activity.rearCartridge) {
    activity.startupProgress = HANDHELD_STARTUP_PROGRESS;
    const lcd = scene.getObjectByName("Totem GBA showcase LCD");
    if (lcd?.isMesh) {
      activity.screenDemo = makeScreenDemo(lcd, "/assets/demos/gba-sonic-advance.mp4", { keepGlass: true, flipY: true, platformId });
    }
  }
  if (activity.gameGear) {
    const lcd = scene.getObjectByName("TotemGameGearLCD");
    const led = scene.getObjectByName("TotemGameGearPowerLED");
    if (lcd?.isMesh) activity.screenDemo = makeScreenDemo(lcd, "/assets/demos/game-gear-sonic-2.mp4", { keepGlass: true, platformId });
    if (led?.material?.emissive) {
      led.material.emissive.setHex(0xff241b);
      led.material.emissiveIntensity = 0;
      activity.gameGearLED = led.material;
    }
  }
  if (platformId === "lynx" && authored?.cartridge) {
    const lcd = scene.getObjectByName("TotemLynxLCD");
    const power = scene.getObjectByName("TotemLynxPower");
    if (lcd?.isMesh && authored.door && power) {
      // Keep the label toward the viewer and the connector on the leading edge.
      authored.cartridge.rotateX(Math.PI);
      activity.lynx = { power, powerZ: power.position.z, time: 0 };
      activity.screenDemo = makeScreenDemo(lcd, "/assets/demos/lynx-toki.mp4", { platformId, builtInStartup: true });
    }
  }
  if (platformId === "psp") {
    const door = scene.getObjectByName("TotemPspDoor");
    const umd = door?.getObjectByName("TotemPspUMD");
    const lcd = scene.getObjectByName("TotemPspLCD");
    if (umd && Number.isFinite(umd.userData.travel) && umd.userData.travel > 0 && lcd?.isMesh) {
      umd.visible = false;
      activity.psp = { door, umd, chassis: scene, doorAngle: door.rotation.x, seatedY: umd.position.y, time: 0 };
      activity.screenDemo = makeScreenDemo(lcd, "/assets/demos/psp-secret-agent-clank.mp4", { platformId, builtInStartup: true });
    }
  }
  const example = examples[platformId];
  if (!example || typeof document === "undefined") return;
  let disc = authored?.disc ?? front?.disc ?? scene.getObjectByName("Optical disc");
  if (platformId === "dreamcast") {
    const sourceDisc = scene.getObjectByName("Disc_Disc_0");
    if (sourceDisc) {
      sourceDisc.geometry.computeBoundingBox();
      const radius = sourceDisc.geometry.boundingBox.max.x;
      disc = new Mesh(new RingGeometry(radius * 0.13, radius * 0.99, 64), new MeshStandardMaterial());
      disc.name = "Example disc label";
      disc.position.z = sourceDisc.geometry.boundingBox.max.z + radius * 0.002;
      sourceDisc.add(disc);
    }
  }
  if (!disc) return;
  try {
    const texture = await new TextureLoader().loadAsync(example.artwork);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    const previous = Array.isArray(disc.material) ? disc.material : [disc.material];
    disc.geometry.clearGroups();
    disc.material = new MeshStandardMaterial({ map: texture, color: 0xffffff, roughness: 0.6, metalness: 0, side: DoubleSide });
    activity.discLabel = disc;
    activity.discLabelRest = disc.quaternion.clone();
    for (const material of previous) material.dispose();
  } catch (error) {
    console.error(`Could not load example disc artwork for ${platformId}`, error);
  }
}

function cartridgeInsertion(progress, start, end) {
  const t = MathUtils.clamp((progress - start) / (end - start), 0, 1);
  // Ease off the reveal pose, then spend most of the slide braking into the slot.
  return 1 - (1 - t) ** 3 * (1 + 3 * t);
}

function updateAuthoredLoader(activity, active, deltaSeconds, focus, reduceMotion) {
  const loader = activity.authored;
  if (!active) activity.elapsed = 0;
  else if (reduceMotion) activity.elapsed = 1;
  else if (focus >= .72 || activity.elapsed > 0)
    activity.elapsed = Math.min(1, activity.elapsed + Math.max(0, deltaSeconds) / (loader.tray ? 3.4 : CARTRIDGE_LOAD_SECONDS));
  const t = activity.elapsed;
  if (loader.tray) {
    const extend = MathUtils.smoothstep(t, 0, .29) * (1 - MathUtils.smoothstep(t, .62, 1));
    const drop = MathUtils.smoothstep(t, .29, .60);
    loader.tray.position.z = loader.home.z + extend * loader.travel;
    loader.disc.position.y = .16 + (1 - drop) * loader.radius * .45;
    loader.disc.visible = active && t > .29 && t < 1;
    if (activity.powerLED) activity.powerLED.emissiveIntensity = active && t >= 1 ? 2 : 0;
    return;
  }
  const start = loader.door ? .28 : .06;
  const end = loader.door ? .76 : 1;
  const insert = cartridgeInsertion(t, start, end);
  loader.cartridge.position.copy(loader.home).addScaledVector(loader.travel, 1 - insert);
  loader.cartridge.visible = active && t > start && (!loader.enclosed || insert < 1);
  const indicator = activity.jaguarPowerLED ?? activity.powerLED;
  if (indicator) indicator.emissiveIntensity = active && t >= end ? 2 : 0;
  for (const { pivot, rest, direction, axis, start, end, angle } of loader.flaps) {
    pivot.rotation[axis] = rest + direction * MathUtils.smoothstep(insert, start, end) * MathUtils.degToRad(angle);
  }
  if (loader.door) {
    const swing = MathUtils.smoothstep(t, 0, start) * (1 - MathUtils.smoothstep(t, end, 1));
    loader.door.rotation.y = loader.doorAngle + swing * Math.PI * .55;
    // Turn the Lynx toward its card end so the rear bay can be seen from the ring.
    loader.restYaw ??= loader.chassis.rotation.y;
    loader.chassis.rotation.y = loader.restYaw - swing * Math.PI * .43;
  }
}

function faceRear(loader, amount, camera) {
  const { chassis } = loader;
  loader.restRotation ??= chassis.quaternion.clone();
  chassis.quaternion.copy(loader.restRotation);
  if (amount === 0) return;

  chassis.quaternion.multiply(rearViewTurn.setFromAxisAngle(rearViewAxis, Math.PI * amount));
  if (!camera) return;

  // The fitted holder is centred on the console. Aim its rear normal at the eye
  // and use screen up so the cartridge artwork is level despite ring tilt.
  (chassis.parent ?? chassis).getWorldPosition(rearViewCenter);
  camera.getWorldPosition(rearViewEye);
  camera.getWorldQuaternion(rearViewRotation);
  rearViewUp.copy(rearViewAxis).applyQuaternion(rearViewRotation);
  rearViewRotation.setFromRotationMatrix(rearViewMatrix.lookAt(rearViewCenter, rearViewEye, rearViewUp));
  if (chassis.parent) {
    rearViewRotation.premultiply(chassis.parent.getWorldQuaternion(rearViewCorrection).invert());
  }

  // Blend the correction on top of a fixed-direction turn so the half-turn
  // cannot switch direction as the model settles on the ring.
  rearViewRotation.premultiply(rearViewCorrection.copy(loader.restRotation).multiply(rearHalfTurn).invert());
  chassis.quaternion.multiply(rearViewCorrection.identity().slerp(rearViewRotation, amount));
}

function updateRearCartridgeDemo(activity, active, deltaSeconds, focus, reduceMotion, camera) {
  const loader = activity.authored;
  if (!active) activity.elapsed = 0;
  else if (reduceMotion) activity.elapsed = 1;
  else if (focus >= .72 || activity.elapsed > 0)
    activity.elapsed = Math.min(1, activity.elapsed + Math.max(0, deltaSeconds) / REAR_CARTRIDGE_LOAD_SECONDS);

  const t = activity.elapsed;
  const startupAt = activity.startupProgress ?? 0;
  updateStartup(activity.screenDemo, active, t >= startupAt && (focus >= .72 || t > 0), deltaSeconds);
  const turn = MathUtils.smoothstep(t, 0, .30) * (1 - MathUtils.smoothstep(t, .71, 1));
  const insertion = cartridgeInsertion(t, .42, REAR_CARTRIDGE_SEATED_PROGRESS);
  faceRear(loader, turn, camera);
  loader.cartridge.position.copy(loader.home).addScaledVector(loader.travel, 1 - insertion);
  loader.cartridge.visible = active && t >= .34 && (!loader.enclosed || insertion < 1);
  const powered = active && t >= 1;
  if (activity.gameGearLED) activity.gameGearLED.emissiveIntensity = powered ? 2 : 0;
  if (activity.screenDemo) updateDemoScreen(activity.screenDemo, active, powered, powered);
}

export function prepareNintendoScreenDemo(model, chassis, playDemo = true) {
  const activity = model.userData.consoleActivity;
  function screen(name, size, point, tilt, host, uvRegion) {
    const lcd = new Mesh(new PlaneGeometry(...size), new MeshBasicMaterial({ toneMapped: false }));
    lcd.name = name;
    lcd.position.fromArray(point);
    lcd.rotation.x = tilt;
    if (uvRegion) {
      const uv = lcd.geometry.attributes.uv;
      const [x, y, width, height] = uvRegion;
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, x + width * uv.getX(i), y + height * uv.getY(i));
    }
    chassis.add(lcd);
    host.attach(lcd);
    return lcd;
  }
  const options = { flipY: true };
  const platformId = model.userData.platformId;
  if (platformId === "wiiu") {
    const material = new MeshBasicMaterial({ color: 0x000000, toneMapped: false });
    const lcd = addWiiUGamePadPreview(chassis, material);
    if (!lcd) {
      material.dispose();
      return;
    }
    if (playDemo) {
      activity.screenDemo = makeScreenDemo(lcd, "/assets/demos/wii-u-mario-kart-8.mp4", { ...options, keepGlass: true, platformId });
    }
  } else if (platformId === "3ds") {
    const lid = model.userData.animationTracks?.find(track => track.id === "3ds-lid")?.pivot;
    if (!lid) return;
    const demo = dualScreenDemos[platformId];
    const top = screen("Totem 3DS top LCD", [.0764, .0458], [0, .06618, .02463], MathUtils.degToRad(20),
      lid, demo.regions[0]);
    const touch = screen("Totem 3DS touch LCD", [.0611, .0458], [0, -.002, .01229], 0, chassis, demo.regions[1]);
    activity.screenDemo = makeScreenDemo(top, demo.path, { ...options, videoOnly: true, platformId, region: demo.regions[0] });
    activity.screenDemo.touch = touch;
    activity.startupProgress = HANDHELD_STARTUP_PROGRESS;
    touch.visible = false;
  } else {
    const demo = dualScreenDemos[platformId];
    if (!demo) return;
    const material = () => new MeshBasicMaterial({ toneMapped: false });
    const top = addPreviewSurface(chassis, dualScreenPlacement(platformId, 0), PRIMARY_PREVIEW, material());
    const touch = addPreviewSurface(chassis, dualScreenPlacement(platformId, 1), SECONDARY_PREVIEW, material());
    if (!top || !touch) {
      for (const surface of [top, touch].filter(Boolean)) {
        surface.removeFromParent();
        surface.geometry.dispose();
        surface.material.dispose();
      }
      return;
    }
    setPreviewRegion(top, demo.regions[0]);
    setPreviewRegion(touch, demo.regions[1]);
    activity.screenDemo = makeScreenDemo(top, demo.path, { ...options, videoOnly: true, platformId, region: demo.regions[0] });
    activity.screenDemo.touch = touch;
    touch.visible = false;
  }
}

function updateLynxDemo(activity, active, deltaSeconds, focus, reduceMotion, camera) {
  const { authored: loader, lynx } = activity;
  if (!active && lynx.time === 0 && !activity.screenDemo.startup?.started) return;
  const seatTime = LYNX_LOAD_SECONDS * LYNX_CARTRIDGE_SEATED_PROGRESS;
  updateStartup(activity.screenDemo, active, focus >= .72, deltaSeconds, seatTime);
  if (!active) lynx.time = 0;
  else if (focus >= .72 || lynx.time > 0 || reduceMotion) {
    if (reduceMotion) lynx.time = Math.max(lynx.time, LYNX_LOAD_SECONDS);
    lynx.time = Math.min(LYNX_LOAD_SECONDS, lynx.time + Math.max(0, deltaSeconds));
  }

  const t = Math.min(1, lynx.time / LYNX_LOAD_SECONDS);
  const turn = MathUtils.smoothstep(t, 0, .30) * (1 - MathUtils.smoothstep(t, .64, .95));
  const door = MathUtils.smoothstep(t, .14, .33) * (1 - MathUtils.smoothstep(t, LYNX_CARTRIDGE_SEATED_PROGRESS, .76));
  const insertion = cartridgeInsertion(t, .43, LYNX_CARTRIDGE_SEATED_PROGRESS);
  faceRear(loader, turn, camera);
  loader.door.rotation.y = loader.doorAngle - door * Math.PI * .57;
  loader.cartridge.position.copy(loader.home).addScaledVector(loader.travel, 1 - insertion);
  loader.cartridge.visible = active && t >= .34 && insertion < 1;
  const press = MathUtils.smoothstep(t, .92, .95) * (1 - MathUtils.smoothstep(t, .95, .99));
  lynx.power.position.z = lynx.powerZ - .026 * press;
  updateDemoScreen(activity.screenDemo, active, t >= .98, t >= 1);
}

function updatePspDemo(activity, active, deltaSeconds, focus, reduceMotion) {
  const { psp } = activity;
  if (!active && psp.time === 0 && !activity.screenDemo.startup?.started) return;
  const seatTime = PSP_LOAD_SECONDS * PSP_DISC_SEATED_PROGRESS;
  updateStartup(activity.screenDemo, active, focus >= .72, deltaSeconds, seatTime);
  if (!active) psp.time = 0;
  else if (focus >= .72 || psp.time > 0 || reduceMotion) {
    if (reduceMotion) psp.time = Math.max(psp.time, PSP_LOAD_SECONDS);
    psp.time = Math.min(PSP_LOAD_SECONDS, psp.time + Math.max(0, deltaSeconds));
  }
  const t = Math.min(1, psp.time / PSP_LOAD_SECONDS);
  const flip = MathUtils.smoothstep(t, 0, .27);
  const faceFront = MathUtils.smoothstep(t, .69, 1);
  const rearAngle = Math.PI + .28;
  psp.restYaw ??= psp.chassis.rotation.y;
  psp.chassis.rotation.y = psp.restYaw + (t < 1 ? flip * rearAngle + faceFront * (2 * Math.PI - rearAngle) : 0);
  const open = MathUtils.smoothstep(t, .20, .36) * (1 - MathUtils.smoothstep(t, .65, .78));
  psp.door.rotation.x = psp.doorAngle - open * MathUtils.degToRad(23);
  const slide = MathUtils.smoothstep(t, .41, PSP_DISC_SEATED_PROGRESS);
  psp.umd.position.y = psp.seatedY + psp.umd.userData.travel * (1 - slide);
  psp.umd.visible = active && t > .31 && t < .78;
  updateDemoScreen(activity.screenDemo, active, t >= 1, t >= 1);
}

export function prepareArcadeScreenDemo(model) {
  const crt = model.getObjectByName("Object_14");
  const activity = model.userData.consoleActivity;
  if (crt?.isMesh && crt.material.name === "Material.002" && activity) {
    activity.screenDemo = makeScreenDemo(crt, "/assets/demos/pacman-arcade.mp4", { keepGlass: true, flipY: true });
  }
}

export function prepareGameBoyColorDemo(chassis, cartridge, screen) {
  const activity = chassis.userData.consoleActivity;
  activity.authored = { chassis, cartridge, home: cartridge.position.clone(), travel: new Vector3(0, 150, 0) };
  activity.rearCartridge = true;
  activity.screenDemo = makeScreenDemo(screen, "/assets/demos/gbc-pokemon-gold.mp4", { flipY: true, videoOnly: true, platformId: "gbc" });
  cartridge.visible = false;
}

export function prepareSwitchScreenDemo(model) {
  const { part, size, position } = SWITCH_SCREEN_PLACEMENT;
  // The carousel splits the imported meshes so the Joy-Cons can detach.
  const glass = model.getObjectByName(`${part} - Tablet`) ?? model.getObjectByName(part);
  if (!glass?.isMesh || !model.userData.consoleActivity) return;
  const lcd = new Mesh(new PlaneGeometry(...size), new MeshBasicMaterial({ toneMapped: false }));
  lcd.name = "Totem Switch carousel video";
  lcd.position.fromArray(position);
  glass.add(lcd);
  model.userData.consoleActivity.screenDemo = makeScreenDemo(lcd, "/assets/demos/switch-mario-kart-8-deluxe.mp4", {
    flipY: true, videoOnly: true, platformId: "switch",
  });
}

export function prepareOffscreenDemo(model, platformId, gameplay, startupUrl) {
  if (model.userData.consoleActivity?.screenDemo) {
    if (startupUrl) setShowcaseStartupVideo(model, startupUrl);
    return;
  }
  const fallback = offscreenClips[platformId];
  const startupPath = startupUrl ?? bundledStartupClip(platformId);
  if (!fallback && !gameplay && !startupPath) return;
  const activity = model.userData.consoleActivity ??= { elapsed: 0 };
  activity.offscreenDemo = {
    path: gameplay?.url,
    startTime: fallback?.clip === gameplay?.filename ? fallback?.start ?? 0 : 0,
    startup: startupPath ? startupState(startupPath) : null,
    startupOnSelection: platformId === "jaguar",
    audio: fallback ? { path: `/assets/demos/offscreen/${platformId}.mp3` } : null,
  };
}

function updateOffscreenDemo(demo, active, start, ready, deltaSeconds) {
  if (!demo) return;
  updateStartup(demo, active, start, deltaSeconds);
  const boot = demo.startup;
  if (boot?.started && !boot.failed) {
    boot.black = boot.fade >= STARTUP_FADE_SECONDS;
    ready &&= boot.black;
  }
  if (ready && demo.path && !demo.element?.error) startGameplay(demo);
  else if (demo.requested) stopDemoMedia(demo);
  updateOffscreenAudio(demo.audio, ready && (!demo.path || Boolean(demo.element?.error)));
}

function updateOffscreenAudio(demo, ready) {
  if (!demo) return;
  if (!ready) {
    if (demo.requested) stopDemoMedia(demo);
    return;
  }
  if (demo.requested || typeof document === "undefined") return;
  if (!demo.element) {
    demo.element = document.createElement("audio");
    demo.element.loop = true;
    demo.element.volume = .4;
    demo.element.src = new URL(demo.path, document.baseURI).href;
  }
  demo.requested = true;
  playDemoMedia(demo);
}

function makeScreenDemo(lcd, path, { keepGlass = false, flipY = false, videoOnly = false,
  platformId, builtInStartup = false, region } = {}) {
  lcd.visible = keepGlass;
  const startupPath = bundledStartupClip(platformId);
  const title = lcd.material.map;
  return {
    lcd, path: path?.startsWith('/assets/demos/') ? null : path, title, baseMaterial: lcd.material, glass: keepGlass ? lcd.material : null, flipY, videoOnly, region,
    startup: startupPath || (builtInStartup && title) ? startupState(startupPath) : null,
    element: null, videoTexture: null, videoMaterial: null, requested: false,
  };
}

function startupState(path) {
  return { path, progress: 0, fade: 0, idle: 0 };
}

export function setShowcaseStartupVideo(model, url) {
  const screen = model.userData.consoleActivity?.screenDemo;
  if (screen && url) screen.startup = startupState(url);
}

function updateStartup(screen, active, start, deltaSeconds, builtInSeconds = 1) {
  const boot = screen?.startup;
  if (!boot || screen.lcd?.userData.gameplaySurfaceBound) return;
  if (!active) {
    if (boot.requested) stopDemoMedia(boot);
    boot.progress = boot.fade = boot.idle = 0;
    boot.started = boot.failed = boot.black = false;
    return;
  }
  if (boot.failed || (!start && !boot.started) || typeof document === "undefined") return;
  boot.started = true;
  const delta = Math.max(0, deltaSeconds);
  if (boot.progress === 1) {
    boot.fade += delta;
    return;
  }
  if (!boot.path) {
    boot.progress = Math.min(1, boot.progress + delta / builtInSeconds);
    return;
  }
  if (!boot.element) {
    boot.element = document.createElement("video");
    boot.element.playsInline = true;
    boot.element.muted = false;
    boot.element.crossOrigin = "anonymous";
    boot.element.src = new URL(boot.path, document.baseURI).href;
    boot.texture = new VideoTexture(boot.element);
    boot.texture.colorSpace = SRGBColorSpace;
    boot.texture.flipY = screen.flipY ?? true;
    if (screen.region) {
      const [x, y, width, height] = screen.region;
      boot.texture.repeat.set(1 / width, 1 / height);
      boot.texture.offset.set(-x / width, -y / height);
    }
  }
  if (!boot.requested) {
    boot.requested = true;
    playDemoMedia(boot);
  }
  const { element } = boot;
  const next = element.ended ? 1 : element.duration > 0 && Number.isFinite(element.duration)
    ? Math.min(.999999, element.currentTime / element.duration) : 0;
  boot.idle = next > boot.progress ? 0 : boot.idle + delta;
  if (element.error || boot.idle >= 2) {
    stopDemoMedia(boot);
    boot.failed = true;
    return;
  }
  boot.progress = Math.max(boot.progress, next);
}

function startGameplay(demo) {
  if (!demo.path || demo.requested || typeof document === "undefined") return;
  if (!demo.element) {
    const video = document.createElement("video");
    video.muted = false;
    video.playsInline = true;
    video.loop = true;
    if (!demo.lcd) {
      video.crossOrigin = "anonymous";
      video.volume = .4;
    }
    video.src = new URL(demo.path, document.baseURI).href;
    demo.element = video;
    demo.videoTexture = new VideoTexture(video);
    demo.videoTexture.colorSpace = SRGBColorSpace;
    demo.videoTexture.flipY = demo.flipY ?? true;
  }
  if (demo.startTime) demo.element.currentTime = demo.startTime;
  demo.requested = true;
  playDemoMedia(demo);
}

export function showcaseBackdropFrame(model) {
  const activity = model?.userData.consoleActivity;
  const demo = activity?.screenDemo ?? activity?.offscreenDemo;
  if (!demo) return null;
  if (demo.requested && demo.element?.paused === false && demo.element.readyState >= 2) {
    return { texture: demo.videoTexture, brightness: 1 };
  }
  const boot = demo.startup;
  if (boot?.requested && !boot.failed && boot.element.readyState >= 2 &&
      (!boot.black || (demo.path && !demo.element?.error))) {
    return { texture: boot.texture, brightness: 1 - Math.min(1, boot.fade / STARTUP_FADE_SECONDS) };
  }
  return null;
}

function updateDemoScreen(screen, active, lit, play) {
  if (screen.lcd.userData.gameplaySurfaceBound) return;
  const boot = screen.startup;
  const showingStartup = active && boot?.started && !boot.failed;
  if (showingStartup && !boot.black) play = false;
  screen.lcd.visible = Boolean(screen.glass) || (active && lit);
  if (!active && screen.requested) stopDemoMedia(screen);
  if (active && play && !screen.requested && typeof document !== "undefined") {
    startGameplay(screen);
    if (screen.glass && !screen.videoMaterial) {
      screen.videoMaterial = new MeshBasicMaterial({ map: screen.videoTexture, toneMapped: false });
    }
  }
  const showingVideo = active && screen.requested && !screen.element.paused && screen.element.readyState >= 2;
  if (showingStartup && !showingVideo) {
    boot.material ??= new MeshBasicMaterial({ toneMapped: false });
    const map = boot.path ? (boot.element.readyState >= 2 ? boot.texture : null) : screen.title;
    if (boot.material.map !== map) {
      boot.material.map = map;
      boot.material.needsUpdate = true;
    }
    boot.material.color.setScalar(map ? 1 - Math.min(1, boot.fade / STARTUP_FADE_SECONDS) : 0);
    boot.black = boot.fade >= STARTUP_FADE_SECONDS;
    screen.lcd.material = boot.material;
    screen.lcd.visible = true;
    if (screen.touch) screen.touch.visible = false;
    return;
  }
  screen.lcd.material = screen.baseMaterial;
  if (screen.videoOnly) screen.lcd.visible = showingVideo;
  if (screen.touch) {
    screen.touch.visible = showingVideo;
    if (screen.touch.material.map !== screen.videoTexture) {
      screen.touch.material.map = screen.videoTexture;
      screen.touch.material.needsUpdate = true;
    }
  }
  if (screen.glass) screen.lcd.material = showingVideo ? screen.videoMaterial : screen.glass;
  else {
    const map = showingVideo ? screen.videoTexture : screen.title;
    if (screen.lcd.material.map !== map) {
      screen.lcd.material.map = map;
      screen.lcd.material.needsUpdate = true;
    }
  }
}

function playDemoMedia(demo) {
  const { element } = demo;
  trackShowcaseMedia(element);
  void element.play().catch(error => {
    if (error.name !== "NotAllowedError" || demo.element !== element || !demo.requested ||
        demo.cancelPlaybackRetry) return;
    function retry(event) {
      if (!event.isTrusted) return;
      demo.cancelPlaybackRetry();
      playDemoMedia(demo);
    }
    demo.cancelPlaybackRetry = () => {
      document.removeEventListener("click", retry, true);
      document.removeEventListener("keydown", retry, true);
      demo.cancelPlaybackRetry = null;
    };
    document.addEventListener("click", retry, true);
    document.addEventListener("keydown", retry, true);
  });
}

function stopDemoMedia(demo) {
  demo.requested = false;
  demo.cancelPlaybackRetry?.();
  demo.element.pause();
  demo.element.currentTime = 0;
}

function disposeDemoMedia(demo) {
  stopDemoMedia(demo);
  releaseShowcaseMedia(demo.element);
  demo.element.removeAttribute("src");
  demo.element.load();
  demo.element = null;
}

export function disposeConsoleActivity(model) {
  const activity = model.userData.consoleActivity;
  const offscreen = activity?.offscreenDemo;
  const audio = offscreen?.audio;
  if (audio?.element) disposeDemoMedia(audio);
  const screen = activity?.screenDemo ?? offscreen;
  if (screen?.startup) {
    const boot = screen.startup;
    if (boot.element) disposeDemoMedia(boot);
    if (screen.lcd) screen.lcd.material = screen.baseMaterial;
    boot.material?.dispose();
    boot.texture?.dispose();
  }
  if (!screen?.element) return;
  disposeDemoMedia(screen);
  if (screen.lcd) {
    if (screen.glass) screen.lcd.material = screen.glass;
    else screen.lcd.material.map = screen.title;
  }
  if (screen.touch) {
    screen.touch.visible = false;
    screen.touch.material.map = null;
  }
  screen.videoMaterial?.dispose();
  screen.videoTexture.dispose();
  screen.videoTexture = null;
  screen.videoMaterial = null;
}

const cameraUp = new Vector3();
const cameraRotation = new Quaternion();
const labelRotation = new Quaternion();

function orientDiscLabel(activity, active, camera) {
  const { discLabel, discLabelRest } = activity;
  if (!discLabel) return;
  if (!active) {
    if (activity.discLabelAligned) discLabel.quaternion.copy(discLabelRest);
    activity.discLabelAligned = false;
    return;
  }
  if (!camera || activity.discLabelAligned) return;
  // Project screen up onto the disc so the label reads upright.
  // Keep that pose fixed until the disc starts spinning.
  camera.getWorldQuaternion(cameraRotation);
  discLabel.getWorldQuaternion(labelRotation).invert();
  cameraUp.set(0, 1, 0).applyQuaternion(cameraRotation).applyQuaternion(labelRotation);
  if (cameraUp.x * cameraUp.x + cameraUp.y * cameraUp.y < 1e-6) return;
  discLabel.rotateZ(Math.atan2(-cameraUp.x, cameraUp.y));
  activity.discLabelAligned = true;
}

export function updateConsoleActivity(model, active, deltaSeconds = 0, focus = active ? 1 : 0, reduceMotion = false, camera) {
  const activity = model?.userData.consoleActivity;
  if (!activity) return;
  const visible = typeof document === "undefined" || !document.hidden;
  const playing = active && visible && model.userData.detailTier !== "preview";
  const ps2Indicators = activity.ps2Indicators;
  ps2Indicators?.power?.emissive.setHex(active ? 0x37ef62 : 0xff2722);
  orientDiscLabel(activity, playing, camera);
  const atRest = playing && focus >= .995;
  const updateBackdropDemo = (ready, start = focus >= .72) =>
    updateOffscreenDemo(activity.offscreenDemo, playing, activity.offscreenDemo?.startupOnSelection || start, ready, deltaSeconds);
  const powered = activity.lynx ? activity.lynx.time >= LYNX_LOAD_SECONDS
    : activity.psp ? activity.psp.time >= PSP_LOAD_SECONDS
    : !activity.authored || activity.elapsed >= 1;
  for (const material of activity.restIndicators ?? [])
    material.emissiveIntensity = atRest && powered ? 1.8 : 0;
  if (activity.jaguarPowerLED && !activity.authored)
    activity.jaguarPowerLED.emissiveIntensity = active && focus >= .72 ? 2 : 0;
  if (activity.psp || activity.lynx || activity.gameGear || activity.rearCartridge) {
    if (activity.psp) updatePspDemo(activity, playing, deltaSeconds, focus, reduceMotion);
    else if (activity.lynx) updateLynxDemo(activity, playing, deltaSeconds, focus, reduceMotion, camera);
    else updateRearCartridgeDemo(activity, playing, deltaSeconds, focus, reduceMotion, camera);
    updateBackdropDemo(atRest);
    return;
  }
  if (activity.authored) {
    updateAuthoredLoader(activity, active, deltaSeconds, focus, reduceMotion);
    updateBackdropDemo(atRest && activity.elapsed >= 1);
    return;
  }
  const front = activity.front;
  if (!front) {
    if (activity.screenDemo) {
      const screen = activity.screenDemo;
      updateStartup(screen, playing, focus >= .72, deltaSeconds);
      updateDemoScreen(screen, playing, playing, !screen.startup || focus >= .72 || screen.startup.started);
    }
    const lidClosed = !model.userData.topLoading || model.userData.animationTransition?.progress >= 1;
    const amiga = model.userData.amigaShowcase;
    const driveReady = !amiga || (amiga.power.visible && !amiga.disk.visible && amiga.audio?.paused !== false);
    updateBackdropDemo(atRest && lidClosed && driveReady);
    return;
  }
  updateStartup(activity.screenDemo, playing, focus >= .72, deltaSeconds);
  const step = Math.max(0, deltaSeconds) / MEDIA_TRAVEL_SECONDS;
  let extension;
  if (front.tray && !front.cycleOnSelect) {
    const target = focus < (active ? 0.55 : 0.95) ? 1 : 0;
    const progress = activity.trayProgress ?? 1;
    activity.trayProgress = reduceMotion ? target : progress + MathUtils.clamp(target - progress, -step, step);
    extension = MathUtils.smoothstep(activity.trayProgress, 0, 1);
  } else {
    const end = 2 + (activity.ps3Indicators ? PS3_DISC_READ_SECONDS / MEDIA_TRAVEL_SECONDS : 0);
    if (!(activity.ps3Indicators ? playing : active)) activity.elapsed = 0;
    else if (reduceMotion) activity.elapsed = end;
    else if (front.cycleOnSelect || focus > 0.05 || activity.elapsed > 0)
      activity.elapsed = Math.min(end, activity.elapsed + step);
    const phase = Math.min(activity.elapsed, 2 - activity.elapsed);
    extension = MathUtils.smoothstep(phase, 0, 1);
  }
  front.disc.visible = active && extension > 0.001;
  const mediaSeated = front.tray && !front.cycleOnSelect ? activity.trayProgress === 0 : activity.elapsed >= 2;
  if (ps2Indicators?.read) ps2Indicators.read.emissiveIntensity = playing && mediaSeated ? 1.8 : 0;
  if (activity.ps3Indicators) {
    const { power, read } = activity.ps3Indicators;
    const inserting = playing && activity.elapsed >= 1;
    power.emissive.setHex(inserting ? 0x37ef62 : 0xff2722);
    const readSeconds = (activity.elapsed - 2) * MEDIA_TRAVEL_SECONDS;
    const readLit = playing && mediaSeated && (readSeconds >= PS3_DISC_READ_SECONDS - 1e-6
      || Math.floor(readSeconds * 8) % 2 === 0);
    read.emissiveIntensity = readLit ? 1.8 : 0;
  }
  // For the Wii, the inward slide starts at the midpoint of this cycle.
  const startBeforeInsertion = front.startupLeadSeconds === undefined ? undefined
    : activity.elapsed >= 1 - front.startupLeadSeconds / MEDIA_TRAVEL_SECONDS;
  updateBackdropDemo(atRest && mediaSeated, startBeforeInsertion);
  if (activity.screenDemo) {
    const seated = atRest && activity.elapsed >= 2;
    updateDemoScreen(activity.screenDemo, activity.screenDemo.startup ? playing : seated, seated, seated);
  }
  if (!front.tray) {
    front.disc.position.copy(front.loaded).addScaledVector(front.direction, front.discTravel * extension);
  }
  if (front.tray) {
    front.tray.position.copy(front.loaded)
      .addScaledVector(front.normal, -front.radius * 0.035)
      .addScaledVector(front.direction, front.radius * 1.6 * extension);
    front.tray.visible = extension > 0.001;
    if (front.closedBadge) front.closedBadge.visible = !front.tray.visible;
  }
}
