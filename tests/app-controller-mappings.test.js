import assert from "node:assert/strict";
import test from "node:test";
import {
  actionBindings, actionGlyph, appControllerAction, appKeyboardAction, controllerActionDescription, controllerContexts, controllerInputs,
  defaultControllerMappings, initialiseControllerMappings, pressedControllerInputs, withActionMapping,
} from "../src/app-controller-mappings.js";

const studio = { pages: {
  platformChooser: { bottomNavVersion: 1, bottomNav: [
    { id: "filters", icon: "menu", action: "filters" },
    { id: "select", icon: "a", action: "select" },
    { id: "previous", icon: "dpad-left-active", action: "previous" },
  ] },
  gameChooser: {
    bottomNav: [{ icon: "a", action: "launch-game" }, { icon: "lb", action: "mute" }],
    sideNav: { elements: { "previous-category-button": { controllerIcon: "lb" } } },
  },
} };

test("imports chooser bindings separately, including Studio D-pad art and side navigation overrides", () => {
  const { platform, game } = defaultControllerMappings(studio);
  assert.equal(platform.menu, "navigation-menu");
  assert.equal(platform.view, "none");
  assert.equal(platform.a, "select");
  assert.equal(platform.left, "previous");
  assert.equal(platform["stick-rightward"], "next");
  assert.equal(game.a, "launch-game");
  assert.equal(game.lb, "previous-category");
  assert.equal(game.menu, "filters");
  assert.equal(game.view, "none");
  assert.equal(game.share, "none");
  for (const map of [platform, game]) assert.equal(Object.keys(map).length, controllerInputs.length);
  for (const [context, { actions }] of Object.entries(controllerContexts))
    for (const action of Object.keys(actions)) assert.ok(controllerActionDescription(context, action));
});

test("the main menu defaults to Menu and F2 while respecting explicit saved bindings", () => {
  const profile = xbox => ({ appControllerMappings: { version: 2, xbox, keyboard: { "navigation-menu": [] } } });
  initialiseControllerMappings(profile({}));
  assert.equal(appControllerAction("platform", "menu"), "navigation-menu");
  assert.equal(appKeyboardAction("platform", "F2"), "navigation-menu");
  assert.equal(appControllerAction("platform", "view"), "none");
  assert.equal(appControllerAction("game", "view"), "none");

  initialiseControllerMappings(profile({ previous: ["view"] }));
  assert.equal(appControllerAction("platform", "view"), "previous");
  assert.deepEqual(actionBindings("xbox", "navigation-menu"), ["menu"]);

  initialiseControllerMappings(profile({ "navigation-menu": [] }));
  assert.equal(appControllerAction("platform", "view"), "none");
  const remapped = withActionMapping(profile({ filters: ["menu"] }), "xbox", "navigation-menu", "press-left");
  initialiseControllerMappings(remapped);
  assert.equal(appControllerAction("platform", "press-left"), "navigation-menu");
  assert.equal(appControllerAction("platform", "view"), "none");
});

test("a shared action reassignment updates dispatch and artwork in both choosers", () => {
  const updated = withActionMapping(studio, "xbox", "filters", "a");
  initialiseControllerMappings({ ...updated, pages: {} });
  assert.equal(appControllerAction("platform", "a"), "filters");
  assert.equal(appControllerAction("platform", "menu"), "navigation-menu");
  assert.equal(actionGlyph("filters"), "a");
  assert.equal(actionGlyph("select"), "");
  assert.equal(appControllerAction("game", "a"), "filters");
  assert.throws(() => withActionMapping(updated, "xbox", "select", "KeyM"));
});

test("letter actions adopt the triggers from legacy category bindings and can be remapped or cleared", () => {
  const legacy = { appControllerMappings: { version: 3, xbox: {
    "previous-category": ["lt", "lb"], "next-category": ["rt", "rb"],
  } } };
  initialiseControllerMappings(legacy);
  for (const context of ["platform", "game"]) {
    assert.equal(appControllerAction(context, "lt"), "previous-letter");
    assert.equal(appControllerAction(context, "rt"), "next-letter");
  }
  assert.deepEqual(actionBindings("xbox", "previous-category"), ["lb"]);
  const remapped = withActionMapping(withActionMapping(legacy, "xbox", "previous-letter", "press-left"), "xbox", "next-letter", null);
  initialiseControllerMappings(remapped);
  for (const context of ["platform", "game"]) {
    assert.equal(appControllerAction(context, "press-left"), "previous-letter");
    assert.equal(appControllerAction(context, "lt"), "none");
    assert.equal(appControllerAction(context, "rt"), "none");
  }
});

