import { normalizeVoiceSettings } from './tiko-voice-settings.js';

export const PERSONALITY_PRESETS = Object.freeze({
  subtle: { probability: 0.5, idleMin: 90, idleMax: 180, movement: 0.35, flight: 0.1 },
  balanced: { probability: 1, idleMin: 45, idleMax: 120, movement: 0.65, flight: 0.4 },
  playful: { probability: 1.3, idleMin: 25, idleMax: 65, movement: 1, flight: 0.7 },
});
export const DEFAULT_PERSONALITY = Object.freeze({
  enabled: true, preset: 'balanced', reactions: true, ambient: true, flight: true, easterEggs: true,
  displayEnabled: true, brightness: 1, glow: 1, color: '#51F4FF', blinking: true,
  randomMessages: true, miniAnimations: true, screenSurprises: true,
  cooldown: 10, idleMin: 45, idleMax: 120, speed: 1, reducedMotion: 'system', effects: true,
  categories: Object.freeze({ games: true, favourites: true, platforms: true, controllers: true, library: true, settings: true, emulators: true }),
});
const bounded = (value, fallback, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
export function normalizePersonality(value = {}) {
  const result = { ...DEFAULT_PERSONALITY, categories: { ...DEFAULT_PERSONALITY.categories }, voice: normalizeVoiceSettings(value?.voice) };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of ['enabled', 'reactions', 'ambient', 'flight', 'easterEggs', 'displayEnabled', 'blinking', 'effects', 'randomMessages', 'miniAnimations', 'screenSurprises']) if (typeof value[key] === 'boolean') result[key] = value[key];
  if (Object.hasOwn(PERSONALITY_PRESETS, value.preset)) result.preset = value.preset;
  if (['system', 'always', 'full'].includes(value.reducedMotion)) result.reducedMotion = value.reducedMotion;
  if (/^#[\da-f]{6}$/i.test(value.color)) result.color = value.color;
  for (const [key, min, max] of [['brightness', 0, 1.5], ['glow', 0, 2], ['cooldown', 2, 60], ['idleMin', 20, 300], ['idleMax', 20, 600], ['speed', 0.5, 2]]) result[key] = bounded(value[key], result[key], min, max);
  result.idleMax = Math.max(result.idleMin, result.idleMax);
  for (const key of Object.keys(result.categories)) if (typeof value.categories?.[key] === 'boolean') result.categories[key] = value.categories[key];
  return result;
}

export function prefersReducedTotemMotion(preference, doc = document, media = matchMedia) {
  if (preference === 'always') return true;
  if (preference === 'full') return false;
  return doc.getElementById('reduced-motion')?.checked ?? media('(prefers-reduced-motion: reduce)').matches;
}
export function applyPersonalityPreset(config, preset) {
  if (!Object.hasOwn(PERSONALITY_PRESETS, preset)) throw Error('Unknown personality preset.');
  return normalizePersonality({ ...config, preset, idleMin: PERSONALITY_PRESETS[preset].idleMin, idleMax: PERSONALITY_PRESETS[preset].idleMax });
}

// Personality is one global field in the existing revisioned Studio document.
// Read the latest document for every write, preserve other owners' fields, and
// use that service's revision check. Never maintain a second persistent store.
export function createPersonalitySettingsStore({ loadDocument, saveDocument }) {
  let expectedPersonality;
  const fingerprint = document => JSON.stringify(normalizePersonality(document.personality));
  const read = async () => {
    const document = await loadDocument();
    if (document?.version !== 1 || !document.defaults || !document.overrides) throw Error('Unsupported Studio settings document.');
    return document;
  };
  return {
    async load() { const document = await read(); expectedPersonality = fingerprint(document); return normalizePersonality(document.personality); },
    async save(config) {
      const document = await read();
      if (expectedPersonality !== undefined && expectedPersonality !== fingerprint(document)) throw Error('Personality settings changed in another editor. Reload before saving.');
      const personality = normalizePersonality(config);
      const saved = await saveDocument({ ...document, personality }, document.revision);
      if (JSON.stringify(normalizePersonality(saved.personality)) !== JSON.stringify(personality)) throw Error('Personality settings were not persisted.');
      expectedPersonality = fingerprint(saved);
      return normalizePersonality(saved.personality);
    },
  };
}
