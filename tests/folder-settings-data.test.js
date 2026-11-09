import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFolderCollections, preserveUnlistedPlatforms } from "../src/folder-settings-data.js";

test("imported singleton extensions and game folders load without modifying source values", () => {
  const source = [{ id: "arcade", extensions: "zip,chd", gameRoots: { path: "D:\\fixture\\roms", active: true } }];
  const before = structuredClone(source);
  const [record] = normalizeFolderCollections(source);
  assert.deepEqual(record.extensions, ["zip", "chd"]);
  assert.equal(record.extensions.join(", "), "zip, chd");
  assert.equal(record.gameRoots[0].path, "D:\\fixture\\roms");
  assert.deepEqual(source, before);
});
test("array and empty imported forms remain supported", () => {
  assert.deepEqual(normalizeFolderCollections([{ extensions: ["zip", "chd"], gameRoots: [] }])[0].extensions, ["zip", "chd"]);
  assert.deepEqual(normalizeFolderCollections([{ extensions: null, gameRoots: null }])[0].gameRoots, []);
  assert.throws(() => normalizeFolderCollections([{ extensions: 42 }]), /Invalid extensions/);
  assert.throws(() => normalizeFolderCollections([{ gameRoots: { missing: true } }]), /Invalid game folders/);
});
test("artwork preference edits preserve saved IDs absent from the current selector", () => {
  assert.deepEqual(preserveUnlistedPlatforms(["gb"], ["nes", "user-private-platform"], ["nes", "gb"]), ["gb", "user-private-platform"]);
  assert.deepEqual(preserveUnlistedPlatforms([], [], ["gb"]), []);
});
