import * as THREE from "three";

const artwork = "/artwork/game-selection/";
const loader = new THREE.TextureLoader();
const displays = {
  tv: { file: "television.png", width: 1448, height: 1086, screen: [[181,230],[1251,111],[1245,852],[168,828]] },
  arcade: { file: "arcade.png", width: 1086, height: 1448, screen: [[278,398],[823,380],[783,730],[204,727]] },
};

export function createDisplay(kind) {
  const { file, width, height, screen } = displays[kind];
  const texture = loader.load(artwork + file);
  texture.colorSpace = THREE.SRGBColorSpace;
  const root = new THREE.Group();
  const aspect = width / height;
  root.add(new THREE.Mesh(new THREE.PlaneGeometry(aspect, 1),
    new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.025, toneMapped: false })));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(
    screen.flatMap(([x, y]) => [(x / width - 0.5) * aspect, 0.5 - y / height, 0.01]), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0,1, 1,1, 1,0, 0,0], 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false }));
  surface.renderOrder = 1;
  root.add(surface);
  return { root, surface, aspect };
}

export function fitModel(model, width, height, x, y, { alignTop = false } = {}) {
  model.scale.setScalar(1);
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) return;
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  const scale = Math.min(width / Math.max(size.x, 0.01), height / Math.max(size.y, 0.01));
  model.scale.setScalar(scale);
  const anchor = alignTop ? bounds.max.y : bounds.min.y;
  model.position.set(x - centre.x * scale, y - anchor * scale, -centre.z * scale);
}

export function findScreen(model, key) {
  let exact, named;
  if (!model) return null;
  model.traverse((part) => {
    if (!part.isMesh || !part.geometry.getAttribute("uv")) return;
    if (key && part.userData.animationMeshKey === key) exact = part;
    if (!named && (/^(?:lcd|screen|display|GameplayPreviewSurface)(?:[_. -]?\d+)?$/i.test(part.name) ||
        part.name === "Totem GBA showcase LCD")) named = part;
  });
  return key ? exact : named;
}
