// Local diagnostics only. Times are elapsed wall time; a submitted frame is not
// proof that the GPU has finished presenting it.
const entries = [];
const measures = [];
let sequence = 0;
const frameSamples = [];
let previousFrame = null;
export const loadingProfile = { entries, graphics: null, session: { startedAt: new Date().toISOString() }, frames: { count: 0, samples: frameSamples } };
if (typeof window !== 'undefined') window.totemLoadingProfile = loadingProfile;

export function setLoadingSession({ label = '', cacheCondition = 'unspecified' } = {}) {
  Object.assign(loadingProfile.session, { label: String(label).slice(0, 120), cacheCondition: String(cacheCondition).slice(0, 120) });
}

export function recordLoadingTime(phase, start, details = {}) {
  const end = performance.now();
  const entry = { phase, start, duration: end - start, status: 'ok', ...details };
  entries.push(entry);
  if (entries.length > 512) entries.shift();
  const measureName = `totem:${phase}:${sequence++}`;
  performance.measure(measureName, { start, end });
  measures.push(measureName);
  if (measures.length > 512) performance.clearMeasures(measures.shift());
  console.debug('[Totem loading]', entry);
  return entry;
}

export function beginLoadingPhase(phase, details = {}) {
  const start = performance.now();
  let completed = false;
  return (status = 'ok', completionDetails = {}) => {
    if (completed) return;
    completed = true;
    return recordLoadingTime(phase, start, { ...details, ...completionDetails, status });
  };
}

export async function timeLoading(phase, operation) {
  const end = beginLoadingPhase(phase);
  try { const result = await operation(); end(); return result; }
  catch (error) { end('error', { error: String(error?.message ?? error).slice(0, 500) }); throw error; }
}

export function recordFrameTiming(timestamp, renderDurationMs) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(renderDurationMs) || renderDurationMs < 0) return;
  const interval = previousFrame === null ? null : timestamp - previousFrame;
  if (interval !== null && interval <= 0) return;
  previousFrame = timestamp;
  frameSamples.push({ interval, renderDurationMs });
  if (frameSamples.length > 512) frameSamples.shift();
  loadingProfile.frames.count++;
}

export function resetFrameTiming() { previousFrame = null; }

// Compute percentiles only when taking a snapshot, not on every render.
export function snapshotLoadingProfile() {
  const stats = values => {
    values.sort((a, b) => a - b);
    const percentile = p => values.length ? values[Math.ceil(values.length * p) - 1] : null;
    return { count: values.length, median: percentile(0.5), p95: percentile(0.95), max: values.at(-1) ?? null };
  };
  return {
    ...loadingProfile,
    entries: [...entries],
    frames: {
      count: loadingProfile.frames.count,
      samples: [...frameSamples],
      intervalMs: stats(frameSamples.map(s => s.interval).filter(v => v !== null)),
      renderSubmissionMs: stats(frameSamples.map(s => s.renderDurationMs)),
    },
  };
}

export function describeGraphics(renderer) {
  const gl = renderer.getContext();
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  loadingProfile.graphics = {
    renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    version: gl.getParameter(gl.VERSION),
    requestedPowerPreference: gl.getContextAttributes()?.powerPreference ?? 'unknown',
  };
}

export function waitForLoadingIdle() {
  return new Promise(resolve => {
    if (typeof window.requestIdleCallback === 'function')
      window.requestIdleCallback(() => resolve(), { timeout: 1000 });
    else window.setTimeout(resolve, 32);
  });
}
