export const STARTUP_VOLUME_KEY = "totem.startup-intro-volume.v1";
export const DEFAULT_STARTUP_VOLUME = 0.65;

export function parseStartupVolume(saved) {
  if (saved == null || saved === "" || !Number.isFinite(Number(saved))) return DEFAULT_STARTUP_VOLUME;
  return Math.min(1, Math.max(0, Number(saved)));
}

// WebView2 normally allows media autoplay. If a local policy requires a user
// gesture, preserve the same video clock and the readiness gate in quiet mode.
export async function playStartupVideo(video, { volume, muted, signal }) {
  video.volume = volume;
  video.muted = muted || volume === 0;
  try {
    await video.play();
    return false;
  } catch (error) {
    if (signal.aborted || video.muted || error.name !== "NotAllowedError") throw error;
    video.muted = true;
    await video.play();
    return true;
  }
}
