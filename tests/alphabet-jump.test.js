import test from "node:test";
import assert from "node:assert/strict";
import { createAlphabetJump } from "../src/alphabet-jump.js";

function setup() {
  let items = ["8 Ball", "Zelda", "Banjo", "Élan", "Banjo Too"];
  let selected = items[2];
  let previous = new Set();
  const events = [];
  const jump = createAlphabetJump({
    items: () => items, selected: () => selected, titleOf: item => item,
    select: item => { selected = item; events.push(item); },
    show: groups => events.push(groups.map(([letter]) => letter).join("")),
    highlight: (index, letter) => events.push(letter), hide: () => events.push("closed"),
  });
  function frame(now, keys, enabled = true) {
    const pressed = new Set(keys);
    const handled = jump.poll(now, pressed, previous, enabled, key => ({ lt: "previous-letter", rt: "next-letter" })[key]);
    previous = pressed;
    return handled;
  }
  return { frame, events, filter: () => { items = items.slice(0, 2); } };
}

test("trigger taps move through populated initials without relying on rail order", () => {
  const { frame, events } = setup();
  assert.equal(frame(0, ["rt"]), true);
  assert.deepEqual(events, []);
  assert.equal(frame(120, []), true);
  frame(200, ["lt"]);
  frame(290, []);
  frame(400, ["lt"]);
  frame(490, []);
  frame(550, ["lt"]);
  frame(600, []);
  assert.deepEqual(events, ["Élan", "Banjo", "8 Ball", "Zelda"]);
});

test("a hold browses initials with the D-pad or stick and commits on release", () => {
  const { frame, events } = setup();
  frame(0, ["rt"]);
  frame(350, ["rt"]);
  frame(370, ["rt", "right"]);
  frame(390, ["rt"]);
  frame(410, ["rt", "stick-rightward"]);
  assert.deepEqual(events, ["#BEZ", "B", "E", "Z"]);
  frame(470, []);
  assert.deepEqual(events, ["#BEZ", "B", "E", "Z", "closed", "Zelda"]);
});

test("filter changes and loss of input cancel a hold without selecting a stale item", () => {
  const { frame, filter, events } = setup();
  frame(0, ["rt"]);
  frame(360, ["rt"]);
  filter();
  frame(400, []);
  frame(450, ["lt"]);
  frame(810, ["lt"]);
  frame(900, [], false);
  assert.deepEqual(events, ["#BEZ", "B", "closed", "#Z", "#", "closed"]);
});
