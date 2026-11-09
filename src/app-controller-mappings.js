import { alphabetBindings, canonicalChooserAction, chooserActions, gamepadAction, toggleDetailsAction, xboxButtons } from "../light-study/chooser-controls.js";
import { gameChooserPage } from "../light-study/chooser-layout.js";
import { PLATFORM_NAV_ACTIONS, platformChooserSettings, platformGamepadAction } from "./studio-page-settings.js";
import { keyboardInputs } from "./keyboard-inputs.js";

const storageKey = "totem.app-controller-mappings.v1";
const legacyGame = {
  uiDesign: {},
  bottomNav: [
    { icon: "a", action: "enter" },
    { icon: "b", action: "escape" },
    { icon: "menu", action: "filters" },
  ],
};

const directions = ["right", "down-right", "down", "down-left", "left", "up-left", "up", "up-right"];
const sticks = ["left", "right"].map((stick, index) => ({
  axis: 2 * index,
  inputs: directions.map((direction, octant) => {
    const icon = `${stick}-stick-${direction}`;
    // Retain the IDs already saved for left-stick horizontal movement.
    const id = stick === "left" && (direction === "left" || direction === "right")
      ? `stick-${direction}ward` : icon;
    const label = `${index === 0 ? "Left" : "Right"} stick ${direction}`;
    return { id, icon, label, stick: stick[0].toUpperCase(), angle: octant * 45 };
  }),
}));

const buttons = xboxButtons.map(([id, label], button) => ({ id, label, button, icon: id }));
export const controllerInputs = [...buttons, ...sticks.flatMap(stick => stick.inputs)];

export const controllerContexts = {
  platform: { label: "Platform Chooser", actions: PLATFORM_NAV_ACTIONS },
  game: { label: "Game Chooser", actions: chooserActions },
};
export const launcherActions = Object.fromEntries(Object.entries(PLATFORM_NAV_ACTIONS).filter(([id]) => id !== "none"));
const xboxIds = new Set(controllerInputs.map(({ id }) => id));
const lettersByInput = Object.fromEntries(Object.entries(alphabetBindings).map(([action, input]) => [input, action]));
const bothChoosers = new Set(["escape", "filters", "toggle-mute", toggleDetailsAction, "previous-platform", "next-platform", ...Object.keys(alphabetBindings)]);
const actionScopes = action => bothChoosers.has(action) ? ["platform", "game"] : [Object.hasOwn(chooserActions, action) ? "game" : "platform"];
const defaultKeyboard = {
  select: ["Enter"], previous: ["ArrowLeft"], next: ["ArrowRight"],
  "previous-filter": ["PageUp"], "next-filter": ["PageDown"],
  up: ["ArrowUp"], down: ["ArrowDown"], "previous-category": ["ArrowLeft"], "next-category": ["ArrowRight"],
  enter: ["Enter", "KeyA"], escape: ["Escape", "KeyB"], filters: ["KeyM", "Slash"],
  "toggle-mute": ["KeyX"], "clear-filters": ["Delete"],
  "navigation-menu": ["F2"],
};

const descriptions = {
  none: "Leaves the input unassigned.",
  enter: "Plays or pauses the selected game's preview.",
  "launch-game": "Starts the selected game with its configured emulator.",
  [toggleDetailsAction]: "Expands or collapses the selected game's description.",
  escape: "Returns to the Platform Chooser, or closes the open platform panel.",
  filters: "Opens or closes the search and filters for the current chooser.",
  up: "Moves to the previous game in the list.",
  down: "Moves to the next game in the list.",
  "previous-category": "Moves to the previous game category.",
  "next-category": "Moves to the next game category.",
  "previous-letter": "Jumps to the previous populated letter. Hold the button to browse letters, then release to select.",
  "next-letter": "Jumps to the next populated letter. Hold the button to browse letters, then release to select.",
  "previous-platform": "Moves to the previous platform.",
  "next-platform": "Moves to the next platform.",
  video: "Pauses or resumes the gameplay preview.",
  "toggle-mute": "Switches preview audio between muted and unmuted.",
  "cycle-skin": "Switches to the next skin on platforms with alternate skins.",
  "previous-filter": "Moves to the previous hardware filter.",
  "next-filter": "Moves to the next hardware filter.",
  "clear-filters": "Clears every selected platform filter.",
  previous: "Rotates the platform carousel left.",
  next: "Rotates the platform carousel right.",
  select: "Opens the selected platform in the Game Chooser.",
  "navigation-menu": "Opens or closes the main Totem menu on the Platform Chooser.",
};
export function controllerActionDescription(context, action) {
  if (context === "platform" &&
      ["enter", "video", "launch-game", "up", "down", "previous-category", "next-category"].includes(action)) {
    return "Opens the Game Chooser first. " + descriptions[action];
  }
  return descriptions[action];
}

export function defaultControllerMappings(studio = {}) {
  const platformNav = platformChooserSettings(studio).bottomNav;
  const gamePage = gameChooserPage({ defaults: {}, ...studio }, legacyGame);
  return {
    platform: Object.fromEntries(controllerInputs.map(({ id }) => [
      id, id === "x" ? "clear-filters"
        : id === "menu" ? "navigation-menu"
        : id === "stick-leftward" ? "previous" : id === "stick-rightward" ? "next"
        : lettersByInput[id] ?? platformGamepadAction(id, platformNav) ?? "none",
    ])),
    game: Object.fromEntries(controllerInputs.map(({ id }) => [
      id, lettersByInput[id] ?? gamepadAction(id, gamePage.sideNav?.elements ?? {}, gamePage.bottomNav ?? legacyGame.bottomNav) ?? "none",
    ])),
  };
}

