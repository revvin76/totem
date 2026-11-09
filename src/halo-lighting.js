import { Color, SRGBColorSpace } from "three";

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load halo lighting image: ${source}`));
    image.src = source;
  });
}

export async function loadHaloLightField(
  colorSource = "/artwork/home-neon-orbit.png",
  maskSource = "/artwork/home-neon-lightmap.png",
) {
  const [colorImage, maskImage] = await Promise.all([
    loadImage(colorSource),
    loadImage(maskSource),
  ]);
  const { naturalWidth: width, naturalHeight: height } = colorImage;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(maskImage, 0, 0, width, height);
  const mask = context.getImageData(0, 0, width, height).data;
  context.clearRect(0, 0, width, height);
  context.drawImage(colorImage, 0, 0, width, height);
  const colors = context.getImageData(0, 0, width, height).data;

  return {
    sample(screenX, screenY, appRect, target = new Color()) {
      const scale = Math.max(appRect.width / width, appRect.height / height);
      const cropX = (appRect.width - width * scale) / 2;
      const cropY = (appRect.height - height * scale) / 2;
      const x = Math.round((screenX - appRect.left - cropX) / scale);
      const y = Math.round((screenY - appRect.top - cropY) / scale);
      if (x < 0 || y < 0 || x >= width || y >= height)
        return { color: target.setRGB(0, 0, 0), intensity: 0 };

      let red = 0;
      let green = 0;
      let blue = 0;
      let total = 0;
      let peak = 0;
      for (let dy = -12; dy <= 12; dy += 3) {
        const py = y + dy;
        if (py < 0 || py >= height) continue;
        for (let dx = -12; dx <= 12; dx += 3) {
          const px = x + dx;
          if (px < 0 || px >= width) continue;
          const index = (py * width + px) * 4;
          const weight = mask[index] / 255;
          if (weight <= 0) continue;
          peak = Math.max(peak, weight);
          red += colors[index] * weight;
          green += colors[index + 1] * weight;
          blue += colors[index + 2] * weight;
          total += weight;
        }
      }
      if (total === 0)
        return { color: target.setRGB(0, 0, 0), intensity: 0 };
      target.setRGB(
        red / total / 255,
        green / total / 255,
        blue / total / 255,
        SRGBColorSpace,
      );
      return { color: target, intensity: Math.min(1, peak * 0.7 + total / 81 * 2.2) };
    },
  };
}

export function applyHaloLight(model, color, intensity) {
  let haloMaterials = model.userData.haloMaterials;
  if (intensity <= 0.001 && !haloMaterials) return;
  if (!haloMaterials) {
    const clones = new Map();
    model.traverse((part) => {
      if (!part.isMesh) return;
      const materials = Array.isArray(part.material)
        ? part.material
        : [part.material];
      const isolated = materials.map((material) => {
        if (!material.emissive) return material;
        if (!clones.has(material)) {
          const copy = material.clone();
          copy.userData.haloBaseEmissive = copy.emissive.clone();
          clones.set(material, copy);
        }
        return clones.get(material);
      });
      part.material = Array.isArray(part.material) ? isolated : isolated[0];
    });
    haloMaterials = [...clones.values()];
    model.userData.haloMaterials = haloMaterials;
  }
  const amount = intensity * 0.18;
  for (const material of haloMaterials) {
    material.emissive.copy(material.userData.haloBaseEmissive);
    material.emissive.r += color.r * amount;
    material.emissive.g += color.g * amount;
    material.emissive.b += color.b * amount;
  }
}
