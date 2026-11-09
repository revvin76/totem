import { invoke, isTauri } from '@tauri-apps/api/core';
import { Raycaster, Vector2 } from 'three';
import { createPersonalitySettingsStore, prefersReducedTotemMotion } from './totem-personality-config.js';
import { loadTotemAsset, createTotemMascot, attachTotemToScene, releaseTotemAsset } from './totem-mascot.js';
import { AMBIENT_NAMES } from './totem-personality.js';
import { recordFailure } from './error-log.js';
import { TikoVoiceEngine } from './tiko-voice-engine.js';
import { isShowcaseMuted, onShowcaseMuteChanged } from './studio-audio.js';

const REACTION_VOICES = {
  happy: 'hello', excited: 'yay', sad: 'no', confused: 'curious',
  surprised: 'wow', sleepy: 'hmm', annoyed: 'no', playful: 'boo',
};

function connectTotemDebug(binding, enabled, selectedConsoleId, signal) {
  const panel = document.getElementById('totem-debug');
  if (!panel) return;
  const disclosure = panel.querySelector('details');
  const summary = panel.querySelector('summary'), menu = panel.querySelector('.totem-debug-actions'), status = panel.querySelector('[role=status]');
  const actions = [
    ['hide_and_seek', 'Peek-a-boo'],
    ['panel_peek', 'Peek around details panel'],
    ['console_perch', 'Land on selected console'],
    ['console_hops', 'Hop between consoles'],
    ['ring_corkscrew', 'Corkscrew around the ring'],
    ['hover_relocation', 'Fly to another rest spot'],
    ['ring_visit', 'Visit a console in the ring'],
    ...AMBIENT_NAMES.filter(name => name !== 'hide_and_seek').map(name => [name, name.replaceAll('_', ' ')]),
  ];
  let timeout;
  const report = (message, duration = 4500) => {
    clearTimeout(timeout);
    status.textContent = message;
    if (message && duration) timeout = setTimeout(() => { status.textContent = ''; }, duration);
  };
  for (const [name, label] of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet';
    button.textContent = label[0].toUpperCase() + label.slice(1);
    button.addEventListener('click', () => {
      disclosure.open = false;
      summary.focus();
      if (!enabled()) { report('Enable Little Totem in Settings first.'); return; }
      report(`Starting ${label.toLowerCase()}…`, 0);
      binding.debug(name, (started, reason) => {
        if (reason || !started) {
          const context = started ? 'little-totem.debug.fallback' : 'little-totem.debug.failed';
          void recordFailure(context, `Action: ${name}\nConsole: ${selectedConsoleId() ?? 'none'}\n${reason ?? 'The behaviour did not start.'}`);
        }
        if (started) report(reason ?? `Playing ${label.toLowerCase()}.`, 1800);
        else report(reason ?? 'Totem could not start this behaviour here.');
      });
    }, { signal });
    menu.append(button);
  }
  panel.hidden = false;
  document.addEventListener('pointerdown', event => {
    if (disclosure.open && !panel.contains(event.target)) disclosure.open = false;
  }, { signal });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape' && disclosure.open) {
      disclosure.open = false;
      summary.focus();
    }
    // Launcher shortcuts should not also activate when using this control.
    event.stopPropagation();
  }, { signal });
  signal.addEventListener('abort', () => { clearTimeout(timeout); disclosure.open = false; panel.hidden = true; menu.replaceChildren(); }, { once: true });
}

export function personalitySettingsStore(storage = localStorage) {
  const native = isTauri(), key = 'totem.studio.preview';
  const read = () => JSON.parse(storage.getItem(key) || 'null') ?? { version: 1, revision: null, defaults: {}, overrides: {} };
  return createPersonalitySettingsStore({
    loadDocument: () => native ? invoke('load_studio_settings') : Promise.resolve(read()),
    saveDocument: async (document, expectedRevision) => {
      if (native) return invoke('save_studio_settings', { document, expectedRevision });
      if (read().revision !== expectedRevision) throw Error('Studio settings changed. Reload before saving.');
      const next = { ...document, revision: crypto.randomUUID() };
      storage.setItem(key, JSON.stringify(next));
      return read();
    },
  });
}

