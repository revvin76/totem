import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import catalogue from "../platforms.json" with { type: "json" };
import { addPreviewSurface, createHardwareProfile } from "./hardware-profiles.js";

const materials = new Map();
const geometries = new Map();
const referenceDimensions = new Map();
function cachedGeometry(key, create) {
  if (!geometries.has(key)) geometries.set(key, create());
  return geometries.get(key);
}
function plastic(color, roughness = 0.43, metalness = 0.12) {
  const key = `${color}/${roughness}/${metalness}`;
  if (!materials.has(key))
    materials.set(
      key,
      new THREE.MeshStandardMaterial({ color, roughness, metalness }),
    );
  return materials.get(key);
}
function part(parent, geometry, color, x = 0, y = 0, z = 0, roughness) {
  const mesh = new THREE.Mesh(geometry, plastic(color, roughness));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
function box(p, w, h, d, c, x = 0, y = 0, z = 0, radius = 0.035, segments = 3) {
  return part(
    p,
    cachedGeometry(
      `box:${w}:${h}:${d}:${radius}:${segments}`,
      () =>
        new RoundedBoxGeometry(
          w,
          h,
          d,
          segments,
          Math.min(radius, w / 4, h / 4, d / 4),
        ),
    ),
    c,
    x,
    y,
    z,
  );
}
function cylinder(p, r, h, c, x = 0, y = 0, z = 0) {
  return part(
    p,
    cachedGeometry(
      `cylinder:${r}:${h}`,
      () => new THREE.CylinderGeometry(r, r, h, 32),
    ),
    c,
    x,
    y,
    z,
  );
}
function sphere(p, r, c, x, y, z, sx = 1, sy = 1, sz = 1) {
  const m = part(
    p,
    cachedGeometry(`sphere:${r}`, () => new THREE.SphereGeometry(r, 24, 16)),
    c,
    x,
    y,
    z,
  );
  m.scale.set(sx, sy, sz);
  return m;
}
function label(p, text, color, x, y, z, w = 0.6, h = 0.15, face = "top") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.font = "500 66px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 64, 480);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  m.position.set(x, y, z);
  if (face === "top") m.rotation.x = -Math.PI / 2;
  p.add(m);
  return m;
}
function vent(p, x, y, z, count, axis = "z", color = "#262a30", length = 0.3) {
  for (let i = 0; i < count; i++)
    box(
      p,
      axis === "z" ? 0.025 : length,
      0.012,
      axis === "z" ? length : 0.025,
      color,
      x + (axis === "z" ? i * 0.065 : 0),
      y,
      z + (axis === "x" ? i * 0.065 : 0),
      0.003,
    );
}
function port(p, x, y, z, w = 0.36, h = 0.13) {
  box(p, w + 0.045, h + 0.045, 0.025, "#535560", x, y, z);
  box(p, w, h, 0.033, "#13161d", x, y, z + 0.015);
}
function dpad(p, x, y, z, size = 0.28) {
  box(p, size, 0.07, size * 0.34, "#20252d", x, y, z, 0.016);
  box(p, size * 0.34, 0.075, size, "#20252d", x, y + 0.004, z, 0.016);
}
function controller(parent, kind = "ps", x = 1.05, z = 1.6, scale = 1) {
  const p = new THREE.Group();
  parent.add(p);
  p.position.set(x, -0.25, z);
  p.scale.setScalar(scale);
  p.rotation.y = -0.12;
  const color =
    kind === "cube" ? "#473a9a" : kind === "xbox" ? "#182022" : "#9095a5";
  box(p, 1.15, 0.24, 0.47, color, 0, 0, 0, 0.11);
  for (const s of [-1, 1]) {
    const grip = sphere(p, 0.29, color, s * 0.49, -0.04, 0.26, 0.78, 0.5, 1.45);
    grip.rotation.y = s * -0.22;
  }
  dpad(p, -0.34, 0.155, 0, 0.25);
  const colors =
    kind === "ps"
      ? ["#65ccc4", "#e578a6", "#f27a7b", "#76aceb"]
      : ["#a4c75b", "#e13b50", "#50abe7", "#e6be4a"];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const q = cylinder(
      p,
      0.053,
      0.036,
      "#25282f",
      0.34 + Math.cos(a) * 0.115,
      0.158,
      Math.sin(a) * 0.115,
    );
    cylinder(p, 0.026, 0.041, colors[i], q.position.x, 0.18, q.position.z);
  }
  if (kind !== "nes")
    for (const s of [-1, 1]) {
      cylinder(p, 0.112, 0.07, "#383c48", s * 0.17, 0.14, 0.24);
      sphere(p, 0.083, "#20252c", s * 0.17, 0.205, 0.24, 1, 0.5, 1);
    }
  box(p, 0.1, 0.025, 0.04, "#303642", 0, 0.14, 0, 0.01);
  return p;
}
function playstation() {
  const p = new THREE.Group();
  box(p, 3.1, 0.46, 2.25, "#969ca9", 0, 0, 0, 0.07);
  box(p, 3.04, 0.16, 2.19, "#b5bac4", 0, 0.26, -0.01, 0.05);
  box(p, 2.94, 0.08, 2.1, "#737b89", 0, -0.27, 0, 0.03);
  cylinder(p, 1.005, 0.035, "#616b7b", 0.02, 0.36, -0.12);
  cylinder(p, 0.98, 0.042, "#aab1bd", 0.02, 0.38, -0.12);
  cylinder(p, 0.18, 0.035, "#c3c8ce", -1.21, 0.375, 0.48);
  cylinder(p, 0.14, 0.035, "#c3c8ce", 1.25, 0.375, 0.48);
  label(p, "POWER", "#4c7c83", -1.2, 0.398, 0.48, 0.23, 0.05);
  label(p, "OPEN", "#4c7c83", 1.25, 0.398, 0.48, 0.21, 0.05);
  label(p, "SONY", "#303847", 0, 0.407, -0.79, 0.36, 0.09);
  label(p, "PlayStation", "#4d5361", 0, 0.407, 0.48, 0.55, 0.1);
  // The four-colour emblem is geometry, visible from any viewpoint.
  box(p, 0.05, 0.018, 0.21, "#c94738", -0.025, 0.415, -0.05, 0.005);
  box(p, 0.15, 0.02, 0.045, "#e9bc42", 0.035, 0.415, 0.03, 0.005);
  box(p, 0.11, 0.02, 0.04, "#3f9d9e", -0.04, 0.416, 0.08, 0.005);
  box(p, 0.07, 0.02, 0.04, "#5d78b9", 0.04, 0.416, 0.09, 0.005);
  for (const x of [-0.86, 0.55]) {
    port(p, x, -0.015, 1.14, 0.53, 0.15);
    box(p, 0.5, 0.07, 0.03, "#596373", x, 0.18, 1.14);
    label(p, "MEMORY CARD", "#414957", x, 0.235, 1.15, 0.48, 0.055, "front");
  }
  vent(p, -1.46, 0.35, -0.78, 22, "x", "#6a7280", 0.14);
  vent(p, 1.31, 0.35, -0.78, 22, "x", "#6a7280", 0.14);
  controller(p, "ps", 1.1, 1.65, 1.03);
  return p;
}
function nes() {
  const p = new THREE.Group();
  box(p, 2.7, 0.72, 2.1, "#afb0ae");
  box(p, 2.69, 0.24, 2.09, "#555c62", 0, -0.4, 0);
  box(p, 2.7, 0.15, 2.1, "#dedbd0", 0, 0.4, 0);
  box(p, 1.5, 0.08, 1.4, "#b5b5af", -0.25, 0.51, 0.22);
  box(p, 1.47, 0.06, 0.035, "#4c5051", -0.25, 0.56, 0.91);
  box(p, 0.48, 0.035, 2.04, "#343a40", 0.89, 0.5, 0);
  vent(p, 0.71, 0.53, -0.9, 29, "x", "#111820", 0.38);
  box(p, 1.3, 0.25, 0.04, "#c5c3ba", -0.33, 0.2, 1.07);
  label(p, "Nintendo", "#b52d34", -0.4, 0.23, 1.1, 0.65, 0.1, "front");
  for (const x of [-0.96, -0.59])
    box(p, 0.3, 0.14, 0.07, "#3a3f45", x, -0.18, 1.1);
  for (const x of [0.55, 0.99]) port(p, x, -0.28, 1.08, 0.25, 0.12);
  const c = new THREE.Group();
  p.add(c);
  c.position.set(0.65, -0.36, 1.62);
  c.rotation.y = -0.13;
  box(c, 1.22, 0.15, 0.54, "#bbbcb9");
  box(c, 1.1, 0.03, 0.43, "#272e35", 0, 0.1, 0);
  dpad(c, -0.36, 0.145, 0, 0.26);
  for (const x of [0.23, 0.45])
    cylinder(c, 0.07, 0.04, "#c92e39", x, 0.14, 0.04);
  box(c, 0.09, 0.025, 0.035, "#888d92", -0.04, 0.14, 0.08);
  box(c, 0.09, 0.025, 0.035, "#888d92", 0.09, 0.14, 0.08);
  return p;
}
function megadrive() {
  const p = new THREE.Group();
  box(p, 3.05, 0.42, 2.05, "#151b25", 0, 0, 0, 0.19);
  box(p, 2.91, 0.15, 1.95, "#222a34", 0, 0.25, 0, 0.12);
  cylinder(p, 0.9, 0.07, "#303640", 0.13, 0.37, -0.02);
  cylinder(p, 0.78, 0.07, "#111722", 0.13, 0.405, -0.02);
  box(p, 1.12, 0.08, 0.18, "#080e16", 0.13, 0.46, -0.42);
  box(p, 1.25, 0.03, 0.035, "#555d68", 0.13, 0.5, -0.48);
  label(p, "16-BIT", "#bcb39b", 0.13, 0.45, 0.24, 0.67, 0.17);
  label(p, "MEGA DRIVE", "#bec4ce", -0.45, 0.35, 0.81, 0.8, 0.12);
  box(p, 0.22, 0.035, 0.15, "#b72d40", -1.08, 0.35, 0.5);
  box(p, 0.22, 0.035, 0.15, "#3b424b", -1.08, 0.35, 0.73);
  vent(p, -1.34, 0.34, -0.78, 20, "x", "#0b111b", 0.3);
  vent(p, 1.1, 0.34, -0.78, 20, "x", "#0b111b", 0.3);
  for (const x of [-0.53, 0.53]) port(p, x, -0.02, 1.045, 0.42, 0.14);
  const c = controller(p, "xbox", 0.98, 1.55, 0.96);
  c.children
    .filter((o) => o.geometry?.type === "CylinderGeometry")
    .forEach((o) => {
      o.material = plastic("#222630");
    });
  return p;
}
function gamecube() {
  const p = new THREE.Group();
  box(p, 2.05, 1.6, 1.88, "#49418b", 0, 0, 0, 0.07);
  box(p, 2.08, 0.13, 1.9, "#6a58b4", 0, 0.83, 0, 0.04);
  cylinder(p, 0.76, 0.035, "#302c4a", 0, 0.92, -0.08);
  cylinder(p, 0.7, 0.04, "#625494", 0, 0.94, -0.08);
  cylinder(p, 0.32, 0.045, "#1b1c2e", 0, 0.965, -0.08);
  label(p, "GAMECUBE", "#c7c6dc", 0, 0.994, -0.08, 0.49, 0.08);
  for (const x of [-0.85, 0.85])
    cylinder(p, 0.095, 0.04, "#9a91b6", x, 0.94, 0.58);
  box(p, 1.9, 0.52, 0.07, "#aaaaba", 0, 0.12, 0.97);
  for (let i = 0; i < 4; i++) {
    const m = cylinder(
      p,
      0.112,
      0.045,
      "#121725",
      -0.65 + i * 0.43,
      0.14,
      1.03,
    );
    m.rotation.x = Math.PI / 2;
  }
  for (const x of [-0.48, 0.48])
    box(p, 0.64, 0.1, 0.06, "#2c2c4b", x, -0.35, 0.99);
  for (let i = 0; i < 13; i++)
    box(p, 0.018, 0.4, 0.025, "#171b32", 1.036, -0.13, -0.7 + i * 0.1, 0.002);
  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.065, 10, 40, Math.PI),
    plastic("#292b43"),
  );
  handle.position.set(0, 0.2, -1.04);
  p.add(handle);
  controller(p, "cube", 1, -0.0 + 1.65, 0.95);
  return p;
}
function xbox() {
  const p = new THREE.Group();
  box(p, 3.2, 0.7, 2.4, "#172025", 0, 0, 0, 0.13);
  box(p, 3.1, 0.1, 2.3, "#202c2c", 0, 0.4, 0, 0.08);
  for (const s of [-1, 1]) {
    const bar = box(p, 3.35, 0.12, 0.42, "#111a1b", 0, 0.49, 0, 0.08);
    bar.rotation.y = s * 0.59;
  }
  cylinder(p, 0.4, 0.045, "#83af42", 0, 0.58, 0);
  label(p, "XBOX", "#263323", 0, 0.607, 0, 0.48, 0.14);
  box(p, 1.38, 0.17, 0.045, "#11191e", -0.65, 0.16, 1.22);
  label(p, "XBOX", "#9baa9f", -0.65, 0.16, 1.25, 0.38, 0.085, "front");
  cylinder(p, 0.07, 0.04, "#80c642", 0.28, 0.48, 1.02);
  for (let i = 0; i < 4; i++) port(p, -1.06 + i * 0.7, -0.2, 1.23, 0.3, 0.14);
  vent(p, -1.48, 0.46, -1, 30, "x", "#080f16", 0.24);
  vent(p, 1.23, 0.46, -1, 30, "x", "#080f16", 0.24);
  controller(p, "xbox", 1.1, 1.75, 1.08);
  return p;
}
function wii() {
  const p = new THREE.Group();
  box(p, 0.7, 2.9, 1.9, "#dce6eb", 0, 0.1, 0, 0.06);
  box(p, 0.05, 2.86, 1.83, "#adbcc7", 0.38, 0.1, 0);
  box(p, 0.035, 1.65, 0.025, "#1d303e", 0.12, 0.42, 0.968);
  box(p, 0.012, 1.62, 0.033, "#67d5ff", 0.15, 0.42, 0.978);
  box(p, 0.09, 0.24, 0.04, "#b1c0cb", -0.17, 1.14, 0.974);
  cylinder(p, 0.035, 0.018, "#85bb72", -0.15, 1.46, 0.3);
  label(p, "Wii", "#6b8496", 0, -0.88, 0.977, 0.43, 0.2, "front");
  const r = new THREE.Group();
  p.add(r);
  r.position.set(0.95, -0.45, 0.96);
  r.rotation.set(-0.25, 0, -0.12);
  box(r, 0.38, 1.6, 0.27, "#e2e9ee", 0, 0, 0, 0.06);
  box(r, 0.25, 0.25, 0.035, "#b3c0ca", 0, 0.37, 0.16);
  dpad(r, 0, 0.28, 0);
  const a = cylinder(r, 0.075, 0.04, "#eaf1f3", 0, 0.07, 0.17);
  a.rotation.x = Math.PI / 2;
  for (const y of [-0.42, -0.62]) {
    const b = cylinder(r, 0.04, 0.03, "#b6c8d4", 0, y, 0.165);
    b.rotation.x = Math.PI / 2;
  }
  label(r, "Wii", "#718b9c", 0, -0.16, 0.162, 0.2, 0.1, "front");
  return p;
}
function gameboy() {
  const p = new THREE.Group();
  box(p, 1.65, 2.75, 0.48, "#c6c5b7", 0, 0, 0, 0.14);
  box(p, 1.39, 1.25, 0.045, "#646b70", 0, 0.49, 0.27, 0.1);
  box(p, 0.99, 0.89, 0.03, "#525e36", 0, 0.5, 0.305, 0.015);
  box(p, 0.81, 0.7, 0.01, "#788452", 0, 0.5, 0.326, 0.01);
  addPreviewSurface(p, 0.81, 0.7, 0, 0.5, 0.333);
  label(
    p,
    "Nintendo GAME BOY",
    "#324276",
    -0.04,
    -0.24,
    0.27,
    1.3,
    0.12,
    "front",
  );
  const d = new THREE.Group();
  p.add(d);
  d.position.set(-0.45, -0.61, 0.29);
  d.rotation.x = Math.PI / 2;
  dpad(d, 0, 0, 0, 0.43);
  for (const [x, y] of [
    [0.3, -0.66],
    [0.58, -0.51],
  ]) {
    const b = cylinder(p, 0.135, 0.06, "#78304e", x, y, 0.29);
    b.rotation.x = Math.PI / 2;
  }
  for (const x of [-0.17, 0.16]) {
    const b = box(p, 0.25, 0.07, 0.05, "#757d7c", x, -1.01, 0.28);
    b.rotation.z = 0.3;
  }
  for (let i = 0; i < 6; i++) {
    const v = box(
      p,
      0.025,
      0.32,
      0.02,
      "#7b807a",
      0.27 + i * 0.075,
      -1.12,
      0.254,
      0.005,
    );
    v.rotation.z = -0.25;
  }
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 10, 8),
    new THREE.MeshBasicMaterial({ color: "#ee6960" }),
  );
  led.position.set(-0.59, 0.54, 0.3);
  p.add(led);
  return p;
}

