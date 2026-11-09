export const VIDEO_FIELDS = {
  opacity: ['Opacity', 0, 100, 40, '%'],
  blur: ['Blur', 0, 40, 3, ' px'],
  brightness: ['Brightness', 0, 150, 100, '%'],
  saturation: ['Saturation', 0, 200, 100, '%'],
  left: ['Horizontal position', -50, 100, 0, '%'],
  top: ['Vertical position', -50, 100, 0, '%'],
  width: ['Width', 10, 150, 100, '%'],
  height: ['Height', 10, 150, 100, '%'],
  feather: ['Edge feather', 0, 50, 0, '%'],
  fadeStart: ['Fade starts', 0, 99, 20, '%'],
  fadeEnd: ['Fade ends', 1, 100, 85, '%'],
  fadeStrength: ['Fade strength', 0, 100, 100, '%'],
  vignette: ['Vignette', 0, 100, 0, '%'],
  scanlines: ['Scanlines', 0, 100, 0, '%'],
};
export const VIDEO_FITS = { cover: 'Fill and crop', contain: 'Fit entire video', stretch: 'Stretch' };
export const VIDEO_FADES = { none: 'None', right: 'Left to right', left: 'Right to left', down: 'Top to bottom', up: 'Bottom to top' };
export const VIDEO_PRESETS = {
  full: ['Full-stage overlay', {}],
  right: ['Right-to-left fade', { fade: 'left', fadeStart: 10, fadeEnd: 78 }],
  left: ['Left-to-right fade', { fade: 'right', fadeStart: 24, fadeEnd: 82 }],
  projection: ['Soft central projection', { left: 5, top: 10, width: 69, height: 65, feather: 21, blur: 2 }],
  horizon: ['Cinematic horizon band', { top: 11, height: 62, feather: 14, fade: 'down', fadeStart: 38, fadeEnd: 100, blur: 7 }],
  atmosphere: ['Blurred atmospheric motion', { opacity: 32, blur: 24, brightness: 78, saturation: 145, scanlines: 25, vignette: 55 }],
};

export function normalizeGameplayBackdrop(value) {
  const result = { enabled: value?.enabled !== false,
    fit: Object.hasOwn(VIDEO_FITS, value?.fit) ? value.fit : 'cover',
    fade: Object.hasOwn(VIDEO_FADES, value?.fade) ? value.fade : 'none' };
  for (const [key, [, min, max, fallback]] of Object.entries(VIDEO_FIELDS)) {
    result[key] = Number.isFinite(value?.[key]) ? Math.min(max, Math.max(min, Math.round(value[key]))) : fallback;
  }
  return result;
}
