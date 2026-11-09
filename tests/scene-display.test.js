import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Raycaster, Texture, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bindDeviceScreen, createDisplayPrimitive, prepareArcadeCabinet, prepareTelevision, resolveDisplayType } from "../light-study/scene-display.js";
import { parseModel, setModelActivity, setModelAnimationProgress } from "../src/platform-assets.js";
import platforms from "../platforms.json" with { type: "json" };
import { mockModelImages } from "./glb-fixture.js";
import { dualScreenDemos, matchedDualScreenDemo, setPreviewRegion } from "../src/dual-screen-preview.js";

test("displays default by device type even in older profiles with a monitor field", () => {
  for (const monitorType of [undefined, "led", "crt"]) {
    const saved = { monitorType };
    assert.equal(resolveDisplayType("console", saved), "tv");
    assert.equal(resolveDisplayType("computer", saved), monitorType || "led");
    assert.equal(resolveDisplayType("handheld", saved), "none");
    assert.equal(resolveDisplayType("arcade", saved), "none");
  }
});

test("an explicit display choice overrides the hardware default", () => {
  assert.equal(resolveDisplayType("console", { displayType: "none" }), "none");
  assert.equal(resolveDisplayType("console", { displayType: "crt" }), "crt");
  assert.equal(resolveDisplayType("handheld", { displayType: "tv" }), "tv");
  assert.equal(resolveDisplayType("computer", { displayType: "led", monitorType: "crt" }), "led");
});

test("CRT and LED display different geometry and use the shared screen material", () => {
  const screen = new MeshBasicMaterial();
  const crt = createDisplayPrimitive("crt", screen);
  const led = createDisplayPrimitive("led", screen);
  const crtSize = new Box3().setFromObject(crt).getSize(new Vector3());
  const ledSize = new Box3().setFromObject(led).getSize(new Vector3());
  assert.ok(crtSize.x > ledSize.x && crtSize.y > ledSize.y && crtSize.z > ledSize.z);
  for (const model of [crt, led]) assert.equal(model.children.filter(mesh => mesh.material === screen).length, 1);
});

test("the fitted plinth moves independently from the TV and keeps the room finish", () => {
  const model = new Group();
  const body = new Mesh(new BoxGeometry(2, 1, 0.2), new MeshStandardMaterial());
  body.position.y = 1;
  const screen = new Mesh(new PlaneGeometry(1.9, 0.9), new MeshStandardMaterial());
  screen.name = "television_screen";
  screen.position.y = 1;
  const plinth = new Mesh(new BoxGeometry(2, 0.5, 0.6), new MeshStandardMaterial());
  plinth.name = "television_plinth";
  plinth.position.y = -0.25;
  model.add(body, screen, plinth);
  const bodyMaterial = body.material;
  const roomFinish = new MeshStandardMaterial();
  const gameplay = new MeshBasicMaterial();
  assert.equal(prepareTelevision(model, gameplay, roomFinish), plinth);
  assert.equal(plinth.parent, null);
  assert.equal(model.getObjectByName("television_plinth"), undefined);
  const plinthBounds = new Box3().setFromObject(plinth);
  assert.equal(plinthBounds.min.y, 0);
  assert.equal(plinthBounds.max.y, 4.25);
  assert.equal(plinthBounds.getSize(new Vector3()).x, 17);
  assert.equal(plinth.material, roomFinish);
  assert.equal(screen.material, gameplay);
  assert.equal(body.material, bodyMaterial);
  const screenPosition = screen.getWorldPosition(new Vector3());
  plinth.position.x += 5;
  assert.deepEqual(screen.getWorldPosition(new Vector3()), screenPosition);
});

test("the arcade cabinet displays an upright, aspect-fitted picture inside its surround", async (t) => {
  mockModelImages(t);
  const file = new URL("../public/assets/models/arcade.glb", import.meta.url);
  const model = await parseModel(new Uint8Array(await readFile(file)).buffer, [], [0, 0, 0], [], "arcade");
  const gameplay = new MeshBasicMaterial();
  const cabinet = prepareArcadeCabinet(model, gameplay);
  const { screen } = cabinet;
  const { width, height } = screen.geometry.parameters;
  const bezel = model.getObjectByName("Arcade screen surround");
  const marquee = model.getObjectByName("Object_13");

  assert.equal(screen.name, "GameplayPreviewSurface");
  assert.equal(screen.material, gameplay);
  assert.deepEqual([...screen.geometry.attributes.uv.array], [0, 1, 1, 1, 0, 0, 1, 0]);
  assert.deepEqual([...marquee.geometry.attributes.uv.array], [0, 0, 1, 0, 0, 1, 1, 1]);
  for (const [videoWidth, videoHeight] of [[224, 384], [640, 480]]) {
    cabinet.setVideoSize(videoWidth, videoHeight);
    assert.ok(Math.abs(width * screen.scale.x / (height * screen.scale.y) - videoWidth / videoHeight) < 1e-6);
  }
  cabinet.setVideoSize(0, 0);
  model.updateMatrixWorld(true);
  const front = new Vector3(0, 0, 1).transformDirection(screen.matrixWorld);
  assert.ok(front.z > 0);
  assert.ok(new Vector3(0, 1, 0).transformDirection(screen.matrixWorld).y > 0);
  const hit = (x, y) => {
    const origin = screen.localToWorld(new Vector3(x * width, y * height, 0)).addScaledVector(front, 2);
    return new Raycaster(origin, front.clone().negate()).intersectObject(model)
      .find(result => result.object.visible)?.object;
  };
  assert.equal(hit(0, 0)?.name, screen.name);
  assert.equal(hit(.48, .48)?.name, screen.name);
  assert.equal(hit(-.48, -.48)?.name, screen.name);
  assert.equal(hit(-.60, 0)?.name, bezel.name);
  assert.equal(hit(0, .52)?.name, bezel.name);

  const art = new Texture();
  let disposed = false;
  art.addEventListener("dispose", () => { disposed = true; });
  cabinet.setArtwork("banner", art);
  assert.equal(marquee.material.map, art);
  cabinet.setArtwork("banner");
  assert.equal(marquee.material.map, null);
  assert.equal(disposed, true);
  cabinet.setArtwork("bezel", new Texture());
  assert.ok(bezel.material.map);
  assert.equal(hit(0, 0)?.name, screen.name);
});