const factories = { gameboy, nes, megadrive, playstation, gamecube, xbox, wii };
export function createConsole(idOrPlatform) {
  const platform =
    typeof idOrPlatform === "string"
      ? catalogue.find((p) => p.id === idOrPlatform)
      : idOrPlatform;
  if (!platform) throw new Error(`Unknown console: ${idOrPlatform}`);
  const id = platform.id;
  const root = new THREE.Group();
  const hardware = factories[id]
    ? factories[id]()
    : createHardwareProfile(platform, {
        box: (p, w, h, d, c, x = 0, y = 0, z = 0, radius = 0.035) =>
          box(p, w, h, d, c, x, y, z, radius, 1),
        cylinder,
        sphere,
        label,
        dpad,
        port,
      });
  root.add(hardware);
  if (hardware.userData.hingePivot)
    root.userData.hingePivot = hardware.userData.hingePivot;
  const animatedPart = (mesh) => {
    for (let part = mesh; part && part !== root; part = part.parent)
      if (part.userData.animated) return true;
    return false;
  };
  // Merge static opaque parts by material so a large enabled set does not
  // submit a separate draw call for every vent, button and case component.
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse((mesh) => {
    if (
      !mesh.isMesh ||
      animatedPart(mesh) ||
      mesh.material.transparent ||
      Array.isArray(mesh.material)
    )
      return;
    const group = groups.get(mesh.material) ?? [];
    group.push(mesh);
    groups.set(mesh.material, group);
  });
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      const geometry = mesh.geometry.index
        ? mesh.geometry.toNonIndexed()
        : mesh.geometry.clone();
      return geometry.applyMatrix4(mesh.matrixWorld);
    });
    const combined = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!combined) throw new Error(`Could not assemble ${id}`);
    for (const mesh of meshes) mesh.removeFromParent();
    root.add(new THREE.Mesh(combined, material));
  }
  root.userData.platformId = id;
  root.userData.coverage = platform.coverage;
  return root;
}

