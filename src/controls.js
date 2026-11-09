import {
  CONTROL_DEFINITIONS,
  DEFAULT_LAYOUT,
  neutralDeviceControls,
} from "./layout.js";
import { supportsDynamicHinge } from "./hardware-profiles.js";

export function createLayoutControl(id, control, accessibleLabel, getValue, onChange) {
  const row = document.createElement("div");
  row.className = "layout-control";
  const heading = document.createElement("div");
  heading.className = "control-heading";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = control.label;
  const value = document.createElement("div");
  value.className = "control-value";
  const number = document.createElement("input");
  number.type = "number";
  number.setAttribute("aria-label", `${accessibleLabel} value`);
  const unit = document.createElement("span");
  unit.textContent = control.unit;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = id;
  slider.setAttribute("aria-label", accessibleLabel);
  for (const input of [number, slider]) {
    input.min = control.min;
    input.max = control.max;
    input.step = control.step;
    input.value = getValue();
  }
  function update(input) {
    if (input.value === "" || !input.checkValidity()) return;
    const next = input.valueAsNumber;
    if (!Number.isFinite(next)) return;
    number.value = slider.value = next;
    onChange(next);
  }
  slider.addEventListener("input", () => update(slider));
  number.addEventListener("input", () => update(number));
  number.addEventListener("blur", () => {
    number.value = getValue();
  });
  value.append(number, unit);
  heading.append(label, value);
  row.append(heading, slider);
  return { row, number, slider };
}

export function mountLayoutControls(
  layout,
  onChange,
  baseline = DEFAULT_LAYOUT,
  deviceDefaults = {},
  inactiveDeviceDefaults = {},
  openWhenActive = {},
) {
  let device = null;
  let deviceValues = neutralDeviceControls();
  let inactiveDeviceValues = neutralDeviceControls();
  let deviceOpenSettings = openWhenActive;
  const values = (group) =>
    group === "device-active"
      ? deviceValues
      : group === "device-inactive"
        ? inactiveDeviceValues
        : layout[group];
  const fields = [];
  for (const [group, controls] of Object.entries({
    ...CONTROL_DEFINITIONS,
    "device-active": CONTROL_DEFINITIONS.consoles,
    "device-inactive": CONTROL_DEFINITIONS.consoles,
  })) {
    const panelId = group.startsWith("device-")
      ? `${group}-control-fields`
      : `${group}-controls`;
    const panel = document.getElementById(panelId);
    for (const control of controls) {
      const id = `${group}-${control.key}`;
      const { row, number, slider } = createLayoutControl(id, control, `${group} ${control.label}`,
        () => values(group)[control.key], next => {
          values(group)[control.key] = next;
          onChange();
        });
      panel.append(row);
      fields.push({ group, key: control.key, number, slider });
    }
    const reset = document.createElement("button");
    reset.className = "reset";
    const groupLabel =
      group === "consoles"
        ? "active rest"
        : group === "inactive"
          ? "inactive rest"
          : group === "device-active"
            ? "device active offsets"
            : group === "device-inactive"
              ? "device inactive offsets"
              : group;
    reset.textContent = `Reset ${groupLabel}`;
    reset.addEventListener("click", () => {
      Object.assign(
        values(group),
        group === "device"
          ? (deviceDefaults[device?.id] ?? neutralDeviceControls())
          : baseline[group],
      );
      refresh();
      onChange();
    });
    panel.append(reset);
  }
  for (const button of document.querySelectorAll("[data-control-group]")) {
    button.addEventListener("click", () => {
      for (const candidate of document.querySelectorAll(
        "[data-control-group]",
      )) {
        const active = candidate === button;
        candidate.setAttribute("aria-pressed", String(active));
        document.getElementById(
          `${candidate.dataset.controlGroup}-controls`,
        ).hidden = !active;
      }
    });
  }
  for (const button of document.querySelectorAll("[data-device-pose]")) {
    button.addEventListener("click", () => {
      for (const candidate of document.querySelectorAll("[data-device-pose]")) {
        const active = candidate === button;
        candidate.setAttribute("aria-pressed", String(active));
        document.getElementById(
          `device-${candidate.dataset.devicePose}-control-fields`,
        ).hidden = !active;
      }
    });
  }
  const openRow = document.getElementById("device-open-active-row");
  const openCheckbox = document.getElementById("device-open-active");
  openCheckbox.addEventListener("change", () => {
    if (!device) return;
    deviceOpenSettings[device.id] = openCheckbox.checked;
    onChange();
  });
  function refresh() {
    for (const field of fields)
      field.number.value = field.slider.value = values(field.group)[field.key];
  }
  return {
    refresh,
    selectDevice(platform, overrides, inactiveOverrides, openSettings) {
      device = platform;
      deviceOpenSettings = openSettings;
      if (platform) {
        overrides[platform.id] ??= neutralDeviceControls();
        deviceValues = overrides[platform.id];
        inactiveOverrides[platform.id] ??= neutralDeviceControls();
        inactiveDeviceValues = inactiveOverrides[platform.id];
        if (supportsDynamicHinge(platform)) openSettings[platform.id] ??= true;
      } else {
        deviceValues = neutralDeviceControls();
        inactiveDeviceValues = neutralDeviceControls();
      }
      document.getElementById("device-name").textContent = platform
        ? `Editing ${platform.maker} ${platform.name}`
        : "Select a device to adjust it.";
      const canOpen = supportsDynamicHinge(platform);
      openRow.hidden = !canOpen;
      openCheckbox.checked = canOpen ? (openSettings[platform.id] ?? true) : false;
      for (const input of document.querySelectorAll(
        "#device-controls input, #device-controls button",
      ))
        input.disabled = !platform;
      openCheckbox.disabled = !canOpen;
      refresh();
    },
  };
}
