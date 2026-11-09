import test from "node:test";
import assert from "node:assert/strict";
import { withDownloadedArtwork } from "../src/igdb-client.js";

test("IGDB fills provisional fronts and generic packaging without mutating the source record", () => {
  const game = { id: "a", cover: "local-art.jpg", coverKind: "artwork", shape: "disc" };
  const state = { assets: { front: { url: "downloaded-front" }, back: { url: "downloaded-back" }, spine: { url: "downloaded-spine" } } };
  const updated = withDownloadedArtwork(game, state);
  assert.equal(updated.cover, "downloaded-front");
  assert.equal(updated.coverKind, "front");
  assert.equal(updated.backCover, "downloaded-back");
  assert.equal(updated.spineCover, "downloaded-spine");
  assert.equal(game.cover, "local-art.jpg");
  assert.equal(game.coverKind, "artwork");
});

test("existing scans and original model UV artwork take priority over downloaded alternatives", () => {
  const state = { assets: { front: { url: "igdb-front" }, back: { url: "igdb-back" } } };
  const scan = { id: "scan", cover: "own-front", coverKind: "front", backCover: "own-back" };
  const updated = withDownloadedArtwork(scan, state);
  assert.equal(updated.cover, "own-front"); assert.equal(updated.backCover, "own-back");
  const original = { id: "duck-hunt", model: "nes-cartridge" };
  assert.equal(withDownloadedArtwork(original, state), original);
  assert.equal(withDownloadedArtwork({ id: "missing" }, null).cover, undefined);
});
