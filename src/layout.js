import definitions from "../layout-controls.json" with { type: "json" };
import { Euler, Quaternion, Vector3 } from "three";
import { LEGACY_SYSTEMS, validateEnabledSystems } from "./collection.js";
import aliases from "../platform-aliases.json" with { type: "json" };

export const CONTROL_DEFINITIONS = definitions;
export const DRAFT_KEY = "horizon.carousel.layout.draft.v3";
export const DEFAULT_LAYOUT = Object.freeze(
  Object.fromEntries(
    Object.entries(definitions).map(([group, controls]) => [
      group,
      Object.freeze(
        Object.fromEntries(
          controls.map((control) => [control.key, control.default]),
        ),
      ),
    ]),
  ),
);

export function defaultLayout() {
  return structuredClone(DEFAULT_LAYOUT);
}

// Validate everything before applying anything, including imported drafts.
export function validateLayout(value) {
  const keys = value && typeof value === "object" ? Object.keys(value).sort() : [];
  const expected = Object.keys(definitions).sort();
  const legacy = keys.length === 2 && keys[0] === "consoles" && keys[1] === "orbit";
  if (!legacy && (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])))
    throw new Error("Layout must contain orbit, active, and inactive controls.");
  const result = {};
  for (const [group, controls] of Object.entries(definitions)) {
    const values = value[group] ?? (group === "inactive" ? DEFAULT_LAYOUT.inactive : null);
    if (
      !values ||
      typeof values !== "object" ||
      Object.keys(values).length !== controls.length
    )
      throw new Error(`Incomplete ${group} settings.`);
    result[group] = {};
    for (const control of controls) {
      const number = values[control.key];
      const steps = (number - control.min) / control.step;
      if (
        typeof number !== "number" ||
        !Number.isFinite(number) ||
        number < control.min ||
        number > control.max ||
        Math.abs(steps - Math.round(steps)) > 1e-6
      )
        throw new Error(`Invalid ${group} ${control.label} value.`);
      result[group][control.key] = number;
    }
  }
  return result;
}

export function parseLayoutSnapshot(text, platformIds) {
  if (text.length > 65536) throw new Error("Layout file is too large.");
  const value = JSON.parse(text);
  if (![1, 2, 3, 4, 5].includes(value?.schemaVersion))
    throw new Error("Unsupported layout snapshot version.");
  const knownIds = [
    ...platformIds,
    ...Object.keys(aliases).filter((id) => platformIds.includes(aliases[id])),
  ];
  const canonicalId = (id) => aliases[id] ?? id;
  const enabled =
    value.schemaVersion === 1
      ? [
          ...new Set([
            ...LEGACY_SYSTEMS.filter((id) => platformIds.includes(id)),
            value.selectedPlatform,
          ]),
        ]
      : value.enabledPlatformIds;
  validateEnabledSystems(enabled, knownIds, value.selectedPlatform);
  const overrides = validateDeviceOverrides(
    value.schemaVersion >= 3 ? value.deviceOverrides : {},
    knownIds,
  );
  // Prefer an explicit retained-device pose, then the selected old variant's
  // pose, when several old entries consolidate into one platform.
  const priority = (id) =>
    platformIds.includes(id) ? 2 : id === value.selectedPlatform ? 1 : 0;
  const deviceOverrides = {};
  for (const [id, controls] of Object.entries(overrides).sort(
    ([a], [b]) => priority(b) - priority(a),
  ))
    deviceOverrides[canonicalId(id)] ??= controls;
  const inactiveOverrides = validateDeviceOverrides(
    value.schemaVersion >= 5 ? value.inactiveDeviceOverrides : {},
    knownIds,
  );
  const inactiveDeviceOverrides = {};
  for (const [id, controls] of Object.entries(inactiveOverrides).sort(
    ([a], [b]) => priority(b) - priority(a),
  ))
    inactiveDeviceOverrides[canonicalId(id)] ??= controls;
  const openWhenActive = {};
  if (value.schemaVersion >= 5) {
    if (!value.openWhenActive || typeof value.openWhenActive !== "object" || Array.isArray(value.openWhenActive))
      throw new Error("Open-when-active settings must be an object.");
    for (const [id, open] of Object.entries(value.openWhenActive).sort(
      ([a], [b]) => priority(b) - priority(a),
    )) {
      if (!knownIds.includes(id) || typeof open !== "boolean")
        throw new Error("Invalid open-when-active setting.");
      openWhenActive[canonicalId(id)] = open;
    }
  }
  return {
    ...value,
    selectedPlatform: canonicalId(value.selectedPlatform),
    layout: validateLayout(value.layout),
    deviceOverrides,
    inactiveDeviceOverrides,
    openWhenActive,
    enabledPlatformIds: validateEnabledSystems(
      [...new Set(enabled.map(canonicalId))],
      platformIds,
      canonicalId(value.selectedPlatform),
    ),
  };
}

