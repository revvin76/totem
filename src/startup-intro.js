import { invoke, isTauri } from "@tauri-apps/api/core";
import { recordFailure } from "./error-log.js";
import { recordLoadingTime } from "./loading-profile.js";
import { startupIntroEnabled, startupIntroVolume, startupMotionAllowed } from "./startup-intro-preference.js";
import { playStartupVideo } from "./startup-intro-audio.js";

const native = isTauri();
const preview = import.meta.env.DEV && !native && new URLSearchParams(location.search).get("startupIntro") === "1";
const splash = document.getElementById("startup-splash");
const app = document.getElementById("app");
const mediaRoot = "/branding/totem/awakening/";
const skip = document.getElementById("startup-skip");
const audio = document.getElementById("startup-audio");
const retry = document.getElementById("startup-retry");
const status = document.getElementById("startup-status");
const feedback = document.getElementById("startup-feedback");
const phases = ["intro", "hold", "exit"];
const videos = new Map(phases.map(phase => [phase, document.getElementById("startup-video-" + phase)]));
let phase = "loading";
let gated = native || preview;
let playIntro = false;
let chooserReady = false;
let completeHandoff;
const handoff = new Promise(resolve => { completeHandoff = resolve; });
let activeVideo;
let incomingVideo;
let audioMuted = false;
let audioVolume = 0;
let pendingVideo;
let mediaRevision = 0;
let watch;
let padFrame;
let padNeedsRelease = gated;
let padArmed = false;
const heldKeys = new Set();

function setPhase(next, details) {
  phase = next;
  splash.dataset.startupPhase = next;
  recordLoadingTime("startup-" + next, 0, details);
}

function clearVideos() {
  mediaRevision++;
  pendingVideo?.abort();
  for (const video of videos.values()) {
    video.muted = true;
    video.pause();
    video.classList.remove("startup-video-active");
    if (video.hasAttribute("src")) {
      video.removeAttribute("src");
      video.load();
    }
  }
  activeVideo = undefined;
  incomingVideo = undefined;
}

function updateAudioButton() {
  audio.textContent = audioMuted ? "Unmute intro" : "Mute intro";
  audio.setAttribute("aria-pressed", String(audioMuted));
}

function showChooser() {
  if (!chooserReady || phase === "transition" || phase === "error") return;
  clearTimeout(watch);
  cancelAnimationFrame(padFrame);
  for (const video of videos.values()) video.pause();
  mediaRevision++;
  skip.hidden = true;
  audio.hidden = true;
  feedback.hidden = true;
  setPhase("transition");
  splash.classList.add("is-hidden");
  setTimeout(() => {
    clearVideos();
    splash.remove();
    gated = false;
    app.inert = false;
    document.getElementById("scene").focus({ preventScroll: true });
    recordLoadingTime("startup-chooser-input-enabled", 0, { focused: document.hasFocus() });
    completeHandoff(true);
  }, splash.classList.contains("startup-animated") || startupMotionAllowed() ? 300 : 0);
}

export function failStartup(error) {
  if (!gated || phase === "error" || phase === "transition") return false;
  clearTimeout(watch);
  padArmed = false;
  playIntro = false;
  clearVideos();
  skip.hidden = true;
  audio.hidden = true;
  feedback.hidden = false;
  retry.hidden = false;
  status.textContent = "Totem could not prepare the Platform Chooser. " + (error?.message || String(error));
  status.setAttribute("role", "alert");
  setPhase("error");
  completeHandoff(false);
  retry.focus({ preventScroll: true });
  void recordFailure("launcher.startup-handoff", error);
  return true;
}

function stopIntro(useLegacySplash = false) {
  if (!playIntro) return;
  playIntro = false;
  if (chooserReady) {
    showChooser();
    return;
  }
  clearVideos();
  if (useLegacySplash) splash.classList.add("startup-legacy");
  skip.hidden = true;
  audio.hidden = true;
  setPhase("loading");
  feedback.hidden = false;
  status.textContent = "Preparing the Platform Chooser…";
  showChooser();
}

function mediaFailure(error) {
  void recordFailure("launcher.startup-media", error);
  stopIntro(true);
}

function firstVideoFrame(video, signal) {
  // On older engines the caller still waits for play() to report playback.
  if (!video.requestVideoFrameCallback) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let frame;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      video.removeEventListener("error", failed);
      if (frame !== undefined) video.cancelVideoFrameCallback(frame);
    };
    const cancel = () => { cleanup(); reject(signal.reason); };
    const failed = () => { cleanup(); reject(new Error("The startup video could not be decoded.")); };
    const timer = setTimeout(failed, 4000);
    signal.addEventListener("abort", cancel, { once: true });
    video.addEventListener("error", failed, { once: true });
    frame = video.requestVideoFrameCallback(() => { cleanup(); resolve(); });
  });
}

async function playPhase(next) {
  const revision = ++mediaRevision;
  pendingVideo?.abort();
  const controller = new AbortController();
  pendingVideo = controller;
  const video = videos.get(next);
  incomingVideo = video;
  if (activeVideo) activeVideo.muted = true;
  try {
    const frame = firstVideoFrame(video, controller.signal);
    const [, mutedByPolicy] = await Promise.all([
      frame,
      playStartupVideo(video, { volume: audioVolume, muted: audioMuted, signal: controller.signal }),
    ]);
    if (revision !== mediaRevision) return;
    if (mutedByPolicy) {
      audioMuted = true;
      updateAudioButton();
    }
    const previous = activeVideo;
    video.classList.add("startup-video-active");
    activeVideo = video;
    if (previous && previous !== video) {
      previous.classList.remove("startup-video-active");
      previous.pause();
    }
    setPhase(next, { mediaMuted: video.muted, mediaVolume: video.volume });
    if (next === "hold") {
      let lastTime;
      const detectLoop = (_now, { mediaTime }) => {
        if (revision !== mediaRevision) return;
        if (chooserReady && lastTime !== undefined && mediaTime < lastTime) void playPhase("exit");
        else {
          lastTime = mediaTime;
          video.requestVideoFrameCallback(detectLoop);
        }
      };
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(detectLoop);
    }
  } catch (error) {
    if (revision === mediaRevision) mediaFailure(error);
  } finally {
    controller.abort();
    if (pendingVideo === controller) {
      pendingVideo = undefined;
      incomingVideo = undefined;
    }
  }
}

