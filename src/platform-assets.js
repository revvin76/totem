import { AxesHelper, Box3, BoxGeometry, BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RingGeometry, Shape, ShapeGeometry, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { applyConsoleSkin } from "./console-skins.js";
import { PRIMARY_PREVIEW } from "./dual-screen-preview.js";
import { recordLoadingTime } from "./loading-profile.js";
import { createConsole, getConsoleReferenceMaxDimension } from "./models.js";
import { PROFILE_TYPES } from "./hardware-profiles.js";
import { validateBoxArt } from "./box-art.js";
import { accessoryIds, validateLibraryPose } from "./library-presentation.js";
import { DREAMCAST_LID_END_PROGRESS, disposeConsoleActivity, prepareArcadeScreenDemo, prepareConsoleActivity, prepareGameBoyColorDemo, prepareNintendoScreenDemo, updateConsoleActivity } from "./console-activity.js";
import { attachAmigaShowcase, disposeAmigaShowcase, updateAmigaShowcase } from "./amiga-showcase.js";

export const MODEL_LIMIT = 128 * 1024 * 1024;
export const LOGO_LIMIT = 8 * 1024 * 1024;
export const LIBRARY_TV_MODEL_PATH = "assets/models/flatpanel-tv.glb";
export const LIBRARY_TV_MODEL_SHA256 = "a521425678bdd068ea06576f3f3fa59e7bbd3768272e483ee24f02e4e1b5cd7b";
const GAMEWATCH_LID_MESH_KEYS = [
  "ControlBorder-1[0]#lid",
  "HingePin0[1]#lid",
  "LowerRearPolarizer[2]#lid",
  "LowerFrontPolarizer[3]#lid",
  "LowerDisplayGasket[4]#lid",
  "LowerStabilizer-1[5]#lid",
  "LowerContactStrip[6]#lid",
  "LowerGirder0[7]#lid",
  "Building0[8]",
  "ControlPlate-1[9]#lid",
];
const ADDITIONAL_3DS_LID_MESH_PREFIXES = [
  "LowerTouchDigitizer[",
  "DockContact0[",
  "HingeAxle[",
];
const SPLIT_3DS_COMPONENT_MESHES = new Set([
  "LowerTouchDigitizer",
  "DockContact0",
  "HingeAxle",
]);

export function inspectGLB(buffer) {
  if (
    !(buffer instanceof ArrayBuffer) ||
    buffer.byteLength < 20 ||
    buffer.byteLength > MODEL_LIMIT
  )
    throw new Error("Use a self-contained GLB 2.0 file up to 128 MB.");
  const view = new DataView(buffer);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== buffer.byteLength
  )
    throw new Error("This is not a valid GLB 2.0 file.");
  const length = view.getUint32(12, true);
  if (
    view.getUint32(16, true) !== 0x4e4f534a ||
    20 + length > buffer.byteLength
  )
    throw new Error("The GLB JSON chunk is missing or incomplete.");
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, length)).trim(),
  );
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])])
    if (item.uri && !item.uri.startsWith("data:"))
      throw new Error(
        "Pack the model and all textures into one GLB; external file and network references are not supported.",
      );
  for (const image of json.images ?? []) {
    if (
      image.uri
        ? !/^data:image\/(png|jpeg|webp);/i.test(image.uri)
        : !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType)
    )
      throw new Error(
        "Model textures must be embedded PNG, JPEG or WebP images.",
      );
  }
  for (const extension of json.extensionsUsed ?? [])
    if (
      [
        "KHR_draco_mesh_compression",
        "KHR_texture_basisu",
        "EXT_meshopt_compression",
      ].includes(extension)
    )
      throw new Error(
        `Export an uncompressed GLB; ${extension} requires an additional decoder.`,
      );
  return json;
}

export async function parseModel(
  buffer,
  hiddenMaterials = [],
  showcaseRotation = [0, 0, 0],
  opaqueMaterials = [],
  platformId = "",
  modelAnimations = null,
  showAnimationHelpers = false,
) {
  inspectGLB(buffer);
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  const scene = gltf.scene;
  if (platformId === "dreamcast") {
    matchDreamcastShellMaterials(scene);
    configureDreamcastPivots(scene);
  }
  if (platformId === "3ds") split3dsHingeMeshes(scene);
  if (platformId === "gba") finishGameBoyAdvance(scene);
  if (platformId === "snes") splitSnesCartridgeDoor(scene);
  if (platformId === "gwmulti") splitGameWatchMeshes(scene);
  if (platformId === "switch") splitSwitchJoyCons(scene);
  if (["playstation", "saturn", "gamecube"].includes(platformId)) configureTopLoadingConsole(scene, platformId);
  await prepareConsoleActivity(scene, platformId);
  const meshList = collectAnimationMeshes(scene);
  // Source-file basis corrections precede centring/fitting and remain separate
  // from the user's shared and per-device layout controls.
  if (showcaseRotation.some((angle) => angle !== 0))
    scene.rotation.set(
      ...showcaseRotation.map((angle) => (angle * Math.PI) / 180),
    );
  const textures = new Set();
  scene.traverse((part) => {
    if (!part.isMesh) return;
    for (const material of Array.isArray(part.material)
      ? part.material
      : [part.material]) {
      if (opaqueMaterials.includes(material.name)) {
        material.transparent = false;
        material.opacity = 1;
        material.depthWrite = true;
      }
      for (const value of Object.values(material))
        if (value?.isTexture) textures.add(value);
    }
  });
  const textureSize = Math.max(
    0,
    ...[...textures].flatMap((texture) => [
      texture.image?.width ?? 0,
      texture.image?.height ?? 0,
    ]),
  );
  if (textureSize > 8192) {
    disposeImported(scene);
    throw new Error("Model textures must be at most 8192 × 8192.");
  }
  scene.traverse((part) => {
    if (
      part.isMesh &&
      (Array.isArray(part.material) ? part.material : [part.material]).every(
        (material) => hiddenMaterials.includes(material.name),
      )
    )
      part.visible = false;
  });
  scene.updateMatrixWorld(true);
  const bounds = new Box3();
  scene.traverseVisible((part) => {
    if (part.isMesh) {
      part.geometry.computeBoundingBox();
      bounds.union(
        part.geometry.boundingBox.clone().applyMatrix4(part.matrixWorld),
      );
    }
  });
  const size = bounds.getSize(new Vector3());
  const maximum = Math.max(size.x, size.y, size.z);
  let triangles = 0;
  scene.traverseVisible((part) => {
    if (part.isMesh)
      triangles +=
        (part.geometry.index?.count ??
          part.geometry.attributes.position.count) / 3;
  });
  if (!Number.isFinite(maximum) || maximum <= 0 || !triangles)
    throw new Error("The model has no visible mesh geometry.");
  if (triangles > 5_000_000)
    throw new Error(
      "The model exceeds five million triangles. Export a lighter display version.",
    );
  const centre = bounds.getCenter(new Vector3());
  const animationSettings = normalizePlatformAnimations(platformId, modelAnimations, meshList);
  const animationTracks = attachMeshAnimations(scene, animationSettings, showAnimationHelpers, maximum);
  const holder = new Group();
  holder.add(scene);
  scene.position.sub(centre);
  holder.scale.setScalar(3.3 / maximum);
  const root = new Group();
  root.add(holder);
  root.userData.imported = true;
  root.userData.platformId = platformId;
  root.userData.meshList = meshList;
  root.userData.animationTracks = animationTracks;
  root.userData.closeWhenActive = animationSettings.closeWhenActive === true;
  root.userData.consoleActivity = scene.userData.consoleActivity;
  if (scene.userData.skinMaterial) root.userData.skinMaterial = scene.userData.skinMaterial;
  if (scene.userData.applyGameBoyAdvanceSkin) root.userData.applyGameBoyAdvanceSkin = scene.userData.applyGameBoyAdvanceSkin;
  root.userData.topLoading = ["dreamcast", "playstation", "saturn", "gamecube"].includes(platformId) && animationSettings.closeWhenActive === true;
  root.userData.modelStats = {
    triangles: Math.round(triangles),
    meshes: 0,
    textures: textures.size,
    textureSize,
  };
  scene.traverseVisible((part) => {
    if (part.isMesh) root.userData.modelStats.meshes++;
  });
  return root;
}

function finishGameBoyAdvance(scene) {
  const purchasedBody = scene.getObjectByName("gba_body");
  if (purchasedBody?.material?.name === "m_gba_console") {
    finishPurchasedGameBoyAdvance(scene, purchasedBody);
    return;
  }
  const shell = scene.getObjectByName("BackCover");
  const trim = scene.getObjectByName("DisplayBezel");
  if (shell?.material?.name !== "indigo" || trim?.material?.name !== "agbgray") return;
  scene.updateMatrixWorld(true);
  scene.userData.skinMaterial = shell.material;
  shell.material.color.set("#554897");
  trim.material.color.set("#dfddd6");
  const parts = splitMeshIntoConnectedComponents(trim, (bounds) => bounds.max.z > .0238 &&
    bounds.min.x > -.039 && bounds.max.x < .039 && bounds.min.y < -.028 && bounds.max.y > .03);
  for (const part of parts) {
    const size = part.geometry.boundingBox?.getSize(new Vector3());
    if (size && size.x > .07 && size.x < .08 && size.z < .001) {
      part.material = part.material.clone();
      part.material.color.set("#16181c");
      part.material.roughness = .31;
    }
  }
  for (const part of [shell, ...parts]) refineGameBoyAdvanceOutline(part);
}

