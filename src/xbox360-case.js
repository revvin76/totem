import * as THREE from "three";

// The supplied label mesh's UV seams (the green plastic is a separate material).
// The source atlas is vertically flipped. Preserve horizontal reading order
// when mapping an upright back / spine / front wrap into its UV panels.
export const XBOX360_PANELS = {
  back: [0, 0.47171], spine: [0.47171, 0.52829], front: [0.52829, 1],
};

export function xbox360AtlasRect(panel, size = 2048) {
  const [left, right] = XBOX360_PANELS[panel];
  return { x: left * size, y: 0, width: (right - left) * size, height: size };
}

function panelCanvas(game, panel, image, wrap) {
  const canvas = document.createElement("canvas");
  const rect = xbox360AtlasRect(panel);
  canvas.width = Math.round(rect.width); canvas.height = rect.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#17221c"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (wrap) {
    const [left, right] = XBOX360_PANELS[panel];
    ctx.drawImage(wrap, left * wrap.width, 0, (right - left) * wrap.width, wrap.height, 0, 0, canvas.width, canvas.height);
  } else if (image) {
    // Physical panel proportions, rather than the square source atlas proportions.
    const aspect = panel === "spine" ? 0.145 / 1.847328 : 1.318 / 1.847328;
    const fitHeight = panel === "front" ? Math.max : Math.min;
    const fittedHeight = fitHeight(canvas.height, canvas.height * aspect / (image.width / image.height));
    const fittedWidth = fittedHeight * (image.width / image.height) / aspect * canvas.width / canvas.height;
    ctx.drawImage(image, (canvas.width - fittedWidth) / 2, (canvas.height - fittedHeight) / 2, fittedWidth, fittedHeight);
  } else {
    // Never leave another game's title/screenshots on missing panels.
    ctx.fillStyle = "#d8eee0"; ctx.textAlign = "center";
    if (panel === "spine") {
      ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(Math.PI / 2);
      ctx.font = "50px Segoe UI, sans-serif"; ctx.fillText(game.title, 0, 18, canvas.height * 0.82);
    } else {
      ctx.font = "54px Segoe UI, sans-serif"; ctx.fillText("XBOX 360", canvas.width / 2, 120);
      ctx.font = "45px Segoe UI, sans-serif"; ctx.fillText(game.title, canvas.width / 2, canvas.height / 2, canvas.width * 0.88);
      ctx.font = "30px Segoe UI, sans-serif";
      ctx.fillText(`${panel === "front" ? "Cover" : "Back artwork"} unavailable`, canvas.width / 2, canvas.height / 2 + 85);
    }
  }
  return canvas;
}

export async function applyXbox360Artwork(root, game, loadImage = async (url) => {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  return { image: texture.image, dispose: () => texture.dispose() };
}) {
  const loaded = [];
  try {
    const images = {};
    for (const [slot, url] of Object.entries({ front: game.cover, back: game.backCover, spine: game.spineCover, wrap: game.wrapCover })) {
      if (url) { const asset = await loadImage(url); loaded.push(asset); images[slot] = asset.image; }
    }
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 2048;
    const ctx = canvas.getContext("2d");
    for (const panel of Object.keys(XBOX360_PANELS)) {
      const rect = xbox360AtlasRect(panel), content = panelCanvas(game, panel, images[panel], images.wrap);
      ctx.save(); ctx.translate(rect.x, rect.height); ctx.scale(1, -1);
      ctx.drawImage(content, 0, 0, rect.width, rect.height); ctx.restore();
    }
    const label = [];
    root.traverse((part) => {
      if (part.isMesh) for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
        if (material.name === "label" && !label.includes(material)) label.push(material);
      }
    });
    if (label.length !== 1) throw new Error("The Xbox 360 template label material is unavailable.");
    const material = label[0], previous = material.map;
    const map = new THREE.CanvasTexture(canvas); map.flipY = false; map.colorSpace = THREE.SRGBColorSpace;
    material.map = map; material.needsUpdate = true;
    previous?.dispose(); previous?.image?.close?.();
    root.userData.artworkTemplate = "xbox360-case";
  } finally { for (const asset of loaded) asset.dispose(); }
  return root;
}
