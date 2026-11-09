import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nearbyAngle,
  slotAngle,
  survivingSelection,
  validateEnabledSystems,
  visiblePlatforms,
} from "../src/collection.js";
import { consoleFocusScale } from "../src/framing.js";
import {
  defaultLayout,
  makeLayoutSnapshot,
  parseLayoutSnapshot,
} from "../src/layout.js";

test("enabled systems retain canonical ordering and preserve or replace the current selection", () => {
  const catalogue = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(
    visiblePlatforms(catalogue, ["d", "a"]).map((p) => p.id),
    ["a", "d"],
  );
  assert.equal(
    survivingSelection(["a", "b", "c", "d"], ["a", "c", "d"], "c"),
    "c",
  );
  assert.equal(
    survivingSelection(["a", "b", "c", "d"], ["a", "c", "d"], "b"),
    "c",
  );
  assert.equal(survivingSelection(["a", "b", "c", "d"], ["a", "b"], "d"), "a");
  assert.equal(survivingSelection(["a"], [], "a"), null);
  assert.equal(survivingSelection([], ["c"], null), "c");
});
test("every enabled count redistributes slots evenly with stable empty and singleton cases", () => {
  for (const count of [0, 1, 2, 3, 7, 50, 347]) {
    assert.ok(Number.isFinite(slotAngle(0, 0, count)));
    for (let i = 0; i < count; i++)
      assert.ok(
        Math.abs(
          slotAngle(i + 1, 0, count) -
            slotAngle(i, 0, count) -
            (Math.PI * 2) / count,
        ) < 1e-10,
      );
    assert.equal(consoleFocusScale(0, count), 1.5);
  }
  assert.ok(
    Math.abs(nearbyAngle(Math.PI - 0.1, -Math.PI + 0.1) - (Math.PI + 0.1)) <
      1e-10,
  );
  assert.ok(consoleFocusScale((Math.PI * 2) / 347, 347) < 0.1);
});
test("v2 snapshots restore the exact checklist, including an empty carousel", () => {
  const layout = defaultLayout();
  const snapshot = makeLayoutSnapshot(layout, "c", {}, ["a", "c"]);
  assert.deepEqual(
    parseLayoutSnapshot(JSON.stringify(snapshot), ["a", "b", "c"])
      .enabledPlatformIds,
    ["a", "c"],
  );
  const empty = makeLayoutSnapshot(layout, null, {}, []);
  assert.deepEqual(
    parseLayoutSnapshot(JSON.stringify(empty), ["a", "b"]).enabledPlatformIds,
    [],
  );
  assert.throws(() => validateEnabledSystems(["a", "a"], ["a"], "a"));
  assert.throws(() => validateEnabledSystems(["x"], ["a"], "x"));
  assert.throws(() => validateEnabledSystems(["a"], ["a", "b"], "b"));
  assert.throws(() => validateEnabledSystems([], ["a"], "a"));
});
test("legacy snapshots preserve layout controls and the original seven-system set", () => {
  const ids = [
    "gameboy",
    "nes",
    "megadrive",
    "playstation",
    "gamecube",
    "xbox",
    "wii",
    "arcade",
  ];
  const legacy = {
    schemaVersion: 1,
    layout: defaultLayout(),
    selectedPlatform: "playstation",
  };
  legacy.layout.consoles.pitch = 22;
  const parsed = parseLayoutSnapshot(JSON.stringify(legacy), ids);
  assert.equal(parsed.layout.consoles.pitch, 22);
  assert.deepEqual(parsed.enabledPlatformIds, ids.slice(0, 7));
});
