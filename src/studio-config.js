import { invoke, isTauri } from '@tauri-apps/api/core';
let studioRequestSequence = 0;
export const DEVICE_TYPES = ['handheld', 'arcade', 'console', 'computer', 'device-only'];
export function platformType(platform) {
  if (platform?.kind === 'hybrid') return 'handheld';
  return DEVICE_TYPES.includes(platform?.kind) ? platform.kind : 'device-only';
}
export function mergeSettings(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch ?? base);
  const result = structuredClone(base || {});
  for (const [key, value] of Object.entries(patch)) result[key] = value && typeof value === 'object' && !Array.isArray(value) ? mergeSettings(result[key], value) : structuredClone(value);
  return result;
}
export function settingsOverride(base, value) {
  const patch = {};
  for (const [key, next] of Object.entries(value)) {
    if (JSON.stringify(base?.[key]) === JSON.stringify(next)) continue;
    patch[key] = next && typeof next === 'object' && !Array.isArray(next) ? settingsOverride(base?.[key], next) : structuredClone(next);
  }
  return patch;
}
export function resolvedSettings(document, type, platformId, fallback) {
  const base = mergeSettings(fallback, document.defaults[type] || {});
  const stored = platformId ? document.overrides[type]?.[platformId] : null;
  if (!stored || stored._enabled === false) return base;
  const patch = { ...stored };
  delete patch._enabled;
  delete patch._snapshot;
  if (stored._snapshot) return structuredClone(patch);
  return mergeSettings(base, patch);
}
export function platformOverrideEnabled(document, type, platformId) {
  const override = document.overrides[type]?.[platformId];
  return Boolean(override) && override._enabled !== false;
}
export async function loadStudioDocument(native = isTauri()) {
  return native ? studioInvoke('load_studio_settings') : JSON.parse(localStorage.getItem('totem.studio.preview') || 'null') || {version:1,revision:null,defaults:{},overrides:{}};
}
export async function saveStudioDocument(document, expectedRevision) {
  if (isTauri()) return studioInvoke('save_studio_settings', {document, expectedRevision});
  const current = await loadStudioDocument(false);
  if (current.revision !== expectedRevision) throw new Error('Studio settings changed in another editor. Reload before saving.');
  const next = structuredClone(document); next.revision = crypto.randomUUID();
  localStorage.setItem('totem.studio.preview', JSON.stringify(next));
  const persisted = await loadStudioDocument(false);
  if (JSON.stringify(persisted) !== JSON.stringify(next)) throw new Error('Studio settings could not be read back.');
  return persisted;
}
export function studioInvoke(command, args = {}) {
  if (window.parent === window) return invoke(command, args);
  const id = String(++studioRequestSequence);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error(`Studio request timed out: ${command}`)); }, 30000);
    function receive(event) {
      if (event.source !== parent || event.origin !== location.origin || event.data?.studioReply !== id) return;
      clearTimeout(timer); window.removeEventListener('message', receive);
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
    }
    window.addEventListener('message', receive);
    parent.postMessage({ studioRequest: id, command, args }, location.origin);
  });
}
