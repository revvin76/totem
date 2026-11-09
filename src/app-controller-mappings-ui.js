import { controllerIcon } from "./bottom-nav.js";
import {
  actionBindings, controllerActionDescription, controllerInputs, launcherActions, withActionMapping,
} from "./app-controller-mappings.js";
import { keyboardGlyph, keyboardInputs } from "./keyboard-inputs.js";
import "./app-controller-mappings.css";

const devices = {
  xbox: { label: "Xbox", inputs: controllerInputs.map(({ id, label }) => [id, label]), glyph: id => {
    const input = controllerInputs.find(input => input.id === id);
    return controllerIcon(input?.icon);
  } },
  keyboard: { label: "Keyboard", inputs: [...keyboardInputs], glyph: keyboardGlyph },
};

export function mountAppControllerMappings(panel, { read, save, apply }) {
  const content = panel.querySelector(".controller-settings-content");
  const settings = panel.closest("dialog");
  const hint = document.createElement("p");
  hint.textContent = "Assign Xbox inputs and keyboard keys for Totem. Choose Auto to capture the next input. Changes save immediately.";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const table = document.createElement("table");
  table.className = "controller-settings-table";
  table.createCaption().textContent = "Launcher input assignments";
  const header = table.createTHead().insertRow();
  for (const title of ["Action", "Xbox", "Keyboard", "Auto"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = title;
    header.append(cell);
  }
  const body = table.createTBody();
  content.append(hint, status, table);
  let capture;

  async function assign(action, device, input, focus) {
    for (const control of body.querySelectorAll("select, button")) control.disabled = true;
    status.textContent = "Saving…";
    try {
      const current = await read();
      apply(await save(withActionMapping(current, device, action, input), current.revision));
      status.textContent = `${launcherActions[action]} mapping saved.`;
    } catch (error) {
      status.textContent = `Could not save ${launcherActions[action]}. ${error}`;
    } finally {
      render();
      body.querySelector(`[data-action="${action}"][data-device="${focus}"]`)?.focus();
    }
  }

  function cancelCapture() {
    if (!capture) return;
    capture.button.textContent = "Auto";
    capture.button.setAttribute("aria-pressed", "false");
    capture = null;
    status.textContent = "";
  }

  function acceptInput(device, input, event) {
    if (!capture || !settings?.open || !capture.button.getClientRects().length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const { action } = capture;
    cancelCapture();
    void assign(action, device, input, "auto");
  }

  window.addEventListener("keydown", event => {
    if (!event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && keyboardInputs.has(event.code)) {
      acceptInput("keyboard", event.code, event);
    }
  }, true);
  settings?.addEventListener("totem:settings-controller", event => acceptInput("xbox", event.detail, event), true);
  settings?.addEventListener("close", cancelCapture);

  function render() {
    cancelCapture();
    body.replaceChildren();
    for (const [action, title] of Object.entries(launcherActions)) {
      const row = body.insertRow();
      const name = document.createElement("th");
      name.scope = "row";
      const description = document.createElement("small");
      description.textContent = controllerActionDescription("game", action);
      name.append(title, description);
      row.append(name);
      for (const [device, { label, inputs, glyph }] of Object.entries(devices)) {
        const [primary, ...also] = actionBindings(device, action);
        const select = document.createElement("select");
        select.dataset.action = action;
        select.dataset.device = device;
        select.setAttribute("aria-label", `${title} ${label} input`);
        select.add(new Option("Unassigned", ""));
        for (const [id, name] of inputs) select.add(new Option(name, id));
        select.value = primary ?? "";
        const cell = row.insertCell();
        cell.append(select);
        const source = glyph(primary);
        if (source) {
          const image = document.createElement("img");
          image.src = source;
          image.alt = "";
          cell.append(image);
        }
        if (also.length) {
          const extra = document.createElement("small");
          const labels = new Map(inputs);
          extra.textContent = `Also: ${also.map(input => labels.get(input)).join(", ")}`;
          cell.append(extra);
        }
        select.addEventListener("change", () => {
          cancelCapture();
          void assign(action, device, select.value, device);
        });
      }
      const auto = document.createElement("button");
      auto.type = "button";
      auto.textContent = "Auto";
      auto.dataset.action = action;
      auto.dataset.device = "auto";
      auto.setAttribute("aria-label", `Detect input for ${title}`);
      auto.setAttribute("aria-pressed", "false");
      row.insertCell().append(auto);
      auto.addEventListener("click", () => {
        const wasListening = capture?.button === auto;
        cancelCapture();
        if (wasListening) return;
        capture = { action, button: auto };
        auto.textContent = "Cancel";
        auto.setAttribute("aria-pressed", "true");
        status.textContent = `Press an Xbox input or keyboard key for ${title}.`;
      });
    }
  }
  panel.addEventListener("toggle", () => {
    if (panel.open) render();
    else cancelCapture();
  });
  render();
}
