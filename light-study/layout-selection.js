// Moving a selected parent already moves its selected descendants.
export function selectionRoots(selection, records) {
  const selected = new Set(selection);
  return [...selected].filter(id => records.some(record => record.id === id && !record.ancestors.some(parent => selected.has(parent))));
}
export function offsetSelection(elements, origins, dx, dy) {
  for (const [id, origin] of Object.entries(origins)) {
    const design = elements[id] ||= {};
    if (!origin.lockX) design.x = origin.x + dx;
    design.y = origin.y + dy;
  }
}