function finishPurchasedGameBoyAdvance(scene, body) {
  const shell = body.material.clone();
  body.material = shell;
  const batteryCover = scene.getObjectByName("gba_battery_cover");
  if (batteryCover?.isMesh) batteryCover.material = shell;
  const led = scene.getObjectByName("gba_led");
  if (led?.isMesh) led.name = "PowerLEDLens";
  const glass = scene.getObjectByName("gba_screen_glass");
  if (glass?.isMesh) {
    // The purchased export has a glass cover over an empty LCD cavity.
    const bezel = new Shape();
    bezel.moveTo(-.030, -.034);
    bezel.lineTo(.030, -.034);
    bezel.quadraticCurveTo(.038, -.034, .038, -.026);
    bezel.lineTo(.038, .023);
    bezel.quadraticCurveTo(.038, .031, .030, .031);
    bezel.lineTo(-.030, .031);
    bezel.quadraticCurveTo(-.038, .031, -.038, .023);
    bezel.lineTo(-.038, -.026);
    bezel.quadraticCurveTo(-.038, -.034, -.030, -.034);
    const faceplate = new Mesh(new ShapeGeometry(bezel), new MeshStandardMaterial({ color: 0x17171d, roughness: .6 }));
    faceplate.position.z = .00711;
    glass.add(faceplate);
    const lcd = new Mesh(new PlaneGeometry(.0611, .0407), new MeshStandardMaterial({ color: 0x31332d, roughness: .35 }));
    lcd.name = "Totem GBA showcase LCD";
    lcd.position.set(0, .0022, .00713);
    glass.add(lcd);
  }

  const tint = { value: new Color() };
  const tintAmount = { value: 0 };
  const shellOpacity = { value: 1 };
  shell.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { tint, tintAmount, shellOpacity });
    shader.fragmentShader = "uniform vec3 tint; uniform float tintAmount; uniform float shellOpacity;\n" +
      shader.fragmentShader.replace("#include <map_fragment>", `
        #include <map_fragment>
        // Recolour the purple plastic while preserving printed labels and fittings.
        float plastic = smoothstep(.025, .075, diffuseColor.b - diffuseColor.g) * tintAmount;
        vec3 finish = tint * clamp(.5 + diffuseColor.b * 2.4, .5, 1.35);
        diffuseColor.rgb = mix(diffuseColor.rgb, finish, plastic);
        diffuseColor.a *= mix(1.0, shellOpacity, plastic);
      `);
  };
  scene.userData.applyGameBoyAdvanceSkin = skin => {
    tintAmount.value = skin.name === "Indigo" ? 0 : 1;
    tint.value.set(skin.color);
    shellOpacity.value = skin.opacity ?? 1;
    shell.metalness = skin.metalness ?? 1;
    const transparent = Boolean(skin.opacity);
    if (shell.transparent !== transparent) {
      shell.transparent = transparent;
      shell.needsUpdate = true;
    }
  };
}

function refineGameBoyAdvanceOutline(mesh) {
  const { geometry } = mesh;
  const { position, normal } = geometry.attributes;
  const direction = new Vector3();
  const smoothSlope = (value, span) => {
    const t = MathUtils.clamp(value / span, 0, 1);
    return 6 * t * (1 - t) / span;
  };
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) + mesh.position.x;
    const y = position.getY(i) + mesh.position.y;
    const outer = MathUtils.smoothstep(Math.abs(x), .039, .072);
    if (outer === 0) continue;

    // Preserve the control area and centre of the case. Lower the shoulder
    // line and keep more material around the lower outside corners.
    const edge = MathUtils.smoothstep(Math.abs(y), .003, .029);
    const drop = y > 0 ? .009 : .008;
    position.setY(i, position.getY(i) - drop * outer * edge);
    if (normal) {
      const dx = -drop * edge * smoothSlope(Math.abs(x) - .039, .033) * Math.sign(x);
      const dy = 1 - drop * outer * smoothSlope(Math.abs(y) - .003, .026) * Math.sign(y);
      const ny = normal.getY(i) / dy;
      direction.set(normal.getX(i) - dx * ny, ny, normal.getZ(i)).normalize();
      normal.setXYZ(i, direction.x, direction.y, direction.z);
    }
  }
  position.needsUpdate = true;
  if (normal) normal.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function splitSnesCartridgeDoor(scene) {
  const shell = scene.getObjectByName("Object094_01_-_Default_0");
  if (!shell?.isMesh) return;
  const isDoor = (bounds) => bounds.min.x > -8.28 && bounds.max.x < -4.72 &&
    bounds.min.y > 9.03 && bounds.max.y < 10.04 &&
    bounds.min.z > -52.15 && bounds.max.z < -30.17 && bounds.max.z - bounds.min.z > 21;
  scene.updateMatrixWorld(true);
  const parts = splitMeshIntoConnectedComponents(shell, isDoor);
  if (parts.length < 2) return;
  const door = parts.find(part => isDoor(part.geometry.boundingBox.clone().applyMatrix4(part.matrixWorld)));
  if (!door) return;
  const pivot = new Group();
  pivot.name = "TotemSnesCartridgeFlap";
  pivot.position.set(-4.85, 9.98, -41.156);
  scene.add(pivot);
  pivot.attach(door);
}

function configureTopLoadingConsole(scene, platformId) {
  scene.updateMatrixWorld(true);
  let lids = [];
  if (platformId === "playstation") {
    const lid = scene.getObjectByName("Object_12");
    if (lid?.isMesh && lid.parent.name === "PS1_2") {
      lids = [lid];
      const rim = splitPlayStationLidRim(scene.getObjectByName("Object_8"), lid);
      if (rim) lids.push(rim);
    }
  } else {
    const shells = [];
    scene.traverse((part) => {
      if (part.isMesh && (platformId === "gamecube"
        ? part.parent.name === "gamecubeobjcleanermaterialmergergles"
        : part.parent.name === "pCube12")) shells.push(part);
    });
    const isLid = platformId === "gamecube"
      ? (bounds) => bounds.min.y > 7 && bounds.max.x - bounds.min.x > 3 &&
        bounds.min.x > -3.8 && bounds.max.x < 3.8 &&
        bounds.min.z > -5.3 && bounds.max.z < 4.3
      : (bounds) => bounds.min.y > 5.4 && bounds.max.y > 5.7 &&
      bounds.min.x > -14.3 && bounds.max.x < 0.2 &&
      bounds.min.z > -5 && bounds.max.z < 8.4;
    for (const shell of shells) {
      for (const piece of splitMeshIntoConnectedComponents(shell, isLid)) {
        if (isLid(new Box3().setFromObject(piece))) lids.push(piece);
      }
    }
  }
  if (!lids.length) return;
  const bounds = new Box3();
  for (const lid of lids) bounds.union(new Box3().setFromObject(lid));
  const center = bounds.getCenter(new Vector3());
  const radius = Math.min(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) *
    (platformId === "gamecube" ? 0.38 : 0.46);
  const hingeBounds = platformId === "playstation" ? new Box3().setFromObject(lids[0]) : bounds;
  const pivot = [center.x, hingeBounds.min.y, hingeBounds.min.z];
  if (platformId === "gamecube") {
    const badge = lids.find((part) => part.name.startsWith("Object_9"));
    if (badge) center.z = new Box3().setFromObject(badge).getCenter(new Vector3()).z;
  }
  for (const lid of lids) {
    lid.userData.topLoaderAnimation = { role: "lid", pivot, axis: [1, 0, 0], closedAngle: 0 };
    for (const material of Array.isArray(lid.material) ? lid.material : [lid.material])
      material.side = DoubleSide;
  }
  // The supplied models have no disc or optical well beneath the lid.
  const deckY = bounds.min.y - radius * 0.025;
  const well = new Mesh(new CircleGeometry(radius * 1.02, 64),
    new MeshStandardMaterial({ color: 0x111217, roughness: 0.85, side: DoubleSide }));
  well.name = "Optical disc well";
  well.rotation.x = -Math.PI / 2;
  well.position.set(center.x, deckY, center.z);
  scene.add(well);
  const disc = new Mesh(new RingGeometry(radius * 0.14, radius * 0.93, 64),
    new MeshStandardMaterial({ color: 0xd5d9e1, metalness: 0.55, roughness: 0.32, side: DoubleSide }));
  disc.name = "Optical disc";
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(center.x, deckY + radius * 0.008, center.z);
  // A small label sector makes rotation visible on the otherwise plain disc.
  disc.geometry.clearGroups();
  disc.geometry.addGroup(0, 48, 1);
  disc.geometry.addGroup(48, disc.geometry.index.count - 48, 0);
  disc.material = [disc.material, new MeshStandardMaterial({ color: 0x414a62, roughness: 0.5, side: DoubleSide })];
  disc.userData.topLoaderAnimation = {
    role: "disc", pivot: disc.position.toArray(), axis: [0, 1, 0],
  };
  scene.add(disc);
}

function splitPlayStationLidRim(shell, lid) {
  if (!shell?.isMesh || shell.parent !== lid.parent || !shell.geometry.index) return null;
  const bounds = new Box3().setFromObject(lid);
  const center = bounds.getCenter(new Vector3());
  const radius = (bounds.max.x - bounds.min.x) / 2;
  const source = shell.geometry;
  const retained = [], moving = [];
  // This asset joins the lid's upper bevel and skirt to the chassis. The
  // deeper cylindrical wall belongs to the fixed optical compartment.
  for (let offset = 0; offset < source.index.count; offset += 3) {
    const triangle = [0, 1, 2].map((corner) => source.index.getX(offset + corner));
    const isRim = triangle.every((index) => {
      const point = new Vector3().fromBufferAttribute(source.attributes.position, index)
        .applyMatrix4(shell.matrixWorld);
      const distance = Math.hypot(point.x - center.x, point.z - center.z);
      return point.y > bounds.max.y - radius * 0.05 &&
        distance > radius * 0.97 && distance < radius * 1.02;
    });
    (isRim ? moving : retained).push(...triangle);
  }
  if (!moving.length || !retained.length) return null;
  // Both parts retain the imported UVs, normals and material. Compact the rim
  // vertices so its bounds describe the lid rather than the entire chassis.
  const rimGeometry = source.clone();
  rimGeometry.setIndex(moving);
  const rim = new Mesh(rimGeometry.toNonIndexed(), shell.material);
  rimGeometry.dispose();
  rim.name = "PlayStation lid sides";
  rim.position.copy(shell.position);
  rim.quaternion.copy(shell.quaternion);
  rim.scale.copy(shell.scale);
  shell.geometry = source.clone();
  shell.geometry.setIndex(retained);
  shell.parent.add(rim);
  let shared = false;
  shell.parent.traverse((part) => { if (part.isMesh && part.geometry === source) shared = true; });
  if (!shared) source.dispose();
  return rim;
}

function configureDreamcastPivots(scene) {
  scene.updateMatrixWorld(true);
  const localDirection = (part, direction) => {
    const worldOrigin = scene.getWorldPosition(new Vector3());
    const worldDirection = direction.transformDirection(part.matrixWorld);
    return scene.worldToLocal(worldDirection.add(worldOrigin)).normalize();
  };
  scene.traverse((part) => {
    if (!part.isMesh) return;
    if (part.name === "Disc_Disc_0") {
      part.userData.dreamcastAnimation = {
        role: "disc",
        pivot: scene.worldToLocal(part.getWorldPosition(new Vector3())).toArray(),
        axis: localDirection(part, new Vector3(0, 0, 1)).toArray(),
      };
    }
    let hinge = part.parent;
    while (hinge && hinge.name !== "Door_Axis") hinge = hinge.parent;
    if (!hinge) return;
    const lid = scene.getObjectByName("Door_Door_and_ports_0");
    if (!lid) return;
    const axis = localDirection(lid, new Vector3(1, 0, 0));
    const normal = localDirection(lid, new Vector3(0, 0, 1));
    const disc = scene.getObjectByName("Disc_Disc_0");
    const up = disc
      ? localDirection(disc, new Vector3(0, 0, 1))
      : new Vector3(0, 1, 0);
    const closedAngle = MathUtils.radToDeg(Math.atan2(
      axis.dot(normal.clone().cross(up)), normal.dot(up),
    ));
    part.userData.dreamcastAnimation = {
      role: "lid",
      pivot: scene.worldToLocal(hinge.getWorldPosition(new Vector3())).toArray(),
      axis: axis.toArray(),
      closedAngle,
    };
  });
}

