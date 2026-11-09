import assert from "node:assert/strict";
import test from "node:test";
import { parseStartupVolume, playStartupVideo } from "../src/startup-intro-audio.js";

test("startup volume accepts zero and clamps malformed or old preferences safely", () => {
  assert.equal(parseStartupVolume(null), 0.65);
  assert.equal(parseStartupVolume("NaN"), 0.65);
  assert.equal(parseStartupVolume("0"), 0);
  assert.equal(parseStartupVolume("0.34"), 0.34);
  assert.equal(parseStartupVolume("2"), 1);
});

test("startup plays at saved volume or stays muted at zero", async () => {
  const signal = new AbortController().signal;
  const video = { play() { assert.equal(this.muted, this.volume === 0); } };
  assert.equal(await playStartupVideo(video, { volume: 0.35, muted: false, signal }), false);
  assert.equal(video.volume, 0.35);
  assert.equal(await playStartupVideo(video, { volume: 0, muted: false, signal }), false);
  assert.equal(video.volume, 0);
});

test("autoplay denial retries the same video muted without reopening it", async () => {
  const attempts = [];
  const video = {
    async play() {
      attempts.push(this.muted);
      if (!this.muted) throw new DOMException("gesture required", "NotAllowedError");
    },
  };
  const signal = new AbortController().signal;
  assert.equal(await playStartupVideo(video, { volume: 0.65, muted: false, signal }), true);
  assert.deepEqual(attempts, [false, true]);
});

test("a skipped or broken clip never restarts playback", async () => {
  const controller = new AbortController();
  let plays = 0;
  const video = {
    async play() {
      plays++;
      controller.abort();
      throw new DOMException("gesture required", "NotAllowedError");
    },
  };
  await assert.rejects(playStartupVideo(video, { volume: 0.65, muted: false, signal: controller.signal }),
    { name: "NotAllowedError" });
  assert.equal(plays, 1);
  const broken = { async play() { throw new DOMException("bad stream", "NotSupportedError"); } };
  await assert.rejects(playStartupVideo(broken, { volume: 0.65, muted: false, signal: new AbortController().signal }),
    { name: "NotSupportedError" });
});
