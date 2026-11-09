import * as THREE from "three";

export const SWITCH_SCREEN_PLACEMENT = {
  part: "DisplayGlass", size: [0.134, 0.075375], position: [0, 0, 0.00045],
};

export const PROFILE_TYPES = Object.freeze([
  "cartridge",
  "disc",
  "tower",
  "vertical",
  "horizontal",
  "tablet",
  "clamshell",
  "dual",
  "controller",
  "keyboard",
  "visor",
  "arcade",
  "desktop",
]);

export function supportsDynamicHinge(platform) {
  if (platform?.modelAnimations?.groups?.length) return true;
  if (["dreamcast", "switch", "gwmulti"].includes(platform?.id)) return true;
  const imported3ds = platform?.id === "3ds" && Boolean(platform.bundledModel);
  return Boolean(
    platform?.model &&
      ["clamshell", "dual"].includes(platform.model.profile) &&
      ((!platform.bundledModel && !platform.modelFile) || imported3ds),
  );
}

// Original, explicitly approximate silhouettes. The catalogue supplies a case
// profile, dimensions and finish for each released design; unknown profiles fail.
export function addPreviewSurface(parent, width, height, x, y, z) {
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ visible: false }));
  surface.name = "GameplayPreviewSurface";
  surface.position.set(x, y, z);
  parent.add(surface);
  return surface;
}

