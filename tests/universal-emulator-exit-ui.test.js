import assert from "node:assert/strict";
import { test } from "node:test";
import { mountEmulatorExitSettings } from "../src/universal-emulator-exit-ui.js";

class Element extends EventTarget {
  children = [];
  options = [];
  selectedIndex = 0;
  setAttribute() {}
  append(...children) { this.children.push(...children); }
  add(option) { this.options.push(option); }
  get length() { return this.options.length; }
  get value() { return this.options[this.selectedIndex]?.value; }
  set value(value) { this.selectedIndex = this.options.findIndex(option => option.value === String(value)); }
}

test("Gameplay settings load defaults, accept controller Confirm and save through the desktop bridge", async t => {
  let saved;
  const settings = {
    enabled: false, shortcut: "bumpersBackStart", holdMs: 1500,
    method: "auto", controllerSlot: null,
  };
  const calls = [];
  const globals = {
    isTauri: true,
    document: { createElement: () => new Element() },
    navigator: { userAgent: "Windows NT" },
    Option: class {
      constructor(text, value) { this.text = text; this.value = String(value); }
    },
    window: { __TAURI_INTERNALS__: { async invoke(command, args) {
      calls.push({ command, args });
      if (command === "load_emulator_exit_settings") return saved ?? { revision: null, settings };
      saved = { revision: "saved", settings: args.settings };
      return saved;
    } } },
  };
  for (const [key, value] of Object.entries(globals)) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => old ? Object.defineProperty(globalThis, key, old) : delete globalThis[key]);
  }
  const panel = new Element();
  const { reload } = mountEmulatorExitSettings(panel);
  const [, , fields, save] = panel.children;
  const [enabled, shortcut, hold, method, slot] = fields.children.map(label => label.children[1]);
  assert.equal(save.disabled, true);
  await reload();
  assert.equal(enabled.checked, false);
  assert.equal(hold.value, "1500");
  assert.equal(save.disabled, false);
  enabled.checked = true;
  shortcut.dispatchEvent(new Event("click"));
  assert.equal(shortcut.value, "backStart");
  shortcut.value = "bumpersTriggers";
  hold.dispatchEvent(new Event("click"));
  method.value = "wmClose";
  slot.value = "2";
  save.dispatchEvent(new Event("click"));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), {
    command: "save_emulator_exit_settings",
    args: {
      expectedRevision: null,
      settings: { enabled: true, shortcut: "bumpersTriggers", holdMs: 2000, method: "wmClose", controllerSlot: 2 },
    },
  });
  await reload();
  assert.equal(enabled.checked, true);
  assert.equal(shortcut.value, "bumpersTriggers");
  assert.equal(slot.value, "2");
});
