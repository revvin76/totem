import brandArtwork from "../platform-brand-artwork.json" with { type: "json" };

export function platformSymbol(platform) {
  const brand = brandArtwork[platform?.id];
  return brand ? { path: `/${brand.path}`, position: brand.symbolPosition, crop: true } : null;
}
