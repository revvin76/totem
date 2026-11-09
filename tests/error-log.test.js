import test from 'node:test';
import assert from 'node:assert/strict';

test('Totem records reported errors once and keeps failed resource URLs free of query tokens', async () => {
  const originalError = console.error;
  const records = [], consoleMessages = [];
  console.error = (...values) => consoleMessages.push(values);
  globalThis.window = new EventTarget();
  globalThis.document = { baseURI: 'https://totem.test/' };
  try {
    const { installErrorLogging, recordFailure } = await import('../src/error-log.js');
    installErrorLogging('launcher', async (context, detail) => {
      if (context === 'disk-failure') throw Error('disk full');
      records.push({ context, detail });
    });
    const error = Error('Mascot failed');
    window.dispatchEvent(Object.assign(new Event('error'), { error }));
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'Rejected operation' }));
    console.error('Could not save', { message: 'Settings failure', secret: 'private settings' });
    const resourceEvent = new Event('error');
    Object.defineProperty(resourceEvent, 'target', {
      value: { localName: 'img', src: 'https://totem.test/cover.png?token=private#fragment' },
    });
    window.dispatchEvent(resourceEvent);
    await recordFailure('little-totem.debug.failed', 'Action: console_hops\nConsole: wii');
    await recordFailure('disk-failure', 'Cannot append');
    assert.deepEqual(records.map(record => record.context), [
      'launcher.window.error', 'launcher.unhandledrejection', 'launcher.console.error', 'launcher.resource',
      'little-totem.debug.failed',
    ]);
    assert.match(records[0].detail, /Mascot failed/);
    assert.equal(records[2].detail, 'Could not save\nSettings failure');
    assert.equal(records[3].detail, 'img: https://totem.test/cover.png');
    assert.equal(consoleMessages.at(-1)[0], 'Could not write Totem error log');
  } finally {
    console.error = originalError;
    delete globalThis.window;
    delete globalThis.document;
  }
});
