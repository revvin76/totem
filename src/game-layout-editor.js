const fields = [
  ["scale", "Scale", 0.25, 2, 0.05, 1],
  ["x", "Horizontal offset", -10, 10, 0.1, 0],
  ["y", "Vertical offset", -8, 10, 0.1, 0],
  ["z", "Depth offset", -10, 10, 0.1, 0],
  ["pitch", "Pitch (°)", -180, 180, 1, 0],
  ["yaw", "Yaw (°)", -180, 180, 1, 0],
  ["roll", "Roll (°)", -180, 180, 1, 0],
];
const neutral = Object.fromEntries(fields.map(([key,,,,, value]) => [key, value]));
const storageKey = "totem.game-selection.layout.v1";

export function platformLayout(pose = {}) {
  const { zoom = 0.72, y = -1.8, ...offsets } = pose;
  return { ...neutral, ...offsets, scale: zoom / 0.72, y: y + 1.8 };
}

export function mountGameLayoutEditor({ getPlatform, savePlatform, onChange }) {
  const form = document.getElementById("game-layout-editor");
  const toggle = document.getElementById("game-layout-toggle");
  const scope = form.elements.scope;
  const status = form.querySelector("output");
  let defaults = {};
  let draft = null;
  let saving = false;
  try { defaults = JSON.parse(localStorage.getItem(storageKey)) ?? {}; } catch { /* Use shipped defaults. */ }

  const inputs = new Map(fields.map(([key, caption, min, max, step]) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "number"; input.name = key; input.min = min; input.max = max;
    input.step = "any"; input.required = true;
    input.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const next = input.valueAsNumber + (event.key === "ArrowUp" ? step : -step);
      input.value = String(Math.max(Number(input.min), Math.min(Number(input.max), Math.round(next * 100) / 100)));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    label.append(caption, input);
    form.querySelector(".game-layout-fields").append(label);
    return [key, input];
  }));

  function displayValues(values) {
    for (const [key, input] of inputs) input.value = values[key];
  }

  function refresh() {
    const platform = getPlatform();
    const option = scope.querySelector('[value="platform"]');
    option.disabled = !platform || platform.kind === "arcade";
    option.textContent = option.disabled ? "Platform console" : `${platform.name} console offset`;
    if (scope.value === "platform" && option.disabled) scope.value = "console";
    const platformScope = scope.value === "platform";
    inputs.get("scale").min = platformScope ? 0.1 / 0.72 : 0.25;
    inputs.get("scale").max = platformScope ? 2 / 0.72 : 2;
    inputs.get("y").min = platformScope ? -8.2 : -8;
    inputs.get("y").max = platformScope ? 11.8 : 10;
    const saved = platformScope ? platformLayout(platform.libraryPresentation?.pose) : defaults[scope.value];
    displayValues({ ...neutral, ...saved });
    draft = null;
    status.textContent = "";
    onChange();
  }

  function close(focus = false) {
    draft = null;
    form.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    onChange();
    if (focus) toggle.focus();
  }

  toggle.addEventListener("click", () => {
    if (!form.hidden) { close(true); return; }
    form.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    refresh();
    scope.focus();
  });
  scope.addEventListener("change", refresh);
  form.addEventListener("input", (event) => {
    if (event.target === scope || !form.checkValidity()) return;
    draft = { scope: scope.value, values: Object.fromEntries([...inputs].map(([key, input]) => [key, input.valueAsNumber])) };
    status.textContent = "Previewing unsaved changes.";
    onChange();
  });
  form.querySelector('[data-action="reset"]').addEventListener("click", () => {
    displayValues(neutral);
    form.dispatchEvent(new Event("input"));
  });
  form.querySelector('[data-action="cancel"]').addEventListener("click", () => close(true));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!draft || saving) return;
    const { scope: target, values } = draft;
    const fieldset = form.querySelector("fieldset");
    saving = fieldset.disabled = true;
    try {
      if (target === "platform") {
        const platform = getPlatform();
        const { scale, y, ...offsets } = values;
        await savePlatform({
          ...platform,
          libraryPresentation: {
            display: platform.kind === "handheld" ? "built-in" : "tv",
            screenMesh: "",
            ...platform.libraryPresentation,
            pose: { ...offsets, zoom: Math.max(0.1, Math.min(2, scale * 0.72)), y: Math.max(-10, Math.min(10, y - 1.8)) },
          },
        });
      } else {
        const next = { ...defaults, [target]: values };
        localStorage.setItem(storageKey, JSON.stringify(next));
        defaults = next;
      }
      if (!form.hidden) {
        refresh();
        status.textContent = "Layout saved.";
      }
    } catch (error) {
      status.textContent = `Could not save layout. ${error.message ?? error}`;
    } finally {
      saving = fieldset.disabled = false;
    }
  });

  return {
    close,
    isOpen: () => !form.hidden,
    values: (target, fallback = defaults[target]) => ({
      ...neutral, ...(draft?.scope === target ? draft.values : fallback),
    }),
  };
}
