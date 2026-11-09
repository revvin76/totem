import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export const EMULATOR_EXIT_EVENT = "totem:emulator-exit-status";

export function observeEmulatorExit(onStatus) {
  if (!isTauri()) return;
  void getCurrentWebviewWindow().listen(EMULATOR_EXIT_EVENT, ({ payload }) => {
    onStatus(payload);
    window.dispatchEvent(new CustomEvent(EMULATOR_EXIT_EVENT, { detail: payload }));
  }).catch(error => console.warn("Could not listen for emulator exit status", error));
}

function choice(name, options) {
  const select = document.createElement("select");
  select.name = name;
  for (const [value, label] of options) select.add(new Option(label, value));
  // The fullscreen settings controller sends a synthetic click for Confirm.
  // Native clicks and key presses retain the standard select interaction.
  select.addEventListener("click", event => {
    if (!event.isTrusted) select.selectedIndex = (select.selectedIndex + 1) % select.length;
  });
  return select;
}

function label(text, control) {
  const node = document.createElement("label");
  node.append(text, control);
  return node;
}

export function mountEmulatorExitSettings(panel) {
  const title = document.createElement("h4");
  title.textContent = "Universal Emulator Exit";
  const help = document.createElement("p");
  help.textContent = "Windows XInput controllers only. With several connected controllers, assign the gameplay controller’s XInput slot. Gamepad Confirm cycles choices. Saved settings apply on the next launch.";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  const shortcut = choice("shortcut", [
    ["bumpersBackStart", "LB + RB + Select + Start"],
    ["backStart", "Select + Start"],
    ["stickClicks", "L3 + R3 + Start"],
    ["bumpersStickClicks", "LB + RB + L3 + R3"],
    ["bumpersTriggers", "LB + LT + RB + RT"],
  ]);
  const hold = choice("holdMs", [
    [500, "0.5 seconds"], [1000, "1.0 second"], [1500, "1.5 seconds"],
    [2000, "2.0 seconds"], [3000, "3.0 seconds"],
  ]);
  const method = choice("method", [
    ["auto", "Automatic (recommended)"], ["wmClose", "Windows close request"],
    ["altF4", "Alt+F4 fallback (requires emulator opt-in)"],
  ]);
  const slot = choice("controllerSlot", [
    ["", "Automatic (one connected controller)"],
    ...Array.from({ length: 4 }, (_, i) => [i, `XInput slot ${i + 1}`]),
  ]);
  const fields = document.createElement("div");
  fields.className = "admin-platform-options";
  fields.append(
    label("Enable Universal Emulator Exit", enabled), label("Exit shortcut", shortcut),
    label("Hold duration", hold), label("Exit method", method), label("Gameplay controller", slot),
  );
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save exit settings";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  panel.append(title, help, fields, save, status);
  const controls = [enabled, shortcut, hold, method, slot, save];
  let revision;
  let busy = false;
  function show(document) {
    revision = document.revision;
    enabled.checked = document.settings.enabled;
    shortcut.value = document.settings.shortcut;
    hold.value = String(document.settings.holdMs);
    method.value = document.settings.method;
    slot.value = document.settings.controllerSlot ?? "";
  }
  const setAvailable = available => controls.forEach(control => { control.disabled = !available; });
  setAvailable(false);
  async function reload() {
    if (busy) return;
    if (!isTauri() || !/Windows/i.test(navigator.userAgent)) {
      status.textContent = "Available in Totem for Windows.";
      return;
    }
    busy = true;
    status.textContent = "Loading exit settings…";
    setAvailable(false);
    try {
      show(await invoke("load_emulator_exit_settings"));
      status.textContent = "";
      setAvailable(true);
    } catch (error) {
      status.textContent = `Could not load exit settings. ${error.message ?? error}`;
    } finally {
      busy = false;
    }
  }
  save.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    const settings = {
      enabled: enabled.checked, shortcut: shortcut.value, holdMs: Number(hold.value),
      method: method.value, controllerSlot: slot.value === "" ? null : Number(slot.value),
    };
    try {
      const saved = await invoke("save_emulator_exit_settings", { settings, expectedRevision: revision });
      revision = saved.revision;
      status.textContent = "Saved. Changes apply to the next game launch.";
    } catch (error) {
      status.textContent = `Could not save exit settings. ${error.message ?? error}`;
    } finally {
      busy = false;
    }
  });
  return { reload };
}