test("bundled handheld gameplay faces forward and fills the visible screen", async (t) => {
  mockModelImages(t);
  const gameplay = new MeshBasicMaterial();
  const handhelds = platforms.filter(p => ["handheld", "hybrid"].includes(p.kind) && p.bundledModel);
  for (const { id, bundledModel, modelAnimations } of handhelds) {
    await t.test(id, async () => {
      const file = new URL(`../public/${bundledModel.path}`, import.meta.url);
      const bytes = new Uint8Array(await readFile(file)).buffer;
      const model = id === "switch"
        ? (await new GLTFLoader().parseAsync(bytes, "")).scene
        : await parseModel(bytes, bundledModel.hiddenMaterials, bundledModel.showcaseRotation,
            bundledModel.opaqueMaterials, id, modelAnimations);
      bindDeviceScreen(model, id, gameplay, { bundled: true });
      setModelAnimationProgress(model, 1);
      setModelActivity(model, true, 0, 1, true);
      model.updateMatrixWorld(true);

      const screen = model.getObjectByName("GameplayPreviewSurface");
      assert.equal(screen?.material, gameplay);
      assert.ok(screen.geometry.getAttribute("uv"));
      const { width, height } = screen.geometry.parameters;
      const front = new Vector3(0, 0, 1).transformDirection(screen.matrixWorld);
      assert.ok(front.z > 0.8);
      assert.ok(new Vector3(0, 1, 0).transformDirection(screen.matrixWorld).y > 0.8);
      const firstHit = (x, y) => {
        const start = screen.localToWorld(new Vector3(width * x, height * y, 0)).addScaledVector(front, 5);
        const ray = new Raycaster(start, front.clone().negate());
        return ray.intersectObject(model).find(hit => hit.object.visible)?.object;
      };
      for (const [x, y] of [[0, 0], [-0.48, 0.48], [0.48, 0.48], [-0.48, -0.48], [0.48, -0.48]]) {
        assert.equal(firstHit(x, y)?.name, screen.name, `screen visible at ${x}, ${y}`);
      }
      if (dualScreenDemos[id]) {
        const touch = model.getObjectByName("GameplayPreviewTouchSurface");
        assert.equal(touch?.material, gameplay, "both LCDs share a single preview");
        assert.deepEqual(touch.geometry.attributes.uv.array, screen.geometry.attributes.uv.array);
        const originalUV = screen.geometry.attributes.uv.array.slice();
        const demo = matchedDualScreenDemo(id, `${dualScreenDemos[id].title} (USA)`);
        setPreviewRegion(screen, demo.regions[0]);
        setPreviewRegion(touch, demo.regions[1]);
        assert.ok(screen.geometry.attributes.uv.getY(2) >= touch.geometry.attributes.uv.getY(0));
        assert.equal(matchedDualScreenDemo(id, "A different game"), null);
        setPreviewRegion(screen);
        setPreviewRegion(touch);
        assert.deepEqual(screen.geometry.attributes.uv.array, originalUV);
        assert.deepEqual(touch.geometry.attributes.uv.array, originalUV);
        const normal = new Vector3(0, 0, 1).transformDirection(touch.matrixWorld);
        const up = new Vector3(0, 1, 0).transformDirection(touch.matrixWorld);
        assert.ok(id === "ndslite" ? normal.y > 0.99 && up.z < -0.99 : normal.z > 0.99 && up.y > 0.99);
        for (const x of [-0.48, 0, 0.48]) {
          for (const y of [-0.48, 0, 0.48]) {
            const start = touch.localToWorld(new Vector3(
              touch.geometry.parameters.width * x, touch.geometry.parameters.height * y, 0,
            )).addScaledVector(normal, .1);
            const ray = new Raycaster(start, normal.clone().negate());
            assert.equal(ray.intersectObject(model).find(hit => hit.object.visible)?.object.name, touch.name);
          }
        }
      }
      if (id === "psp") assert.equal(firstHit(0.505, 0)?.name, "Plane_Material032_0", "PSP screen stops at the surround");
      if (model.userData.consoleActivity?.screenDemo)
        assert.equal(model.userData.consoleActivity.screenDemo.lcd.visible, false, "carousel demo stays out of the chooser");
    });
  }
});
