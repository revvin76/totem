import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { SAMPLE_GAMES, gamesForPlatform, samplePlatforms } from "../src/game-library.js";
import { inspectGLB } from "../src/platform-assets.js";
import { fitArtwork } from "../src/game-models.js";
import sources from "../game-models.json" with { type: "json" };
import platforms from "../platforms.json" with { type: "json" };

const publicFile = (path) => new URL(`../public/${path}`, import.meta.url);
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");

test("the public preview starts with an empty library and no game assets", () => {
  assert.deepEqual(SAMPLE_GAMES, []);
  assert.deepEqual(samplePlatforms(), []);
  assert.deepEqual(gamesForPlatform("all"), []);
  assert.deepEqual(sources, []);
});

test("landscape artwork and square cover scans fit a case without distortion or clipping", () => {
  for (const [imageWidth, imageHeight] of [[1920, 1080], [445, 445], [800, 1400]]) {
    const rect = fitArtwork(imageWidth, imageHeight, 1024, 900);
    assert.ok(Math.abs(rect.width / rect.height - imageWidth / imageHeight) < 1e-10);
    assert.ok(rect.x >= -1e-9 && rect.y >= -1e-9);
    assert.ok(rect.x + rect.width <= 1024 + 1e-9 && rect.y + rect.height <= 900 + 1e-9);
  }
  assert.ok(SAMPLE_GAMES.filter((game) => game.platformId === "wiiu").every((game) => game.coverKind === "artwork"));
});
