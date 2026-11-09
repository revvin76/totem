import { mergeSettings, platformOverrideEnabled } from '../src/studio-config.js';
import { normaliseNavAction, sideNavButtons, withAlphabetNav } from './chooser-controls.js';
import { normalizeThumbnails } from './thumbnail-settings.js';

const sideNavIds = new Set([
  ...Object.keys(sideNavButtons), 'game-rail', 'category-switcher', 'active-category-label',
  'search-filter-menu', 'game-button-inactive', 'game-button-active', 'game-thumbnail',
]);

export function splitChooserDesign(design = {}) {
  const elements = Object.entries(design.elements || {});
  const removed = design.removed || [];
  return {
    sideNav: {
      elements: Object.fromEntries(elements.filter(([id]) => sideNavIds.has(id))),
      removed: removed.filter(id => sideNavIds.has(id)),
      thumbnails: normalizeThumbnails(design),
    },
    layout: {
      elements: Object.fromEntries(elements.filter(([id]) => !sideNavIds.has(id))),
      removed: removed.filter(id => !sideNavIds.has(id)),
      custom: design.custom || {},
    },
  };
}

export function gameChooserPage(document, fallback) {
  const saved = document.pages?.gameChooser;
  if (saved) return saved;
  const handheld = document.defaults.handheld;
  return {
    ...splitChooserDesign(handheld?.uiDesign ?? fallback.uiDesign),
    bottomNav: handheld?.bottomNav ?? fallback.bottomNav,
  };
}

export function resolveChooserLayout(document, type, id, fallback) {
  const page = gameChooserPage(document, fallback);
  const override = id && platformOverrideEnabled(document, type, id) ? document.overrides[type][id] : null;
  let layout = override?.layout ?? page.layout;
  if (!override?.layout && override?.uiDesign) {
    const legacyLayout = splitChooserDesign(override.uiDesign).layout;
    if (!Array.isArray(override.uiDesign.removed)) delete legacyLayout.removed;
    layout = override._snapshot ? legacyLayout : mergeSettings(page.layout, legacyLayout);
  }
  return structuredClone({
    bottomNav: (page.bottomNavVersion === 2 ? page.bottomNav : withAlphabetNav(page.bottomNav))?.map(normaliseNavAction),
    uiDesign: {
      elements: { ...layout.elements, ...page.sideNav.elements },
      removed: [...(layout.removed || []), ...page.sideNav.removed],
      custom: layout.custom,
      thumbnails: page.sideNav.thumbnails,
    },
  });
}

export function updateChooserPage(document, fallback, snapshot, previous, platformId) {
  const page = gameChooserPage(document, fallback);
  const { layout, sideNav } = splitChooserDesign(snapshot.uiDesign);
  const before = splitChooserDesign(previous?.uiDesign);
  const changed = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
  const layoutChanged = changed(layout, before.layout);
  const navChanged = changed(snapshot.bottomNav, previous?.bottomNav);
  document.pages ??= {};
  document.pages.gameChooser = {
    ...page,
    layout: !platformId && layoutChanged ? layout : page.layout,
    sideNav: changed(sideNav, before.sideNav) ? sideNav : page.sideNav,
    ...(navChanged ? { bottomNav: snapshot.bottomNav, bottomNavVersion: 2 } : {}),
  };
  return { layout, layoutChanged };
}

export function resolveChooserPole(document, type, id, allPlatforms = false) {
  const pole = document.pages?.gameChooser?.pole;
  return (allPlatforms ? pole?.all : pole?.platforms?.[id] ?? pole?.types?.[type] ?? pole?.all) ?? {};
}

export function saveChooserPole(page, type, id, allPlatforms, settings) {
  const pole = page.pole ??= {};
  if (allPlatforms) pole.all = settings;
  else if (id) (pole.platforms ??= {})[id] = settings;
  else (pole.types ??= {})[type] = settings;
}
