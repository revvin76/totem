import { audioToggleLabels, chooserActions, normaliseNavAction, withAlphabetNav, xboxButtonId } from '../light-study/chooser-controls.js';
import { applyPlatformDetails, PLATFORM_METRIC_ICONS } from './platform-details.js';
import { normalizePlatformLights } from './studio-environment-settings.js';

export const STUDIO_PAGES = Object.freeze({ platformChooser: 'Platform Chooser', gameChooser: 'Game Chooser' });
const PLATFORM_NAV = [
  { id: 'previous-filter', icon: 'lb', label: '', name: 'Previous hardware filter' },
  { id: 'next-filter', icon: 'rb', label: 'Platform', name: 'Next hardware filter' },
  { id: 'previous', icon: 'left', label: '', name: 'Rotate left' },
  { id: 'next', icon: 'right', label: 'Rotate', name: 'Rotate right' },
  { id: 'select', icon: 'a', label: 'Select', name: 'Select platform' },
];
export const PLATFORM_NAV_ACTIONS = Object.freeze({
  ...chooserActions,
  'cycle-skin': 'Cycle skin',
  'clear-filters': 'Clear all filters',
  ...Object.fromEntries(PLATFORM_NAV.map(({ id, name }) => [id, name])),
  'navigation-menu': 'Main menu',
});

