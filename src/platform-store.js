import { invoke } from "@tauri-apps/api/core";
import {
  LOGO_LIMIT,
  MODEL_LIMIT,
  inspectGLB,
  validatePlatform,
} from "./platform-assets.js";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () =>
      reject(tx.error ?? new Error("Storage transaction cancelled."));
    tx.onerror = () => reject(tx.error);
  });
}
function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function readBrowserBundledModel(path) {
  const response = await fetch(new URL(path, location.origin + "/"));
  if (!response.ok) throw new Error(`Bundled model could not be loaded (${response.status}).`);
  return response.arrayBuffer();
}

export async function createPlatformStore(native, base) {
  let db;
  let libraryPath;
  if (!native) {
    const request = indexedDB.open("horizon-platform-editor", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("platforms", { keyPath: "id" });
      request.result.createObjectStore("assets", { keyPath: "id" });
    };
    db = await requestResult(request);
  }
  const baseIds = base.map((p) => p.id);
  return {
    live: native,
    async catalogue() {
      if (native) {
        const state = await invoke("carousel_state");
        libraryPath = state.assetLibrary;
        return state.platforms;
      }
      const edits = await requestResult(
        db.transaction("platforms").objectStore("platforms").getAll(),
      );
      const records = new Map(base.map((p) => [p.id, p]));
      for (const record of edits) {
        const validated = validatePlatform(record, baseIds);
        const bundled = base.find((p) => p.id === record.id);
        if (bundled) {
          validated.bundledModel = bundled.bundledModel;
          validated.upgradePriority = bundled.upgradePriority;
        }
        records.set(record.id, validated);
      }
      return [...records.values()];
    },
    async save(record) {
      record = validatePlatform(record, baseIds);
      if (native) return invoke("save_platform", { platform: record });
      const tx = db.transaction("platforms", "readwrite");
      const existing = await requestResult(
        tx.objectStore("platforms").get(record.id),
      );
      if (
        (existing?.recordRevision ?? null) !== (record.recordRevision ?? null)
      ) {
        tx.abort();
        throw new Error(
          "This platform changed in another window. Reopen the application before editing it again.",
        );
      }
      record.recordRevision = crypto.randomUUID();
      tx.objectStore("platforms").put(record);
      await transactionDone(tx);
      return record;
    },
    async importAsset(file, kind) {
      if (file.size > (kind === "model" ? MODEL_LIMIT : LOGO_LIMIT))
        throw new Error(
          kind === "model" ? "Model limit is 128 MB." : "Logo limit is 8 MB.",
        );
      const buffer = await file.arrayBuffer();
      let extension;
      if (kind === "model") {
        inspectGLB(buffer);
        extension = "glb";
      } else {
        const bytes = new Uint8Array(buffer);
        extension =
          bytes[0] === 137 &&
          bytes[1] === 80 &&
          bytes[2] === 78 &&
          bytes[3] === 71
            ? "png"
            : bytes[0] === 255 && bytes[1] === 216
              ? "jpg"
              : new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
                  new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
                ? "webp"
                : null;
        if (!extension) throw new Error("Choose a PNG, JPEG or WebP logo.");
        const bitmap = await createImageBitmap(new Blob([buffer]));
        const oversized = bitmap.width > 8192 || bitmap.height > 8192;
        bitmap.close();
        if (oversized)
          throw new Error("Logo dimensions must be at most 8192 × 8192.");
      }
      if (native)
        return invoke("import_platform_asset", {
          name: file.name,
          kind,
          encoded: (await dataUrl(file)).split(",")[1],
        });
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
      ]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      const reference = {
        id: `${hash}.${extension}`,
        name: file.name,
        kind,
        bytes: file.size,
      };
      const tx = db.transaction("assets", "readwrite");
      tx.objectStore("assets").put({ ...reference, buffer });
      await transactionDone(tx);
      return reference;
    },
    async readAsset(reference) {
      if (native) return invoke("read_platform_asset", { id: reference.id });
      const asset = await requestResult(
        db.transaction("assets").objectStore("assets").get(reference.id),
      );
      if (!asset) throw new Error(`Missing imported asset: ${reference.name}`);
      return asset.buffer;
    },
    async readBundledModel(path, sha256) {
      if (native) return invoke("read_bundled_model", { path, sha256 });
      return readBrowserBundledModel(path);
    },
    async logoUrl(reference) {
      return URL.createObjectURL(new Blob([await this.readAsset(reference)]));
    },
    libraryLocation() {
      return native
        ? libraryPath
        : "This browser's local IndexedDB storage (separate from the desktop library)";
    },
  };
}
