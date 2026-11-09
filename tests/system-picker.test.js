import test from "node:test";
import assert from "node:assert/strict";
import { matchingSystems, updateFilteredSystems } from "../src/system-picker.js";
const catalogue = [
  { id: "gb", name: "Game Boy", maker: "Nintendo", kind: "handheld" },
  { id: "nes", name: "NES", maker: "Nintendo", kind: "console" },
  { id: "ms", name: "Master System", maker: "Sega", kind: "console" },
];
test("system filtering combines manufacturer, hardware and enabled state", () => {
  const enabled = new Set(["gb", "ms"]);
  assert.deepEqual(matchingSystems(catalogue, enabled, { query: "nintendo", status: "disabled", kind: "console" }).map((p) => p.id), ["nes"]);
  assert.deepEqual(matchingSystems(catalogue, enabled, { status: "enabled" }).map((p) => p.id), ["gb", "ms"]);
  assert.equal(catalogue.length, 3);
});
test("bulk selection changes only filtered systems and preserves hidden selections", () => {
  const enabled = new Set(["gb", "ms"]);
  assert.deepEqual([...updateFilteredSystems(enabled, [catalogue[1]], true)], ["gb", "ms", "nes"]);
  assert.deepEqual([...updateFilteredSystems(enabled, [catalogue[2]], false)], ["gb"]);
  assert.deepEqual([...enabled], ["gb", "ms"]);
});
