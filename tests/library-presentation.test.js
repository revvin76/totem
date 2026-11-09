import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import platforms from "../platforms.json" with { type: "json" };
import { accessoryPose, devicePose, libraryDisplay, libraryShowsControllers, libraryShowsMedia } from "../src/library-presentation.js";
import { layoutLibraryAccessories, libraryAccessoryOptions, loadLibraryAccessories } from "../src/library-accessories.js";
import { disposeImported, validatePlatform } from "../src/platform-assets.js";

const platform = (id) => platforms.find((record) => record.id === id);

test("every handheld defaults to its own screen and saved TV choices still apply", () => {
  for (const record of platforms.filter(({ kind }) => kind === "handheld")) {
    assert.equal(libraryDisplay(record), "built-in", record.id);
    assert.equal(libraryDisplay({ ...record, libraryPresentation: { display: "tv" } }), "tv");
  }
  assert.equal(libraryDisplay(platform("snes")), "tv");
  assert.equal(libraryDisplay(platform("switch")), "built-in");
  assert.equal(libraryDisplay(platform("switch2")), "built-in");
});

test("disc, UMD and cartridge systems offer their own media models", () => {
  assert.deepEqual(libraryAccessoryOptions(platform("playstation")), [["media", "Disc"], ["controller", "Controller 1"], ["controller2", "Controller 2"]]);
  assert.deepEqual(libraryAccessoryOptions(platform("psp")), [["media", "UMD"]]);
  assert.deepEqual(libraryAccessoryOptions(platform("gameboy")), [["media", "Cartridge"]]);
  assert.deepEqual(libraryAccessoryOptions(platform("3ds")), []);
  assert.deepEqual(libraryAccessoryOptions(platform("steamdeck")), []);
});

test("platform visibility overrides survive saving and filter accessory models", async () => {
  const arcade = platform("arcade");
  const playstation = platform("playstation");
  assert.equal(libraryShowsControllers(arcade), false);
  assert.equal(libraryShowsMedia(arcade), false);
  assert.equal(libraryShowsControllers(playstation, false), false);
  assert.equal(libraryShowsMedia(playstation), true);

  const settings = { screenMesh: "", pose: devicePose, showControllers: true, showMedia: false };
  const record = JSON.parse(JSON.stringify(validatePlatform({
    ...playstation, libraryPresentation: settings,
  }, [playstation.id])));
  assert.equal(libraryShowsControllers(record, false), true);
  assert.equal(libraryShowsMedia(record), false);
  const models = await loadLibraryAccessories(record);
  try {
    assert.deepEqual([...models.keys()], ["controller", "controller2"]);
  } finally {
    for (const model of models.values()) disposeImported(model);
  }
  assert.throws(() => validatePlatform({
    ...record, libraryPresentation: { ...settings, showMedia: "false" },
  }, [playstation.id]), /Invalid game library visibility/);
});

test("a saved cartridge pose and second controller pose move only their own models", async () => {
  const snes = platform("snes");
  const record = validatePlatform({
    ...snes,
    libraryPresentation: {
      screenMesh: "", pose: devicePose,
      accessories: { media: { ...accessoryPose, x: 2 }, controller2: { ...accessoryPose, yaw: 30 } },
    },
  }, [snes.id]);
  const settings = JSON.parse(JSON.stringify(record)).libraryPresentation;
  const models = await loadLibraryAccessories(snes, { readBundledModel: async () => { throw new Error("offline"); } });
  try {
    const bounds = new Box3(new Vector3(-2, -1, -1), new Vector3(2, 0, 1));
    layoutLibraryAccessories(models, null, bounds, 1);
    const originalX = models.get("media").position.x;
    const originalYaw = models.get("controller2").rotation.y;
    models.get("controller").updateMatrix();
    const firstController = models.get("controller").matrix.clone();
    layoutLibraryAccessories(models, settings.accessories, bounds, 1);
    models.get("controller").updateMatrix();
    assert.equal(models.get("media").position.x, originalX + 2);
    assert.ok(Math.abs(models.get("controller2").rotation.y - originalYaw - Math.PI / 6) < 1e-10);
    assert.ok(models.get("controller").matrix.equals(firstController));
    assert.throws(() => validatePlatform({
      ...record, libraryPresentation: { ...settings, accessories: { media: { ...accessoryPose, zoom: 0 } } },
    }, [snes.id]), /Invalid game library zoom/);
  } finally {
    for (const model of models.values()) disposeImported(model);
  }
});
