import defaults from '../box-art-defaults.json' with { type: 'json' };
export const BOX_ART_TEMPLATES = defaults.templates;
export const BOX_ART_PANELS = ['front', 'back', 'spine'];
export function defaultBoxArt(platform) {
  const id = typeof platform === 'string' ? platform : platform?.id;
  const template = defaults.platforms[id] ?? (platform?.kind === 'computer' ? 'cardboard' : 'dvd-black');
  return { version: 1, template, source: defaults.templates[template].source ?? '', author: defaults.templates[template].author ?? '', license: defaults.templates[template].license ?? '', rotation: [0, 0, 0], neutralMaterials: [], panels: structuredClone(defaults.templates[template].panels) };
}
export function boxArtForPlatform(platform) {
  const config = structuredClone(platform?.boxArt ?? defaultBoxArt(platform));
  if (config.template === 'snes-retail-box') {
    config.rotation = [...BOX_ART_TEMPLATES['snes-retail-box'].rotation];
    config.panels = structuredClone(BOX_ART_TEMPLATES['snes-retail-box'].panels);
  }
  return config;
}
export function validateBoxArt(value) {
  if (!value || value.version !== 1 || !BOX_ART_TEMPLATES[value.template]) throw new Error('Choose a supported Box Art base model.');
  function vector(v, n, min, max) { return Array.isArray(v) && v.length === n && v.every(x => Number.isFinite(x) && x >= min && x <= max); }
  if (!vector(value.rotation, 3, -180, 180)) throw new Error('Box Art model rotation must be within −180° to 180°.');
  if (!Array.isArray(value.neutralMaterials) || value.neutralMaterials.length > 16 || value.neutralMaterials.some(v => typeof v !== 'string' || v.length > 100)) throw new Error('Invalid Box Art material selection.');
  for (const slot of BOX_ART_PANELS) {
    const p = value.panels?.[slot];
    if (!p || typeof p.enabled !== 'boolean' || !vector(p.position, 3, -5, 5) || !vector(p.rotation, 3, -180, 180) || !vector(p.size, 2, 0.01, 5)) throw new Error(`Invalid ${slot} artwork placement.`);
  }
  if (value.template === 'custom' && !value.modelFile) throw new Error('Choose a GLB for the custom Box Art model.');
  if (value.modelFile && (value.modelFile.kind !== 'model' || !/^[a-f0-9]{64}\.glb$/.test(value.modelFile.id) || typeof value.modelFile.name !== 'string')) throw new Error('Invalid Box Art model reference.');
  for (const key of ['source', 'author', 'license']) if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 2000)) throw new Error('Box Art credit is too long.');
  return structuredClone(value);
}
