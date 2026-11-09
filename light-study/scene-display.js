import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Path, PlaneGeometry, Shape, ShapeGeometry, Vector2, Vector3 } from "three";
import { SWITCH_SCREEN_PLACEMENT } from "../src/hardware-profiles.js";
import { addPreviewSurface, dualScreenPlacement, PRIMARY_PREVIEW, SECONDARY_PREVIEW } from "../src/dual-screen-preview.js";

export const DISPLAY_LABELS = Object.freeze({ tv: "TV", crt: "CRT Monitor", led: "LED Monitor" });

export function prepareArcadeCabinet(model, screenMaterial) {
  const crt = model.getObjectByName("Object_14");
  const marquee = model.getObjectByName("Object_13");
  if (crt?.material?.name !== "Material.002" || marquee?.material?.name !== "pacman_logo_oben") return null;

  const marqueeMaterial = new MeshBasicMaterial({ color: 0x191b23, toneMapped: false });
  marquee.material = marqueeMaterial;
  const marqueeUV = marquee.geometry.getAttribute("uv");
  for (let i = 0; i < marqueeUV.count; i++) {
    marqueeUV.setXY(i, marqueeUV.getX(i) < .5 ? 0 : 1, marqueeUV.getY(i) < .5 ? 0 : 1);
  }
  marqueeUV.needsUpdate = true;

  // The glass and bezel are angled back together. Use the authored CRT plane
  // for the picture and put the surround just in front of it.
  crt.geometry.computeBoundingBox();
  const bounds = crt.geometry.boundingBox;
  const size = bounds.getSize(new Vector3());
  const width = size.x, height = Math.hypot(size.y, size.z);
  const normal = new Vector3().fromBufferAttribute(crt.geometry.getAttribute("normal"), 0);
  const pitch = -Math.atan2(normal.y, normal.z);
  const screen = new Mesh(new PlaneGeometry(width, height), screenMaterial);
  screen.name = PRIMARY_PREVIEW;
  screen.position.copy(bounds.getCenter(new Vector3())).addScaledVector(normal, .005);
  screen.rotation.x = pitch;
  crt.material = new MeshBasicMaterial({ color: 0x08080b });
  crt.add(screen);

  marquee.geometry.computeBoundingBox();
  const marqueeBounds = marquee.geometry.boundingBox;
  const outerWidth = marqueeBounds.max.x - marqueeBounds.min.x, outerHeight = height + .32;
  const rectangle = (w, h) => [
    new Vector2(-w / 2, -h / 2), new Vector2(w / 2, -h / 2),
    new Vector2(w / 2, h / 2), new Vector2(-w / 2, h / 2),
  ];
  const surround = new Shape(rectangle(outerWidth, outerHeight));
  surround.holes.push(new Path(rectangle(width, height)));
  const geometry = new ShapeGeometry(surround);
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) / outerWidth + .5, uv.getY(i) / outerHeight + .5);
  }
  const bezelMaterial = new MeshStandardMaterial({ color: 0x20212a, roughness: .82 });
  const bezel = new Mesh(geometry, bezelMaterial);
  bezel.name = "Arcade screen surround";
  bezel.position.copy(screen.position).addScaledVector(normal, .118);
  bezel.rotation.x = pitch;
  crt.add(bezel);
  for (const name of ["Object_16", "Object_17"]) {
    const side = model.getObjectByName(name);
    if (side) side.visible = false;
  }

  return {
    screen,
    setVideoSize(videoWidth, videoHeight) {
      const ratio = videoWidth && videoHeight ? (videoWidth / videoHeight) / (width / height) : 1;
      screen.scale.set(Math.min(1, ratio), Math.min(1, 1 / ratio), 1);
    },
    setArtwork(type, texture = null) {
      const material = type === "banner" ? marqueeMaterial : bezelMaterial;
      if (material.map === texture) return;
      material.map?.dispose();
      material.map = texture;
      material.color.setHex(texture ? 0xffffff : type === "banner" ? 0x191b23 : 0x20212a);
      material.needsUpdate = true;
    },
  };
}

// Active picture areas in the bundled models' part-local coordinates.
// The clamshell surfaces inherit the angle and motion of their upper panel.
const bundledScreens = {
  gameboy: { part: "LCDPolarizer", size: [0.0469, 0.0429], position: [0, 0, 0.00046] },
  gbcolor: { part: "gameboy_low001_Main_0", size: [86, 79], position: [-2.9, 108.9, 20.4] },
  gba: { part: "LCDPolarizer", size: [0.0611, 0.0407], position: [0, 0, 0.00058] },
  switch: SWITCH_SCREEN_PLACEMENT,
  switch2: { part: "Object_15", size: [0.696, 0.3915], position: [0, 0, 0.0359], rotation: [0, 0, -Math.PI / 2] },
};

// These replacement models ship a flat LCD mesh. Fit to its geometry so the
// Game Chooser and the carousel demo use the same picture area.
function authoredLcd(model, platformId) {
  const name = { lynx: "TotemLynxLCD", psp: "TotemPspLCD" }[platformId];
  if (name) return model.getObjectByName(name);
  if (platformId === "gamegear") {
    let lcd;
    model.traverse((mesh) => {
      if (mesh.isMesh && mesh.material?.name === "ggLCD") lcd = mesh;
    });
    return lcd;
  }
}