export function platformGamepadAction(icon, bottomNav) {
  return bottomNav.find(item => xboxButtonId(item.icon) === icon)?.action;
}
export function platformBottomNavLabel(item, audioOn) {
  if (item.toggleLabel !== true || !Object.hasOwn(audioToggleLabels, item.action)) return item.label;
  const labels = audioToggleLabels[item.action];
  return audioOn ? item.labelOn ?? labels.on : item.labelOff ?? labels.off;
}
export function bottomNavSide(item) {
  if (item.align === 'start' || item.align === 'end') return item.align;
  return /^(lb|rb)(-active)?$/.test(item.icon) ? 'start' : 'end';
}
export function bottomNavOrder(items) {
  return items.map((item, index) => ({ item, index })).sort((a, b) =>
    Number(bottomNavSide(a.item) === 'end') - Number(bottomNavSide(b.item) === 'end'));
}
export const HOME_ELEMENTS = Object.freeze({
  brand: ['Totem logo', '#app > header .brand'],
  details: ['Platform details', '.hero'],
  arrows: ['Navigation arrows', '.scene-navigation'],
  selection: ['Select system button', '.selection-caption'],
  filters: ['Hardware filters', '#system-rail-controls'],
  platforms: ['Platform rail', '#systems'],
  bottom: ['Bottom navigation', '#app > footer'],
});
const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
export function normalizeCameraSettings(value = {}, fallback = {}) {
  const defaults = { target: [0, 0, 0], yaw: 0, pitch: 0, distance: 24, fov: 36, ...fallback };
  const target = Array.isArray(value?.target) ? value.target : defaults.target;
  return {
    target: [0, 1, 2].map(index => bounded(target[index], defaults.target[index] ?? 0, -100, 100)),
    yaw: bounded(value?.yaw, defaults.yaw, -180, 180),
    pitch: bounded(value?.pitch, defaults.pitch, -85, 85),
    distance: bounded(value?.distance, defaults.distance, 1, 115),
    fov: bounded(value?.fov, defaults.fov, 20, 80),
  };
}
export function normalizeDepthOfField(value = {}, fallback = { enabled: false, blur: 0.006 }) {
  if (!value || typeof value !== 'object') value = {};
  return { enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
    blur: bounded(value.blur ?? fallback.blur, fallback.blur, 0, 0.012) };
}
function normalizePlatformPole(value) {
  const vector = (key, defaults, min, max) => defaults.map((fallback, index) =>
    bounded(value?.[key]?.[index] ?? fallback, fallback, min, max));
  return {
    enabled: value?.enabled !== false,
    alignWithDetails: value?.alignWithDetails !== false,
    position: vector('position', [3, -4, -2], -100, 100),
    rotation: vector('rotation', [0, 0, 0], -4 * Math.PI, 4 * Math.PI),
    scale: vector('scale', [2, 2, 2], .1, 15),
    mascotScale: bounded(value?.mascotScale ?? 1, 1, .25, 2),
    mascotYaw: bounded(value?.mascotYaw ?? 0, 0, -180, 180),
  };
}
export function scalePlatformPole(scale, value, axis = 0) {
  // Keep the proportions of poles saved with the old per-axis controls.
  const factor = bounded(value / scale[axis], 1, .1 / Math.min(...scale), 15 / Math.max(...scale));
  return scale.map(component => component * factor);
}
export function platformChooserSettings(document = {}, fallback = {}, cameraFallback = {}) {
  const page = document.pages?.platformChooser ?? {};
  const elements = {};
  for (const id of Object.keys(HOME_ELEMENTS)) {
    const value = page.elements?.[id] ?? {};
    elements[id] = { x: bounded(value.x ?? 0, 0, -1400, 1400), y: bounded(value.y ?? 0, 0, -900, 900),
      scale: bounded(value.scale ?? 1, 1, 0.3, 3), visible: value.visible !== false };
  }
  const details = page.elements?.details;
  for (const [key, min] of [['width', 220], ['height', 120]]) {
    if (Number.isFinite(details?.[key])) elements.details[key] = bounded(details[key], min, min, 4096);
  }
  const text = Object.fromEntries(Object.entries(page.text ?? {}).filter(([key, value]) =>
    /^[a-z][a-z0-9-]{0,63}$/.test(key) && value && typeof value === 'object').map(([key, value]) => [
    key, Object.fromEntries(Object.entries(value).filter(([field, setting]) =>
      ['text', 'fontSize', 'fontFamily', 'fontWeight', 'color', 'textAlign', 'letterSpacing', 'lineHeight'].includes(field) &&
      typeof setting === 'string').map(([field, setting]) => [field, setting.slice(0, field === 'text' ? 512 : 128)])),
  ]));
  const icons = Object.fromEntries(Object.entries(page.icons ?? {}).filter(([slot, icon]) =>
    ['games', 'released', 'players', 'maker', 'category', 'emulators'].includes(slot) && Object.hasOwn(PLATFORM_METRIC_ICONS, icon)));
  const savedNav = Array.isArray(page.bottomNav) ? page.bottomNav : [];
  let bottomNav;
  if ([1, 2].includes(page.bottomNavVersion) && Array.isArray(page.bottomNav)) {
    bottomNav = savedNav.filter(item => typeof item?.id === 'string' && typeof item.icon === 'string').map(normaliseNavAction).map(item => ({
      id: item.id, icon: item.icon, label: typeof item.label === 'string' ? item.label : '',
      action: Object.hasOwn(PLATFORM_NAV_ACTIONS, item.action) ? item.action : 'none',
      align: bottomNavSide(item),
      ...(typeof item.toggleLabel === 'boolean' ? { toggleLabel: item.toggleLabel } : {}),
      ...(typeof item.labelOn === 'string' ? { labelOn: item.labelOn } : {}),
      ...(typeof item.labelOff === 'string' ? { labelOff: item.labelOff } : {}),
      ...(["hardware-start", "hardware-end"].includes(item.region) ? { region: item.region } : {}),
    }));
  } else {
    // Older documents only stored label and alignment overrides for the fixed buttons.
    bottomNav = PLATFORM_NAV.map(item => {
      const saved = savedNav.find(entry => entry?.id === item.id);
      return { id: item.id, icon: item.icon, action: item.id,
        label: typeof saved?.label === 'string' ? saved.label : item.label,
        align: bottomNavSide({ ...item, align: saved?.align }) };
    });
  }
  if (page.bottomNavVersion !== 2) bottomNav = withAlphabetNav(bottomNav);
  return { depthOfField: normalizeDepthOfField(page.depthOfField, normalizeDepthOfField(fallback)),
    camera: normalizeCameraSettings(page.camera, cameraFallback),
    pole: normalizePlatformPole(page.pole),
    lights: normalizePlatformLights(page.lights), elements, text, icons, bottomNav, bottomNavVersion: 2 };
}
export function applyPlatformChooserElements(document, root = window.document) {
  const settings = platformChooserSettings(document);
  for (const [id, [, selector]] of Object.entries(HOME_ELEMENTS)) {
    const element = root.querySelector(selector);
    if (!element) continue;
    const value = settings.elements[id];
    element.style.translate = `${value.x}px ${value.y}px`;
    element.style.scale = String(value.scale);
    element.style.visibility = value.visible ? '' : 'hidden';
    if (id === 'details') {
      element.style.width = value.width ? `${value.width}px` : '';
      element.style.height = value.height ? `${value.height}px` : '';
      element.toggleAttribute?.('data-details-sized', Boolean(value.height));
    }
  }
  applyPlatformDetails(root, settings);
}
export async function changeStudioPage(page, beforeNavigate = async () => true) {
  if (!Object.hasOwn(STUDIO_PAGES, page)) throw new Error('Unknown Studio page.');
  if (await beforeNavigate() === false) return false;
  location.assign(page === 'platformChooser' ? '/index.html?studio=platformChooser' : '/light-study/index.html');
  return true;
}
export function studioPageSelector(page, beforeNavigate) {
  const label = document.createElement('label'); label.textContent = 'Page';
  const select = document.createElement('select'); select.id = 'studio-page';
  label.htmlFor=select.id;select.setAttribute('aria-label','Page');
  for (const [id, name] of Object.entries(STUDIO_PAGES)) select.add(new Option(name, id));
  select.value = page;
  select.onchange = async () => { select.disabled = true; try { if (!await changeStudioPage(select.value, beforeNavigate)) select.value = page; } finally { select.disabled = false; } };
  label.append(select); return label;
}