export function makeLayoutSnapshot(
  layout,
  selectedPlatform,
  view = {},
  enabledPlatformIds = selectedPlatform === null ? [] : [selectedPlatform],
  deviceOverrides = {},
  inactiveDeviceOverrides = {},
  openWhenActive = {},
) {
  return {
    schemaVersion: 5,
    createdAt: new Date().toISOString(),
    selectedPlatform,
    enabledPlatformIds: [...enabledPlatformIds],
    layout: validateLayout(layout),
    deviceOverrides: structuredClone(deviceOverrides),
    inactiveDeviceOverrides: structuredClone(inactiveDeviceOverrides),
    openWhenActive: structuredClone(openWhenActive),
    view: structuredClone(view),
  };
}

export function platformSceneLayout({ layout, deviceOverrides, inactiveDeviceOverrides, openWhenActive }) {
  return structuredClone({ layout, deviceOverrides, inactiveDeviceOverrides, openWhenActive });
}

export function readPlatformSceneLayout(document, platformIds) {
  const saved = document.pages?.platformChooser?.sceneLayout;
  if (!saved) return null;
  const snapshot = parseLayoutSnapshot(JSON.stringify({
    ...saved, schemaVersion: 5, selectedPlatform: null, enabledPlatformIds: [],
  }), platformIds);
  return platformSceneLayout(snapshot);
}

// Console offsets are in camera axes, independent of both orbit tilt and pose.
export function applyConsoleControls(
  model,
  controls,
  cameraOrientation,
  focusScale,
) {
  model.position.add(
    new Vector3(controls.panX, controls.panY, controls.panZ).applyQuaternion(
      cameraOrientation,
    ),
  );
  model.quaternion.multiply(
    new Quaternion().setFromEuler(
      new Euler(
        (controls.pitch * Math.PI) / 180,
        (controls.yaw * Math.PI) / 180,
        (controls.roll * Math.PI) / 180,
        "XYZ",
      ),
    ),
  );
  model.scale.setScalar(controls.zoom * focusScale);
}

// Device transforms add camera-axis offsets, local rotation and a size multiplier
// after the shared pose. They never mutate another device or the orbit settings.
export function neutralDeviceControls() {
  return { zoom: 1, panX: 0, panY: 0, panZ: 0, pitch: 0, yaw: 0, roll: 0 };
}
export function validateDeviceOverrides(value, platformIds) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Device overrides must be an object.");
  const result = {};
  for (const [id, controls] of Object.entries(value)) {
    if (!platformIds.includes(id)) throw new Error("Unknown device override.");
    result[id] = validateLayout({
      orbit: defaultLayout().orbit,
      consoles: controls,
    }).consoles;
  }
  return result;
}
export function applyDeviceControls(model, controls, cameraOrientation) {
  if (!controls) return;
  const scale = model.scale.x;
  applyConsoleControls(model, controls, cameraOrientation, scale);
}
