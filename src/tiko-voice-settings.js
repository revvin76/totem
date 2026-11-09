// Default, minimum, maximum and slider increment. The Lab and planner share
// these bounds so saved/imported values cannot bypass the audio safety limits.
export const VOICE_CONTROLS = Object.freeze({
  pitch: [350, 150, 480, 1],
  range: [1, .4, 1.5, .01],
  modulation: [.08, 0, .6, .01],
  glide: [1, .45, 1.55, .01],
  vibratoRate: [7, 2, 18, .1],
  vibrato: [12, 0, 90, 1],
  blend: [.67, 0, 1, .01],
  resonance: [2.1, .7, 5, .1],
  filter: [4200, 700, 5500, 10],
  harmonics: [.83, 0, 1, .01],
  articulation: [.69, 0, 1, .01],
  duration: [1, .55, 1.7, .01],
  separation: [1, .4, 2, .01],
  variation: [.38, 0, 1, .01],
  volume: [.65, 0, 1, .01],
});

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function normalizeVoicePatch(value) {
  return Object.fromEntries(Object.entries(VOICE_CONTROLS).map(([key, [fallback, min, max]]) =>
    [key, Number.isFinite(value?.[key]) ? clamp(value[key], min, max) : fallback]));
}
export const DEFAULT_VOICE_PATCH = Object.freeze(normalizeVoicePatch());
export const MAX_VOICE_PRESETS = 24;
export function normalizeVoiceSettings(value) {
  const presets = [];
  for (const entry of Array.isArray(value?.presets) ? value.presets : []) {
    const name = typeof entry?.name === 'string' ? entry.name.trim().slice(0, 40) : '';
    if (name && !presets.some(preset => preset.name === name)) presets.push({ name, patch: normalizeVoicePatch(entry.patch) });
    if (presets.length === MAX_VOICE_PRESETS) break;
  }
  const active = presets.find(preset => preset.name === value?.active)?.name ?? '';
  return { enabled: value?.enabled === true, active, presets };
}

export function randomizeVoicePatch(patch, random = Math.random) {
  return normalizeVoicePatch(Object.fromEntries(Object.entries(VOICE_CONTROLS).map(([key, [center, min, max, step]]) => {
    const value = key === 'volume' ? patch.volume : center + (random() - .5) * (max - min) * .38;
    return [key, Math.round(value / step) * step];
  })));
}
