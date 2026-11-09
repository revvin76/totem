import { isTauri } from "@tauri-apps/api/core";
import { parseStartupVolume, STARTUP_VOLUME_KEY } from "./startup-intro-audio.js";

const preferenceKey = "totem.startup-intro.v1";
const motionKey = "horizon.carousel.reduced-motion.v1";

export function startupIntroEnabled() {
  return localStorage.getItem(preferenceKey) !== "false";
}

export function startupMotionAllowed() {
  const setting = localStorage.getItem(motionKey);
  return setting === null ? !matchMedia("(prefers-reduced-motion: reduce)").matches : setting !== "true";
}

export function startupIntroVolume() {
  return parseStartupVolume(localStorage.getItem(STARTUP_VOLUME_KEY));
}

export function mountStartupIntroSetting(section) {
  if (!isTauri()) return;
  const label = document.createElement("label");
  label.className = "admin-checkbox-option";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  const hint = document.createElement("small");
  hint.className = "admin-save-hint";
  hint.textContent = "Applies next time Totem opens";
  hint.setAttribute("role", "status");
  checkbox.checked = startupIntroEnabled();
  checkbox.addEventListener("change", () => {
    try {
      localStorage.setItem(preferenceKey, String(checkbox.checked));
      hint.textContent = "Applies next time Totem opens";
    } catch {
      checkbox.checked = !checkbox.checked;
      hint.textContent = "Could not save the startup cinematic preference.";
    }
  });
  label.append(checkbox, "Play the startup cinematic", hint);
  const volumeLabel = document.createElement("label");
  volumeLabel.className = "admin-checkbox-option";
  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.value = String(Math.round(startupIntroVolume() * 100));
  volume.addEventListener("change", () => {
    try {
      localStorage.setItem(STARTUP_VOLUME_KEY, String(Number(volume.value) / 100));
      hint.textContent = "Applies next time Totem opens";
    } catch {
      volume.value = String(Math.round(startupIntroVolume() * 100));
      hint.textContent = "Could not save the startup cinematic volume.";
    }
  });
  volumeLabel.append("Startup cinematic volume", volume);
  section.append(label, volumeLabel);
}
