import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial } from "three";

// Tiny, untextured stand-ins keep every enabled ring slot visible while GLBs
// are being read and decoded. Geometry and materials are owned by each model
// so residency can dispose of a stand-in as soon as its preview is attached.
export function createRingPlaceholder(platform) {
  const root = new Group();
  root.userData.platformId = platform.id;
  root.userData.placeholder = true;
  root.userData.ringPlaceholder = true;

  const accent = new Color(platform.color || "#586279");
  const dark = accent.clone().multiplyScalar(0.28);
  const pale = accent.clone().lerp(new Color("#ffffff"), 0.62);
  const material = (color) => new MeshStandardMaterial({ color, roughness: 0.68 });
  const bodyMaterial = material(accent);
  const detailMaterial = material(dark);
  const screenMaterial = material("#101722");
  const addBox = (name, size, position, mat, segments = [1, 1, 1]) => {
    const mesh = new Mesh(new BoxGeometry(...size, ...segments), mat);
    mesh.name = name;
    mesh.position.set(...position);
    root.add(mesh);
    return mesh;
  };

  const profile = platform.model?.profile;
  const handheld = platform.kind === "handheld" || platform.kind === "hybrid";
  const width = Math.min(3.2, platform.model?.width ?? (handheld ? 2.1 : 2.7));
  const height = Math.min(3.2, platform.model?.height ?? (handheld ? 1.65 : 0.72));
  const depth = Math.min(2.3, platform.model?.depth ?? (handheld ? 0.42 : 1.8));

  if (platform.kind === "arcade" || profile === "arcade") {
    addBox("Cabinet", [width, height, depth], [0, height / 2, 0], bodyMaterial);
    addBox("Marquee", [width * 0.78, height * 0.15, 0.035], [0, height * 0.81, depth / 2 + 0.02], pale);
    addBox("Screen", [width * 0.72, height * 0.4, 0.04], [0, height * 0.56, depth / 2 + 0.025], screenMaterial);
    addBox("Control deck", [width * 0.82, 0.07, depth * 0.25], [0, height * 0.29, depth * 0.28], detailMaterial);
  } else if (handheld) {
    const tablet = profile === "tablet" || platform.kind === "hybrid";
    const bodyWidth = tablet ? width * 0.76 : width;
    addBox("Handheld shell", [bodyWidth, height, depth], [0, 0, 0], bodyMaterial);
    addBox("Display", [bodyWidth * 0.57, height * 0.46, 0.025], [0, height * 0.17, depth / 2 + 0.016], screenMaterial);
    if (profile === "dual")
      addBox("Lower display", [bodyWidth * 0.54, height * 0.23, 0.025], [0, -height * 0.26, depth / 2 + 0.016], screenMaterial);
    if (!tablet) {
      addBox("D-pad", [bodyWidth * 0.13, height * 0.13, 0.045], [-bodyWidth * 0.29, -height * 0.22, depth / 2 + 0.035], detailMaterial);
      addBox("Action buttons", [bodyWidth * 0.15, height * 0.08, 0.045], [bodyWidth * 0.29, -height * 0.22, depth / 2 + 0.035], pale);
    }
  } else {
    addBox("Console shell", [width, height, depth], [0, height / 2, 0], bodyMaterial);
    if (["cartridge", "disc", "keyboard", "visor"].includes(profile))
      addBox("Top detail", [width * 0.53, 0.025, depth * 0.5], [0, height + 0.018, 0], detailMaterial);
    addBox("Front panel", [width * 0.5, height * 0.22, 0.025], [0, height * 0.43, depth / 2 + 0.016], detailMaterial);
    addBox("Power indicator", [0.07, 0.035, 0.03], [width * 0.34, height * 0.43, depth / 2 + 0.034], pale);
  }

  root.userData.coverage = "Lightweight ring stand-in";
  return root;
}