function readSavedMappings() {
  try { return JSON.parse(localStorage.getItem(storageKey)); }
  catch { return null; }
}

function resolveMappings(studio) {
  const saved = studio.appControllerMappings ?? readSavedMappings();
  const defaults = defaultControllerMappings(studio);
  const legacy = saved ?? defaults;
  const bindings = { version: 3, xbox: {}, keyboard: {} };
  const hasActionBindings = saved?.version === 2 || saved?.version === 3;
  for (const action of Object.keys(launcherActions)) {
    if (hasActionBindings) {
      bindings.xbox[action] = Object.hasOwn(saved.xbox ?? {}, action)
        ? validInputs(saved.xbox[action], xboxIds) : validInputs(action === "clear-filters" ? ["x"] : [], xboxIds);
      bindings.keyboard[action] = Object.hasOwn(saved.keyboard ?? {}, action)
        ? validInputs(saved.keyboard[action], keyboardInputs) : defaultKeyboard[action] ?? [];
      continue;
    }
    const scopes = actionScopes(action);
    // Preserve alternate inputs and prefer the action's owning chooser when
    // both old maps mention it.
    const contexts = [...new Set([...scopes, "platform", "game"])];
    bindings.xbox[action] = [...new Set(contexts.flatMap(context => controllerInputs
      .filter(({ id }) => canonicalChooserAction(legacy[context]?.[id]) === action)
      .map(({ id }) => id)))];
    bindings.keyboard[action] = defaultKeyboard[action] ?? [];
    if (action === "clear-filters" && !bindings.xbox[action].length) bindings.xbox[action] = ["x"];
  }
  const menuWasAssignedElsewhere = saved?.version === 2 &&
    Object.entries(bindings.xbox).some(([action, inputs]) => action !== "navigation-menu" && inputs.includes("menu"));
  if (!hasActionBindings || !Object.hasOwn(saved.xbox ?? {}, "navigation-menu") || menuWasAssignedElsewhere) {
    bindings.xbox["navigation-menu"] = ["menu"];
    for (const action of Object.keys(launcherActions)) {
      if (action !== "navigation-menu") bindings.xbox[action] = bindings.xbox[action].filter(input => input !== "menu");
    }
  }
  if (saved?.version === 2 && !bindings.keyboard["navigation-menu"].length) {
    bindings.keyboard["navigation-menu"] = ["F2"];
    for (const action of Object.keys(launcherActions)) {
      if (action !== "navigation-menu") bindings.keyboard[action] = bindings.keyboard[action].filter(input => input !== "F2");
    }
  }
  for (const [action, input] of Object.entries(alphabetBindings)) {
    if (hasActionBindings && Object.hasOwn(saved.xbox ?? {}, action)) continue;
    for (const other of Object.keys(launcherActions)) {
      bindings.xbox[other] = bindings.xbox[other].filter(value => value !== input);
    }
    bindings.xbox[action] = [input];
  }
  return bindings;
}

function validInputs(inputs, allowed) {
  return Array.isArray(inputs) ? [...new Set(inputs.filter(input => allowed.has(input)))] : [];
}

let bindings = resolveMappings({});
let platformNavActions = new Set();

export function initialiseControllerMappings(studio) {
  bindings = resolveMappings(studio);
  platformNavActions = new Set(platformChooserSettings(studio).bottomNav.map(item => item.action));
  return bindings;
}

export function mappedInputs(action) {
  return actionBindings("xbox", action).map(id => controllerInputs.find(input => input.id === id));
}

export function actionGlyph(action) {
  return mappedInputs(action)[0]?.icon ?? "";
}

export function actionBindings(device, action) {
  return Object.hasOwn(launcherActions, action) ? bindings[device][action] : [];
}

export function withActionMapping(studio, device, action, input) {
  const allowed = { xbox: xboxIds, keyboard: keyboardInputs }[device];
  if (!allowed || !Object.hasOwn(launcherActions, action) || (input && !allowed.has(input))) {
    throw new Error("Invalid action mapping.");
  }
  const next = resolveMappings(studio);
  if (input) {
    for (const other of Object.keys(launcherActions)) {
      if (other !== action) next[device][other] = next[device][other].filter(value => value !== input);
    }
  }
  next[device][action] = input ? [input] : [];
  return { ...studio, appControllerMappings: next };
}

function actionForInput(context, device, input) {
  const actions = Object.keys(launcherActions).filter(action => bindings[device][action].includes(input));
  if (context === "platform" && actions.includes("clear-filters")) return "clear-filters";
  return actions.find(action => actionScopes(action).includes(context))
    ?? (context === "platform" ? actions.find(action => platformNavActions.has(action)) : null)
    ?? "none";
}

export function appControllerAction(context, input) {
  return actionForInput(context, "xbox", input);
}

export function appKeyboardAction(context, input) {
  return actionForInput(context, "keyboard", input);
}

export function pressedControllerInputs(pad) {
  const pressed = new Set();
  if (!pad) return pressed;
  for (const { id, button } of buttons) {
    if (pad.buttons[button]?.pressed || pad.buttons[button]?.value > .65) pressed.add(id);
  }
  for (const { axis, inputs } of sticks) {
    const x = pad.axes[axis] ?? 0, y = pad.axes[axis + 1] ?? 0;
    if (Math.max(Math.abs(x), Math.abs(y)) <= .55) continue;
    const octant = Math.round(Math.atan2(y, x) / (Math.PI / 4));
    pressed.add(inputs[(octant + 8) % 8].id);
  }
  return pressed;
}