// Only sources already emitted by the application are connected here.
// A selection/click is never treated as a successful launch or update.
export function connectTotemEvents(personality, target = window, settings = document.getElementById('folder-settings')) {
  const abort = new AbortController(), options = { signal: abort.signal };
  const navigation = () => personality.navigation?.();
  for (const event of ['pointerdown', 'keydown', 'wheel']) target.addEventListener(event, navigation, { ...options, capture: true, passive: true });
  const platform = event => { navigation(); personality.cancelHover(); personality.event('platform_changed', event.detail?.id); };
  target.addEventListener('horizon:platform-selected', platform, options);
  target.addEventListener('totem:library-rescanned', event => personality.event('library_scan_complete', event.detail?.revision ?? String(personality.now)), options);
  target.addEventListener('gamepadconnected', event => personality.event('controller_connected', `${event.gamepad.index}:${personality.now}`), options);
  target.addEventListener('gamepaddisconnected', event => personality.event('controller_disconnected', `${event.gamepad.index}:${personality.now}`), options);
  // Actual legacy chooser only supplies identity, not favourite/recent/new
  // status. Do not infer unsupported reactions from missing metadata.
  target.addEventListener('horizon:game-selected', () => { navigation(); personality.cancelHover(); }, options);
  const observer = settings ? new MutationObserver(() => { if (settings.open) personality.event('settings_opened', String(personality.now)); }) : null;
  observer?.observe(settings, { attributes: true, attributeFilter: ['open'] });
  return () => { abort.abort(); observer?.disconnect(); personality.cancelHover(); };
}

export function connectChooserDocument(personality, doc, isActive) {
  const search = doc.getElementById('game-search'), rail = doc.querySelector('.rail-list');
  if (!search || !rail) return () => {};
  const abort = new AbortController(), options = { signal: abort.signal };
  const navigation = () => { if (isActive()) personality.navigation?.(); };
  for (const event of ['pointerdown', 'keydown', 'wheel']) doc.addEventListener(event, navigation, { ...options, capture: true, passive: true });
  let selection = null, changes = [], searchRevision = 0;
  function selected() {
    if (!isActive()) return;
    const current = rail.querySelector('[aria-current="page"]')?.dataset.game;
    if (!current || current === selection) return;
    selection = current; navigation(); personality.cancelHover();
    changes = changes.filter(time => personality.now - time < 500); changes.push(personality.now);
    if (changes.length >= 4) { personality.event('rapid_scrolling', `scroll:${personality.now}`); changes = []; }
    personality.event('scrolling_stopped', current);
    // Runtime rail flags currently mark every indexed game as recent. They
    // cannot establish genuine recent/new/favourite status, so are not used.
  }
  const observer = new MutationObserver(selected);
  observer.observe(rail, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current'] });
  search.addEventListener('focus', () => { if (isActive()) personality.event('search_started', `search:${++searchRevision}`); }, options);
  search.addEventListener('input', () => {
    if (!isActive() || !search.value.trim()) return;
    const found = rail.querySelector('.rail-game:not([hidden])');
    personality.event(found ? 'search_found' : 'search_empty', `query:${++searchRevision}`);
  }, options);
  return () => { abort.abort(); observer.disconnect(); personality.cancelHover(); };
}

export function connectTotemClicks(target, hitTest, react, isActive = () => true, watchPointer = () => {}) {
  const abort = new AbortController(), options = { signal: abort.signal, capture: true };
  let press = null;
  target.addEventListener('pointerdown', event => {
    if (!isActive() || event.button !== 0 || event.target?.closest?.('button, a, input, select, textarea, summary, [role="button"], .studio-scene-input, .studio-control-panel, .studio-toolbar')) return;
    const hit = hitTest(event);
    if (!hit) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, hit };
    event.preventDefault();
    event.stopImmediatePropagation();
  }, options);
  target.addEventListener('pointerup', event => {
    if (press?.id !== event.pointerId) return;
    const { hit } = press;
    const distance = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    press = null;
    event.stopImmediatePropagation();
    if (isActive() && distance < 8) {
      if (event.pointerType === 'mouse') watchPointer(event);
      react(hit);
    }
  }, options);
  target.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse' && isActive()) watchPointer(event);
  }, { ...options, passive: true });
  target.addEventListener('pointerout', event => {
    if (event.pointerType === 'mouse' && !event.relatedTarget && isActive()) watchPointer(null);
  }, { ...options, passive: true });
  target.addEventListener('pointercancel', event => { if (press?.id === event.pointerId) press = null; }, options);
  return () => abort.abort();
}

