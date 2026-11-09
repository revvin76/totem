import test from "node:test";
import assert from "node:assert/strict";
import { titleArtwork, visibleLogoBounds } from "../light-study/title-artwork.js";

test("logo bounds ignore transparent padding and near-invisible specks", () => {
  const width = 20, height = 16;
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels[3] = 2;
  assert.equal(visibleLogoBounds(pixels, width, height), null);

  for (let y = 6; y < 10; y++) {
    for (let x = 5; x < 15; x++) pixels[(y * width + x) * 4 + 3] = 255;
  }
  assert.deepEqual(visibleLogoBounds(pixels, width, height), { x: 5, y: 6, width: 10, height: 4 });
  pixels.fill(255);
  assert.deepEqual(visibleLogoBounds(pixels, width, height), { x: 0, y: 0, width, height });
});

test("title keeps its text through failed or superseded logo loads", async () => {
  const decodes = new Map();
  const image = {
    hidden: true,
    removeAttribute(name) { delete this[name]; },
    decode() {
      return new Promise((resolve, reject) => decodes.set(this.src, { resolve, reject }));
    },
  };
  const fallback = new Map();
  fallback.setAttribute = fallback.set.bind(fallback);
  fallback.removeAttribute = fallback.delete.bind(fallback);
  const show = titleArtwork(image, fallback);

  const stale = show("old-logo", "Old title");
  const broken = show("broken-logo", "Current title");
  decodes.get("old-logo").resolve();
  await stale;
  assert.equal(image.hidden, true);
  assert.equal(fallback.has("aria-hidden"), false);
  decodes.get("broken-logo").reject(new Error("Invalid image"));
  await broken;
  assert.equal(image.src, undefined);
  assert.equal(fallback.has("aria-hidden"), false);

  const valid = show("current-logo", "Current title");
  decodes.get("current-logo").resolve();
  await valid;
  assert.equal(image.hidden, false);
  assert.equal(image.alt, "Current title");
  assert.equal(fallback.get("aria-hidden"), "true");
  await show(null);
  assert.equal(image.hidden, true);
  assert.equal(fallback.has("aria-hidden"), false);
});