function matchDreamcastShellMaterials(scene) {
  const materials = new Map();
  scene.traverse((part) => {
    if (!part.isMesh) return;
    for (const material of Array.isArray(part.material) ? part.material : [part.material])
      materials.set(material.name, material);
  });
  const lid = materials.get("Door_and_ports");
  const shell = materials.get("Case");
  if (lid?.color && shell?.color) shell.color.copy(lid.color);
  // The source export flags the opaque plastic shell and printed disc as
  // transmissive/alpha blended, exposing internal geometry through the case.
  for (const name of ["Case", "Disc"]) {
    const material = materials.get(name);
    if (!material) continue;
    material.transparent = false;
    material.opacity = 1;
    material.depthWrite = true;
    if ("transmission" in material) material.transmission = 0;
    material.needsUpdate = true;
  }
  for (const material of materials.values()) {
    for (const value of Object.values(material)) {
      if (!value?.isTexture) continue;
      value.anisotropy = 8;
      value.needsUpdate = true;
    }
  }
}

export function setModelActivity(model, active, deltaSeconds = 0, focus = active ? 1 : 0, reduceMotion = false, camera) {
  const amiga = model?.userData.amigaShowcase;
  if (amiga) updateAmigaShowcase(amiga, active, deltaSeconds, focus, reduceMotion);
  updateConsoleActivity(model, active, deltaSeconds, focus, reduceMotion, camera);
}

function collectAnimationMeshes(scene) {
  const meshes = [];
  scene.traverse((part) => {
    if (!part.isMesh) return;
    const path = [];
    for (let node = part; node && node !== scene; node = node.parent) {
      const index = node.parent?.children.indexOf(node) ?? 0;
      path.unshift(`${node.name || node.type}[${index}]`);
    }
    const key = part.userData.animationMeshKeyOverride ?? path.join("/");
    part.userData.animationMeshKey = key;
    part.updateWorldMatrix(true, false);
    const bounds = new Box3().setFromObject(part);
    meshes.push({
      key,
      name: part.name || `Mesh ${meshes.length + 1}`,
      centre: bounds.getCenter(new Vector3()).toArray(),
      ...(part.userData.dreamcastAnimation
        ? { dreamcastAnimation: part.userData.dreamcastAnimation }
        : {}),
      ...(part.userData.topLoaderAnimation ? { topLoaderAnimation: part.userData.topLoaderAnimation } : {}),
    });
  });
  return meshes;
}

function split3dsHingeMeshes(scene) {
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((part) => {
    if (part.isMesh) meshes.push(part);
  });
  for (const part of meshes) {
    const sourceName = part.name;
    if (SPLIT_3DS_COMPONENT_MESHES.has(sourceName)) {
      // These merged CAD meshes contain complete lower-shell pieces whose
      // upper edges extend past the hinge. Cutting at the hinge turned those
      // edges into moving slivers. Classify each intact component instead.
      for (const piece of splitMeshIntoConnectedComponents(part)) {
        piece.geometry.computeBoundingBox();
        const moving = piece.geometry.boundingBox.min.y + piece.position.y >= 0.037;
        piece.name += moving ? " - Lid" : " - Bottom";
        if (moving)
          piece.userData.animationMeshKeyOverride = `${animationKeyForMesh(piece)}#lid`;
      }
      continue;
    }
    if (part.name === "BackCover") {
      splitBackCoverComponents(
        part,
        0.037,
        `${part.name} - Bottom`,
        `${part.name} - Lid`,
      );
      continue;
    }
    // The bundled 3DS GLB is Y-up, with direct scene children and a hinge at
    // world Y=0.0341. Split every crossing mesh along the hinge line.
    const baseKey = animationKeyForMesh(part);
    const splitKey = splitMeshAtLocalAxis(
      part,
      0.0341 - part.position.y,
      `${part.name} - Bottom`,
      `${part.name} - Lid`,
      1,
    );
    if (splitKey === baseKey) {
      part.name = `${part.name} - Lid`;
      part.userData.animationMeshKeyOverride = `${baseKey}#lid`;
    }
  }
}