export function createHardwareProfile(platform, helpers) {
  const { box, cylinder, sphere, label, dpad, port } = helpers;
  const m = platform.model;
  if (!m || !PROFILE_TYPES.includes(m.profile))
    throw new Error(`No 3D hardware profile for ${platform.id}`);
  const p = new THREE.Group();
  const w = m.width,
    h = m.height,
    d = m.depth,
    color = m.color;
  const dark = "#1a2230",
    trim = "#89939d";
  const frontLabel = (y = 0, z = d / 2 + 0.025, width = w * 0.72) =>
    label(p, platform.name, "#d7e7ed", 0, y, z, width, 0.12, "front");
  function frontButton(x, y, z, r = 0.065, c = "#8a93a8") {
    const button = cylinder(p, r, 0.035, c, x, y, z);
    button.rotation.x = Math.PI / 2;
  }
  function frontPad(x, y, z, size = 0.28) {
    const group = new THREE.Group();
    p.add(group);
    group.position.set(x, y, z);
    group.rotation.x = Math.PI / 2;
    dpad(group, 0, 0, 0, size);
  }
  function screen(x, y, z, sw, sh, parent = p) {
    box(parent, sw + 0.14, sh + 0.14, 0.05, dark, x, y, z);
    box(parent, sw, sh, 0.025, "#284959", x, y, z + 0.04);
    addPreviewSurface(parent, sw, sh, x, y, z + 0.06);
    label(
      parent,
      platform.short,
      "#9ac6d3",
      x,
      y,
      z + 0.057,
      sw * 0.85,
      Math.min(0.12, sh * 0.25),
      "front",
    );
  }
  function handheldControls(z) {
    frontPad(-w * 0.38, -h * 0.04, z);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      frontButton(
        w * 0.38 + Math.cos(a) * 0.12,
        -h * 0.04 + Math.sin(a) * 0.12,
        z,
      );
    }
  }
  if (m.profile === "vertical") {
    box(p, w, h, d, color, 0, 0, 0, 0.1);
    screen(0, h * 0.17, d / 2 + 0.025, w * 0.72, h * 0.4);
    frontPad(-w * 0.27, -h * 0.26, d / 2 + 0.055, 0.3);
    frontButton(w * 0.16, -h * 0.25, d / 2 + 0.055, 0.095, "#a55272");
    frontButton(w * 0.34, -h * 0.19, d / 2 + 0.055, 0.095, "#a55272");
    box(p, 0.17, 0.045, 0.035, trim, -0.12, -h * 0.39, d / 2 + 0.04);
    box(p, 0.17, 0.045, 0.035, trim, 0.12, -h * 0.39, d / 2 + 0.04);
    frontLabel(-h * 0.09, d / 2 + 0.06, w * 0.84);
    if (platform.id === "playdate") {
      box(p, 0.25, 0.055, 0.06, "#d8b73e", w / 2 + 0.1, 0, 0);
      sphere(p, 0.07, "#d8b73e", w / 2 + 0.22, -0.12, 0);
    }
  } else if (["horizontal", "tablet"].includes(m.profile)) {
    box(p, w, h, d, color, 0, 0, 0, 0.15);
    if (platform.id.startsWith("switch")) {
      box(p, w * 0.13, h * 0.95, d + 0.015, "#2f8ba9", -w * 0.435, 0, 0, 0.1);
      box(p, w * 0.13, h * 0.95, d + 0.015, "#bd575b", w * 0.435, 0, 0, 0.1);
    }
    screen(0, 0, d / 2 + 0.02, w * 0.59, h * 0.67);
    handheldControls(d / 2 + 0.07);
    frontLabel(-h * 0.42, d / 2 + 0.04, w * 0.62);
  } else if (["clamshell", "dual"].includes(m.profile)) {
    const deckDepth = Math.max(1.15, d * 3.7);
    box(p, w, 0.23, deckDepth, color, 0, -0.54, 0.12, 0.07);
    const hingeY = -0.4;
    const hingeZ = -deckDepth * 0.4;
    const lid = new THREE.Group();
    lid.position.set(0, hingeY, hingeZ);
    lid.userData.animated = true;
    p.userData.hingePivot = lid;
    p.add(lid);
    box(
      lid,
      w,
      h * 1.2,
      0.2,
      color,
      0,
      h * 0.15 - hingeY,
      -deckDepth * 0.42 - hingeZ,
      0.06,
    );
    screen(
      0,
      h * 0.17 - hingeY,
      -deckDepth * 0.42 + 0.12 - hingeZ,
      w * 0.77,
      h * 0.83,
      lid,
    );
    const hinge = cylinder(p, 0.1, w * 0.87, trim, 0, hingeY, hingeZ);
    hinge.rotation.z = Math.PI / 2;
    if (m.profile === "dual") {
      box(p, w * 0.52, 0.025, deckDepth * 0.62, "#284959", 0, -0.407, 0.14);
      if (platform.id === "ndslite" || platform.id === "3ds") {
        const touch = addPreviewSurface(p, w * 0.52, deckDepth * 0.62, 0, -0.393, 0.14);
        touch.name = "GameplayPreviewTouchSurface";
        touch.rotation.x = -Math.PI / 2;
      }
    }
    dpad(p, -w * 0.37, -0.38, 0.12, 0.3);
    for (let i = 0; i < 4; i++)
      cylinder(
        p,
        0.06,
        0.04,
        "#6d7792",
        w * 0.36 + Math.cos((i * Math.PI) / 2) * 0.11,
        -0.38,
        0.12 + Math.sin((i * Math.PI) / 2) * 0.11,
      );
    label(
      p,
      platform.name,
      "#d7e7ed",
      0,
      -0.405,
      deckDepth * 0.42,
      w * 0.73,
      0.1,
    );
  } else if (m.profile === "desktop") {
    box(p, 0.7, 1.6, 1, color, -1, -0.2, 0);
    box(p, 1.7, 1.1, 0.2, dark, 0.35, 0.35, -0.15);
    screen(0.35, 0.35, 0, 1.5, 0.85);
    box(p, 0.12, 0.5, 0.2, trim, 0.35, -0.4, -0.15);
    box(p, 0.8, 0.08, 0.5, dark, 0.35, -0.67, -0.15);
    box(p, 1.6, 0.12, 0.5, dark, 0.15, -0.85, 0.65);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 13; col++)
        box(
          p,
          0.09,
          0.035,
          0.07,
          trim,
          -0.55 + col * 0.11,
          -0.77,
          0.48 + row * 0.1,
          0.01,
        );
    sphere(p, 0.17, trim, 1.2, -0.83, 0.65, 0.65, 0.4, 1);
  } else if (m.profile === "arcade") {
    box(p, w, h * 0.54, d * 0.78, color, 0, -h * 0.18, -0.08, 0.05);
    box(p, w * 0.98, h * 0.24, d * 0.75, color, 0, h * 0.32, -0.1, 0.04);
    for (const x of [-w * 0.48, w * 0.48])
      box(p, 0.12, h, d * 0.84, color, x, 0, 0, 0.04);
    box(p, w * 0.83, h * 0.36, 0.14, dark, 0, h * 0.13, d * 0.33, 0.025);
    screen(0, h * 0.14, d * 0.42, w * 0.69, h * 0.27);
    box(p, w * 0.92, 0.17, d * 0.72, "#3c4c60", 0, -h * 0.13, d * 0.28, 0.04);
    cylinder(p, 0.035, 0.22, "#afb8bf", -w * 0.26, -h * 0.065, d * 0.48);
    sphere(p, 0.095, "#da5553", -w * 0.26, -h * 0.025, d * 0.48);
    for (let i = 0; i < 6; i++)
      cylinder(
        p,
        0.055,
        0.035,
        ["#67b3e5", "#d95361", "#d9bc61"][i % 3],
        w * 0.1 + (i % 3) * 0.15,
        -h * 0.095,
        d * 0.4 + Math.floor(i / 3) * 0.15,
      );
    box(p, w * 0.9, h * 0.12, 0.08, "#c6a94e", 0, h * 0.415, d * 0.41, 0.02);
    label(
      p,
      platform.kind === "arcade" ? "TOTEM ARCADE" : platform.name,
      "#182331",
      0,
      h * 0.415,
      d * 0.46,
      w * 0.8,
      0.16,
      "front",
    );
    box(p, w * 0.36, h * 0.2, 0.055, dark, 0, -h * 0.31, d * 0.34, 0.02);
    box(p, w * 0.12, 0.025, 0.065, "#9ba1a8", 0, -h * 0.29, d * 0.38, 0.005);
  } else if (m.profile === "visor") {
    box(p, w, h, d, color, 0, 0.3, 0, 0.2);
    for (const x of [-w * 0.25, w * 0.25]) {
      const lens = cylinder(p, h * 0.32, 0.08, dark, x, 0.3, d / 2 + 0.03);
      lens.rotation.x = Math.PI / 2;
    }
    if (platform.id === "virtualboy") {
      box(p, 0.13, 1.2, 0.13, dark, 0, -0.7, 0);
      for (const x of [-0.55, 0.55]) {
        const leg = box(p, 1, 0.08, 0.14, dark, x, -1.25, 0.15);
        leg.rotation.y = x;
      }
    }
    frontLabel(0.3, d / 2 + 0.09, w * 0.7);
  } else if (m.profile === "controller") {
    box(p, w * 0.75, h * 0.46, d * 0.52, color, 0, 0, 0, 0.15);
    for (const x of [-w * 0.34, w * 0.34])
      sphere(p, 0.35, color, x, -0.05, d * 0.17, 0.8, 0.5, 1.3);
    dpad(p, -w * 0.25, h * 0.27, 0, 0.32);
    for (let i = 0; i < 4; i++)
      cylinder(
        p,
        0.06,
        0.04,
        "#929aab",
        w * 0.25 + Math.cos((i * Math.PI) / 2) * 0.12,
        h * 0.27,
        Math.sin((i * Math.PI) / 2) * 0.12,
      );
    label(p, platform.name, "#b8c7d9", 0, h * 0.25, -d * 0.12, w * 0.4, 0.12);
  } else {
    box(p, w, h, d, color, 0, 0, 0, 0.065);
    box(p, w * 0.97, h * 0.16, d * 0.96, color, 0, h * 0.57, 0, 0.03);
    if (m.profile === "cartridge") {
      box(p, w * 0.48, 0.055, 0.2, dark, 0, h * 0.7, -d * 0.15, 0.01);
      for (let i = 0; i < 8; i++)
        box(
          p,
          0.035,
          0.02,
          d * 0.33,
          dark,
          -w * 0.38 + i * 0.08,
          h * 0.67,
          -d * 0.18,
          0.003,
        );
    } else if (m.profile === "disc") {
      cylinder(
        p,
        Math.min(w, d) * 0.34,
        0.045,
        "#596373",
        0,
        h * 0.7,
        -d * 0.05,
      );
      cylinder(p, Math.min(w, d) * 0.31, 0.05, color, 0, h * 0.72, -d * 0.05);
      box(p, w * 0.42, 0.08, 0.035, dark, -w * 0.2, 0, d / 2 + 0.02, 0.01);
    } else if (m.profile === "tower") {
      box(p, w * 0.63, h * 0.92, d * 0.95, dark, 0, 0, 0.03, 0.04);
      for (const x of [-w * 0.43, w * 0.43])
        box(p, w * 0.15, h, d, color, x, 0, 0, 0.04);
      box(
        p,
        0.035,
        h * 0.5,
        0.04,
        "#71b8dc",
        -w * 0.13,
        -h * 0.04,
        d / 2 + 0.03,
        0.005,
      );
    } else if (m.profile === "keyboard") {
      if (platform.id === "cybiko") {
        const screenZ = -d * 0.3;
        box(p, w * 0.6, 0.025, d * 0.28, dark, 0, h * 0.67, screenZ, 0.01);
        const surface = addPreviewSurface(p, w * 0.54, d * 0.24, 0, h * 0.67 + 0.014, screenZ);
        surface.rotation.x = -Math.PI / 2;
      }
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 10; col++)
          box(
            p,
            w * 0.065,
            0.035,
            d * 0.09,
            trim,
            -w * 0.35 + col * w * 0.078,
            h * 0.7,
            -d * 0.1 + row * d * 0.15,
            0.006,
          );
    }
    for (const x of [-w * 0.23, w * 0.23])
      port(p, x, -h * 0.15, d / 2 + 0.02, 0.24, 0.08);
    frontLabel(h * 0.15);
    if (m.profile !== "tower")
      label(p, platform.name, "#d7e7ed", 0, h * 0.8, d * 0.27, w * 0.65, 0.13);
  }
  const bounds = new THREE.Box3().setFromObject(p);
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  p.position.sub(centre);
  const scale = Math.min(1, 3.3 / Math.max(size.x, size.y, size.z));
  p.position.multiplyScalar(scale);
  p.scale.setScalar(scale);
  return p;
}
