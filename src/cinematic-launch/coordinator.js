import { createCinematicState } from './state.js';

const FRAME_PERIOD = 67;
const FIRST_FRAME_LIMIT = 5000;
const LIVE_PREVIEW_MS = 2000;
const FRAME_STALL_LIMIT = 950;
const HANDOFF_LIMIT = 1000;
const STARTUP_LOAD_LIMIT = 2500;
const STARTUP_MAX_MS = 65000;
const RETURN_SNAPSHOT_LIMIT = 450;
const SHORTCUT_RETURN_HOLD_MS = 2000;
const SHORTCUT_RETURN_FADE_MS = 500;
const DURATION = 1200;

export function decodeCinematicFrame(buffer) {
  if (!(buffer instanceof ArrayBuffer)) throw new Error('Capture did not return binary pixels.');
  if (!buffer.byteLength) return null;
  const header = new DataView(buffer);
  const width = header.getUint32(0, true);
  const height = header.getUint32(4, true);
  if (!width || !height || width > 640 || height > 480 || buffer.byteLength !== 20 + width * height * 4)
    throw new Error('Capture returned an invalid frame size.');
  return {
    width, height, pixels: new Uint8Array(buffer, 20),
    ageMs: header.getUint32(8, true) / 1000,
    readbackMs: header.getUint32(12, true) / 1000,
    surfaceBytes: header.getUint32(16, true),
  };
}

function hasPicture({ width, height, pixels }) {
  // A newly opened emulator can emit a blank viewport while its menu/status
  // chrome updates. Sample the central picture area before committing to zoom.
  for (let row = 2; row <= 14; row++) {
    const y = Math.floor(height * row / 16);
    for (let column = 2; column <= 14; column++) {
      const offset = 4 * (y * width + Math.floor(width * column / 16));
      if (pixels[offset] > 16 || pixels[offset + 1] > 16 || pixels[offset + 2] > 16)
        return true;
    }
  }
  return false;
}

