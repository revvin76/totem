import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";

const key = "totem.display.anti-aliasing";
const changeEvent = "totem:anti-aliasing-changed";

export function antiAliasingEnabled() {
  return localStorage.getItem(key) !== "false";
}

export function setAntiAliasingEnabled(enabled) {
  localStorage.setItem(key, String(enabled));
  window.dispatchEvent(new Event(changeEvent));
}

// FXAA needs the final tone-mapped colour buffer, after OutputPass.
export function addSceneAntialiasing(composer) {
  const pass = new FXAAPass();
  const update = () => { pass.enabled = antiAliasingEnabled(); };
  update();
  composer.addPass(pass);
  const events = new AbortController();
  window.addEventListener(changeEvent, update, { signal: events.signal });
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) update();
  }, { signal: events.signal });
  window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    events.abort();
    pass.dispose();
  }, { signal: events.signal });
}
