export const toggleDetailsAction = "toggle-details";

export const chooserActions = Object.freeze({
  none: "No action",
  enter: "Play / pause",
  "launch-game": "Launch game",
  [toggleDetailsAction]: "Toggle details",
  escape: "Back",
  filters: "Search & filters",
  up: "Previous game",
  down: "Next game",
  "previous-category": "Previous category",
  "next-category": "Next category",
  "previous-letter": "Previous letter",
  "next-letter": "Next letter",
  "previous-platform": "Previous platform",
  "next-platform": "Next platform",
  video: "Pause / resume video",
  "toggle-mute": "Mute / unmute",
});

export const alphabetBindings = { "previous-letter": "lt", "next-letter": "rt" };

export function withAlphabetNav(items) {
  if (!items?.length) return items;
  return [...items, ...Object.entries(alphabetBindings)
    .filter(([action]) => !items.some(item => item.action === action || item.id === action))
    .map(([action, icon]) => ({ id: action, action, icon, align: "end", label: chooserActions[action] }))];
}

export function canonicalChooserAction(action) {
  return action === "mute" || action === "unmute" ? "toggle-mute" : action;
}

export function normaliseNavAction(item) {
  const action = canonicalChooserAction(item.action);
  if (action === item.action) return item;
  const label = typeof item.label === "string" && item.label.toLowerCase() === item.action
    ? chooserActions[action] : item.label;
  return { ...item, action, label };
}

const audioLabels = { on: "Mute", off: "Unmute", state: "audio" };
export const audioToggleLabels = Object.freeze({
  "toggle-mute": audioLabels,
});

export const xboxButtons = [
  ["a", "A"], ["b", "B"], ["x", "X"], ["y", "Y"],
  ["lb", "LB"], ["rb", "RB"], ["lt", "LT"], ["rt", "RT"],
  ["view", "View"], ["menu", "Menu"], ["press-left", "Left stick press"], ["press-right", "Right stick press"],
  ["up", "D-pad up"], ["down", "D-pad down"], ["left", "D-pad left"], ["right", "D-pad right"],
  ["home", "Xbox"], ["share", "Share"],
];

export function xboxButtonId(icon) {
  return icon.replace(/-active$/, "").replace(/^dpad-(up|down|left|right)$/, "$1");
}

export const sideNavButtons = Object.freeze({
  "menu-button": { icon: "menu", action: "filters" },
  "previous-category-button": { icon: "lt", action: "previous-category" },
  "next-category-button": { icon: "rt", action: "next-category" },
  "previous-game-button": { icon: "up", action: "up" },
  "next-game-button": { icon: "down", action: "down" },
});

export function sideNavBinding(id, elements) {
  const defaults = sideNavButtons[id];
  const saved = elements[id];
  return {
    icon: saved?.controllerIcon ?? defaults.icon,
    action: canonicalChooserAction(saved?.controllerAction ?? defaults.action),
  };
}

export function gamepadAction(icon, elements, bottomNav) {
  const sideNav = Object.keys(sideNavButtons).map(id => ({ ...sideNavBinding(id, elements), id }));
  // Explicit SideNav edits take priority. Existing bottom bars keep their
  // bindings when the SideNav is using its defaults.
  const override = sideNav.find(item => xboxButtonId(item.icon) === icon &&
    (elements[item.id]?.controllerIcon != null || elements[item.id]?.controllerAction != null));
  const bottom = bottomNav.find(item => xboxButtonId(item.icon) === icon);
  return canonicalChooserAction(override?.action ?? bottom?.action ??
    sideNav.find(item => xboxButtonId(item.icon) === icon)?.action ?? ({ a: "enter", b: "escape" })[icon]);
}
