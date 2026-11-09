const modeKey = "totem.input-mode";
export const inputModeEvent = "totem:input-mode";

export function inputMode() {
  try { return sessionStorage.getItem(modeKey) === "keyboard" ? "keyboard" : "xbox"; }
  catch { return "xbox"; }
}

export function useInputMode(mode) {
  if (inputMode() === mode) return;
  sessionStorage.setItem(modeKey, mode);
  window.dispatchEvent(new Event(inputModeEvent));
}

export function trackInputMode() {
  window.addEventListener("keydown", event => {
    if (!event.repeat) useInputMode("keyboard");
  }, true);
  window.addEventListener("storage", event => {
    if (event.storageArea === sessionStorage && event.key === modeKey) {
      window.dispatchEvent(new Event(inputModeEvent));
    }
  });
}