function splitMeshIntoConnectedComponents(mesh, classify = null) {
  const source = mesh.geometry;
  if (!source.index || source.morphAttributes.position?.length) return [mesh];
  const positions = source.attributes.position;
  const indices = source.index;
  const parent = Int32Array.from({ length: positions.count }, (_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  const coincidentVertices = new Map();
  for (let index = 0; index < positions.count; index++) {
    const key = [0, 1, 2]
      .map((axis) => Math.round(positions.getComponent(index, axis) * 1_000_000))
      .join(",");
    const match = coincidentVertices.get(key);
    if (match === undefined) coincidentVertices.set(key, index);
    else union(index, match);
  }

  const start = Math.max(0, source.drawRange.start);
  const end = Math.min(indices.count, start + source.drawRange.count);
  const firstTriangle = start - (start % 3);
  for (let offset = firstTriangle; offset + 2 < end; offset += 3) {
    const triangle = [indices.getX(offset), indices.getX(offset + 1), indices.getX(offset + 2)];
    union(triangle[0], triangle[1]);
    union(triangle[0], triangle[2]);
  }
  const trianglesByComponent = new Map();
  for (let offset = firstTriangle; offset + 2 < end; offset += 3) {
    const triangle = [indices.getX(offset), indices.getX(offset + 1), indices.getX(offset + 2)];
    const root = find(triangle[0]);
    if (!trianglesByComponent.has(root)) trianglesByComponent.set(root, []);
    trianglesByComponent.get(root).push({ offset, triangle });
  }
  if (classify) {
    const grouped = new Map();
    for (const triangles of trianglesByComponent.values()) {
      const bounds = new Box3();
      for (const { triangle } of triangles)
        for (const index of triangle)
          bounds.expandByPoint(new Vector3().fromBufferAttribute(positions, index));
      const side = classify(bounds.applyMatrix4(mesh.matrixWorld));
      if (!grouped.has(side)) grouped.set(side, []);
      for (const triangle of triangles) grouped.get(side).push(triangle);
    }
    trianglesByComponent.clear();
    for (const [side, triangles] of grouped) trianglesByComponent.set(side, triangles);
  }
  if (trianglesByComponent.size < 2) return [mesh];

  const materialAt = (offset) =>
    source.groups.find((group) => offset >= group.start && offset < group.start + group.count)?.materialIndex ?? 0;
  const components = [...trianglesByComponent.entries()]
    .map(([root, triangles]) => ({ root, triangles, firstIndex: Math.min(...triangles[0].triangle) }))
    .sort((a, b) => a.firstIndex - b.firstIndex);
  const baseKey = animationKeyForMesh(mesh);
  const lidComponent = baseKey.endsWith("#lid");
  const baseName = mesh.name;
  const originalGeometry = mesh.geometry;
  const buildGeometry = (triangles) => {
    const geometry = new BufferGeometry();
    const vertexMap = new Map();
    const attributes = Object.fromEntries(
      Object.keys(source.attributes).map((name) => [name, []]),
    );
    const groups = new Map();
    for (const { offset, triangle } of triangles) {
      const materialIndex = materialAt(offset);
      if (!groups.has(materialIndex)) groups.set(materialIndex, []);
      const group = groups.get(materialIndex);
      for (const oldIndex of triangle) {
        let newIndex = vertexMap.get(oldIndex);
        if (newIndex === undefined) {
          newIndex = vertexMap.size;
          vertexMap.set(oldIndex, newIndex);
          for (const [name, attribute] of Object.entries(source.attributes)) {
            const values = attributes[name];
            for (let component = 0; component < attribute.itemSize; component++)
              values.push(attribute.getComponent(oldIndex, component));
          }
        }
        group.push(newIndex);
      }
    }
    for (const [name, values] of Object.entries(attributes))
      geometry.setAttribute(name, new Float32BufferAttribute(values, source.attributes[name].itemSize));
    const outputIndices = [];
    for (const [materialIndex, group] of groups) {
      const groupStart = outputIndices.length;
      for (const index of group) outputIndices.push(index);
      geometry.addGroup(groupStart, group.length, materialIndex);
    }
    geometry.setIndex(outputIndices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  };

  let geometryIsShared = false;
  (mesh.parent ?? mesh).traverse((part) => {
    if (part !== mesh && part.isMesh && part.geometry === originalGeometry)
      geometryIsShared = true;
  });
  const pieces = components.map((component, index) => {
    const piece = index === 0 ? mesh : mesh.clone(false);
    piece.geometry = buildGeometry(component.triangles);
    piece.name = `${baseName} - Part ${String(index + 1).padStart(2, "0")}`;
    piece.userData.animationMeshKeyOverride =
      `${baseKey}#part-${String(index + 1).padStart(2, "0")}${lidComponent ? "#lid" : ""}`;
    if (index > 0) mesh.parent.add(piece);
    return piece;
  });
  if (!geometryIsShared) originalGeometry.dispose();
  return pieces;
}

function splitBackCoverComponents(mesh, movingMinY, bottomName, lidName) {
  const source = mesh.geometry;
  if (!source.index || source.morphAttributes.position?.length) return;
  const indices = source.index;
  const positions = source.attributes.position;
  const parent = Int32Array.from({ length: positions.count }, (_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  const start = Math.max(0, source.drawRange.start);
  const end = Math.min(indices.count, start + source.drawRange.count);
  const firstTriangle = start - (start % 3);
  for (let offset = firstTriangle; offset + 2 < end; offset += 3) {
    const a = indices.getX(offset);
    const b = indices.getX(offset + 1);
    const c = indices.getX(offset + 2);
    union(a, b);
    union(a, c);
  }
  const componentMinY = new Map();
  for (let offset = firstTriangle; offset + 2 < end; offset += 3) {
    for (let corner = 0; corner < 3; corner++) {
      const index = indices.getX(offset + corner);
      const root = find(index);
      componentMinY.set(root, Math.min(componentMinY.get(root) ?? Infinity, positions.getY(index)));
    }
  }

  const sides = [0, 1].map(() => ({
    vertexMap: new Map(),
    attributes: Object.fromEntries(Object.keys(source.attributes).map((name) => [name, []])),
    groups: new Map(),
  }));
  const materialAt = (offset) =>
    source.groups.find((group) => offset >= group.start && offset < group.start + group.count)?.materialIndex ?? 0;
  for (let offset = firstTriangle; offset + 2 < end; offset += 3) {
    const component = find(indices.getX(offset));
    const side = sides[(componentMinY.get(component) ?? -Infinity) >= movingMinY ? 1 : 0];
    const materialIndex = materialAt(offset);
    let group = side.groups.get(materialIndex);
    if (!group) side.groups.set(materialIndex, (group = []));
    for (let corner = 0; corner < 3; corner++) {
      const oldIndex = indices.getX(offset + corner);
      let newIndex = side.vertexMap.get(oldIndex);
      if (newIndex === undefined) {
        newIndex = side.vertexMap.size;
        side.vertexMap.set(oldIndex, newIndex);
        for (const [name, attribute] of Object.entries(source.attributes)) {
          const values = side.attributes[name];
          for (let componentIndex = 0; componentIndex < attribute.itemSize; componentIndex++)
            values.push(attribute.getComponent(oldIndex, componentIndex));
        }
      }
      group.push(newIndex);
    }
  }
  const buildGeometry = (side) => {
    const geometry = new BufferGeometry();
    for (const [name, values] of Object.entries(side.attributes))
      geometry.setAttribute(name, new Float32BufferAttribute(values, source.attributes[name].itemSize));
    const outputIndices = [];
    for (const [materialIndex, group] of side.groups) {
      const groupStart = outputIndices.length;
      outputIndices.push(...group);
      geometry.addGroup(groupStart, group.length, materialIndex);
    }
    geometry.setIndex(outputIndices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  };
  const bottomGeometry = buildGeometry(sides[0]);
  const lidGeometry = buildGeometry(sides[1]);
  if (!bottomGeometry.index?.count || !lidGeometry.index?.count) {
    bottomGeometry.dispose();
    lidGeometry.dispose();
    return;
  }
  const originalGeometry = mesh.geometry;
  const baseKey = animationKeyForMesh(mesh);
  mesh.geometry = bottomGeometry;
  mesh.name = bottomName;
  mesh.userData.animationMeshKeyOverride = baseKey;
  const lidMesh = mesh.clone(false);
  lidMesh.geometry = lidGeometry;
  lidMesh.name = lidName;
  lidMesh.userData.animationMeshKeyOverride = `${baseKey}#lid`;
  mesh.parent.add(lidMesh);
  let geometryIsShared = false;
  (mesh.parent ?? mesh).traverse((part) => {
    if (part !== mesh && part.isMesh && part.geometry === originalGeometry)
      geometryIsShared = true;
  });
  if (!geometryIsShared) originalGeometry.dispose();
}

function splitGameWatchMeshes(scene) {
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((part) => {
    if (part.isMesh) meshes.push(part);
  });
  for (const part of meshes) {
    // The model is Y-up and its hinge line is at Y = 0.034. The bundled GLB
    // stores each component as a direct scene child with translation only.
    splitMeshAtLocalAxis(
      part,
      0.034 - part.position.y,
      `${part.name} - Bottom`,
      `${part.name} - Lid`,
      1,
    );
  }
}

function splitSwitchJoyCons(scene) {
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((part) => { if (part.isMesh) meshes.push(part); });
  for (const mesh of meshes) {
    if (!mesh.geometry.index || mesh.geometry.morphAttributes.position?.length) continue;
    const baseKey = animationKeyForMesh(mesh);
    mesh.geometry.computeBoundingBox();
    const minX = mesh.geometry.boundingBox.min.x + mesh.position.x;
    const maxX = mesh.geometry.boundingBox.max.x + mesh.position.x;
    let middle = mesh;
    const leftEdge = -0.086;
    const rightEdge = 0.086;
    if (maxX <= leftEdge) {
      mesh.userData.animationMeshKeyOverride = `${baseKey}#left-joycon`;
      continue;
    }
    if (minX < leftEdge) {
      const rightSide = splitMeshAtLocalAxis(
        mesh, leftEdge - mesh.position.x, `${mesh.name} - Left Joy-Con`,
        `${mesh.name} - Body and Right Joy-Con`, 0,
      );
      if (rightSide) {
        mesh.userData.animationMeshKeyOverride = `${baseKey}#left-joycon`;
        middle = rightSide;
      }
    }
    middle.geometry.computeBoundingBox();
    const remainingMin = middle.geometry.boundingBox.min.x + middle.position.x;
    const remainingMax = middle.geometry.boundingBox.max.x + middle.position.x;
    if (remainingMin >= rightEdge) {
      middle.userData.animationMeshKeyOverride = `${baseKey}#right-joycon`;
    } else if (remainingMax > rightEdge) {
      const rightSide = splitMeshAtLocalAxis(
        middle, rightEdge - middle.position.x, `${middle.name} - Tablet`,
        `${middle.name} - Right Joy-Con`, 0,
      );
      middle.userData.animationMeshKeyOverride = baseKey;
      if (rightSide) rightSide.userData.animationMeshKeyOverride = `${baseKey}#right-joycon`;
    } else {
      middle.userData.animationMeshKeyOverride = baseKey;
    }
  }
}

function animationKeyForMesh(mesh) {
  if (mesh.userData.animationMeshKeyOverride)
    return mesh.userData.animationMeshKeyOverride;
  const path = [];
  for (let node = mesh; node && node.parent; node = node.parent) {
    const index = node.parent.children.indexOf(node);
    path.unshift(`${node.name || node.type}[${index}]`);
  }
  return path.join("/");
}

function splitMeshAtLocalAxis(mesh, threshold, bottomName, lidName, axis = 1) {
  if (!mesh.geometry.index || mesh.geometry.morphAttributes.position?.length)
    return null;
  const source = mesh.geometry;
  const position = source.attributes.position;
  if (!position || position.itemSize < 2) return;
  const baseKey = animationKeyForMesh(mesh);
  const coordinate = (vertex) => vertex.position[axis];
  let hasBottom = false;
  let hasLid = false;
  const indices = source.index;
  for (let offset = 0; offset + 2 < indices.count; offset += 3) {
    const values = [0, 1, 2].map((corner) =>
      position.getComponent(indices.getX(offset + corner), axis),
    );
    hasBottom ||= Math.min(...values) < threshold;
    hasLid ||= Math.max(...values) > threshold;
    if (hasBottom && hasLid) break;
  }
  if (!hasBottom) return baseKey;
  if (!hasLid) return null;
  const sides = [new Map(), new Map()];
  const componentValue = (attribute, index, component) => {
    switch (component) {
      case 0: return attribute.getX(index);
      case 1: return attribute.getY(index);
      case 2: return attribute.getZ(index);
      case 3: return attribute.getW(index);
      default: return attribute.array[index * attribute.itemSize + component];
    }
  };
  const readVertex = (index) => Object.fromEntries(
    Object.entries(source.attributes).map(([name, attribute]) => [
      name,
      Array.from({ length: attribute.itemSize }, (_, component) =>
        componentValue(attribute, index, component)),
    ]),
  );
  const interpolate = (a, b, amount) => {
    const vertex = {};
    for (const name of Object.keys(source.attributes))
      vertex[name] = a[name].map((value, i) => value + (b[name][i] - value) * amount);
    if (vertex.normal) {
      const length = Math.hypot(...vertex.normal) || 1;
      vertex.normal = vertex.normal.map((value) => value / length);
    }
    return vertex;
  };
  const clip = (polygon, keepLid) => {
    const result = [];
    for (let i = 0; i < polygon.length; i++) {
      const current = polygon[i];
      const previous = polygon[(i + polygon.length - 1) % polygon.length];
      const currentInside = keepLid ? coordinate(current) >= threshold : coordinate(current) <= threshold;
      const previousInside = keepLid ? coordinate(previous) >= threshold : coordinate(previous) <= threshold;
      if (currentInside !== previousInside) {
        const amount = (threshold - coordinate(previous)) / (coordinate(current) - coordinate(previous));
        result.push(interpolate(previous, current, amount));
      }
      if (currentInside) result.push(current);
    }
    return result;
  };
  const materialAt = (offset) =>
    source.groups.find((group) => offset >= group.start && offset < group.start + group.count)?.materialIndex ?? 0;
  const attributeEntries = Object.entries(source.attributes);
  // Most triangles are entirely on one side. Copy their original attributes
  // directly; only triangles crossing the cut need polygon objects/clipping.
  const appendSourceTriangle = (side, materialIndex, a, b, c) => {
    let builder = sides[side].get(materialIndex);
    if (!builder) {
      builder = Object.fromEntries(attributeEntries.map(([name]) => [name, []]));
      sides[side].set(materialIndex, builder);
    }
    for (const [name, attribute] of attributeEntries) {
      const destination = builder[name];
      for (const index of [a, b, c])
        for (let component = 0; component < attribute.itemSize; component++)
          destination.push(componentValue(attribute, index, component));
    }
  };
  const appendTriangle = (side, materialIndex, vertices) => {
    let builder = sides[side].get(materialIndex);
    if (!builder) {
      builder = Object.fromEntries(Object.keys(source.attributes).map((name) => [name, []]));
      sides[side].set(materialIndex, builder);
    }
    for (const vertex of vertices)
      for (const [name, values] of Object.entries(vertex)) builder[name].push(...values);
  };

  const drawStart = Math.max(0, source.drawRange.start);
  const drawEnd = Math.min(indices.count, drawStart + source.drawRange.count);
  for (let offset = drawStart - (drawStart % 3); offset + 2 < drawEnd; offset += 3) {
    const a = indices.getX(offset), b = indices.getX(offset + 1), c = indices.getX(offset + 2);
    const av = position.getComponent(a, axis), bv = position.getComponent(b, axis), cv = position.getComponent(c, axis);
    const minValue = Math.min(av, bv, cv);
    const maxValue = Math.max(av, bv, cv);
    const materialIndex = materialAt(offset);
    if (minValue > threshold || (minValue === threshold && maxValue === threshold)) {
      appendSourceTriangle(1, materialIndex, a, b, c);
      continue;
    }
    if (maxValue < threshold) {
      appendSourceTriangle(0, materialIndex, a, b, c);
      continue;
    }
    const triangle = [readVertex(a), readVertex(b), readVertex(c)];
    for (const [side, keepLid] of [[0, false], [1, true]]) {
      const polygon = clip(triangle, keepLid);
      for (let i = 1; i + 1 < polygon.length; i++)
        appendTriangle(side, materialIndex, [polygon[0], polygon[i], polygon[i + 1]]);
    }
  }

  const buildGeometry = (materialGroups) => {
    const geometry = new BufferGeometry();
    const attributes = Object.fromEntries(Object.keys(source.attributes).map((name) => [name, []]));
    const index = [];
    for (const [materialIndex, builder] of materialGroups) {
      const vertexOffset = attributes.position.length / source.attributes.position.itemSize;
      const groupStart = index.length;
      for (const [name, values] of Object.entries(builder)) {
        const destination = attributes[name];
        for (let i = 0; i < values.length; i++) destination.push(values[i]);
      }
      const vertexCount = builder.position.length / source.attributes.position.itemSize;
      for (let i = 0; i < vertexCount; i++) index.push(vertexOffset + i);
      geometry.addGroup(groupStart, index.length - groupStart, materialIndex);
    }
    for (const [name, values] of Object.entries(attributes))
      geometry.setAttribute(name, new Float32BufferAttribute(values, source.attributes[name].itemSize));
    geometry.setIndex(index);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  };
  const bottomGeometry = buildGeometry(sides[0]);
  const lidGeometry = buildGeometry(sides[1]);
  if (!bottomGeometry.index?.count || !lidGeometry.index?.count) {
    bottomGeometry.dispose();
    lidGeometry.dispose();
    return;
  }

  const originalGeometry = mesh.geometry;
  mesh.geometry = bottomGeometry;
  mesh.name = bottomName;
  mesh.userData.animationMeshKeyOverride = baseKey;
  const lidMesh = mesh.clone(false);
  lidMesh.geometry = lidGeometry;
  lidMesh.name = lidName;
  lidMesh.userData.animationMeshKeyOverride = `${baseKey}#lid`;
  mesh.parent.add(lidMesh);
  let geometryIsShared = false;
  (mesh.parent ?? mesh).traverse((part) => {
    if (part !== mesh && part.isMesh && part.geometry === originalGeometry) geometryIsShared = true;
  });
  if (!geometryIsShared) originalGeometry.dispose();
  return lidMesh;
}

export function validateModelAnimations(value) {
  if (value == null) return { version: 1, transitionDelayMs: 100, groups: [] };
  const groups = value?.groups;
  if (
    value.version !== 1 ||
    !Array.isArray(groups) ||
    groups.length > 64 ||
    (value.transitionDelayMs !== undefined &&
      (!Number.isFinite(value.transitionDelayMs) || value.transitionDelayMs < 0 || value.transitionDelayMs > 5000)) ||
    (value.configured !== undefined && typeof value.configured !== "boolean") ||
    (value.closeWhenActive !== undefined && typeof value.closeWhenActive !== "boolean") ||
    (value.meshSplitsVersion !== undefined && ![1, 2, 3, 4, 5, 6].includes(value.meshSplitsVersion))
  )
    throw new Error("Invalid model animation groups.");
  const groupIds = new Set();
  const assignedMeshes = new Set();
  const validated = groups.map((group) => {
    if (
      !group ||
      typeof group.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,39}$/.test(group.id) ||
      groupIds.has(group.id) ||
      typeof group.name !== "string" ||
      !group.name.trim() ||
      group.name.length > 80 ||
      !Array.isArray(group.meshes) ||
      !group.meshes.length ||
      group.meshes.length > 256 ||
      new Set(group.meshes).size !== group.meshes.length ||
      group.meshes.some((key) => typeof key !== "string" || key.length > 512) ||
      group.meshes.some((key) => assignedMeshes.has(key)) ||
      !Array.isArray(group.pivot) ||
      group.pivot.length !== 3 ||
      group.pivot.some((value) => !Number.isFinite(value) || Math.abs(value) > 100000) ||
      (group.translation !== undefined && (!Array.isArray(group.translation) || group.translation.length !== 3 || group.translation.some((value) => !Number.isFinite(value) || Math.abs(value) > 100000))) ||
      (group.startProgress !== undefined && (!Number.isFinite(group.startProgress) || group.startProgress < 0 || group.startProgress > 1)) ||
      (group.endProgress !== undefined && (!Number.isFinite(group.endProgress) || group.endProgress < 0 || group.endProgress > 1)) ||
      ((group.startProgress !== undefined || group.endProgress !== undefined) && (group.endProgress ?? 1) <= (group.startProgress ?? 0)) ||
      (group.spinRate !== undefined && (!Number.isFinite(group.spinRate) || Math.abs(group.spinRate) > 3600)) ||
      (group.reverseProgress !== undefined && typeof group.reverseProgress !== "boolean") ||
      !["x", "y", "z"].includes(group.axis) ||
      !Number.isFinite(group.closedAngle) ||
      Math.abs(group.closedAngle) > 360 ||
      !Number.isFinite(group.openAngle) ||
      Math.abs(group.openAngle) > 360 ||
      typeof group.enabled !== "boolean"
    )
      throw new Error("Invalid model animation settings or pivot.");
    groupIds.add(group.id);
    for (const key of group.meshes) assignedMeshes.add(key);
    return structuredClone(group);
  });
  return {
    version: 1,
    transitionDelayMs: value.transitionDelayMs ?? 100,
    ...(value.closeWhenActive === true ? { closeWhenActive: true } : {}),
    ...(value.configured === true ? { configured: true } : {}),
    ...([1, 2, 3, 4, 5, 6].includes(value.meshSplitsVersion)
      ? { meshSplitsVersion: value.meshSplitsVersion }
      : {}),
    groups: validated,
  };
}

export function normalizePlatformAnimations(platformId, value, meshList = []) {
  const settings = validateModelAnimations(value);
  if (platformId === "gwmulti" && settings.groups.length === 0 && !settings.configured) {
    settings.groups.push({
      id: "gamewatch-lid",
      name: "Upper Game & Watch half",
      meshes: ["Building0[8]"],
      pivot: [0, 0.034, 0.011],
      axis: "x",
      closedAngle: 90,
      openAngle: 0,
      enabled: true,
    });
  }
  if (platformId === "3ds") {
    const lid = settings.groups.find((group) => group.id === "3ds-lid");
    if (lid && (settings.meshSplitsVersion ?? 0) < 3 && meshList.length) {
      const splitLidKeys = [];
      for (const mesh of meshList)
        if (mesh.key.endsWith("#lid")) splitLidKeys.push(mesh.key);
      const splitBases = new Set(splitLidKeys.map((key) => key.slice(0, -4)));
      lid.meshes = lid.meshes.filter((key) => !splitBases.has(key));
      for (const key of splitLidKeys)
        if (!lid.meshes.includes(key)) lid.meshes.push(key);
      settings.meshSplitsVersion = 3;
    }
    if (lid && (settings.meshSplitsVersion ?? 0) < 4 && meshList.length) {
      for (const mesh of meshList)
        if (
          mesh.key.endsWith("#lid") &&
          ADDITIONAL_3DS_LID_MESH_PREFIXES.some((prefix) => mesh.key.startsWith(prefix)) &&
          !lid.meshes.includes(mesh.key)
        )
          lid.meshes.push(mesh.key);
      settings.meshSplitsVersion = 4;
    }
    if ((settings.meshSplitsVersion ?? 0) < 5 && meshList.length) {
      for (const group of settings.groups) {
        const splitMeshes = [];
        for (const key of group.meshes) {
          const components = meshList
            .filter((mesh) => mesh.key.startsWith(`${key}#part-`))
            .map((mesh) => mesh.key);
          if (components.length) splitMeshes.push(...components);
          else splitMeshes.push(key);
        }
        group.meshes = [...new Set(splitMeshes)];
      }
      settings.meshSplitsVersion = 5;
    }
    if (lid && (settings.meshSplitsVersion ?? 0) < 6 && meshList.length) {
      const affected = (key) =>
        ADDITIONAL_3DS_LID_MESH_PREFIXES.some((prefix) => key.startsWith(prefix));
      for (const group of settings.groups)
        group.meshes = group.meshes.filter((key) => !affected(key));
      lid.meshes.push(...meshList
        .filter((mesh) => affected(mesh.key) && mesh.key.endsWith("#lid"))
        .map((mesh) => mesh.key));
      settings.groups = settings.groups.filter((group) => group.meshes.length);
      settings.meshSplitsVersion = 6;
    }
  }
  if (platformId === "gwmulti") {
    const lid = settings.groups.find((group) => group.id === "gamewatch-lid");
    if (lid) {
      if (!settings.meshSplitsVersion) {
        for (const key of GAMEWATCH_LID_MESH_KEYS)
          if (!lid.meshes.includes(key)) lid.meshes.push(key);
      }
      settings.meshSplitsVersion = Math.max(settings.meshSplitsVersion ?? 0, 1);
    }
  }
  // Keep the Dreamcast's built-in lid/disc sequence available when an editor
  // save has marked animation settings as configured but contains no groups.
  if (["playstation", "saturn", "gamecube"].includes(platformId) && settings.groups.length === 0) {
    const lids = meshList.filter((mesh) => mesh.topLoaderAnimation?.role === "lid");
    const disc = meshList.find((mesh) => mesh.topLoaderAnimation?.role === "disc");
    if (lids.length && disc) {
      settings.closeWhenActive = true;
      settings.transitionDelayMs = 0;
      settings.groups.push(
        { id: `${platformId}-disc-spin`, name: "Disc spin", meshes: [disc.key],
          pivot: disc.topLoaderAnimation.pivot, axis: "y", closedAngle: 0, openAngle: 0,
          startProgress: 0, endProgress: 0.15, reverseProgress: true, spinRate: 540, enabled: true },
        { id: `${platformId}-lid`, name: "Disc lid", meshes: lids.map((mesh) => mesh.key),
          pivot: lids[0].topLoaderAnimation.pivot, axis: "x", closedAngle: 0, openAngle: -75,
          startProgress: 0, endProgress: 0.85, enabled: true },
      );
    }
  }
  if (platformId === "playstation") {
    const top = meshList.find((mesh) => mesh.name === "Object_12");
    const rim = meshList.find((mesh) => mesh.name === "PlayStation lid sides");
    const lid = settings.groups.find((group) => group.meshes.includes(top?.key));
    if (lid && rim && !lid.meshes.includes(rim.key)) lid.meshes.push(rim.key);
  }
  if (platformId === "dreamcast" && settings.groups.length === 0) {
    const lid = meshList.find((mesh) => mesh.name.replaceAll(" ", "_") === "Door_Door_and_ports_0")?.key;
    const disc = meshList.find((mesh) => mesh.name === "Disc_Disc_0")?.key;
    if (lid && disc) {
      settings.closeWhenActive = true;
      settings.transitionDelayMs = 0;
      settings.groups.push(
        {
          id: "dreamcast-disc-spin",
          name: "Dreamcast disc spin",
          meshes: [disc],
          pivot: [-0.0012, 6.3084, -1.0785],
          axis: "y",
          closedAngle: 0,
          openAngle: 0,
          startProgress: 0.05,
          endProgress: 0.3,
          spinRate: 540,
          reverseProgress: true,
          enabled: true,
        },
        {
          id: "dreamcast-lid",
          name: "Dreamcast lid",
          meshes: [lid],
          pivot: [-0.0164, 7.2928, -9.7073],
          axis: "x",
          closedAngle: 0,
          openAngle: 90,
          startProgress: 0,
          endProgress: 0.3,
          enabled: true,
        },
      );
    }
  }
  if (platformId === "dreamcast") {
    const disc = settings.groups.find((group) => group.id === "dreamcast-disc-spin");
    const lid = settings.groups.find((group) => group.id === "dreamcast-lid");
    if (disc && lid) {
      const discMesh = meshList.find((mesh) => mesh.dreamcastAnimation?.role === "disc");
      const lidMeshes = meshList.filter((mesh) => mesh.dreamcastAnimation?.role === "lid");
      if (discMesh) disc.pivot = [...discMesh.dreamcastAnimation.pivot];
      if (lidMeshes.length) {
        lid.pivot = [...lidMeshes[0].dreamcastAnimation.pivot];
        lid.closedAngle = lidMeshes[0].dreamcastAnimation.closedAngle;
        lid.openAngle = lid.closedAngle - 75;
        lid.meshes = lidMeshes.map((mesh) => mesh.key);
      }
      settings.closeWhenActive = true;
      settings.transitionDelayMs = 0;
      disc.startProgress = 0;
      disc.endProgress = 0.15;
      disc.reverseProgress = true;
      lid.startProgress = 0;
      lid.endProgress = DREAMCAST_LID_END_PROGRESS;
    }
  }
  if (platformId === "switch" && settings.groups.length === 0 && !settings.configured) {
    const left = meshList.filter((mesh) => mesh.key.endsWith("#left-joycon")).map((mesh) => mesh.key);
    const right = meshList.filter((mesh) => mesh.key.endsWith("#right-joycon")).map((mesh) => mesh.key);
    if (left.length && right.length) {
      settings.groups.push(
        { id: "switch-left-joycon", name: "Left Joy-Con", meshes: left, pivot: [0, 0, 0], axis: "x", closedAngle: 0, openAngle: 0, translation: [-0.035, 0.04, 0.035], startProgress: 0.15, endProgress: 0.85, enabled: true },
        { id: "switch-right-joycon", name: "Right Joy-Con", meshes: right, pivot: [0, 0, 0], axis: "x", closedAngle: 0, openAngle: 0, translation: [0.035, 0.04, 0.035], startProgress: 0.15, endProgress: 0.85, enabled: true },
      );
    }
  }
  if (platformId === "switch") {
    for (const group of settings.groups) {
      if (!["switch-left-joycon", "switch-right-joycon"].includes(group.id)) continue;
      group.startProgress = 0;
      group.endProgress = 1;
    }
  }
  return settings;
}

export function setModelMeshHighlight(model, meshKeys = []) {
  const selected = new Set(meshKeys);
  model?.traverse((part) => {
    if (!part.isMesh) return;
    const saved = part.userData.previewHighlight;
    if (saved) {
      part.material = saved.original;
      for (const material of saved.clones) material.dispose();
      delete part.userData.previewHighlight;
    }
    if (!selected.has(part.userData.animationMeshKey)) return;
    const original = part.material;
    const clones = (Array.isArray(original) ? original : [original]).map((material) => {
      const clone = material.clone();
      if (clone.emissive) {
        clone.emissive.set(0x27f2ff);
        clone.emissiveIntensity = Math.max(clone.emissiveIntensity ?? 1, 2.2);
      } else if (clone.color) {
        clone.color.lerp(new Color(0x27f2ff), 0.7);
      }
      return clone;
    });
    part.material = Array.isArray(original) ? clones : clones[0];
    part.userData.previewHighlight = { original, clones };
  });
}

function attachMeshAnimations(scene, value, showHelpers, modelSize) {
  const settings = validateModelAnimations(value);
  if (!settings.groups.length) return [];
  const meshesByKey = new Map();
  scene.traverse((part) => {
    if (part.isMesh) meshesByKey.set(part.userData.animationMeshKey, part);
  });
  const axisSize = Math.max(modelSize * 0.09, 0.01);
  const consoleTop = new Box3().setFromObject(scene).max.y;
  const tracks = [];
  for (const group of settings.groups) {
    const parts = group.meshes.map((key) => meshesByKey.get(key)).filter(Boolean);
    if (!parts.length) continue;
    const joyCon = ["switch-left-joycon", "switch-right-joycon"].includes(group.id);
    const joyConBottom = joyCon
      ? Math.min(...parts.map((part) => new Box3().setFromObject(part).min.y))
      : 0;
    const pivot = new Group();
    pivot.name = `Animation pivot · ${group.name}`;
    pivot.position.fromArray(group.pivot);
    if (joyCon) {
      const bounds = new Box3();
      for (const part of parts) bounds.union(new Box3().setFromObject(part));
      bounds.getCenter(pivot.position);
    }
    scene.add(pivot);
    scene.updateMatrixWorld(true);
    for (const part of parts) pivot.attach(part);
    const helper = showHelpers ? new AxesHelper(axisSize) : null;
    if (helper) {
      helper.name = `Animation pivot guide · ${group.name}`;
      helper.position.copy(pivot.position);
      helper.visible = false;
      scene.add(helper);
    }
    tracks.push({
      id: group.id,
      settings: group,
      pivot,
      basePosition: pivot.position.clone(),
      translation: group.translation ? new Vector3(...group.translation) : null,
      liftHeight: joyCon ? consoleTop - joyConBottom + modelSize * 0.015 : null,
      restingAngles: joyCon
        ? (group.id === "switch-left-joycon" ? [-8, -12, -10] : [6, 9, 13]).map(MathUtils.degToRad)
        : null,
      spinAngle: 0,
      axis: parts[0].userData.topLoaderAnimation
        ? new Vector3(...parts[0].userData.topLoaderAnimation.axis)
        : parts[0].userData.dreamcastAnimation &&
        ["dreamcast-disc-spin", "dreamcast-lid"].includes(group.id)
        ? new Vector3(...parts[0].userData.dreamcastAnimation.axis)
        : new Vector3(
        group.axis === "x" ? 1 : 0,
        group.axis === "y" ? 1 : 0,
        group.axis === "z" ? 1 : 0,
      ),
      helper,
    });
  }
  return tracks;
}

const DISC_SPIN_DELAY_SECONDS = 0.8;

export function setModelAnimationProgress(model, progress, activeGroupId = null, deltaSeconds = 0, active = true) {
  const t = MathUtils.clamp(progress, 0, 1);
  const tracks = model?.userData.animationTracks ?? [];
  for (const track of tracks) {
    const { settings, pivot, axis, helper } = track;
    const groupProgress = settings.reverseProgress ? 1 - t : t;
    const start = settings.startProgress ?? 0;
    const end = settings.endProgress ?? 1;
    const phase = MathUtils.clamp((groupProgress - start) / (end - start), 0, 1);
    let angle = settings.enabled
      ? settings.closedAngle + (settings.openAngle - settings.closedAngle) * phase
      : 0;
    if (settings.enabled && settings.spinRate) {
      let spinSeconds = Math.max(0, deltaSeconds);
      if (settings.id.endsWith("-disc-spin")) {
        const remaining = track.spinDelayRemaining ?? DISC_SPIN_DELAY_SECONDS;
        track.spinDelayRemaining = active ? Math.max(0, remaining - spinSeconds) : DISC_SPIN_DELAY_SECONDS;
        if (!active) track.spinAngle = 0;
        spinSeconds = active ? Math.max(0, spinSeconds - remaining) : 0;
      }
      track.spinAngle = (track.spinAngle + settings.spinRate * spinSeconds * phase) % 360;
      angle += track.spinAngle;
    }
    pivot.quaternion.setFromAxisAngle(axis, MathUtils.degToRad(angle));
    pivot.position.copy(track.basePosition);
    if (settings.enabled && track.translation) {
      if (track.liftHeight !== null && track.liftHeight !== undefined) {
        const liftPhase = MathUtils.smoothstep(phase, 0, 0.6);
        const detachPhase = MathUtils.smoothstep(phase, 0.6, 1);
        pivot.position.y += track.liftHeight * liftPhase;
        pivot.position.x += track.translation.x * detachPhase;
        pivot.position.z += track.translation.z * detachPhase;
        pivot.position.y += (track.translation.y - track.liftHeight) * detachPhase;
        if (track.restingAngles) {
          pivot.rotateX(track.restingAngles[0] * detachPhase);
          pivot.rotateY(track.restingAngles[1] * detachPhase);
          pivot.rotateZ(track.restingAngles[2] * detachPhase);
        }
      } else {
        pivot.position.addScaledVector(track.translation, phase);
      }
    }
    if (helper) helper.visible = track.id === activeGroupId;
  }
}

const CAROUSEL_CARTRIDGES = {
  "3ds": {
    consoleHash: "d36ee8ed0fe8cf7f28e7eeda18c01548293787899af68f3251d155dcb6ee418c",
    path: "assets/models/super-mario-3d-land-card.glb",
    hash: "85b85e7bde1df39a5a213a86d314e7eeb4040ed5521641a913c60317a64a848a",
  },
  gba: {
    consoleHash: "4bf02b0200f32c2283b0ca4e3bf22b217efefb0d1a17e28e954ff0253c936fa3",
    path: "assets/models/sonic-gba-cartridge.glb",
    hash: "233e427d2740462f8679c631447184130b6663bc09b4b40862e17b1c1e707fd1",
    offset: [0, .039, -.017],
  },
  n64: {
    consoleHash: "b4efd6040f813172e1119646ab7087d7da367d1209a8bd2b608d43693e1fa9fe",
    path: "assets/models/super-mario-64-cartridge.glb",
    hash: "98c8213f45fb4b962b55c25fd884d20cb03be7c03a6757b55a68c4130f7fe383",
  },
  jaguar: {
    consoleHash: "281d068a6ea0de1b1e953c76ff0e5e12884123d4c6df4cb94f26c7b2aff8c86d",
    path: "assets/models/theme-park-jaguar-cartridge.glb",
    hash: "8f0b7c10af339dd7b5faad32d876c8a2cd932c7c22fed73d9d7009dfb7a65aac",
  },
  mastersystem: {
    consoleHash: "420165726a70f99881f6bcfd806903abdb69c3de0aeaca23e38fb9ce009788f0",
    path: "assets/models/alex-kidd-master-system-cartridge.glb",
    hash: "c1f0d4385fdf8886ec9a1977c08f8754410ed94cb4cb12537e2c6a67c28eddb3",
  },
  megadrive: {
    consoleHash: "98a761a000f7165adc451006116345b7f703cec62ef2dd732898854923313c5c",
    path: "assets/models/sonic-the-hedgehog-cartridge.glb",
    hash: "f2b89eab607fb938b4084a81a1d786cbb7e71fa52dedcee26c6ca93572e58b5f",
  },
  snes: {
    consoleHash: "12c6db3c815d5b437f9feb4fd51d297456d98a3b3e5ad6979d3d901c20f2cba0",
    path: "assets/models/super-mario-kart-cartridge.glb",
    hash: "e0fe60a33f2b3fba15f46c2ffb0cb9e59282f7b1fab07dfbb1a5a9ab0b1e26ef",
  },
};

export async function loadPlatformModel(platform, store, showAnimationHelpers = false, { separateGamePad = false, carouselShowcase = false } = {}) {
  if (platform.usePlaceholder) return createPlatformPlaceholder(platform);
  try {
    const model = await loadPlatformModelAsset(platform, store, showAnimationHelpers, separateGamePad, carouselShowcase);
    applyConsoleSkin(model, platform.id);
    return model;
  }
  catch(error) {
    const model = createPlatformPlaceholder(platform);
    model.userData.modelLoadError = String(error);
    console.warn(`Using placeholder for ${platform.name}:`, error);
    return model;
  }
}

export function createPlatformPlaceholder(platform) {
  let model;
  try { model = createConsole(platform); }
  catch {
    model = new Group();
    model.add(new Mesh(new BoxGeometry(2.4, 1.4, 0.5), new MeshStandardMaterial({color:platform.color || '#586279'})));
  }
  model.userData.platformId = platform.id;
  model.userData.placeholder = true;
  return model;
}

async function loadPlatformModelAsset(platform, store, showAnimationHelpers, separateGamePad, carouselShowcase) {
  const loadStartedAt = performance.now();
  if (!platform.modelFile && !platform.bundledModel) {
    const model = createConsole(platform);
    model.userData.platformId = platform.id;
    await prepareConsoleActivity(model, platform.id);
    return model;
  }
  let buffer;
  if (platform.modelFile) buffer = await store.readAsset(platform.modelFile);
  else {
    if (!/^assets\/models\/[a-z0-9-]+\.glb$/.test(platform.bundledModel.path))
      throw new Error("Invalid bundled model path.");
    buffer = await store.readBundledModel(
      platform.bundledModel.path,
      platform.bundledModel.sha256,
    );
  }
  const originalBundledSource =
    !platform.modelFile ||
    platform.modelFile.id.startsWith(`${platform.bundledModel?.sha256}.`);
  recordLoadingTime("model-read-and-integrity", loadStartedAt, { platform: platform.id, bytes: buffer.byteLength });
  const parseStartedAt = performance.now();
  const root = await parseModel(
    buffer,
    originalBundledSource ? (platform.bundledModel?.hiddenMaterials ?? []) : [],
    originalBundledSource
      ? (platform.bundledModel?.showcaseRotation ?? [0, 0, 0])
      : [0, 0, 0],
    originalBundledSource ? (platform.bundledModel?.opaqueMaterials ?? []) : [],
    platform.id,
    platform.modelAnimations,
    showAnimationHelpers,
  );
  recordLoadingTime("model-parse-and-prepare", parseStartedAt, { platform: platform.id, ...root.userData.modelStats });
  root.children[0].scale.multiplyScalar(
    (getConsoleReferenceMaxDimension(platform) / 3.3) *
      (originalBundledSource ? (platform.bundledModel?.showcaseScale ?? 1) : 1),
  );
  if (originalBundledSource && platform.bundledModel?.showcaseOffsetY)
    root.children[0].position.y = platform.bundledModel.showcaseOffsetY;
  if (originalBundledSource && platform.id === "playstation") {
    const shell = root.getObjectByName("Object_8")?.material;
    const lid = root.getObjectByName("Object_12")?.material;
    if (shell?.name === "PS1_Material" && lid?.name === "PS1_Lid_Material" && shell.map && lid.map) {
      // Match sampled plastic colours in linear space without replacing the
      // shell's grain or touching the printed artwork on the lid.
      const bodyColour = new Color(0x9e9e9e);
      const lidColour = new Color(0xa9a38d);
      shell.color.setRGB(lidColour.r / bodyColour.r, lidColour.g / bodyColour.g, lidColour.b / bodyColour.b);
    }
  }
  if (platform.id === "wiiu") {
    if (separateGamePad) root.children[0].rotation.y -= Math.PI / 4;
    else await addWiiUGamePad(root, store, carouselShowcase && originalBundledSource);
  }
  if (carouselShowcase && platform.id === "arcade" && originalBundledSource) {
    prepareArcadeScreenDemo(root);
  }
  if (platform.id === "gbcolor" &&
      ["14d6cc43539ed69dce435e4bfa2a645b10bb4840211371d03715663476644217",
        "fd36c339ad6d2540c1d1f4c20856088fbc80632dce08cf0c4db5456224ea45fc"].includes(platform.bundledModel?.sha256) &&
      originalBundledSource) {
    try {
      await addGameBoyColorSkins(root, store, carouselShowcase);
    } catch (error) {
      console.warn("Game Boy Color skins could not be loaded:", error);
    }
  }
  if (carouselShowcase && platform.id === "amiga500" && originalBundledSource) {
    const chassis = root.children[0].children[0];
    try {
      const disk = await store.readBundledModel("assets/models/amiga-workbench-floppy.glb",
        "d5d98615e28284e70a4bebfdc16c0ed1d96d3689b4de7013f8a269a3fd5ec0fd");
      attachAmigaShowcase(root, chassis, (await new GLTFLoader().parseAsync(disk, "")).scene);
    } catch (error) {
      console.warn("Amiga Workbench floppy could not be loaded:", error);
    }
  }
  const cartridge = CAROUSEL_CARTRIDGES[platform.id];
  const showcaseHash = platform.carouselDisplaySha256 ?? platform.bundledModel?.sha256;
  if (carouselShowcase && originalBundledSource && cartridge?.consoleHash === showcaseHash) {
    const chassis = root.children[0].children[0];
    try {
      const bytes = await store.readBundledModel(cartridge.path, cartridge.hash);
      const { scene: cartridgeScene } = await new GLTFLoader().parseAsync(bytes, "");
      if (cartridge.offset) {
        const card = cartridgeScene.getObjectByName("TotemCartridge");
        card.position.add(new Vector3(...cartridge.offset));
      }
      chassis.add(cartridgeScene);
      if (platform.id === "n64") {
        // The CAD deck has no partition between the vent and the cartridge bay.
        const baffle = new Mesh(new BoxGeometry(.124, .020, .001), new MeshStandardMaterial({ color: 0x18191a, roughness: .8 }));
        baffle.name = "N64 cartridge bay front wall";
        baffle.position.set(0, .055, -.0305);
        chassis.add(baffle);
      }
      await prepareConsoleActivity(chassis, platform.id);
      root.userData.consoleActivity = chassis.userData.consoleActivity;
      if (platform.id === "3ds") prepareNintendoScreenDemo(root, chassis);
    } catch (error) {
      console.warn(`Cartridge showcase could not be loaded for ${platform.name}:`, error);
    }
  }
  root.userData.platformId = platform.id;
  if (carouselShowcase && originalBundledSource && ["ndslite", "gwmulti"].includes(platform.id)) {
    root.userData.consoleActivity ??= {};
    prepareNintendoScreenDemo(root, root.children[0].children[0]);
  }
  root.userData.coverage = "Imported 3D model · quality not yet accepted";
  recordLoadingTime("model-total", loadStartedAt, { platform: platform.id });
  return root;
}

async function addGameBoyColorSkins(root, store, carouselShowcase) {
  const chassis = root.children[0].children[0];
  const original = chassis.getObjectByName("gameboy_low001_Main_0");
  if (!original?.isMesh || original.material.name !== "Main") return;
  const bytes = await store.readBundledModel("assets/models/gbc-pikachu-and-gold.glb",
    "61d4ccec8c4a27b3daabd083458614b0e3b3d67dc5549022263f1a86c913b6fd");
  const { scene: assets } = await new GLTFLoader().parseAsync(bytes, "");
  const pikachu = assets.getObjectByName("Pikachu_console");
  const gold = assets.getObjectByName("Pokemon_Gold_cartridge");
  const yellowShell = pikachu?.getObjectByName("polySurface5_Yellow_0");
  if (!yellowShell || !gold) {
    disposeImported(assets);
    return;
  }

  const host = original.parent;
  pikachu.scale.setScalar(28.7);
  pikachu.position.set(-2.4, -120.6, 14.9);
  pikachu.updateMatrix();
  host.add(pikachu);

  const screen = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: 0x292c23, toneMapped: false }));
  screen.name = carouselShowcase ? "Totem Game Boy Color showcase LCD" : PRIMARY_PREVIEW;
  screen.visible = !carouselShowcase;
  const showcase = carouselShowcase
    ? addGameBoyColorCartridge(root, chassis, original, pikachu, yellowShell, gold, screen)
    : null;
  const body = showcase?.body ?? original;
  host.add(screen);
  if (!showcase) {
    gold.visible = false;
    host.add(gold);
  }

  const material = body.material;
  const tint = { value: new Color() };
  const tintAmount = { value: 0 };
  const shellOpacity = { value: 1 };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { tint, tintAmount, shellOpacity });
    shader.fragmentShader = "uniform vec3 tint; uniform float tintAmount; uniform float shellOpacity;\n" +
      shader.fragmentShader.replace("#include <map_fragment>", `
        #include <map_fragment>
        // The original atlas paints the shell red and packs the black trim,
        // display, labels and buttons into the same texture.
        float shell = smoothstep(.06, .15, diffuseColor.r - max(diffuseColor.g, diffuseColor.b)) * tintAmount;
        vec3 finish = tint * clamp(diffuseColor.r * 1.8 + .33, .55, 1.4);
        diffuseColor.rgb = mix(diffuseColor.rgb, finish, shell);
        diffuseColor.a *= mix(1.0, shellOpacity, shell);
      `);
  };
  const lens = chassis.getObjectByName("Totem power lens");
  root.userData.applyGameBoyColorSkin = skin => {
    const special = skin.name === "Pokémon Pikachu";
    body.visible = !special;
    pikachu.visible = special;
    if (lens) lens.visible = !special;
    tintAmount.value = skin.color ? 1 : 0;
    if (skin.color) tint.value.set(skin.color);
    shellOpacity.value = skin.opacity ?? 1;
    if (material.transparent !== Boolean(skin.opacity)) {
      material.transparent = Boolean(skin.opacity);
      material.needsUpdate = true;
    }
    screen.scale.set(special ? 94 : 86, special ? 86 : 79, 1);
    screen.position.set(special ? -1.8 : -2.9, special ? 110.7 : 108.9, special ? 20.7 : 20.4);
    showcase?.fit(special);
  };
  root.userData.applyGameBoyColorSkin({ name: "Original" });
}

