import { test } from "node:test";
import assert from "node:assert/strict";
import catalogue from "../platforms.json" with { type: "json" };
import aliases from "../platform-aliases.json" with { type: "json" };
import {
  defaultLayout,
  makeLayoutSnapshot,
  neutralDeviceControls,
  parseLayoutSnapshot,
} from "../src/layout.js";

const ids = catalogue.map((p) => p.id);
test("removed variants map directly to a single retained platform", () => {
  for (const [variant, retained] of Object.entries(aliases)) {
    assert.ok(!ids.includes(variant), variant);
    assert.ok(ids.includes(retained), retained);
    assert.ok(!Object.hasOwn(aliases, retained), retained);
  }
  for (const distinct of [
    "gameboy",
    "gbcolor",
    "gba",
    "wii",
    "wiiu",
    "megadrive",
    "segacd",
    "32x",
    "arcade",
  ])
    assert.ok(ids.includes(distinct), distinct);
});

test("old selections and enabled variants migrate and deduplicate across snapshot versions", () => {
  for (const schemaVersion of [1, 2, 3]) {
    const saved = {
      ...makeLayoutSnapshot(defaultLayout(), "ps2slim", {}, [
        "ps2",
        "ps2slim",
        "ps3slim",
      ]),
      schemaVersion,
    };
    const restored = parseLayoutSnapshot(JSON.stringify(saved), ids);
    assert.equal(restored.selectedPlatform, "ps2");
    assert.equal(
      restored.enabledPlatformIds.filter((id) => id === "ps2").length,
      1,
    );
    assert.ok(!restored.enabledPlatformIds.includes("ps2slim"));
    if (schemaVersion > 1)
      assert.deepEqual(restored.enabledPlatformIds, ["ps2", "ps3"]);
  }
  for (const variant of Object.keys(aliases)) {
    const saved = makeLayoutSnapshot(defaultLayout(), variant, {}, [variant]);
    assert.deepEqual(
      parseLayoutSnapshot(JSON.stringify(saved), ids).enabledPlatformIds,
      [aliases[variant]],
    );
  }
});

test("pose consolidation prefers the retained pose, then the selected variant", () => {
  const pose = (panY) => ({ ...neutralDeviceControls(), panY });
  const saved = makeLayoutSnapshot(
    defaultLayout(),
    "ps3superslim",
    {},
    ["ps3slim", "ps3superslim"],
    { ps3slim: pose(1), ps3superslim: pose(2) },
  );
  assert.equal(
    parseLayoutSnapshot(JSON.stringify(saved), ids).deviceOverrides.ps3.panY,
    2,
  );
  saved.deviceOverrides.ps3 = pose(3);
  assert.equal(
    parseLayoutSnapshot(JSON.stringify(saved), ids).deviceOverrides.ps3.panY,
    3,
  );
  saved.enabledPlatformIds.push("unknown-platform");
  assert.throws(() => parseLayoutSnapshot(JSON.stringify(saved), ids));
});
