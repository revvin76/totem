import { DEMO_SYSTEMS } from "./collection.js";

export function matchingSystems(catalogue, enabled, { query = "", kind = "all", status = "all" } = {}) {
  query = query.trim().toLowerCase();
  return catalogue.filter((p) => (kind === "all" || p.kind === kind)
    && (status === "all" || enabled.has(p.id) === (status === "enabled"))
    && `${p.name} ${p.maker} ${p.id}`.toLowerCase().includes(query));
}
export function updateFilteredSystems(enabled, shown, checked) {
  const next = new Set(enabled);
  for (const platform of shown) checked ? next.add(platform.id) : next.delete(platform.id);
  return next;
}

export function mountSystemPicker(catalogue, enabledIds, onChange) {
  let enabled = new Set(enabledIds);
  const search = document.getElementById("system-search");
  const kind = document.getElementById("system-kind");
  const statusFilter = document.createElement("select"); statusFilter.id = "system-enabled-filter";
  const statusLabel = document.createElement("label"); statusLabel.htmlFor = statusFilter.id; statusLabel.textContent = "System status";
  for (const [text, value] of [["All systems", "all"], ["Enabled", "enabled"], ["Disabled", "disabled"]]) statusFilter.add(new Option(text, value));
  kind.after(statusLabel, statusFilter);
  const shownSystems = () => matchingSystems(sorted, enabled, { query: search.value, kind: kind.value, status: statusFilter.value });
  const list = document.getElementById("system-checklist");
  let sorted = [...catalogue].sort(
    (a, b) => a.maker.localeCompare(b.maker) || a.name.localeCompare(b.name),
  );
  function draw() {
    const focusedId = document.activeElement?.dataset.platform;
    const shown = shownSystems();
    document.getElementById("system-count").textContent =
      `${enabled.size} / ${catalogue.length} enabled · ${shown.length} shown`;
    list.replaceChildren();
    if (!shown.length) {
      const text = document.createElement("p");
      text.textContent = "No systems match this search.";
      list.append(text);
    }
    for (const p of shown) {
      const row = document.createElement("label");
      row.className = "system-check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = enabled.has(p.id);
      input.setAttribute("aria-label", `Show ${p.maker} ${p.name}`);
      input.dataset.platform = p.id;
      input.addEventListener("change", () => {
        if (input.checked) enabled.add(p.id);
        else enabled.delete(p.id);
        draw();
        onChange(catalogue.filter((p) => enabled.has(p.id)).map((p) => p.id));
      });
      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = p.name;
      const meta = document.createElement("small");
      meta.textContent = `${p.maker} · ${p.kind} · 3D PoC`;
      row.title = p.coverage;
      text.append(name, meta);
      row.append(input, text);
      list.append(row);
    }
    if (focusedId)
      [...list.querySelectorAll("input")]
        .find((input) => input.dataset.platform === focusedId)
        ?.focus({ preventScroll: true });
  }
  search.addEventListener("input", draw);
  kind.addEventListener("change", draw);
  statusFilter.addEventListener("change", draw);
  document.getElementById("systems-all").textContent = "Enable all filtered";
  document.getElementById("systems-none").textContent = "Disable all filtered";
  for (const [id, values] of [
    ["systems-all", () => [...updateFilteredSystems(enabled, shownSystems(), true)]],
    ["systems-none", () => [...updateFilteredSystems(enabled, shownSystems(), false)]],
    [
      "systems-demo",
      () => DEMO_SYSTEMS.filter((id) => catalogue.some((p) => p.id === id)),
    ],
  ])
    document.getElementById(id).addEventListener("click", () => {
      enabled = new Set(values());
      draw();
      onChange([...enabled]);
    });
  draw();
  return {
    refresh(ids) {
      enabled = new Set(ids);
      draw();
    },
    setCatalogue(next) {
      catalogue = next;
      sorted = [...next].sort(
        (a, b) =>
          a.maker.localeCompare(b.maker) || a.name.localeCompare(b.name),
      );
      draw();
    },
  };
}
