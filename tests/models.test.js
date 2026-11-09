import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import catalogue from "../platforms.json" with { type: "json" };
import { createConsole, getConsoleReferenceMaxDimension } from "../src/models.js";
import { PROFILE_TYPES } from "../src/hardware-profiles.js";

test("every catalogue entry constructs actual bounded 3D geometry with no fallback", () => {
  // Only raster text needs a DOM surface; geometry is tested independently of WebGL.
  const original = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillText() {} }),
    }),
  };
  try {
    assert.equal(new Set(catalogue.map((p) => p.id)).size, catalogue.length);
    for (const platform of catalogue) {
      assert.ok(
        platform.model.profile === "bespoke" ||
          PROFILE_TYPES.includes(platform.model.profile),
        platform.id,
      );
      const model = createConsole(platform);
      let meshes = 0;
      model.traverse((part) => {
        if (part.isMesh) {
          meshes++;
          assert.ok(part.geometry.attributes.position.count > 0, platform.id);
        }
      });
      const bounds = new Box3().setFromObject(model);
      const size = bounds.getSize(new Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z);
      assert.equal(getConsoleReferenceMaxDimension(platform), maxDimension, platform.id);
      assert.equal(getConsoleReferenceMaxDimension({ ...platform }), maxDimension, platform.id);
      assert.ok(meshes >= 2, platform.id);
      assert.ok(
        size
          .toArray()
          .every(
            (value) => Number.isFinite(value) && value > 0.05 && value < 10,
          ),
        platform.id,
      );
      assert.equal(model.userData.platformId, platform.id);
    }
    assert.ok(catalogue.some((p) => p.id === "arcade" && p.kind === "arcade"));
    assert.throws(() => createConsole("not-a-real-platform"));
  } finally {
    globalThis.document = original;
  }
});
