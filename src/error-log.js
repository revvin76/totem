import { invoke, isTauri } from '@tauri-apps/api/core';

// Keep an unwrapped console method so a failed log write cannot log itself.
const consoleError = console.error.bind(console);
const nativeWrite = (context, detail) => invoke('record_error', { context, detail });
let writeError = isTauri() ? nativeWrite : null;

function formatError(value) {
  if (value instanceof Error) return value.stack || value.message;
  // Console arguments may include request or settings objects. Record their
  // error messages without serializing the whole object.
  if (value && typeof value === 'object') {
    return typeof value.message === 'string' ? value.message : Object.prototype.toString.call(value);
  }
  return String(value);
}

async function persistError(context, values) {
  if (!writeError) return;
  try { await writeError(context, values.map(formatError).join('\n')); }
  catch (error) { consoleError('Could not write Totem error log', error); }
}

export function recordFailure(context, error) {
  consoleError(`[${context}]`, error);
  return persistError(context, [error]);
}

export function installErrorLogging(surface, writer = writeError) {
  writeError = writer;
  window.addEventListener('error', event => {
    if (event.target === window) {
      void recordFailure(`${surface}.window.error`, event.error ?? event.message);
    } else {
      const target = event.target;
      const resource = target.currentSrc || target.src || target.href;
      if (resource) {
        // Query strings and fragments may contain private access tokens.
        let url;
        try { url = new URL(resource, document.baseURI); }
        catch { return; }
        void recordFailure(`${surface}.resource`, `${target.localName}: ${url.protocol === 'data:' ? 'data URL' : url.origin + url.pathname}`);
      }
    }
  }, { capture: true });
  window.addEventListener('unhandledrejection', event => {
    void recordFailure(`${surface}.unhandledrejection`, event.reason);
  });
  console.error = (...values) => {
    consoleError(...values);
    void persistError(`${surface}.console.error`, values);
  };
}
