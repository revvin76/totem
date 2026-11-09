import assert from "node:assert/strict";
import { test } from "node:test";
import { nextSettingsOption, readinessTarget, settingsControllerAction } from "../src/settings-navigation.js";
import { readinessCategories } from "../src/platform-readiness.js";

test("every current readiness check resolves to a specific control or a reason to retain the evidence", () => {
  const checks = readinessCategories.flatMap(category => category.checks);
  for (const { id } of checks) {
    const target = readinessTarget(id);
    assert.ok(target.section ? target.target && target.label : target.note, id);
  }
  assert.equal(readinessTarget("platform-logo").target, "editor-logo-input");
  assert.equal(readinessTarget("model-availability").target, "editor-model-input");
  assert.equal(readinessTarget("front-covers").section, "providers");
  for (const id of ["rail-artwork", "video-files", "controller-model", "unregistered-check"]) {
    assert.equal(readinessTarget(id).section, undefined, id);
  }
});

test("Settings interprets default Xbox bindings as local actions", () => {
  assert.equal(settingsControllerAction("a"), "confirm");
  assert.equal(settingsControllerAction("b"), "back");
  for (const input of ["left", "right", "up", "down"]) {
    assert.equal(settingsControllerAction(input), input);
  }
  assert.equal(settingsControllerAction("stick-leftward"), "left");
  assert.equal(settingsControllerAction("lb"), null);
});

test("Settings honours mapped confirm and Back without running chooser actions", () => {
  const mappings = {
    platform: { x: "select", y: "escape", a: "launch-game", left: "next" },
    game: { a: "enter", b: "escape", y: "enter" },
  };
  const mapped = (context, input) => mappings[context][input] ?? "none";
  assert.equal(settingsControllerAction("x", mapped), "confirm");
  assert.equal(settingsControllerAction("y", mapped), "back");
  assert.equal(settingsControllerAction("b", mapped), "back");
  assert.equal(settingsControllerAction("a", mapped), null);
  assert.equal(settingsControllerAction("left", mapped), "left");
});
test("controller select navigation skips unavailable options and stops at either end", () => {
  const options = [{}, { disabled: true }, { hidden: true }, { parentElement: { disabled: true } }, {}];
  assert.equal(nextSettingsOption({ options, selectedIndex: 0 }, "right"), 4);
  assert.equal(nextSettingsOption({ options, selectedIndex: 4 }, "up"), 0);
  assert.equal(nextSettingsOption({ options, selectedIndex: 4 }, "down"), 4);
  assert.equal(nextSettingsOption({ options, selectedIndex: 0 }, "left"), 0);
});
