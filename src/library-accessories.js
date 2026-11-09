import * as THREE from "three";
import examples from "../disc-examples.json" with { type: "json" };
import { defaultBoxArt } from "./box-art.js";
import { generatedPackage } from "./box-art-models.js";
import { controllerForPlatform } from "./controller-mapping.js";
import { createControllerModel } from "./controller-models.js";
import { fitModel } from "./game-selection-stage.js";
import { accessoryPose, isPortable, libraryShowsControllers, libraryShowsMedia } from "./library-presentation.js";
import { disposeImported, loadSNESControllerPair, loadWiiUGamePad } from "./platform-assets.js";

const optical = new Set([
  ...Object.keys(examples), "pcecd", "pcfx", "neogeocd", "jaguarcd", "hyperscan",
  "playdia", "pippin", "cd32", "cdtv", "marty", "cdi", "laseractive", "vis",
  "nuon", "vflash", "gamewave", "polymega",
]);
const cartridges = new Set([
  "virtualboy", "pokemonmini", "gamegear", "lynx", "vita", "ngp", "ngpc", "wonderswan",
  "wonderswancolor", "gamate", "supervision", "megaduck", "gamemaster", "gamecom",
  "analoguepocket", "evercade", "superpocket", "ngage", "leapster", "leapsterexplorer",
  "microvision", "gameking", "xegs", "odyssey2", "videopac7400", "pv1000", "creativision",
]);

function mediaFor(platform) {
  const { id } = platform;
  if (id === "3ds") return;
  if (optical.has(id)) return "Disc";
  if (id === "psp") return "UMD";
  if (["famicomdisk", "n64dd", "amiga500"].includes(id)) return "Disk";
  if (["cpc464", "c64", "vic20", "spectrum"].includes(id)) return "Cassette";
  const template = defaultBoxArt(platform).template;
  if (template.endsWith("-cartridge") || cartridges.has(id) || platform.model?.profile === "cartridge" || platform.kind === "hybrid")
    return "Cartridge";
}

export function createLibraryMedia(platform, format) {
  if (format === "Disc") {
    return new THREE.Mesh(new THREE.RingGeometry(0.16, 1, 64), new THREE.MeshStandardMaterial({
      color: "#b5c4d1", metalness: 0.55, roughness: 0.29, side: THREE.DoubleSide,
    }));
  }
  if (format === "Cartridge") {
    const template = defaultBoxArt(platform).template;
    return generatedPackage(template.endsWith("-cartridge") ? template :
      platform.id === "snes" ? "snes-cartridge" : platform.kind === "handheld" ? "gba-cartridge" : "n64-cartridge");
  }
  const root = new THREE.Group();
  const shell = (w, h, d, color, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }));
    mesh.position.set(x, y, z);
    root.add(mesh);
  };
  if (format === "Disk") {
    shell(1.8, 1.85, 0.09, "#323844");
    shell(0.85, 0.55, 0.025, "#a7aeb4", 0.15, 0.56, 0.05);
    shell(1.45, 0.68, 0.01, "#c7c8b7", 0, -0.37, 0.05);
  } else if (format === "Cassette") {
    shell(2, 1.24, 0.18, "#252b34");
    shell(1.77, 0.8, 0.015, "#c5b890", 0, 0.12, 0.1);
    shell(0.98, 0.26, 0.02, "#323844", 0, 0.12, 0.11);
  } else {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.14, 48),
      new THREE.MeshStandardMaterial({ color: "#dddcd4" }));
    body.rotation.x = Math.PI / 2;
    root.add(body);
    shell(0.75, 0.32, 0.025, "#4d5261", 0, 0, 0.08);
  }
  return root;
}

export function libraryAccessoryOptions(platform) {
  const format = platform.kind === "arcade" ? null : mediaFor(platform);
  const options = format ? [["media", format]] : [];
  if (!isPortable(platform) && controllerForPlatform(platform.id)?.id !== "keyboard") {
    if (platform.id === "wiiu") options.push(["controller", "Wii U GamePad"]);
    else if (platform.id === "mastersystem") options.push(["controller", "Controller set"]);
    else options.push(["controller", "Controller 1"], ["controller2", "Controller 2"]);
  }
  return options;
}

export function visibleLibraryAccessories(platform) {
  return libraryAccessoryOptions(platform).filter(([id]) =>
    id === "media" ? libraryShowsMedia(platform) : libraryShowsControllers(platform));
}

export async function loadLibraryAccessories(platform, store) {
  const models = new Map();
  const options = visibleLibraryAccessories(platform);
  const controller = controllerForPlatform(platform.id);
  let pair;
  let gamePad;
  if (platform.id === "snes" && options.some(([id]) => id === "controller2")) {
    try { pair = await loadSNESControllerPair(store); }
    catch { /* The mapping profile supplies the fallback controller. */ }
  }
  if (platform.id === "wiiu" && options.some(([id]) => id === "controller")) {
    try { gamePad = await loadWiiUGamePad(store); }
    catch { /* The mapping profile supplies the fallback controller. */ }
  }
  try {
    for (const [id, label] of options) {
      const root = new THREE.Group();
      models.set(id, root);
      root.name = label;
      const model = id === "media" ? createLibraryMedia(platform, label) :
        pair?.children[0] ?? gamePad ?? createControllerModel(controller).root;
      model.position.set(0, 0, 0);
      root.add(model);
    }
    return models;
  } catch (error) {
    for (const root of models.values()) disposeImported(root);
    if (pair) disposeImported(pair);
    if (gamePad && !gamePad.parent) disposeImported(gamePad);
    throw error;
  }
}

// Fit each accessory against the device, independently of the other accessories.
// Offsets are in stage units, shared by the editor and the game library.
export function layoutLibraryAccessories(models, poses, bounds, units) {
  if (bounds.isEmpty()) return;
  const width = units * 1.55;
  for (const [id, model] of models) {
    const media = id === "media";
    const pose = poses?.[id] ?? accessoryPose;
    const onRight = media && models.has("controller");
    const spacing = id === "controller2" ? 1.72 : 0.62;
    const [pitch, yaw, roll] = media ? [-12, -12, 0] : [27, -13, 5];
    model.rotation.set(...[pitch + pose.pitch, yaw + pose.yaw, roll + pose.roll].map(THREE.MathUtils.degToRad));
    const x = onRight ? bounds.max.x + width * spacing : bounds.min.x - width * spacing;
    fitModel(model, width * pose.zoom, units * 1.4 * pose.zoom,
      x + pose.x * units, bounds.min.y + pose.y * units);
    model.position.z += bounds.max.z + pose.z * units;
  }
}