export async function createTotemCompanion({
  onStatus = () => {},
  getRuntime = () => window.totemSceneRuntime,
  standaloneChooser = false,
  sceneInteractive = () => true,
} = {}) {
  const store = personalitySettingsStore();
  let config, asset, mascot, detach, disconnect, disposed = false, preview = null, frameObserver, disconnectChooser, chooserFrame;
  let waitForRuntime;
  let benchmarkHidden = false, measuring = false;
  const lifecycle = new AbortController();
  const voice = new TikoVoiceEngine();
  const scenePaused = () => document.body.classList.contains('cinematic-picture-active') ||
    Boolean(document.querySelector('dialog[open]:not(.game-chooser-host)'));
  const stopSceneVoice = () => { if (voice.target === 'scene') voice.stop(); };
  function speak(expression, options, target) {
    const { presets, active } = config.voice;
    return voice.speak(expression, { ...options, patch: presets.find(preset => preset.name === active)?.patch, target });
  }
  function prepareVoice(event) {
    if (!event.isTrusted || !config.voice.enabled || voice.context?.state === 'running') return;
    void voice.prepare().catch(error => recordFailure('little-totem.voice.prepare', error));
  }
  const wait = milliseconds => new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(Error('Totem was closed during measurement.')); };
    const timer = setTimeout(() => { lifecycle.signal.removeEventListener('abort', cancel); resolve(); }, milliseconds);
    lifecycle.signal.addEventListener('abort', cancel, { once: true });
  });
  const service = {
    store, voice,
    get config() { return config; }, get asset() { return asset; }, get mascot() { return mascot; },
    get preview() { return preview; }, set preview(value) { preview = value; },
    speak(expression, options = {}) {
      if (!config.voice.enabled || !mascot?.root.visible || mascot.personality.gameplay || document.hidden || scenePaused()) {
        return Promise.resolve(null);
      }
      return speak(expression, options, 'scene');
    },
    previewVoice(expression, options) { return speak(expression, options, 'preview'); },
    react(emotion, options = {}) {
      return service.speak(Object.hasOwn(REACTION_VOICES, emotion) ? REACTION_VOICES[emotion] : 'huh', { ...options, emotion });
    },
    stopSpeaking: stopSceneVoice,
    async save(value) {
      config = await store.save(value);
      if (!config.voice.enabled || !config.enabled) stopSceneVoice();
      mascot?.personality.configure(config); preview?.personality.configure(config);
      return config;
    },
    async measureScenePerformance() {
      const runtime = window.totemSceneRuntime, profile = window.totemLoadingProfile;
      if (measuring || !runtime || !profile || !config.enabled) throw Error('Enable Totem and wait for the launcher scene.');
      measuring = true;
      const stats = values => {
        const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
        return { count: sorted.length, median: sorted[Math.ceil(sorted.length * .5) - 1] ?? null, p95: sorted[Math.ceil(sorted.length * .95) - 1] ?? null };
      };
      const sample = async hidden => {
        benchmarkHidden = hidden;
        const startCount = profile.frames.count;
        await wait(5000);
        if (document.hidden || document.querySelector('dialog[open]') || profile.frames.count - startCount < 120) throw Error('Scene measurement interrupted or fewer than 120 frames were available.');
        const frames = profile.frames.samples.slice(-120);
        return {
          intervalMs: stats(frames.map(frame => frame.interval)), submissionMs: stats(frames.map(frame => frame.renderDurationMs)),
          gpuMs: stats(profile.gpu?.milliseconds?.slice(-120) ?? []),
          resources: { ...runtime.renderer.info.memory },
        };
      };
      try {
        document.getElementById('folder-close').click();
        const disabled = await sample(true), enabled = await sample(false);
        const result = { disabled, enabled, graphics: profile.graphics, note: 'Last 120 stationary launcher frames per five-second phase; source assets retained in both phases.' };
        let path = null;
        if (isTauri()) path = await invoke('save_loading_profile', { profile: { entries: [], personalityBenchmark: result } });
        return { result, path };
      } finally {
        benchmarkHidden = false; measuring = false;
        if (!disposed && !document.getElementById('folder-settings').open) document.getElementById('folder-settings-toggle').click();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; lifecycle.abort(); clearInterval(waitForRuntime); disconnect?.(); frameObserver?.disconnect(); disconnectChooser?.(); detach?.(); preview?.dispose();
      void voice.dispose().catch(error => recordFailure('little-totem.voice.dispose', error));
      if (asset) releaseTotemAsset(asset);
    },
  };
  config = await store.load();
  asset = await loadTotemAsset();
  if (disposed) return service;
  voice.setMuted(isShowcaseMuted());
  onShowcaseMuteChanged(() => voice.setMuted(isShowcaseMuted()), lifecycle.signal);
  const gestureOptions = { capture: true, signal: lifecycle.signal };
  document.addEventListener('pointerup', prepareVoice, gestureOptions);
  document.addEventListener('keydown', prepareVoice, gestureOptions);
  document.addEventListener('visibilitychange', () => { if (document.hidden) voice.stop(); }, { signal: lifecycle.signal });
  const reducedMotion = () => prefersReducedTotemMotion(config.reducedMotion);
  function attach() {
    const runtime = getRuntime();
    if (!runtime || disposed) return;
    clearInterval(waitForRuntime);
    mascot = createTotemMascot(asset, config, undefined, (expression, options) => {
      void service.speak(expression, options).catch(error => recordFailure('little-totem.voice.animation', error));
    });
    const details = document.querySelector('.hero');
    const binding = attachTotemToScene(runtime, mascot, {
      reducedMotion,
      hidden: () => document.hidden || benchmarkHidden || Boolean(document.getElementById('startup-splash')),
      previewOpen: scenePaused,
      voiceEvent: () => voice.active?.event.target === 'scene' ? voice.active.event : null,
      stopVoice: stopSceneVoice,
      panelBounds: () => {
        if (!details?.checkVisibility({ visibilityProperty: true })) return null;
        const panel = details.getBoundingClientRect(), view = runtime.renderer.domElement.getBoundingClientRect();
        const left = Math.max(panel.left, view.left), right = Math.min(panel.right, view.right);
        const top = Math.max(panel.top, view.top), bottom = Math.min(panel.bottom, view.bottom);
        if (right <= left || bottom <= top) return null;
        const x = value => (value - view.left) * 2 / view.width - 1;
        const y = value => 1 - (value - view.top) * 2 / view.height;
        return [x(left), y(bottom), x(right), y(top)];
      },
    });
    detach = binding.detach;
    connectTotemDebug(binding, () => config.enabled, () => runtime.selectedConsoleId, lifecycle.signal);
    const ray = new Raycaster(), pointer = new Vector2();
    const screenPointer = (event, frame) => {
      if (!event) return null;
      const rect = runtime.renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const offset = frame?.getBoundingClientRect();
      return pointer.set((event.clientX + (offset?.left ?? 0) - rect.left) / rect.width * 2 - 1,
        1 - (event.clientY + (offset?.top ?? 0) - rect.top) / rect.height * 2);
    };
    const hitTest = (event, frame) => {
      if (!runtime.camera || !screenPointer(event, frame)) return false;
      ray.setFromCamera(pointer, runtime.camera);
      const mascotHit = mascot.root.visible && mascot.personality.config.reactions ? ray.intersectObject(mascot.root, true)[0] : null;
      const pole = binding.canSummonPole() && mascot.root.parent?.getObjectByName('Totem pole');
      if (pole?.visible && pole.parent?.visible) {
        const poleHit = ray.intersectObject(pole, true)[0];
        if (poleHit && (!mascotHit || poleHit.distance < mascotHit.distance)) return pole;
      }
      return Boolean(mascotHit && (frame || !details?.contains(event.target) || mascot.root.userData.onPole));
    };
    const react = hit => hit === true ? binding.interact() : binding.summonPole(hit);
    const disconnectClicks = connectTotemClicks(window, hitTest, react,
      () => sceneInteractive() && (standaloneChooser || !runtime.activeView) && !document.querySelector('dialog[open]'),
      event => binding.watchPointer(screenPointer(event)));
    const disconnectEvents = connectTotemEvents(mascot.personality);
    disconnect = () => { disconnectClicks(); disconnectEvents(); };
    function watchChooser() {
      const frame = document.querySelector('.game-chooser-host iframe');
      if (!frame || frame === chooserFrame) return;
      chooserFrame = frame;
      const connect = () => {
        if (disposed) return;
        disconnectChooser?.();
        const doc = frame.contentDocument;
        if (!doc) return;
        const isActive = () => frame.closest('dialog').open && Boolean(runtime.activeView);
        const stopClicks = connectTotemClicks(doc, event => hitTest(event, frame), react, isActive,
          event => binding.watchPointer(screenPointer(event, frame)));
        const stopEvents = connectChooserDocument(mascot.personality, doc, isActive);
        disconnectChooser = () => { stopClicks(); stopEvents(); };
      };
      frame.addEventListener('load', connect, { signal: lifecycle.signal }); connect();
    }
    frameObserver = new MutationObserver(watchChooser); frameObserver.observe(document.body, { childList: true }); watchChooser();
    // Expose read-only diagnostics and the real controller for development,
    // without creating synthetic application events or success notifications.
    if (import.meta.env.DEV) window.totemCompanion = service;
    onStatus('Totem ready');
  }
  waitForRuntime = setInterval(attach, 250); attach();
  addEventListener('pagehide', () => service.dispose(), { once: true, signal: lifecycle.signal });
  return service;
}
