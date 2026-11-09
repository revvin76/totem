import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import {
  ACK_DURATION,
  CONTROLLERS,
  INPUTS,
  MappingRun,
  XBOX,
  controllerForPlatform,
  gamepadInputs,
  pairingIntensity,
  revealView,
  suggestedBindings,
  validateMapping,
} from "../src/controller-mapping.js";
import { createControllerModel } from "../src/controller-models.js";

const nes = controllerForPlatform("nes");
const empty = () => new Set();
const profile = () => ({
  schemaVersion: 1,
  id: "map-00000000-0000-0000-0000-000000000000",
  name: "My NES",
  controllerId: "nes",
  platformId: "nes",
  createdAt: "2026-11-02T12:00:00.000Z",
  bindings: suggestedBindings(nes),
  skipped: [],
});

test("each controller has unique controls, valid suggestions and bounded 3D button surfaces", () => {
  const ids = new Set();
  for (const controller of CONTROLLERS) {
    assert.ok(!ids.has(controller.id));
    ids.add(controller.id);
    const controls = new Set();
    const model = createControllerModel(controller);
    for (const control of controller.controls) {
      assert.ok(!controls.has(control.id), `${controller.id}/${control.id}`);
      controls.add(control.id);
      assert.ok(INPUTS.has(control.defaultInput));
      assert.ok(["front", "top", "rear"].includes(control.view));
      assert.ok(model.buttons.has(control.id));
      const node = model.buttons.get(control.id).node;
      assert.equal(node.userData.controlId, control.id);
    }
    const size = new Box3().setFromObject(model.root).getSize(new Vector3());
    assert.ok(
      [size.x, size.y, size.z].every(
        (n) => Number.isFinite(n) && n > 0 && n < 8,
      ),
      controller.id,
    );
    assert.equal(model.buttons.size, controller.controls.length);
    model.dispose();
  }
  assert.equal(controllerForPlatform("user-new").id, "generic");
  assert.equal(XBOX.controls.length, 26);
});

test("pairing requires neutral, acknowledges once and cannot spill a held button into the next step", () => {
  const run = new MappingRun(nes);
  run.tick(new Set(["b0"]), 0);
  assert.equal(run.phase, "release");
  run.tick(empty(), 10);
  assert.equal(run.phase, "listen");
  run.tick(new Set(["b0"]), 20);
  assert.equal(run.phase, "ack");
  assert.equal(run.bindings.a, "b0");
  run.tick(empty(), 100);
  assert.equal(run.index, 0);
  run.tick(new Set(["b0"]), ACK_DURATION + 30);
  assert.equal(run.index, 0);
  run.tick(empty(), ACK_DURATION + 40);
  assert.equal(run.index, 1);
  assert.equal(run.phase, "listen");
  assert.deepEqual(run.bindings, { a: "b0" });
  run.tick(new Set(["b2"]), 1000);
  assert.equal(run.bindings.b, "b2");
});

test("ambiguous input and focus/device rearming require release without losing progress", () => {
  const run = new MappingRun(nes);
  run.tick(empty(), 0);
  run.tick(new Set(["b0", "b1"]), 1);
  assert.equal(run.phase, "release");
  assert.deepEqual(run.bindings, {});
  run.tick(new Set(["b0"]), 2);
  assert.deepEqual(run.bindings, {});
  run.tick(empty(), 3);
  run.rearm();
  run.tick(new Set(["b0"]), 4);
  assert.deepEqual(run.bindings, {});
  run.tick(empty(), 5);
  run.tick(new Set(["b0"]), 6);
  assert.equal(run.bindings.a, "b0");
});

test("a complete run and explicitly skipped controls round-trip without overwriting profiles", () => {
  const run = new MappingRun(nes);
  let now = 0;
  run.tick(empty(), now);
  while (run.current) {
    run.tick(new Set([run.current.defaultInput]), (now += 1000));
    run.tick(empty(), (now += 1000));
  }
  assert.equal(run.phase, "complete");
  const saved = validateMapping({ ...profile(), bindings: run.bindings }, [
    "nes",
  ]);
  assert.deepEqual(saved.bindings, suggestedBindings(nes));
  const partial = new MappingRun(nes);
  partial.tick(empty(), 0);
  partial.tick(new Set(["b0"]), 10);
  partial.skip();
  assert.equal(partial.index, 0);
  partial.tick(empty(), 1000);
  while (partial.current) partial.skip();
  assert.equal(partial.phase, "complete");
  assert.equal(partial.skipped.length, 7);
  assert.doesNotThrow(() =>
    validateMapping(
      { ...profile(), bindings: partial.bindings, skipped: partial.skipped },
      ["nes"],
    ),
  );
  saved.bindings.a = "b1";
  assert.equal(run.bindings.a, "b0");
  run.back();
  assert.equal(run.phase, "release");
  assert.equal(run.current.id, "start");
  assert.equal(run.bindings.start, undefined);
  partial.back();
  assert.equal(partial.current.id, "start");
  assert.ok(!partial.skipped.includes("start"));
});

test("validation rejects incomplete runs, malformed inputs and mapped/skipped overlaps", () => {
  for (const edit of [
    { id: "../escape" },
    { bindings: { a: "b99" } },
    { skipped: ["a"] },
    { controllerId: "missing" },
    { platformId: "missing" },
    { name: " " },
    { createdAt: "bad" },
  ])
    assert.throws(() => validateMapping({ ...profile(), ...edit }, ["nes"]));
  const missing = profile();
  delete missing.bindings.a;
  assert.throws(() => validateMapping(missing, ["nes"]));
  missing.skipped = ["a"];
  assert.doesNotThrow(() => validateMapping(missing, ["nes"]));
});

test("stick and trigger hysteresis rejects drift and releases below the lower threshold", () => {
  const pad = {
    mapping: "standard",
    connected: true,
    buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    axes: [0.2, 0, 0, 0],
  };
  assert.equal(gamepadInputs(pad).size, 0);
  pad.axes[0] = 0.8;
  assert.deepEqual([...gamepadInputs(pad)], ["a0+"]);
  pad.axes[0] = 0.4;
  assert.equal(gamepadInputs(pad).size, 0);
  assert.equal(gamepadInputs(pad, new Set(["a0+"])).size, 1);
  pad.axes[0] = 0.2;
  assert.equal(gamepadInputs(pad, new Set(["a0+"])).size, 0);
  pad.buttons[6].value = 0.8;
  assert.ok(gamepadInputs(pad).has("b6"));
  pad.buttons[6].value = 0.4;
  assert.ok(gamepadInputs(pad, new Set(["b6"])).has("b6"));
  assert.equal(gamepadInputs({ ...pad, mapping: "" }).size, 0);
  assert.equal(gamepadInputs(null).size, 0);
});

test("both models share acknowledgement timing; hidden controls reveal the appropriate surface", () => {
  assert.equal(pairingIntensity(0, true), 1);
  assert.equal(pairingIntensity(225, true), 0.12);
  assert.equal(pairingIntensity(450, true), 1);
  assert.equal(pairingIntensity(225, true, true), 1);
  assert.equal(pairingIntensity(123, false, true), 0.7);
  assert.ok(pairingIntensity(0) < pairingIntensity(800));
  assert.equal(revealView([]), "front");
  assert.equal(revealView([{ view: "top" }]), "top");
  assert.equal(revealView([{ view: "top" }, { view: "rear" }]), "rear");
});