function beginIntro() {
  playIntro = true;
  audioVolume = startupIntroVolume();
  audio.hidden = audioVolume === 0;
  splash.classList.add("startup-animated");
  skip.hidden = false;
  skip.focus({ preventScroll: true });
  for (const [name, video] of videos) {
    video.src = mediaRoot + name + ".mp4";
    video.addEventListener("error", () => {
      if (playIntro) mediaFailure(new Error("Could not load the startup " + name + " video."));
    });
  }
  const hold = videos.get("hold");
  hold.loop = Boolean(hold.requestVideoFrameCallback);
  videos.get("intro").addEventListener("ended", () => {
    if (playIntro && phase === "intro") void playPhase(chooserReady ? "exit" : "hold");
  });
  hold.addEventListener("ended", () => {
    if (!playIntro || phase !== "hold") return;
    if (chooserReady) void playPhase("exit");
    else void hold.play().catch(mediaFailure);
  });
  videos.get("exit").addEventListener("ended", () => {
    if (playIntro && phase === "exit") showChooser();
  });
  void playPhase("intro");
}

function pollSkip() {
  if (!gated || phase === "transition") return;
  const pad = Array.from(navigator.getGamepads?.() ?? []).find(item => item?.connected);
  const a = Boolean(pad?.buttons[0]?.pressed);
  const b = Boolean(pad?.buttons[1]?.pressed);
  if (!document.hasFocus()) padArmed = false;
  else if (!a && !b) padArmed = true;
  else if (padArmed) {
    if (phase === "error" && a) retry.click();
    else if (playIntro) stopIntro();
    padArmed = false;
  }
  padFrame = requestAnimationFrame(pollSkip);
}

export function startupBlocksController(buttons) {
  if (gated) return true;
  if (!padNeedsRelease) return false;
  if (document.hasFocus() && !buttons.size) {
    padNeedsRelease = false;
    recordLoadingTime("startup-controller-rearmed", 0);
  }
  return true;
}

export function revealStartupChooser(evidence) {
  chooserReady = true;
  recordLoadingTime("startup-chooser-ready", 0, evidence);
  if (!playIntro) showChooser();
  return handoff;
}

// Keep the rendered startup selection stable while the overlay completes.
export function waitForStartupHandoffIfReady() {
  if (gated && chooserReady) return handoff;
}

export function startupOwnsSplash() {
  return gated;
}

export function startupNeedsChooserFrame() {
  return gated && !chooserReady && phase !== "error";
}

export function startupMotionChanged(reduced) {
  if (!reduced) return;
  splash.classList.remove("startup-animated");
  stopIntro(true);
}

if (gated) {
  watch = setTimeout(() => {
    if (chooserReady) mediaFailure(new Error("The startup cinematic did not finish in time."));
    else failStartup(new Error("The Platform Chooser did not become ready in time. Retry to start again."));
  }, 45000);
  padFrame = requestAnimationFrame(pollSkip);
} else {
  app.inert = false;
  splash.classList.add("startup-legacy");
}
skip.addEventListener("click", () => stopIntro());
audio.addEventListener("click", () => {
  audioMuted = !audioMuted;
  const playing = incomingVideo ?? activeVideo;
  if (playing) playing.muted = audioMuted || audioVolume === 0;
  updateAudioButton();
});
retry.addEventListener("click", () => location.reload());
window.addEventListener("keydown", event => {
  if (!gated && !heldKeys.has(event.code)) return;
  if ((event.target === retry || event.target === audio) && ["Enter", "Space"].includes(event.code)) return;
  if (gated && event.code === "Tab") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (gated) {
    heldKeys.add(event.code);
    const activatesSkip = event.target === skip && ["Enter", "Space"].includes(event.code);
    if (playIntro && (event.code === "Escape" || activatesSkip) && !event.repeat) stopIntro();
  }
}, true);
window.addEventListener("keyup", event => {
  if (!heldKeys.delete(event.code)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
window.addEventListener("blur", () => heldKeys.clear());

export const startupBenchmarkConfig = (async () => {
  const config = native ? await invoke("loading_benchmark_config") : null;
  if (config) {
    gated = false;
    padNeedsRelease = false;
    clearTimeout(watch);
    cancelAnimationFrame(padFrame);
  } else if (preview && gated && phase !== "error" && startupIntroEnabled() && startupMotionAllowed()) {
    beginIntro();
    return config;
  }
  if (phase !== "error") splash.classList.add("startup-legacy");
  return config;
})();

export function startLauncher() {
  return startupBenchmarkConfig.then(() => import("./main.js")).catch(error => {
    if (!failStartup(error) && phase !== "error") {
      splash.remove();
      app.inert = false;
      const loading = document.getElementById("loading");
      loading.hidden = false;
      loading.textContent = "Totem could not start. " + (error?.message || String(error));
      void recordFailure("launcher.bootstrap", error);
    }
  });
}
