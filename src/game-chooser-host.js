import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { loadStudioDocument, studioInvoke } from './studio-config.js';
import { recordFailure } from './error-log.js';
import { reportCinematicResult } from './cinematic-launch/settings.js';
import { EMULATOR_EXIT_EVENT } from './universal-emulator-exit-ui.js';

const launch = gameId => invoke('launch_game', { gameId });

export function mountGameLibrary({ library, getPlatform = () => null, reducedMotion = () => false, onStepPlatform } = {}) {
  let dialog, frame, returnFocus, loaded, preparing;
  let frameReady;
  let closeRevision = 0;
  let requestSequence = 0;
  let launchableGames = new Map(), launching = false;
  let cinematic, cinematicAbort;
  const requests = new Map();
  const allowed = new Set(['load_studio_settings', 'carousel_state', 'get_platform_games', 'get_library_game_metadata', 'get_library_game_artwork', 'get_library_game_thumbnail', 'get_library_game_video', 'read_platform_asset', 'read_bundled_model', 'record_error']);
  window.addEventListener(EMULATOR_EXIT_EVENT, ({ detail: status }) => {
    frame?.contentWindow.postMessage({ gameChooser: 'emulator-exit', status }, location.origin);
  });
  window.addEventListener('message', async event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin) return;
    if (event.data?.gameChooser === 'ready') frameReady?.();
    if (event.data?.studioRequest && event.data.command === 'get_indexed_game_diagnostics') {
      const studioReply = event.data.studioRequest;
      const game = launchableGames.get(event.data.args?.gameId);
      const isCurrent = () => dialog.open && !preparing && game
        && launchableGames.get(game.id) === game;
      try {
        if (!isTauri() || !isCurrent()) throw new Error('Game information is unavailable for the current selection.');
        const result = await invoke('get_indexed_game_diagnostics', { gameId: game.id });
        if (!isCurrent()) throw new Error('The Game Chooser selection changed.');
        event.source.postMessage({ studioReply, result }, location.origin);
      } catch (error) {
        event.source.postMessage({ studioReply, error: error.message ?? String(error) }, location.origin);
      }
      return;
    }
    if (event.data?.studioRequest && event.data.command === 'launch_game') {
      const studioReply = event.data.studioRequest;
      const game = launchableGames.get(event.data.args?.gameId);
      if (!isTauri() || !dialog.open || preparing || !game || launching) {
        event.source.postMessage({ studioReply, error: 'Game launch is unavailable for the current selection.' }, location.origin);
        return;
      }
      launching = true;
      let replied = false;
      const launched = emulator => {
        if (replied) return;
        replied = true;
        window.dispatchEvent(new CustomEvent('horizon:game-selected', { detail: {
          id: game.id, platformId: game.platformId, title: game.title, emulator,
        } }));
        event.source.postMessage({ studioReply, result: emulator }, location.origin);
      };
      try {
        const emulator = await cinematicPlay(game, launched);
        launched(emulator);
      } catch (error) {
        void recordFailure('game-chooser.launch-game', error);
        if (!replied) event.source.postMessage({ studioReply, error: error.message ?? String(error) }, location.origin);
      } finally {
        launching = false;
      }
      return;
    }
    if (event.data?.studioRequest && allowed.has(event.data.command)) {
      try {
        const command = event.data.command;
        let result;
        if (command === 'load_studio_settings') result = await loadStudioDocument();
        else if (command !== 'record_error' || isTauri()) result = await studioInvoke(command, event.data.args);
        if (command === 'get_library_game_video') result = convertFileSrc(result);
        frame.contentWindow.postMessage({studioReply:event.data.studioRequest,result},location.origin);
      }
      catch (error) { frame.contentWindow.postMessage({studioReply:event.data.studioRequest,error:String(error)},location.origin); }
    }
    if (event.data?.gameChooser === 'prepared') {
      const pending = requests.get(event.data.request);
      if (pending) {
        clearTimeout(pending.timer); requests.delete(event.data.request);
        if (event.data.error) pending.reject(new Error(event.data.error)); else pending.resolve();
      }
    }
    if (event.data?.gameChooser === 'back') close();
    if (event.data?.gameChooser === 'step-platform' && dialog.open && !cinematicAbort) {
      const { direction } = event.data;
      if (direction !== -1 && direction !== 1) return;
      try { await onStepPlatform?.(direction); }
      catch (error) {
        if (dialog.open) frame.contentWindow.postMessage({
          gameChooser: 'platform-error',
          message: `Could not switch platforms: ${error.message ?? error}`,
        }, location.origin);
      }
    }
  });
  async function cinematicPlay(game, onLaunched) {
    const abort = new AbortController();
    cinematicAbort = abort;
    const cancel = () => abort.abort();
    window.addEventListener('pagehide', cancel, { once: true });
    try {
      let modules;
      try {
        modules = await Promise.all([
          import('./cinematic-launch/coordinator.js'),
          import('./cinematic-launch/shot.js'),
          import('./console-activity.js'),
        ]);
      } catch {
        abort.signal.throwIfAborted();
        reportCinematicResult('Cinematic launch could not initialize. Standard launch used.');
        return await launch(game.id);
      }
      abort.signal.throwIfAborted();
      const [{ createCinematicCoordinator }, { createCinematicShot }, { bundledStartupClip }] = modules;
      const control = (sessionId, action) => invoke('cinematic_control', { sessionId, action });
      cinematic ??= createCinematicCoordinator({
        launch,
        backend: {
          start: gameId => invoke('cinematic_start', { gameId }),
          control,
          waitForAudio: async sessionId => await control(sessionId, 'waitForAudio') === 'audioStarted',
          frame: sessionId => invoke('cinematic_frame', { sessionId }),
          snapshot: sessionId => invoke('cinematic_frame', { sessionId, returnSnapshot: true }),
          async waitForReturn(sessionId, signal) {
            let returned;
            const focus = new Promise(resolve => { returned = resolve; });
            const checkFocus = () => { if (document.hasFocus()) returned('focus'); };
            window.addEventListener('focus', checkFocus);
            signal.addEventListener('abort', returned, { once: true });
            try { return await Promise.race([control(sessionId, 'wait'), focus]); }
            finally {
              window.removeEventListener('focus', checkFocus);
              signal.removeEventListener('abort', returned);
            }
          },
        },
        report(result, metrics) {
          reportCinematicResult(result);
          if (metrics) console.info('[Totem cinematic]', result, JSON.stringify(metrics));
        },
      });
      const stage = window.totemSceneRuntime;
      return await cinematic.play({
        enabled: true, gameId: game.id, signal: abort.signal, reducedMotion: reducedMotion(), onLaunched,
        async startupUrl() {
          const path = await invoke('get_showcase_startup_video', { platformId: game.platformId }).catch(() => null);
          return path ? convertFileSrc(path) : bundledStartupClip(game.platformId);
        },
        createShot: () => stage?.activeView?.prepareCinematic?.(game.platformId, createCinematicShot, cancel),
      });
    } finally {
      window.removeEventListener('pagehide', cancel);
      cinematicAbort = null;
    }
  }
  function ensureFrame() {
    if (frame) return loaded;
    dialog = document.createElement('dialog'); dialog.className='game-chooser-host';dialog.setAttribute('aria-label','Game Chooser');
    // Keep the iframe laid out and loaded while closed, without making it interactive.
    Object.assign(dialog.style,{padding:'0',border:'0',inset:'0',margin:'0',display:'block',visibility:'hidden',pointerEvents:'none',background:'transparent'});
    frame = document.createElement('iframe'); frame.title = 'Game Chooser';
    Object.assign(frame.style,{width:'100%',height:'100%',border:'0',display:'block',background:'transparent'});
    loaded = new Promise(resolve => { frameReady = resolve; });
    frame.src = isTauri() ? '/light-study/index.html?runtime=1' : '/light-study/index.html?runtime=1&browser=1';
    dialog.append(frame); document.body.append(dialog);
    dialog.addEventListener('cancel',event => {event.preventDefault();close();});
    return loaded;
  }
  async function prepare(platform) {
    if (!platform) return;
    const key = [platform.id,platform.recordRevision,platform.modelFile?.id,platform.bundledModel?.sha256].join(':');
    if (preparing?.key === key) return preparing.promise;
    launchableGames.clear();
    const revision = closeRevision;
    const promise = (async () => {
      ensureFrame();
      const games = await library.games(platform.id);
      const request = String(++requestSequence);
      const ready = new Promise((resolve,reject) => {
        const timer=setTimeout(()=>{requests.delete(request);reject(new Error('Game Chooser preparation timed out'));},30000);
        requests.set(request,{resolve,reject,timer});
      });
      void loaded.then(() => {
        if (requests.has(request)) frame.contentWindow.postMessage({gameChooser:'prepare',request,platform,games,native:isTauri()},location.origin);
      });
      await ready;
      if (preparing?.promise === promise && revision === closeRevision) {
        launchableGames = new Map(games.map(game => [game.id, game]));
      }
    })();
    preparing={key,promise};
    try { await promise; } finally { if(preparing?.promise===promise) preparing=null; }
  }
  function close() {
    if (cinematicAbort) { cinematicAbort.abort(); return; }
    closeRevision++;
    launchableGames.clear();
    window.totemSceneRuntime?.activateView();
    document.body.classList.remove('game-chooser-open');
    if(dialog){dialog.close();dialog.style.visibility='hidden';dialog.style.pointerEvents='none';}
    frame?.contentWindow.postMessage({gameChooser:'pause'},location.origin);
    returnFocus?.focus();
  }
  return {
    isOpen: () => Boolean(dialog?.open),
    runAction(action) {
      if (dialog?.open && !preparing && !cinematicAbort)
        frame.contentWindow.postMessage({ gameChooser: 'action', action }, location.origin);
    },
    warmShell: ensureFrame,
    async open(chosen = getPlatform('switch')) {
      const switching = Boolean(dialog?.open);
      const revision = closeRevision;
      if (!switching) returnFocus=document.activeElement;
      try { await prepare(chosen); }
      catch (error) {
        if (switching && revision === closeRevision)
          frame.contentWindow.postMessage({gameChooser:'resume'},location.origin);
        throw error;
      }
      if (revision !== closeRevision) return false;
      window.totemSceneRuntime?.activateView('gameChooser');
      if (!switching) {
        document.body.classList.add('game-chooser-open');
        dialog.showModal();dialog.style.visibility='visible';dialog.style.pointerEvents='auto';
        if(!reducedMotion())dialog.animate([{opacity:0},{opacity:1}],{duration:180});
      }
      frame.contentWindow.postMessage({gameChooser:'resume'},location.origin);
      if (!switching) frame.focus();
      return true;
    },
    close,
  };
}