function addGameBoyColorCartridge(root, chassis, original, pikachu, yellowShell, gold, screen) {
  // The original atlas and mesh include a seated grey cartridge. Separate
  // it from the case so it cannot intersect the Gold cartridge on insertion.
  const isBakedCartridge = bounds => bounds.min.y > .64 && bounds.max.y < 1.047 &&
    bounds.min.x > -.35 && bounds.max.x < .33 && bounds.max.z < -.027;
  // parseModel has fitted the holder. Classify in the unfitted chassis space.
  root.updateMatrixWorld(true);
  const chassisInverse = chassis.matrixWorld.clone().invert();
  const parts = splitMeshIntoConnectedComponents(original, bounds => isBakedCartridge(bounds.applyMatrix4(chassisInverse)));
  root.updateMatrixWorld(true);
  const baked = parts.find(part => {
    const bounds = part.geometry.boundingBox.clone().applyMatrix4(part.matrixWorld).applyMatrix4(chassisInverse);
    return isBakedCartridge(bounds);
  });
  if (!baked) {
    return null;
  }
  const body = parts.find(part => part !== baked);

  // The Pikachu mesh includes a second seated cartridge in its yellow plastic.
  // Use that cartridge as the fit reference for the animated replacement.
  const isYellowCartridge = bounds => bounds.min.y > 5.5 && bounds.max.z < -.56;
  yellowShell.updateWorldMatrix(true, false);
  const yellowInverse = yellowShell.matrixWorld.clone().invert();
  const yellowParts = splitMeshIntoConnectedComponents(yellowShell, bounds => isYellowCartridge(bounds.applyMatrix4(yellowInverse)));
  const yellowCartridge = yellowParts.find(part => isYellowCartridge(part.geometry.boundingBox));
  if (!yellowCartridge) {
    return null;
  }
  baked.visible = false;
  yellowCartridge.visible = false;
  for (const part of pikachu.children) {
    if (["yellow_label", "aiStandardSurface18", "Bronse"].includes(part.material?.name)) part.visible = false;
  }
  const originalSlot = baked.geometry.boundingBox.clone().applyMatrix4(baked.matrix);
  const pikachuSlot = yellowCartridge.geometry.boundingBox.clone().applyMatrix4(pikachu.matrix);
  // The donor Gold cartridge is posed 30 degrees off upright beside the console.
  // Straighten it and put its pivot at the top centre of the shell.
  gold.removeFromParent();
  gold.rotation.set(0, Math.PI, -Math.PI / 6);
  const goldBounds = new Box3().setFromObject(gold, true);
  const goldSize = goldBounds.getSize(new Vector3());
  gold.position.copy(goldBounds.getCenter(new Vector3())).negate();
  gold.position.y = -goldBounds.max.y;
  const cartridge = new Group();
  cartridge.name = "TotemCartridge";
  cartridge.add(gold);
  original.parent.add(cartridge);

  prepareGameBoyColorDemo(chassis, cartridge, screen);
  const loader = chassis.userData.consoleActivity.authored;
  function fit(special) {
    const slot = special ? pikachuSlot : originalSlot;
    const widthScale = (slot.max.x - slot.min.x) / goldSize.x;
    cartridge.scale.set(widthScale, widthScale, (slot.max.z - slot.min.z) / goldSize.z);
    const seat = slot.getCenter(new Vector3());
    seat.y = slot.max.y;
    cartridge.position.sub(loader.home).add(seat);
    loader.home.copy(seat);
  }
  return { body, fit };
}

