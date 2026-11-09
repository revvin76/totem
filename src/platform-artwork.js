import artwork from "../platform-artwork.json" with { type: "json" };
import brandArtwork from "../platform-brand-artwork.json" with { type: "json" };

// Bundled local artwork is independent of editable platform records, so old
// saved records still receive logos and custom uploads continue to take priority.
export function bundledLogo(platform) {
  const path = brandArtwork[platform?.id]?.path ?? artwork[platform?.id]?.path ?? null;
  return path ? `/${path.replace(/^\/+/, "")}` : null;
}

export function bundledBrandArtwork(platform) {
  return brandArtwork[platform?.id] ?? null;
}
