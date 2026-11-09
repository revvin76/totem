export function visibleLogoBounds(pixels, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Ignore nearly invisible specks that would otherwise enlarge the crop.
      if (pixels[(y * width + x) * 4 + 3] < 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function trimLogo(image) {
  const { naturalWidth, naturalHeight } = image;
  if (!naturalWidth || !naturalHeight) return image.src;
  const scale = Math.min(1, 2048 / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = image.ownerDocument.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return image.src;

  try {
    context.drawImage(image, 0, 0, width, height);
    const crop = visibleLogoBounds(context.getImageData(0, 0, width, height).data, width, height);
    if (!crop) return null;
    if (crop.width === width && crop.height === height) return image.src;
    const sourceX = naturalWidth / width;
    const sourceY = naturalHeight / height;
    canvas.width = crop.width;
    canvas.height = crop.height;
    context.drawImage(image, crop.x * sourceX, crop.y * sourceY, crop.width * sourceX, crop.height * sourceY,
      0, 0, crop.width, crop.height);
    return canvas.toDataURL();
  } catch {
    return image.src;
  }
}

export function titleArtwork(image, fallback) {
  let revision = 0;
  return async (url, title = "") => {
    const request = ++revision;
    image.hidden = true;
    image.removeAttribute("src");
    fallback.removeAttribute("aria-hidden");
    if (!url) return;

    image.alt = title;
    image.src = url;
    try {
      await image.decode();
      if (request !== revision) return;
      const cropped = trimLogo(image);
      if (!cropped) {
        image.removeAttribute("src");
        return;
      }
      if (cropped !== image.src) {
        image.src = cropped;
        await image.decode();
      }
    } catch {
      if (request === revision) image.removeAttribute("src");
      return;
    }
    if (request !== revision) return;

    // Keep the fallback in the shared grid cell to reserve its title space.
    fallback.setAttribute("aria-hidden", "true");
    image.hidden = false;
  };
}
