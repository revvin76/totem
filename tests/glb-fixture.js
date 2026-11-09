import { Texture, TextureLoader } from "three";

// An original triangle for import verification, never a production device asset.
export function triangleGLB(overrides = {}) {
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [0.2, 0.7, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 0.4,
        },
      },
    ],
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [-1, 0, 0],
        max: [1, 1, 0],
      },
    ],
    ...overrides,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const length = Math.ceil(encoded.length / 4) * 4;
  const buffer = new ArrayBuffer(12 + 8 + length + 8 + 36);
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + length);
  bytes.set(encoded, 20);
  view.setUint32(20 + length, 36, true);
  view.setUint32(24 + length, 0x004e4942, true);
  new Float32Array(buffer, 28 + length, 9).set([-1, 0, 0, 1, 0, 0, 0, 1, 0]);
  return buffer;
}

// Keep geometry tests on the real model path without decoding browser images.
export function mockModelImages(t) {
  t.mock.method(globalThis, "fetch", async () => new Response(new Blob()));
  t.mock.method(TextureLoader.prototype, "loadAsync", async () => new Texture());
  const previousSelf = globalThis.self;
  const previousBitmap = globalThis.createImageBitmap;
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });
  t.after(() => {
    globalThis.self = previousSelf;
    globalThis.createImageBitmap = previousBitmap;
  });
}
