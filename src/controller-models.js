import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Original procedural display models. Every interactive surface is a separate,
// named mesh, so labels, pairing light and input identifiers stay in agreement.
export function createControllerModel(profile) {
  const root = new THREE.Group();
  const buttons = new Map();
  const material = (color, roughness = 0.55) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.08 });
  function box(
    width,
    height,
    depth,
    color,
    x = 0,
    y = 0,
    z = 0,
    radius = 0.12,
  ) {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(
        width,
        height,
        depth,
        3,
        Math.min(radius, width / 4, height / 4, depth / 4),
      ),
      material(color),
    );
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  }
  function text(parent, value, x, y, z, width = 0.35, height = 0.16) {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    context.font = "600 57px Segoe UI, Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const measured = context.measureText(value).width;
    if (measured > 450)
      context.font = `600 ${Math.max(15, Math.floor((57 * 450) / measured))}px Segoe UI, Arial`;
    context.lineWidth = 9;
    context.strokeStyle = "#101824";
    context.strokeText(value, 256, 64);
    context.fillStyle = "#f4f8ff";
    context.fillText(value, 256, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    label.position.set(x, y, z);
    parent.add(label);
  }
  function silhouette(points, color) {
    const shape = new THREE.Shape();
    const last = points[points.length - 1];
    shape.moveTo((last[0] + points[0][0]) / 2, (last[1] + points[0][1]) / 2);
    for (let i = 0; i < points.length; i++) {
      const p = points[i],
        next = points[(i + 1) % points.length];
      shape.quadraticCurveTo(
        p[0],
        p[1],
        (p[0] + next[0]) / 2,
        (p[1] + next[1]) / 2,
      );
    }
    shape.closePath();
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.4,
        bevelEnabled: true,
        bevelSegments: 4,
        bevelSize: 0.11,
        bevelThickness: 0.09,
        steps: 1,
      }),
      material(color),
    );
    mesh.position.z = -0.25;
    root.add(mesh);
  }
  const padOutline = [
    [-1.58, 0.66],
    [-0.98, 0.9],
    [0.98, 0.9],
    [1.58, 0.66],
    [1.77, 0.12],
    [1.55, -1.05],
    [1.19, -1.16],
    [0.7, -0.55],
    [-0.7, -0.55],
    [-1.19, -1.16],
    [-1.55, -1.05],
    [-1.77, 0.12],
  ];
  const color = profile.color;
  if (
    ["xbox", "playstation", "gamecube", "dreamcast"].includes(profile.shape)
  ) {
    silhouette(padOutline, color);
    box(2.9, 1.13, 0.12, color, 0, 0.27, 0.2);
    if (profile.shape === "playstation") {
      box(0.84, 0.72, 0.16, "#212b38", -1.07, 0.22, 0.26);
      box(0.84, 0.72, 0.16, "#212b38", 1.07, 0.22, 0.26);
    }
    if (profile.shape === "dreamcast") {
      box(0.72, 0.81, 0.07, "#67717d", 0, 0.26, 0.3);
      box(0.53, 0.51, 0.03, "#acc1ad", 0, 0.29, 0.35);
    }
    // Thumbstick sockets beneath the separately addressable direction surfaces.
    const sticks = new Map();
    for (const c of profile.controls.filter((c) => c.shape === "axis")) {
      const prefix = c.id.replace(/(up|down|left|right)$/, "");
      const [x, y] = c.position;
      if (!sticks.has(prefix))
        sticks.set(prefix, [
          x +
            (c.id.endsWith("left") ? 0.23 : c.id.endsWith("right") ? -0.23 : 0),
          y + (c.id.endsWith("up") ? -0.23 : c.id.endsWith("down") ? 0.23 : 0),
        ]);
    }
    for (const [x, y] of sticks.values()) {
      const socket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.29, 0.31, 0.08, 32),
        material("#19212b"),
      );
      socket.rotation.x = Math.PI / 2;
      socket.position.set(x, y, 0.3);
      root.add(socket);
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.19, 0.13, 32),
        material("#4a535e"),
      );
      cap.rotation.x = Math.PI / 2;
      cap.position.set(x, y, 0.4);
      root.add(cap);
    }
  } else if (profile.shape === "n64") {
    silhouette(
      [
        [-1.65, 0.65],
        [-0.9, 0.88],
        [0.9, 0.88],
        [1.65, 0.65],
        [1.7, 0.05],
        [1.45, -1],
        [1.12, -1.08],
        [0.68, -0.27],
        [0.28, -1.3],
        [-0.28, -1.3],
        [-0.68, -0.27],
        [-1.12, -1.08],
        [-1.45, -1],
        [-1.7, 0.05],
      ],
      color,
    );
  } else if (profile.shape === "jaguar") {
    silhouette(
      [
        [-1.65, 0.65],
        [-0.9, 0.85],
        [0.9, 0.85],
        [1.65, 0.65],
        [1.75, 0],
        [1.4, -0.75],
        [0.8, -0.55],
        [0.7, -1.35],
        [-0.7, -1.35],
        [-0.8, -0.55],
        [-1.4, -0.75],
        [-1.75, 0],
      ],
      color,
    );
    box(1.3, 1.4, 0.06, "#202937", 0, -0.65, 0.25);
  } else if (profile.shape === "handheld") {
    box(1.85, 3.05, 0.5, color, 0, 0, 0, 0.18);
    box(1.45, 1.3, 0.08, "#5e6270", 0, 0.67, 0.28);
    box(1.05, 0.94, 0.03, "#869f59", 0, 0.69, 0.34);
    for (let i = 0; i < 5; i++)
      box(0.06, 0.36, 0.025, "#636c74", 0.27 + i * 0.12, -1.06, 0.27, 0.01);
  } else if (["widehandheld", "switch"].includes(profile.shape)) {
    box(profile.shape === "switch" ? 4.2 : 3.8, 1.8, 0.48, color);
    box(2.04, 1.39, 0.06, "#111a26", 0, 0.06, 0.28);
    box(1.8, 1.08, 0.025, "#283b4c", 0, 0.06, 0.325);
    if (profile.shape === "switch") {
      box(0.63, 1.78, 0.5, "#3a9bb5", -1.79, 0, 0);
      box(0.63, 1.78, 0.5, "#bf575b", 1.79, 0, 0);
    }
  } else if (profile.shape === "clamshell") {
    box(3.05, 1.47, 0.36, color, 0, -0.69, 0);
    box(3.05, 1.45, 0.23, color, 0, 0.82, -0.16);
    box(1.88, 1.04, 0.05, "#152333", 0, 0.83, 0);
    box(1.24, 0.76, 0.05, "#1b2c3d", 0, -0.56, 0.22);
    box(2.7, 0.14, 0.3, "#687386", 0, 0.05, -0.08, 0.03);
  } else if (profile.shape === "wii") {
    box(0.96, 3.27, 0.53, color, 0.55, 0, 0);
    box(0.76, 0.35, 0.06, "#1f2b3a", 0.55, 1.34, 0.3);
    box(0.7, 1.34, 0.61, color, -1.05, -0.35, -0.03, 0.17);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.55, -1.58, 0),
      new THREE.Vector3(0.2, -1.98, 0),
      new THREE.Vector3(-0.9, -1.5, 0),
      new THREE.Vector3(-1.05, -0.95, 0),
    ]);
    root.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 28, 0.025, 6, false),
        material("#9faab7"),
      ),
    );
  } else if (profile.shape === "joystick") {
    box(2.95, 1.66, 0.5, color, 0, -0.2, 0);
    box(0.7, 0.7, 0.23, "#202732", 0.25, 0.12, 0.31);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 0.8, 20),
      material("#606b7a"),
    );
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0.25, 0.12, 0.65);
    root.add(shaft);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 24, 16),
      material("#414b59"),
    );
    knob.position.set(0.25, 0.12, 1.03);
    root.add(knob);
  } else if (profile.shape === "keyboard") {
    box(5.1, 2.8, 0.4, color, 0, -0.15, 0);
  } else {
    box(
      profile.shape === "arcade" ? 3.9 : 3.85,
      1.85,
      0.46,
      color,
      0,
      0,
      0,
      profile.shape === "snes" || profile.shape === "megadrive" ? 0.2 : 0.1,
    );
    if (profile.shape === "nes")
      box(3.5, 1.24, 0.04, "#353d4a", 0, -0.05, 0.26, 0.05);
  }
  text(
    root,
    profile.name,
    0,
    profile.shape === "handheld" ? -0.12 : -0.82,
    0.37,
    1.2,
    0.12,
  );
  const directions = profile.controls.filter((c) =>
    ["up", "down", "left", "right"].includes(c.id),
  );
  if (directions.length === 4) {
    const x = directions.reduce((sum, c) => sum + c.position[0], 0) / 4,
      y = directions.reduce((sum, c) => sum + c.position[1], 0) / 4;
    if (profile.shape === "xbox") {
      const dish = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.39, 0.08, 8),
        material("#66717f"),
      );
      dish.rotation.x = Math.PI / 2;
      dish.position.set(x, y, 0.3);
      root.add(dish);
    } else {
      box(0.58, 0.18, 0.08, "#252d38", x, y, 0.3, 0.02);
      box(0.18, 0.58, 0.08, "#252d38", x, y, 0.3, 0.02);
    }
  }
  for (const control of profile.controls) {
    const node = new THREE.Group();
    node.name = control.id;
    node.userData.controlId = control.id;
    node.position.set(...control.position);
    if (control.view === "top") node.rotation.x = -Math.PI / 2;
    if (control.view === "top")
      node.position.y = profile.shape === "wii" ? 0.4 : 1.02;
    if (control.view === "rear") {
      node.rotation.y = Math.PI;
      node.position.z = Math.min(node.position.z, -0.45);
    }
    let geometry;
    const radius =
      control.shape === "axis"
        ? 0.075
        : control.shape === "stick"
          ? 0.17
          : 0.15;
    if (["pill", "shoulder", "touchpad", "key"].includes(control.shape)) {
      const [w, h] =
        control.shape === "touchpad"
          ? [1, 0.32]
          : control.shape === "shoulder"
            ? [0.62, 0.23]
            : control.shape === "key"
              ? [0.26, 0.22]
              : [0.29, 0.12];
      geometry = new RoundedBoxGeometry(w, h, 0.1, 2, 0.035);
    } else if (["up", "down", "left", "right"].includes(control.shape)) {
      geometry = new THREE.BoxGeometry(0.19, 0.19, 0.1);
    } else {
      geometry = new THREE.CylinderGeometry(radius, radius * 1.08, 0.1, 28);
      geometry.rotateX(Math.PI / 2);
    }
    const faceMaterial = material(control.color, 0.42);
    const face = new THREE.Mesh(geometry, faceMaterial);
    face.userData.controlId = control.id;
    node.add(face);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(Math.max(radius, 0.16) + 0.065, 0.028, 8, 32),
      haloMaterial,
    );
    halo.position.z = 0.09;
    node.add(halo);
    const label =
      control.shape === "axis"
        ? control.id.endsWith("up")
          ? "↑"
          : control.id.endsWith("down")
            ? "↓"
            : control.id.endsWith("left")
              ? "←"
              : "→"
        : ({
            Cross: "×",
            Circle: "○",
            Square: "□",
            Triangle: "△",
            "D-pad up": "↑",
            "D-pad down": "↓",
            "D-pad left": "←",
            "D-pad right": "→",
            Xbox: "X",
            "Nunchuk C": "C",
            "Nunchuk Z": "Z",
            "B trigger": "B",
            "L stick click": "L3",
            "R stick click": "R3",
          }[control.label] ?? control.label);
    text(
      node,
      label,
      0,
      0,
      0.07,
      control.shape === "axis"
        ? 0.11
        : control.shape === "shoulder"
          ? 0.36
          : 0.28,
      control.shape === "axis" ? 0.1 : 0.12,
    );
    root.add(node);
    buttons.set(control.id, {
      node,
      face,
      halo,
      base: new THREE.Color(control.color),
    });
  }
  return {
    root,
    buttons,
    highlight(states) {
      for (const [id, button] of buttons) {
        const state = states.get(id);
        button.face.material.color.copy(button.base);
        button.face.material.emissive.set(0x000000);
        button.face.material.emissiveIntensity = 0;
        button.halo.material.opacity = 0;
        if (state) {
          const colour =
            state.colour === "green"
              ? new THREE.Color("#55ee94")
              : new THREE.Color("#ffffff");
          button.face.material.color.lerp(colour, state.intensity * 0.8);
          button.face.material.emissive.copy(colour);
          button.face.material.emissiveIntensity = state.intensity * 0.8;
          button.halo.material.color.copy(colour);
          button.halo.material.opacity = state.intensity;
        }
      }
    },
    dispose() {
      const disposed = new Set();
      root.traverse((part) => {
        if (!part.isMesh) return;
        if (!disposed.has(part.geometry)) {
          part.geometry.dispose();
          disposed.add(part.geometry);
        }
        for (const m of Array.isArray(part.material)
          ? part.material
          : [part.material])
          if (!disposed.has(m)) {
            m.map?.dispose();
            m.dispose();
            disposed.add(m);
          }
      });
    },
  };
}