function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createCinematicCoordinator({ launch, backend, report = () => {}, duration = DURATION, previewMs = LIVE_PREVIEW_MS, now = () => performance.now() }) {
  let active = false;
  return {
    async play({ enabled, gameId, createShot, signal, reducedMotion = false, startupUrl, onLaunched }) {
      if (active) throw new Error('A cinematic launch is already active.');
      if (!enabled || !createShot) return launch(gameId);
      active = true;
      const state = createCinematicState(true);
      const metrics = { frames: 0, captureFailures: 0, webglFrameMs: [], maxCaptureBytes: 0, maxTextureBytes: 0 };
      const started = now();
      const stopStartupLoad = new AbortController();
      let shot, session, emulator, lastPicture, captureFailure, handedOff = false;
      const useBlack = reason => {
        shot.black();
        lastPicture = null;
        metrics.mode = 'black';
        if (reason) {
          captureFailure = reason;
          metrics.captureFailures++;
        }
      };
      const handoff = () => abortable(backend.control(session, 'handoff'),
        AbortSignal.any([signal, AbortSignal.timeout(HANDOFF_LIMIT)]));
      try {
        let displayError;
        try { shot = createShot(); }
        catch (error) { displayError = `Display unavailable: ${error.message ?? error}`; }
        if (!shot) {
          signal.throwIfAborted();
          report(displayError ?? 'This display has no supported cinematic screen.');
          return await launch(gameId);
        }
        state.move('LAUNCHING');
        signal.throwIfAborted();
        try { shot.lock(value => { if (metrics.webglFrameMs.length < 240) metrics.webglFrameMs.push(value); }); }
        catch (error) {
          shot.dispose();
          shot = null;
          report(`Could not prepare the cinematic screen: ${error.message ?? error}`);
          return await launch(gameId);
        }
        // Prepare the startup clip while Windows is starting the emulator.
        const loading = AbortSignal.any([signal, stopStartupLoad.signal, AbortSignal.timeout(STARTUP_LOAD_LIMIT)]);
        const startupTask = startupUrl ? (async () => {
          try {
            const url = await abortable(startupUrl(), loading);
            return url ? await shot.startup(url, STARTUP_MAX_MS, loading) : null;
          } catch {
            return null;
          }
        })() : null;
        // Once the native command is sent, no recovery path may spawn again.
        const result = await backend.start(gameId);
        emulator = result.emulator;
        session = result.sessionId;
        onLaunched?.(emulator);
        if (session == null) {
          state.move('COMPLETED');
          report(result.reason ?? 'The game used standard launching.');
          return emulator;
        }
        signal.throwIfAborted();
        state.move('WAITING_FOR_WINDOW');
        const audio = startupTask && backend.waitForAudio
          ? backend.waitForAudio(session).catch(() => false) : null;
        const discovery = abortable(backend.control(session, 'discover'), signal).then(() => {
          metrics.launchToWindowMs = now() - started;
          return true;
        }, error => {
          captureFailure = error.message ?? String(error);
          return false;
        });
        const startup = await startupTask;
        signal.throwIfAborted();
        const windowReady = startup ? false : await discovery;

        const nextFrame = async stop => {
          stop.throwIfAborted();
          const requested = now();
          const pixels = await abortable(backend.frame(session), stop);
          const fresh = decodeCinematicFrame(pixels);
          if (fresh) {
            const visible = hasPicture(fresh);
            if (!lastPicture && !visible) return null;
            if (visible) lastPicture = fresh;
            shot.frame(fresh);
            metrics.frames++;
            metrics.frameAgeMs ??= [];
            metrics.readbackMs ??= [];
            metrics.frameRequestMs ??= [];
            metrics.frameAgeMs.push(fresh.ageMs);
            metrics.readbackMs.push(fresh.readbackMs);
            metrics.frameRequestMs.push(now() - requested);
            metrics.maxCaptureBytes = Math.max(metrics.maxCaptureBytes, fresh.surfaceBytes);
            metrics.maxTextureBytes = Math.max(metrics.maxTextureBytes, fresh.pixels.byteLength);
          }
          return fresh;
        };
        if (startup) metrics.mode = 'startup';
        else if (result.captureAvailable && windowReady) {
          state.move('CAPTURING');
          const firstDeadline = AbortSignal.timeout(FIRST_FRAME_LIMIT);
          const firstFrame = AbortSignal.any([signal, firstDeadline]);
          try {
            while (!await nextFrame(firstFrame)) await abortable(pause(FRAME_PERIOD), firstFrame);
            metrics.firstFrameMs = now() - started;
            metrics.mode = 'live';
          } catch (error) {
            signal.throwIfAborted();
            useBlack(firstDeadline.aborted ? 'The emulator did not provide a visible frame in time.' :
              (error.message ?? String(error)));
          }
        } else useBlack();

        const stopFrames = new AbortController();
        const zoomSignal = AbortSignal.any([signal, stopFrames.signal]);
        const pump = async () => {
          let lastFrame = now();
          let next = lastFrame + FRAME_PERIOD;
          while (true) {
            await abortable(pause(Math.max(0, next - now())), zoomSignal);
            next = now() + FRAME_PERIOD;
            const deadline = AbortSignal.any([zoomSignal, AbortSignal.timeout(FRAME_STALL_LIMIT)]);
            if (await nextFrame(deadline)) lastFrame = now();
            if (now() - lastFrame > FRAME_STALL_LIMIT) throw new Error('Gameplay capture stopped updating.');
          }
        };
        const recoverCapture = error => {
          if (!zoomSignal.aborted) useBlack(error.message ?? String(error));
        };
        const live = lastPicture ? pump().catch(recoverCapture) : null;
        let zoomStarted;
        try {
          if (live && previewMs > 0) await abortable(pause(previewMs), zoomSignal);
          state.move('ZOOMING_IN');
          zoomStarted = now();
          const zoomDuration = startup ? Math.min(startup.durationMs, 6000) : duration;
          const animation = shot.animate(1, reducedMotion ? 0 : zoomDuration, zoomSignal);
          if (startup) {
            // Open capture for every supported launch without replacing the clip.
            if (result.captureAvailable) {
              const probe = AbortSignal.any([zoomSignal, AbortSignal.timeout(FIRST_FRAME_LIMIT)]);
              void (async () => {
                if (!await discovery || probe.aborted) return;
                while (!decodeCinematicFrame(await abortable(backend.frame(session), probe)))
                  await abortable(pause(FRAME_PERIOD), probe);
              })().catch(error => {
                if (!zoomSignal.aborted) captureFailure = error.message ?? String(error);
              });
            }
            const playback = AbortSignal.any([zoomSignal, AbortSignal.timeout(startup.durationMs + 1500)]);
            const ended = startup.waitForEnd(playback).then(() => 'video-ended', () => {
              zoomSignal.throwIfAborted();
              useBlack();
              return 'video-unavailable';
            });
            // A stalled renderer must not cut short media that is still playing.
            void animation.catch(error => {
              if (!zoomSignal.aborted) metrics.startupAnimationError = error.message ?? String(error);
            });
            if (audio) {
              const audioStarted = audio.then(detected => detected ? 'game-audio' : ended);
              metrics.startupHandoff = await Promise.race([ended, audioStarted]);
              if (metrics.startupHandoff === 'game-audio') startup.stop();
            } else metrics.startupHandoff = await ended;
          } else if (live) await Promise.race([animation, live.then(() => animation)]);
          else await animation;
        } finally {
          stopFrames.abort();
        }
        metrics.zoomInMs = now() - zoomStarted;

        await discovery;
        state.move('HANDING_OFF');
        const handoffStarted = now();
        signal.throwIfAborted();
        await handoff();
        handedOff = true;
        metrics.handoffMs = now() - handoffStarted;
        state.move('NATIVE_GAMEPLAY');
        shot.suspend();
        const returnReason = await abortable(backend.waitForReturn(session, signal), signal);

        state.move('RESTORING');
        const returnStarted = now();
        let returnFrame;
        const shortcut = returnReason === 'shortcut';
        if ((shortcut || (returnReason === 'focus' && lastPicture)) && backend.snapshot) {
          try {
            const deadline = AbortSignal.any([signal, AbortSignal.timeout(RETURN_SNAPSHOT_LIMIT)]);
            const fresh = decodeCinematicFrame(await abortable(backend.snapshot(session), deadline));
            if (fresh && hasPicture(fresh)) returnFrame = fresh;
          } catch {
            signal.throwIfAborted();
          }
        }
        if (!returnFrame) await shot.preparePreview?.(signal);
        const presented = shot.resume(returnFrame, { fade: !shortcut });
        if (shortcut) {
          const focusDeadline = AbortSignal.any([signal, AbortSignal.timeout(350)]);
          const focused = await abortable(backend.control(session, 'returnFocus'), focusDeadline)
            .then(() => true, () => false);
          signal.throwIfAborted();
          if (focused) {
            const presentDeadline = AbortSignal.any([signal, AbortSignal.timeout(650)]);
            await abortable(presented, presentDeadline).catch(() => signal.throwIfAborted());
            await shot.fadeToBlack(SHORTCUT_RETURN_HOLD_MS, SHORTCUT_RETURN_FADE_MS, signal)
              .catch(() => signal.throwIfAborted());
          }
          await abortable(backend.control(session, 'close'), signal).catch(() => signal.throwIfAborted());
        }
        state.move('ZOOMING_OUT');
        await shot.animate(0, reducedMotion ? 0 : duration, signal);
        metrics.returnMs = now() - returnStarted;
        state.move('COMPLETED');
        const completed = {
          black: 'Black-screen transition and return completed.',
          startup: 'Startup video transition and return completed.',
          live: 'Cinematic transition and return completed.',
        }[metrics.mode];
        report(captureFailure ? `${completed} Live capture: ${captureFailure}` : completed, metrics);
        return emulator;
      } catch (error) {
        const stage = state.current;
        if (stage !== 'IDLE') state.move('FAILED');
        if (session != null && !handedOff && !signal.aborted && stage !== 'HANDING_OFF')
          await handoff().catch(() => {});
        const reason = signal.aborted ? 'Transition canceled.' :
          `${stage.toLowerCase().replaceAll('_', ' ')}: ${error.message ?? error}`;
        report(reason, metrics);
        if (emulator !== undefined) return emulator;
        throw error;
      } finally {
        stopStartupLoad.abort();
        try {
          const cleanup = session == null ? null : abortable(backend.control(session, 'cancel'),
            AbortSignal.timeout(HANDOFF_LIMIT)).catch(() => {});
          shot?.dispose();
          await cleanup;
        } finally {
          if (state.current === 'FAILED' || state.current === 'COMPLETED') state.move('IDLE');
          active = false;
        }
      }
    },
  };
}
