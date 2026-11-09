import test from "node:test";
import assert from "node:assert/strict";
import { animationMembership } from "../src/animation-membership.js";
test("initial preview can list ungrouped meshes without an animation selection", () => {
  assert.deepEqual(animationMembership({ name: "Shell" }), {
    inCurrentGroup: false, action: "Add", disabled: true, label: "Add Shell to the current group",
  });
});
test("membership actions respect the current group and existing mesh ownership", () => {
  const mesh = { name: "Lid" }, current = { id: "lid", name: "Hinge" }, other = { id: "other", name: "Tray" };
  assert.equal(animationMembership(mesh, current, current).label, "Remove Lid from Hinge");
  assert.equal(animationMembership(mesh, current, current).disabled, false);
  assert.equal(animationMembership(mesh, current, other).disabled, true);
  assert.equal(animationMembership(mesh, current).disabled, false);
  assert.equal(animationMembership(mesh, undefined, other).inCurrentGroup, false);
});