export async function loadWiiUGamePad(store) {
  const bytes = await store.readBundledModel(
    "assets/models/wii-u-gamepad-controller-stand.glb",
    "a883b9e996ef3c9c234ad6d5d341b35774e2001f2d382b1a371a79df8adef8de",
  );
  return parseModel(bytes);
}

async function addWiiUGamePad(consoleModel, store, carouselShowcase) {
  const gamePad = await loadWiiUGamePad(store);
  const consoleBody = consoleModel.children[0];
  // The supplied console faces +X; the standing GamePad faces +Z. Align
  // their fronts to size and place the GamePad using the console's straight-on bounds.
  consoleBody.rotation.y -= Math.PI / 2;
  consoleModel.updateMatrixWorld(true);
  const consoleBounds = new Box3().setFromObject(consoleModel);
  const gamePadBounds = new Box3().setFromObject(gamePad);
  const consoleSize = consoleBounds.getSize(new Vector3());
  const gamePadSize = gamePadBounds.getSize(new Vector3());
  const fitScale = (consoleSize.x * 1.5) / gamePadSize.x;
  if (!Number.isFinite(fitScale) || fitScale <= 0)
    throw new Error("Wii U GamePad model has invalid dimensions.");
  gamePad.scale.setScalar(fitScale);
  gamePad.updateMatrixWorld(true);
  gamePadBounds.setFromObject(gamePad);
  const consoleCenter = consoleBounds.getCenter(new Vector3());
  const gamePadCenter = gamePadBounds.getCenter(new Vector3());
  gamePad.position.set(
    consoleCenter.x - consoleSize.x * 0.32 - gamePadCenter.x,
    consoleBounds.min.y - gamePadBounds.min.y,
    consoleBounds.max.z + 0.025 - gamePadBounds.min.z,
  );
  consoleBody.rotation.y += Math.PI / 4;
  consoleModel.add(gamePad);
  prepareNintendoScreenDemo(consoleModel, gamePad.children[0].children[0], carouselShowcase);
}

