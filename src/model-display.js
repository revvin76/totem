import variants from '../model-display-variants.json' with { type: 'json' };

// The catalogue remains authoritative. Derivatives only apply to the exact
// source they were generated from, so a user import cannot inherit stale art.
export function displayPlatform(platform, tier) {
  if (platform.usePlaceholder) return platform;
  const entry = variants.platforms[platform.id];
  const source = platform.bundledModel;
  const matches = entry && source?.sha256 === entry.sourceSha256 &&
    (!platform.modelFile || platform.modelFile.id.startsWith(`${entry.sourceSha256}.`));
  // Studio previews the actual platform, including custom models without a derivative.
  const reference = matches ? entry[tier === 'studio' ? 'preview' : tier] : null;
  if (!reference) return tier === 'preview' ? { ...platform, usePlaceholder: true } : platform;
  const result = { ...platform, bundledModel: { ...source, ...reference } };
  // Cartridge fits are authored for the carousel display model. Studio uses
  // its lighter derivative while keeping that display model as the fit reference.
  if (tier === 'studio') result.carouselDisplaySha256 = entry.display?.sha256 ?? source.sha256;
  delete result.modelFile;
  return result;
}