// Imported models use the procedural silhouette only to preserve catalogue
// sizing. Cache that scalar, not the mutable Three.js scene instance.
export function getConsoleReferenceMaxDimension(platform) {
  const key = JSON.stringify([platform.id, platform.kind, platform.name, platform.short, platform.model]);
  if (referenceDimensions.has(key)) return referenceDimensions.get(key);

  const reference = createConsole(platform);
  const size = new THREE.Box3().setFromObject(reference).getSize(new THREE.Vector3());
  const maximum = Math.max(size.x, size.y, size.z);
  const sharedGeometries = new Set(geometries.values());
  const sharedMaterials = new Set(materials.values());
  const ownedMaterials = new Set();
  const ownedGeometries = new Set();
  reference.traverse((part) => {
    if (!part.isMesh) return;
    if (!sharedGeometries.has(part.geometry)) ownedGeometries.add(part.geometry);
    for (const material of Array.isArray(part.material) ? part.material : [part.material])
      if (!sharedMaterials.has(material)) ownedMaterials.add(material);
  });
  for (const material of ownedMaterials) {
    for (const value of Object.values(material))
      if (value?.isTexture) value.dispose();
    material.dispose();
  }
  for (const geometry of ownedGeometries) geometry.dispose();

  // Bound entries for dynamically edited catalogue values.
  if (referenceDimensions.size >= 128)
    referenceDimensions.delete(referenceDimensions.keys().next().value);
  referenceDimensions.set(key, maximum);
  return maximum;
}
