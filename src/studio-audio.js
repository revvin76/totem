import { invoke, isTauri } from '@tauri-apps/api/core';

const preference = 'totem.studio.systemMuted';
const showcaseMedia = new Map();
const showcaseAudio = new EventTarget();
let showcaseMuted = false;

export function trackShowcaseMedia(element) {
  if (showcaseMedia.has(element)) return;
  showcaseMedia.set(element, element.volume);
  if (showcaseMuted) element.volume = 0;
}

export function releaseShowcaseMedia(element) {
  showcaseMedia.delete(element);
}

export function isShowcaseMuted() {
  return showcaseMuted;
}

export function setShowcaseMuted(muted = !showcaseMuted) {
  const changed = showcaseMuted !== muted;
  showcaseMuted = muted;
  for (const [element, volume] of showcaseMedia) element.volume = muted ? 0 : volume;
  if (changed) showcaseAudio.dispatchEvent(new Event('change'));
  return muted;
}

export function onShowcaseMuteChanged(listener, signal) {
  showcaseAudio.addEventListener('change', listener, { signal });
}

export function createStudioMuteButton(gameplay = null) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'studio-system-audio';
  button.setAttribute('aria-label', 'Mute Studio system audio');
  const native = isTauri();
  let muted = localStorage.getItem(preference) !== 'false';

  async function apply(next) {
    if (native && await invoke('set_studio_audio_muted', { muted: next })) return;
    if (gameplay) trackShowcaseMedia(gameplay);
    setShowcaseMuted(next);
  }

  function render() {
    button.textContent = muted ? 'Unmute system' : 'Mute system';
    button.setAttribute('aria-pressed', String(muted));
  }

  function report(error) {
    button.title = 'Could not change Studio audio';
    console.error('Could not change Studio audio:', error);
  }

  render();
  button.disabled = true;
  void apply(muted).catch(report).finally(() => { button.disabled = false; });
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await apply(!muted);
      muted = !muted;
      localStorage.setItem(preference, String(muted));
      button.removeAttribute('title');
      render();
    } catch (error) {
      report(error);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}