test("imports the previously saved Totem bindings before creating a shared mapping", () => {
  const legacy = defaultControllerMappings(studio);
  legacy.platform.a = "cycle-skin";
  legacy.platform.x = "unmute";
  legacy.game.x = "mute";
  globalThis.localStorage = { getItem: () => JSON.stringify(legacy) };
  try {
    const imported = initialiseControllerMappings(studio);
    assert.equal(imported.version, 3);
    assert.deepEqual(imported.xbox["cycle-skin"], ["a"]);
    assert.equal(appControllerAction("platform", "x"), "toggle-mute");
    assert.equal(actionGlyph("toggle-mute"), "x");
    const edited = withActionMapping(studio, "xbox", "toggle-mute", "right-stick-up");
    assert.deepEqual(edited.appControllerMappings.xbox["cycle-skin"], ["a"]);
    assert.deepEqual(edited.appControllerMappings.xbox["toggle-mute"], ["right-stick-up"]);
    assert.equal(Object.hasOwn(controllerContexts.game.actions, "mute"), false);
    assert.equal(Object.hasOwn(controllerContexts.game.actions, "unmute"), false);
  } finally {
    delete globalThis.localStorage;
  }
});

test("a saved Toggle details binding follows the shared action and can be cleared", () => {
  const saved = defaultControllerMappings(studio);
  saved.platform["press-left"] = "toggle-details";
  initialiseControllerMappings({ appControllerMappings: saved });
  assert.equal(appControllerAction("game", "press-left"), "toggle-details");
  assert.equal(actionGlyph("toggle-details"), "press-left");
  assert.equal(appControllerAction("platform", "press-left"), "toggle-details");
  const cleared = withActionMapping({ appControllerMappings: saved }, "xbox", "toggle-details", "");
  initialiseControllerMappings(cleared);
  assert.equal(actionGlyph("toggle-details"), "");
});

test("keyboard actions retain their chooser-specific defaults", () => {
  const updated = withActionMapping(studio, "keyboard", "toggle-details", "KeyD");
  initialiseControllerMappings(updated);
  assert.equal(appKeyboardAction("game", "KeyD"), "toggle-details");
  assert.equal(appKeyboardAction("platform", "KeyD"), "toggle-details");
  assert.deepEqual(actionBindings("keyboard", "toggle-details"), ["KeyD"]);
  assert.equal(actionGlyph("toggle-details"), "");
  assert.equal(appControllerAction("platform", "a"), "select");
  assert.equal(appControllerAction("game", "a"), "launch-game");
  assert.equal(appKeyboardAction("platform", "ArrowLeft"), "previous");
  assert.equal(appKeyboardAction("game", "ArrowLeft"), "previous-category");
  assert.deepEqual(actionBindings("keyboard", "enter"), ["Enter", "KeyA"]);
});

test("assigning an input removes it from every other action", () => {
  const profile = { appControllerMappings: { version: 2, xbox: { enter: ["menu"], "navigation-menu": [] }, keyboard: { enter: ["F2"], "navigation-menu": [] } } };
  const xbox = withActionMapping(profile, "xbox", "navigation-menu", "menu");
  const keyboard = withActionMapping(xbox, "keyboard", "navigation-menu", "F2");
  initialiseControllerMappings(keyboard);
  assert.equal(appControllerAction("platform", "menu"), "navigation-menu");
  assert.equal(appKeyboardAction("platform", "F2"), "navigation-menu");
  assert.deepEqual(actionBindings("xbox", "enter"), []);
  assert.deepEqual(actionBindings("keyboard", "enter"), []);
});

test("reads standard buttons and all eight directions independently on both sticks", () => {
  const buttons = Array(18).fill(null);
  buttons[6] = { value: .7 };
  buttons[9] = { pressed: true };
  buttons[17] = { pressed: true };
  assert.deepEqual([...pressedControllerInputs({ buttons, axes: [-.7, 0] })],
    ["lt", "menu", "share", "stick-leftward"]);
  for (const [direction, x, y] of [
    ["up", 0, -.8], ["down", 0, .8], ["left", -.8, 0], ["right", .8, 0],
    ["up-left", -.7, -.7], ["up-right", .7, -.7], ["down-left", -.7, .7], ["down-right", .7, .7],
  ]) {
    const left = ["left", "right"].includes(direction) ? `stick-${direction}ward` : `left-stick-${direction}`;
    assert.deepEqual([...pressedControllerInputs({ buttons: [], axes: [x, y, x, y] })],
      [left, `right-stick-${direction}`]);
  }
  assert.equal(pressedControllerInputs({ buttons: [], axes: [.15, -.2, -.1, .3] }).size, 0);
  assert.deepEqual([...pressedControllerInputs(null)], []);
});
