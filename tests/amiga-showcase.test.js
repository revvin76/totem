import test from "node:test";
import assert from "node:assert/strict";
import { Group } from "three";
import { attachAmigaShowcase, disposeAmigaShowcase, updateAmigaShowcase } from "../src/amiga-showcase.js";

test("the Amiga settles, inserts the disk with power on, then reads it once", (t) => {
  const events = [];
  const previousAudio = globalThis.Audio;
  const previousDocument = globalThis.document;
  t.after(() => {
    if (previousAudio) globalThis.Audio = previousAudio;
    else delete globalThis.Audio;
    if (previousDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
  });
  globalThis.document = { baseURI: "http://localhost/" };
  globalThis.Audio = class {
    async play() { events.push("play"); }
    pause() { events.push("pause"); }
    removeAttribute(name) { events.push(name); }
    load() { events.push("load"); }
  };
  const model = new Group();
  const chassis = new Group();
  model.add(chassis);
  const disk = new Group();
  attachAmigaShowcase(model, chassis, disk);
  const showcase = model.userData.amigaShowcase;
  const { power, drive, audio } = showcase;
  const outside = disk.position.x;
  updateAmigaShowcase(showcase, true, 2, .95, false);
  assert.deepEqual([disk.visible, power.visible, drive.visible], [false, false, false]);
  updateAmigaShowcase(showcase, true, .25, 1, false);
  assert.deepEqual([disk.visible, power.visible, drive.visible], [true, true, false]);
  assert.ok(disk.position.x < outside);
  assert.deepEqual(events, []);
  updateAmigaShowcase(showcase, true, 1, 1, false);
  assert.deepEqual([disk.visible, power.visible, drive.visible], [false, true, true]);
  assert.deepEqual(events, ["play"]);
  updateAmigaShowcase(showcase, true, .3, 1, false);
  assert.equal(drive.visible, false);
  updateAmigaShowcase(showcase, true, .1, 1, false);
  assert.equal(drive.visible, true);
  updateAmigaShowcase(showcase, true, 3, 1, false);
  assert.deepEqual([power.visible, drive.visible], [true, false]);
  assert.deepEqual(events, ["play"]);
  updateAmigaShowcase(showcase, false, 0, 0, false);
  assert.deepEqual([disk.visible, power.visible, drive.visible], [false, false, false]);
  assert.equal(disk.position.x, outside);
  assert.equal(audio.currentTime, 0);
  updateAmigaShowcase(showcase, true, 0, 0, true);
  assert.deepEqual([disk.visible, power.visible, drive.visible], [false, true, true]);
  disposeAmigaShowcase(showcase);
  assert.deepEqual(events, ["play", "pause", "play", "pause", "src", "load"]);
});
