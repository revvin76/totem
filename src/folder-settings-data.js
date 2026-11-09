// The import manifest retains PowerShell singleton values. Normalize its read
// projection, leaving the manifest and saved folder configuration untouched.
export function normalizeFolderCollections(records) {
  if (!Array.isArray(records)) throw new Error("Collection manifest must contain a collection list.");
  return records.map((record) => {
    const extensions = record.extensions == null ? [] : Array.isArray(record.extensions) ? record.extensions : [record.extensions];
    if (!extensions.every((value) => typeof value === "string")) throw new Error(`Invalid extensions for ${record.name ?? record.id}.`);
    const roots = record.gameRoots == null ? [] : Array.isArray(record.gameRoots) ? record.gameRoots : [record.gameRoots];
    if (!roots.every((value) => value && typeof value.path === "string")) throw new Error(`Invalid game folders for ${record.name ?? record.id}.`);
    return { ...record, extensions: extensions.flatMap((value) => value.split(/[,;\s]+/)).filter(Boolean), gameRoots: roots };
  });
}

export function preserveUnlistedPlatforms(selected, saved, listed) {
  const known = new Set(listed);
  return [...new Set([...selected, ...saved.filter((id) => !known.has(id))])];
}