export function resolveDisplayType(deviceType, settings) {
  const { displayType, monitorType } = settings;
  if (displayType === "none" || Object.hasOwn(DISPLAY_LABELS, displayType)) return displayType;
  if (deviceType === "console") return "tv";
  // Older profiles applied monitorType only to computers.
  if (deviceType === "computer") return monitorType === "crt" ? "crt" : "led";
  return "none";
}

export function createDisplayPrimitive(type, screenMaterial) {
  const model = new Group();
  const body = new MeshStandardMaterial({ color: "#263449", roughness: 0.48, metalness: 0.12 });
  const dark = new MeshStandardMaterial({ color: "#101722", roughness: 0.34, metalness: 0.12 });
  function box(w, h, d, material, y) {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material);
    mesh.position.y = y;
    model.add(mesh);
  }
  const crt = type === "crt";
  const tv = type === "tv";
  const height = crt ? 10 : 8;
  const depth = crt ? 7 : tv ? 1.3 : 1.2;
  box(crt ? 18 : tv ? 17 : 16, crt ? 14 : 10, depth, body, height);
  const panel = new Mesh(new PlaneGeometry(crt ? 14 : tv ? 15.5 : 14.5, crt ? 9 : tv ? 8.5 : 8), screenMaterial);
  panel.position.set(0, height, depth / 2 + 0.04);
  model.add(panel);
  if (tv) box(5, 3, 4, dark, 1.5);
  else {
    box(2, 5, 2, dark, 2.5);
    box(12, 1, 7, body, 0.5);
  }
  return model;
}

export const TV_PLINTH_HEIGHT = 5.44;

export function createPlinthPrimitive(material) {
  const plinth = new Mesh(new BoxGeometry(17, TV_PLINTH_HEIGHT, 5.21), material);
  plinth.position.set(0, TV_PLINTH_HEIGHT / 2, -0.28);
  return plinth;
}

export function bindDeviceScreen(model, platformId, screenMaterial, { bundled = false, selected = null } = {}) {
  const demo = model.userData.consoleActivity?.screenDemo;
  const demoLcd = demo?.lcd;
  if (demoLcd) {
    // The carousel's power-on demo must stay out of the Game Chooser.
    demoLcd.userData.gameplaySurfaceBound = true;
    demoLcd.visible = false;
    if (demo.touch) demo.touch.visible = false;
  }
  const touch = model.getObjectByName(SECONDARY_PREVIEW);
  if (touch) touch.material = screenMaterial;
  const touchPlacement = bundled ? dualScreenPlacement(platformId, 1) : null;
  if (!touch && touchPlacement) addPreviewSurface(model, touchPlacement, SECONDARY_PREVIEW, screenMaterial);
  const lcd = bundled ? authoredLcd(model, platformId) : demoLcd;
  if (selected && selected !== lcd && !touchPlacement) {
    selected.material = screenMaterial;
    return selected;
  }
  const screen = model.getObjectByName(PRIMARY_PREVIEW);
  if (screen) {
    screen.material = screenMaterial;
    screen.visible = true;
    return screen;
  }
  if (lcd?.isMesh) {
    lcd.geometry.computeBoundingBox();
    const bounds = lcd.geometry.boundingBox;
    const { x: width, y: height } = bounds.getSize(new Vector3());
    const surface = new Mesh(new PlaneGeometry(width, height), screenMaterial);
    surface.name = PRIMARY_PREVIEW;
    surface.position.copy(bounds.getCenter(new Vector3()));
    surface.position.z = bounds.max.z + width * 0.0005;
    lcd.updateMatrix();
    surface.applyMatrix4(lcd.matrix);
    lcd.parent.add(surface);
    return surface;
  }
  const purchasedGba = bundled && platformId === "gba" && model.getObjectByName("gba_screen_glass");
  const placement = purchasedGba
    ? { part: purchasedGba.name, size: [0.0611, 0.0407], position: [0, 0.0022, 0.00715] }
    : bundled ? dualScreenPlacement(platformId, 0) ?? bundledScreens[platformId] : null;
  return addPreviewSurface(model, placement, PRIMARY_PREVIEW, screenMaterial);
}

export function prepareTelevision(model, screenMaterial, plinthMaterial) {
  const screen = model.getObjectByName("television_screen");
  const uv = screen?.geometry?.getAttribute("uv");
  if (!uv) throw new Error("The bundled TV is missing its screen surface.");
  const plinth = model.getObjectByName("television_plinth");
  if (!plinth?.isMesh) throw new Error("The bundled TV is missing its plinth.");
  // glTF uses a top-left texture origin. The shared VideoTexture uses bottom-left.
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  screen.material.dispose();
  screen.material = screenMaterial;
  plinth.material.dispose();
  plinth.material = plinthMaterial;
  const bounds = new Box3().setFromObject(model);
  model.scale.multiplyScalar(17 / bounds.getSize(new Vector3()).x);
  bounds.setFromObject(model);
  const center = bounds.getCenter(new Vector3());
  model.position.set(-center.x, -bounds.min.y, -center.z);
  // Preserve the fitted pose when taking the plinth out of the TV assembly.
  model.updateMatrixWorld(true);
  plinth.applyMatrix4(plinth.parent.matrixWorld);
  return plinth.removeFromParent();
}