export async function loadSNESControllerPair(store) {
  const controllerBytes = await store.readBundledModel(
    "assets/models/snes-controller.glb",
    "e0308c1673850535ecd614d65157f6e2160a74c890d561044ef9aef79075c01c",
  );
  const pair = new Group();
  for (const [x, yaw] of [[-1.45, 0.15], [1.45, -0.15]]) {
    const controller = await parseModel(controllerBytes.slice(0));
    controller.scale.setScalar(0.34);
    controller.position.set(x, -0.8, 1.3);
    controller.rotation.y = yaw;
    pair.add(controller);
  }
  return pair;
}

export function disposeImported(root) {
  disposeConsoleActivity(root);
  disposeAmigaShowcase(root.userData.amigaShowcase);
  setModelMeshHighlight(root);
  const disposed = new Set();
  const images = new Set();
  root.traverse((part) => {
    if (part.isAxesHelper) {
      part.geometry.dispose();
      part.material.dispose();
    }
    if (!part.isMesh) return;
    if (!disposed.has(part.geometry)) {
      part.geometry.dispose();
      disposed.add(part.geometry);
    }
    for (const material of Array.isArray(part.material)
      ? part.material
      : [part.material]) {
      if (disposed.has(material)) continue;
      for (const value of Object.values(material))
        if (value?.isTexture && !disposed.has(value)) {
          if (value.image?.close) images.add(value.image);
          value.dispose();
          disposed.add(value);
        }
      material.dispose();
      disposed.add(material);
    }
  });
  for (const bitmap of images) bitmap.close();
}

