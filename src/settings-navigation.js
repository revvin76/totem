import { appControllerAction } from "./app-controller-mappings.js";

const iconPaths = {
  readiness: "M12 3 2 8l10 5 10-5z M2 12l10 5 10-5 M2 16l10 5 10-5",
  platforms: "M7 6h10c3 0 5 5 5 9 0 4-3 4-6 0H8c-3 4-6 4-6 0 0-4 2-9 5-9z M7 8v5 M5 10.5h4 M16 10h.1 M19 12h.1",
  general: "M4 7h5m4 0h7M4 12h10m4 0h2M4 17h2m4 0h10M9 5v4m5 1v4m-8 1v4",
};

export function settingsIcon(key) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  const path = document.createElementNS(namespace, "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  path.setAttribute("d", iconPaths[key]);
  svg.append(path);
  return svg;
}

const directions = {
  up: "up", down: "down", left: "left", right: "right",
  "stick-leftward": "left", "stick-rightward": "right",
  "left-stick-up": "up", "left-stick-down": "down",
};

/**
 * @typedef {Object} SettingsLocation
 * @property {string} section
 * @property {string} [platformId]
 * @property {string} [tab]
 * @property {string} [gameId]
 * @property {string} [emulatorId]
 * @property {string} [checkId]
 * @property {string} [target] Control ID to focus on entry.
 * @property {string} [focusKey] Stable key to restore on return.
 * @property {number[]} [scroll]
 *
 * @typedef {{ origin: SettingsLocation, destination: SettingsLocation }} SettingsRoute
 */

export function settingsControllerAction(input, mappedAction = appControllerAction) {
  const platform = mappedAction("platform", input);
  const action = platform === "none" ? mappedAction("game", input) : platform;
  if (action === "escape") return "back";
  if (action === "select" || action === "enter") return "confirm";
  return Object.hasOwn(directions, input) ? directions[input] : null;
}

export function nextSettingsOption(select, direction) {
  const step = direction === "left" || direction === "up" ? -1 : 1;
  for (let index = select.selectedIndex + step; index >= 0 && index < select.options.length; index += step) {
    const option = select.options[index];
    if (!option.disabled && !option.hidden && !option.parentElement?.disabled && !option.parentElement?.hidden) return index;
  }
  return select.selectedIndex;
}

const artworkCoverage = {
  section: "providers", target: "admin-providers-title", label: "Open Artwork Providers",
  note: "Provider settings affect future lookups. Missing artwork must be corrected for the individual game.",
};
const readinessTargets = {
  "platform-logo": { section: "platforms", tab: "logo", target: "editor-logo-input", label: "Open Platform Logo" },
  "model-availability": { section: "platforms", tab: "console", target: "editor-model-input", label: "Open Console Model" },
  "front-covers": artworkCoverage,
  "back-covers": artworkCoverage,
  "clear-logos": artworkCoverage,
  "release-year": { note: "The platform editor has no release-year field." },
  "rail-artwork": { note: "This is the read-only evidence for the rail button asset. Settings has no rail image editor." },
  "controller-model": { note: "The renderer generates the controller model from its platform profile. Controller mappings change input, and cannot repair the model." },
  "media-model": { note: "The renderer generates media models. Settings has no editor for this asset." },
  "insertion-animation": { note: "This check verifies a runtime insertion route. Model animation tools cannot change that route." },
  "video-files": { note: "This check verifies default clip availability. Video display controls placement, and cannot add or repair the clip." },
};

export function readinessTarget(checkId) {
  return Object.hasOwn(readinessTargets, checkId) ? readinessTargets[checkId] : {
    note: "There is no direct editor for this check.",
  };
}

// The caller owns the draft, its save result and the requested continuation.
export function confirmEditorLeave({ title, save, discard, leave }) {
  const opener = document.activeElement;
  const prompt = document.createElement("dialog");
  prompt.className = "admin-shell settings-leave-dialog";
  const heading = document.createElement("h2");
  heading.id = "settings-leave-title";
  heading.textContent = title;
  prompt.setAttribute("aria-labelledby", heading.id);
  const actions = document.createElement("div");
  actions.className = "admin-emulator-actions";
  function add(label, run) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", run);
    actions.append(button);
    return button;
  }
  add("Save changes", async () => {
    prompt.close();
    if (await save()) leave();
    else if (document.activeElement === document.body) opener?.focus();
  });
  add("Discard changes", () => {
    prompt.close();
    discard?.();
    leave();
  });
  const keep = add("Keep editing", () => prompt.close());
  prompt.append(heading, actions);
  prompt.addEventListener("close", () => {
    prompt.remove();
    if (document.activeElement === document.body && opener?.getClientRects().length && !opener.disabled) opener.focus();
  }, { once: true });
  document.body.append(prompt);
  prompt.showModal();
  keep.focus();
}
