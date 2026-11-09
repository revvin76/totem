import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Box3, Color, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeImported, loadPlatformModel, parseModel, setModelActivity, setModelAnimationProgress } from "../src/platform-assets.js";
import { displayPlatform } from "../src/model-display.js";
import { mockModelImages } from "./glb-fixture.js";
import catalogue from "../platforms.json" with { type: "json" };

// Node has no image decoder. Keep the actual bundled geometry and transforms,
// replacing only texture materials for this geometry regression.
async function fixture() {
  const bytes = await readFile(new URL("../public/assets/models/playstation-1.glb", import.meta.url));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + length));
  json.materials = json.materials.map(({ name }) => ({ name }));
  delete json.images; delete json.textures; delete json.samplers;
  let chunk = Buffer.from(JSON.stringify(json));
  chunk = Buffer.concat([chunk, Buffer.alloc((4 - chunk.length % 4) % 4, 32)]);
  const tail = bytes.subarray(20 + length);
  const output = Buffer.alloc(20 + chunk.length + tail.length);
  output.writeUInt32LE(0x46546c67); output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8); output.writeUInt32LE(chunk.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16); chunk.copy(output, 20); tail.copy(output, 20 + chunk.length);
  return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
}

test("PlayStation lid retains its original skirt and bevel throughout opening", async () => {
  const bytes = await fixture();
  const original = (await new GLTFLoader().parseAsync(bytes, "")).scene;
  original.updateMatrixWorld(true);
  const source = original.getObjectByName("Object_8");
  const model = await parseModel(bytes, [], [0, 0, 0], [], "playstation");
  const shell = model.getObjectByName("Object_8");
  const top = model.getObjectByName("Object_12");
  const rim = model.getObjectByName("PlayStation lid sides");
  assert.ok(rim);
  assert.equal(rim.geometry.attributes.position.count, 160 * 3);
  assert.equal(shell.geometry.index.count + rim.geometry.attributes.position.count, source.geometry.index.count);
  assert.ok(rim.geometry.attributes.uv);
  assert.ok(rim.geometry.attributes.normal);
  assert.equal(rim.material, shell.material);
  assert.equal(rim.parent, top.parent);
  rim.geometry.computeBoundingBox();
  assert.ok(rim.geometry.boundingBox.getSize(new Vector3()).length() > 0);
  const pivot = top.parent;
  setModelAnimationProgress(model, 0);
  model.updateMatrixWorld(true);
  const closed = new Box3().setFromObject(rim).getCenter(new Vector3());
  setModelAnimationProgress(model, 1);
  model.updateMatrixWorld(true);
  assert.ok(closed.distanceTo(new Box3().setFromObject(rim).getCenter(new Vector3())) > 0.1);
  assert.equal(rim.parent, pivot);
  assert.notEqual(shell.parent, pivot);

  const saved = {
    version: 1, configured: true, closeWhenActive: true,
    groups: model.userData.animationTracks.map(({ settings }) => ({
      ...settings, meshes: settings.meshes.filter((key) => key !== rim.userData.animationMeshKey),
    })),
  };
  const updated = await parseModel(bytes, [], [0, 0, 0], [], "playstation", saved);
  assert.equal(updated.getObjectByName("PlayStation lid sides").parent,
    updated.getObjectByName("Object_12").parent);
});

test("the bundled PlayStation matches the lid plastic and keeps its power button dark at both detail tiers", async (t) => {
  mockModelImages(t);
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillText() {} }) }) };
  t.after(() => { globalThis.document = previousDocument; });
  const platform = catalogue.find(entry => entry.id === "playstation");
  const store = {
    async readBundledModel(path) {
      const bytes = await readFile(new URL(`../public/${path}`, import.meta.url));
      return Uint8Array.from(bytes).buffer;
    },
  };
  for (const tier of ["preview", "display"]) {
    const model = await loadPlatformModel(displayPlatform(platform, tier), store);
    try {
      const shell = model.getObjectByName("Object_8").material;
      const lid = model.getObjectByName("Object_12").material;
      const button = model.getObjectByName("Object_11").material;
      assert.ok(shell.map && lid.map && button.map);
      assert.notEqual(shell.map, lid.map);
      assert.equal(new Color(0x9e9e9e).multiply(shell.color).getHex(), 0xa9a38d);
      assert.equal(lid.color.getHex(), 0xffffff);
      setModelActivity(model, true, 1, 1);
      assert.equal(button.emissive.getHex(), 0);
    } finally {
      disposeImported(model);
    }
  }
});
