import { bottomNavOrder, bottomNavSide, platformBottomNavLabel, PLATFORM_NAV_ACTIONS } from "./studio-page-settings.js";
import { actionBindings, actionGlyph, controllerContexts, controllerInputs } from "./app-controller-mappings.js";
import { audioToggleLabels } from "../light-study/chooser-controls.js";
import { inputMode } from "./input-mode.js";
import { keyboardGlyph } from "./keyboard-inputs.js";
import "./bottom-nav.css";

const iconFiles = import.meta.glob("../light-study/assets/controller/*.png", {
  eager: true, query: "?url", import: "default",
});
export const controllerIcons = Object.entries(iconFiles).map(([path, url]) => [
  path.split("/").pop().slice(0, -4), url,
]);
const urls = new Map(controllerIcons);
for (const { icon, stick, angle } of controllerInputs) {
  if (!stick) continue;
  for (const active of [false, true]) {
    const stroke = active ? "#eacaff" : "#b499d7";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="16" fill="${active ? "#684396" : "#24183a"}" stroke="${stroke}"/>
      <path d="M25 18h6m-3-3 3 3-3 3" transform="rotate(${angle} 18 18)"
        fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="18" y="22" fill="white" font-size="12" font-family="sans-serif" text-anchor="middle">${stick}</text>
    </svg>`;
    urls.set(active ? icon + "-active" : icon, "data:image/svg+xml," + encodeURIComponent(svg));
  }
}
export const controllerIcon = (name) => urls.get(name);

export function actionArtwork(action) {
  if (inputMode() === "keyboard") {
    const source = keyboardGlyph(actionBindings("keyboard", action)[0]);
    return { source, active: source, keyboard: true };
  }
  const glyph = actionGlyph(action);
  const source = controllerIcon(glyph);
  return { glyph, source, active: controllerIcon(glyph + "-active") ?? source, keyboard: false };
}

export function refreshBottomNavArtwork(button) {
  const image = button.querySelector("img");
  const { glyph, source, keyboard } = actionArtwork(button.dataset.navAction);
  button.classList.toggle("bottom-bumper", /^(lb|rb)$/.test(glyph ?? ""));
  image.classList.toggle("bottom-keycap", keyboard);
  if (source && image.getAttribute("src") !== source) image.src = source;
  image.hidden = !source;
}

export function bottomNavButton(item, activate, context) {
  const button = document.createElement("button");
  button.type = "button";
  if (item.id != null) button.dataset.navId = item.id;
  button.dataset.navAction = item.action;
  button.classList.toggle("bottom-end", bottomNavSide(item) === "end");
  const icon = document.createElement("img");
  icon.alt = "";
  icon.draggable = false;
  const label = document.createElement("span");
  label.className = "bottom-label";
  label.append(document.createElement("span"));
  button.append(icon, label);
  refreshBottomNavArtwork(button);
  button.onclick = activate;
  setBottomNavLabel(button, item.label, controllerContexts[context].actions[item.action]);
  return button;
}

export function setBottomNavLabel(button, value, accessibleLabel, toggleValues = []) {
  const label = button.querySelector(".bottom-label");
  const text = label.firstElementChild;
  const fallback = button.querySelector("img").hidden ? accessibleLabel ?? "" : "";
  const display = value => String(value ?? "").trim() || fallback;
  text.textContent = display(value);
  const candidates = toggleValues.map(display).filter(Boolean);
  const signature = JSON.stringify(candidates);
  if (label.dataset.sizing !== signature) {
    label.dataset.sizing = signature;
    const sizers = candidates.map(candidate => {
      const sizer = document.createElement("span");
      sizer.className = "bottom-label-sizer";
      sizer.setAttribute("aria-hidden", "true");
      sizer.textContent = candidate;
      return sizer;
    });
    label.replaceChildren(text, ...sizers);
  }
  label.hidden = !text.textContent && !candidates.length;
  button.classList.toggle("bottom-icon-only", label.hidden);
  button.setAttribute("aria-label", text.textContent || accessibleLabel);
}

export function bottomNavToggleValues(item, labels) {
  return item.toggleLabel === true && labels ? [item.labelOn ?? labels.on, item.labelOff ?? labels.off] : [];
}

export function mountPlatformBottomNav(footer, actions, region = "") {
  const bar = document.createElement("nav");
  bar.className = "chooser-bottom-nav";
  bar.setAttribute("aria-label", "Platform controls");
  if (region) {
    bar.dataset.hardwareButtons = region;
    bar.setAttribute("aria-label", region === "hardware-start" ? "Hardware filters start buttons" : "Hardware filters end buttons");
  }
  footer.append(bar);
  let rendered;
  return (bottomNav, canCycleSkin, audioOn) => {
    const ordered = bottomNavOrder(bottomNav.filter(item => (item.region ?? "") === region));
    const signature = JSON.stringify(ordered.map(({ item: { id, icon, action, align } }) =>
      [id, icon, action, align]));
    if (signature !== rendered) {
      rendered = signature;
      bar.replaceChildren(...ordered.map(({ item }) => bottomNavButton(
        item, Object.hasOwn(actions, item.action) ? actions[item.action] : null, "platform",
      )));
    }
    ordered.forEach(({ item }, index) => {
      const button = bar.children[index];
      button.hidden = item.action === "cycle-skin" && !canCycleSkin;
      refreshBottomNavArtwork(button);
      setBottomNavLabel(button, platformBottomNavLabel(item, audioOn),
        item.action === "none" ? item.icon : PLATFORM_NAV_ACTIONS[item.action], bottomNavToggleValues(item, audioToggleLabels[item.action]));
    });
  };
}