export function validatePlatform(record, baseIds) {
  if (record?.boxArt) validateBoxArt(record.boxArt);
  if (record?.libraryPresentation) {
    const presentation = record.libraryPresentation;
    if (!presentation || (presentation.display !== undefined && !["tv", "built-in"].includes(presentation.display)) ||
      typeof presentation.screenMesh !== "string" || presentation.screenMesh.length > 512 ||
      !presentation.pose || typeof presentation.pose !== "object")
      throw new Error("Invalid game library presentation settings.");
    validateLibraryPose(presentation.pose);
    for (const key of ["showControllers", "showMedia"]) {
      if (presentation[key] !== undefined && typeof presentation[key] !== "boolean")
        throw new Error("Invalid game library visibility settings.");
    }
    if (presentation.accessories !== undefined) {
      const { accessories } = presentation;
      if (!accessories || typeof accessories !== "object" || Array.isArray(accessories))
        throw new Error("Invalid game library accessories.");
      for (const [id, pose] of Object.entries(accessories)) {
        if (!accessoryIds.includes(id)) throw new Error("Invalid game library accessory.");
        validateLibraryPose(pose);
      }
    }
  }
  if (
    !record ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(record.id) ||
    (!baseIds.includes(record.id) && !record.id.startsWith("user-"))
  )
    throw new Error("New platforms need a unique user- prefixed ID.");
  for (const field of ["name", "maker"])
    if (
      typeof record[field] !== "string" ||
      !record[field].trim() ||
      record[field].length > 100
    )
      throw new Error(
        `Enter a ${field === "maker" ? "manufacturer" : "platform name"} of 1–100 characters.`,
      );
  if (
    !["console", "handheld", "hybrid", "arcade", "computer"].includes(
      record.kind,
    )
  )
    throw new Error("Choose a hardware type.");
  if (!/^#[0-9a-f]{6}$/i.test(record.color))
    throw new Error("Choose a valid accent colour.");
  if (
    !record.model ||
    ![...PROFILE_TYPES, "bespoke"].includes(record.model.profile)
  )
    throw new Error("Choose a supported placeholder model.");
  if (
    record.model.profile === "bespoke" &&
    ![
      "gameboy",
      "nes",
      "megadrive",
      "playstation",
      "gamecube",
      "xbox",
      "wii",
    ].includes(record.id)
  )
    throw new Error("This platform needs a family placeholder profile.");
  if (
    record.model.profile !== "bespoke" &&
    ["width", "height", "depth"].some(
      (key) =>
        typeof record.model[key] !== "number" ||
        !Number.isFinite(record.model[key]) ||
        record.model[key] <= 0 ||
        record.model[key] > 10,
    )
  )
    throw new Error("Placeholder dimensions are invalid.");
  for (const [key, kind] of [
    ["logoFile", "logo"],
    ["modelFile", "model"],
  ]) {
    const asset = record[key];
    if (
      asset &&
      (asset.kind !== kind ||
        !/^[a-f0-9]{64}\.(glb|png|jpg|webp)$/.test(asset.id) ||
        typeof asset.name !== "string")
    )
      throw new Error("Invalid asset reference.");
  }
  return structuredClone(record);
}
