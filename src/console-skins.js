const GBA_SKINS = [
  { name: "Indigo", color: "#554897" },
  { name: "Arctic", color: "#f2edd7" },
  { name: "Platinum", color: "#c8c7c2", metalness: .25 },
  { name: "Fuchsia", color: "#e58db6", opacity: .78 },
  { name: "Orange", color: "#f7a84a" },
  { name: "Glacier", color: "#aebbe4", opacity: .75 },
  { name: "Black", color: "#24252a" },
  { name: "Gold", color: "#c7a876", metalness: .22 },
  { name: "Milky Pink", color: "#f3b9cc", opacity: .72 },
];

const STORAGE_KEY = "totem.console-skins.v1";

const GBC_SKINS = [
  { name: "Original" },
  { name: "Pokémon Pikachu" },
  { name: "Berry", color: "#bd3760" },
  { name: "Grape", color: "#654496" },
  { name: "Kiwi", color: "#a1c63f" },
  { name: "Dandelion", color: "#f3c530" },
  { name: "Teal", color: "#159b96" },
  { name: "Atomic Purple", color: "#967bbb", opacity: .71 },
  { name: "Clear", color: "#e6e3e0", opacity: .48 },
  { name: "Ice Blue", color: "#84c3dc", opacity: .59 },
  { name: "Midnight Blue", color: "#253e88", opacity: .76 },
  { name: "Clear Black", color: "#41404a", opacity: .72 },
];

function availableSkins(model, platformId) {
  if (platformId === "gba" && (model?.userData.skinMaterial || model?.userData.applyGameBoyAdvanceSkin)) return GBA_SKINS;
  if (platformId === "gbcolor" && model?.userData.applyGameBoyColorSkin) return GBC_SKINS;
  return [];
}

function selections(storage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

export function applyConsoleSkin(model, platformId, storage = globalThis.localStorage) {
  const skins = availableSkins(model, platformId);
  const skin = skins.find(({ name }) => name === selections(storage)[platformId]) ?? skins[0];
  if (!skin) return null;
  if (platformId === "gbcolor") {
    model.userData.applyGameBoyColorSkin(skin);
    return skin.name;
  }
  if (model.userData.applyGameBoyAdvanceSkin) {
    model.userData.applyGameBoyAdvanceSkin(skin);
    return skin.name;
  }
  const shell = model?.userData.skinMaterial;
  shell.color.set(skin.color);
  shell.metalness = skin.metalness ?? 0;
  shell.opacity = skin.opacity ?? 1;
  const translucent = shell.opacity < 1;
  if (shell.transparent !== translucent) {
    shell.transparent = translucent;
    shell.depthWrite = !translucent;
    shell.needsUpdate = true;
  }
  shell.roughness = translucent ? .43 : .64;
  return skin.name;
}

export function watchConsoleSkins(refresh) {
  window.addEventListener("storage", event => {
    if (event.key === STORAGE_KEY || event.key === null) refresh();
  });
}

export function canCycleConsoleSkin(model, platformId) {
  return availableSkins(model, platformId).length > 1;
}

export function cycleConsoleSkin(model, platformId, storage = localStorage) {
  const skins = availableSkins(model, platformId);
  if (skins.length < 2) return null;
  const saved = selections(storage);
  const current = skins.findIndex(({ name }) => name === saved[platformId]);
  const next = skins[((current < 0 ? 0 : current) + 1) % skins.length];
  storage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, [platformId]: next.name }));
  return applyConsoleSkin(model, platformId, storage);
}
