const SVG = 'http://www.w3.org/2000/svg';
export const PLATFORM_METRIC_ICONS = Object.freeze({
  games: ['Controller', 'M14 13h20c5 0 7 5 8 12l2 10c1 5-4 6-7 2l-6-7H17l-6 7c-3 4-8 3-7-2l2-10c1-7 3-12 8-12Z M11 21h10m-5-5v10 M32 20h1m4 5h1'],
  released: ['Calendar', 'M7 10h34v32H7z M7 20h34M15 5v11M33 5v11M15 27h3m6 0h3m6 0h2M15 34h3m6 0h3m6 0h2'],
  players: ['Players', 'M32 14a8 8 0 1 0-16 0 8 8 0 0 0 16 0ZM10 42v-7c0-14 28-14 28 0v7ZM10 11c-8 0-8 14 0 14M38 11c8 0 8 14 0 14M6 29c-5 2-5 8-5 13h5m36-13c5 2 5 8 5 13h-5'],
  maker: ['Manufacturer', 'M6 42V22l12 7V18l12 8V8h9l3 34H6Zm8-6h3m6 0h3m6 0h3'],
  category: ['Layers', 'm4 15 20-10 20 10-20 10L4 15Zm0 9 20 10 20-10M4 33l20 10 20-10'],
  emulators: ['Display', 'M5 8h38v27H5z M17 42h14m-7-7v7 M19 17l-4 4 4 4m10-8 4 4-4 4'],
  star: ['Star', 'm24 5 6 12 13 2-10 9 3 13-12-6-12 6 3-13-10-9 13-2z'],
  clock: ['Clock', 'M42 24a18 18 0 1 0-36 0 18 18 0 0 0 36 0Z M24 13v12l8 5'],
});

export function platformMetricIcon(owner, key) {
  const svg = owner.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  const path = owner.createElementNS(SVG, 'path');
  path.setAttribute('d', PLATFORM_METRIC_ICONS[key][1]);
  svg.append(path);
  return svg;
}

const textState = new WeakMap();
const textStyles = ['fontSize', 'fontFamily', 'fontWeight', 'color', 'textAlign', 'letterSpacing', 'lineHeight'];

export function writePlatformText(element, value) {
  const state = textState.get(element) ?? {};
  state.base = value;
  textState.set(element, state);
  element.textContent = state.override ?? value;
}

export function applyPlatformDetails(root, { text, icons }) {
  for (const element of root.querySelectorAll?.('[data-platform-text]') ?? []) {
    const state = textState.get(element) ?? { base: element.textContent };
    const style = text[element.dataset.platformText];
    state.override = style?.text;
    textState.set(element, state);
    const value = state.override ?? state.base;
    if (element.textContent !== value) element.textContent = value;
    if (element.classList.contains('system-name')) element.closest('.system')?.setAttribute('aria-label', value || state.base);
    for (const key of textStyles) element.style[key] = style?.[key] ?? '';
  }
  for (const row of root.querySelectorAll?.('[data-metric-icon]') ?? []) {
    const slot = row.dataset.metricIcon;
    const key = icons[slot] ?? row.dataset.defaultMetricIcon ?? slot;
    if (row.dataset.currentMetricIcon === key) continue;
    row.querySelector('svg')?.remove();
    row.prepend(platformMetricIcon(row.ownerDocument, key));
    row.dataset.currentMetricIcon = key;
  }
}

export function renderPlatformEmulatorSummary(root, emulators, availability) {
  const list = root.querySelector('#platform-emulator-list');
  const isReady = emulator => Boolean(availability[emulator.id]?.executableExists && emulator.enabled);
  const sorted = [...emulators].sort((a, b) =>
    Number(isReady(b)) - Number(isReady(a)) || a.name.localeCompare(b.name));
  list.replaceChildren(...sorted.map((emulator) => {
    const installed = availability[emulator.id]?.executableExists;
    const ready = isReady(emulator);
    const item = root.ownerDocument.createElement('li');
    item.className = 'platform-emulator';
    item.classList.toggle('is-ready', Boolean(ready));

    const marker = root.ownerDocument.createElement('span');
    marker.className = 'platform-emulator-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = ready ? '✓' : '!';

    const label = root.ownerDocument.createElement('span');
    const name = root.ownerDocument.createElement('strong');
    name.textContent = emulator.name;
    const status = root.ownerDocument.createElement('span');
    status.className = 'platform-emulator-status';
    status.textContent = ready ? 'Ready' : installed ? 'Disabled' : 'Not installed';
    label.append(name, status);
    item.append(marker, label);
    return item;
  }));
  root.querySelector('#platform-emulator-count').textContent = `(${sorted.length})`;
  root.querySelector('#platform-emulators-empty').hidden = sorted.length > 0;
}
