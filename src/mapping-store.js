import { invoke } from "@tauri-apps/api/core";
import { validateMapping } from "./controller-mapping.js";

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function createMappingStore(native, platformIds) {
  let db;
  if (!native) {
    const request = indexedDB.open("horizon-controller-mappings", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("profiles", { keyPath: "id" });
    db = await result(request);
  }
  return {
    async list() {
      if (native) return invoke("list_controller_mappings");
      const records = await result(
        db.transaction("profiles").objectStore("profiles").getAll(),
      );
      const profiles = [],
        errors = [];
      for (const record of records)
        try {
          profiles.push(validateMapping(record, platformIds()));
        } catch (error) {
          errors.push(`${record.name ?? "Saved profile"}: ${error.message}`);
        }
      return { profiles, errors };
    },
    async save(profile) {
      const validated = validateMapping(profile, platformIds());
      if (native)
        return invoke("save_controller_mapping", { profile: validated });
      const tx = db.transaction("profiles", "readwrite");
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () =>
          reject(tx.error ?? new Error("Mapping save cancelled."));
        tx.onerror = () => reject(tx.error);
      });
      tx.objectStore("profiles").add(validated);
      await done;
      const persisted = await result(
        db.transaction("profiles").objectStore("profiles").get(validated.id),
      );
      if (JSON.stringify(persisted) !== JSON.stringify(validated))
        throw new Error(
          "Mapping readback did not match. Reopen the screen to check saved profiles.",
        );
      return persisted;
    },
  };
}
