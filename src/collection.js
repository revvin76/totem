export const LEGACY_SYSTEMS = Object.freeze([
  "gameboy",
  "nes",
  "megadrive",
  "playstation",
  "gamecube",
  "xbox",
  "wii",
]);
export const DEMO_SYSTEMS = Object.freeze([...LEGACY_SYSTEMS, "arcade"]);

export function visiblePlatforms(catalogue, enabledIds) {
  const enabled = new Set(enabledIds);
  return catalogue.filter((platform) => enabled.has(platform.id));
}

export function survivingSelection(previousIds, nextIds, selectedId) {
  if (!nextIds.length) return null;
  if (nextIds.includes(selectedId)) return selectedId;
  const start = Math.max(0, previousIds.indexOf(selectedId));
  for (let offset = 1; offset <= previousIds.length; offset++) {
    const candidate = previousIds[(start + offset) % previousIds.length];
    if (nextIds.includes(candidate)) return candidate;
  }
  return nextIds[0];
}

export function slotAngle(index, currentSlot, count) {
  return count > 0 ? ((index - currentSlot) * Math.PI * 2) / count : 0;
}

export function nearbyAngle(current, target) {
  return (
    current + Math.atan2(Math.sin(target - current), Math.cos(target - current))
  );
}

export function validateEnabledSystems(ids, catalogueIds, selectedId) {
  if (
    !Array.isArray(ids) ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string" || !catalogueIds.includes(id))
  )
    throw new Error("Enabled systems must be unique known platform IDs.");
  if (ids.length ? !ids.includes(selectedId) : selectedId !== null)
    throw new Error("Selected platform must belong to the enabled systems.");
  return [...ids];
}
