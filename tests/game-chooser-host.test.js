import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountGameLibrary } from '../src/game-chooser-host.js';

test('only the open native chooser can launch a game from its current platform list', async (t) => {
  const origin = 'http://totem.test';
  const host = new EventTarget();
  const replies = [];
  const invocations = [];
  const launches = [];
  const chooserMessages = [];
  let finishLaunch;
  const frame = new EventTarget();
  frame.style = {};
  frame.focus = () => {};
  // Node restricts MessageEvent.source to MessagePorts; a simple event lets
  // the fixture represent the browser's iframe window without opening one.
  function fromFrame(data, source = frame.contentWindow, from = origin) {
    host.dispatchEvent(Object.assign(new Event('message'), { data, source, origin: from }));
  }
  frame.contentWindow = {
    postMessage(message) {
      if (message.gameChooser) chooserMessages.push(message);
      if (message.gameChooser === 'prepare')
        queueMicrotask(() => fromFrame({ gameChooser: 'prepared', request: message.request }));
      else if (message.studioReply) replies.push(message);
    },
  };
  const dialog = new EventTarget();
  Object.assign(dialog, {
    style: {}, open: false,
    setAttribute() {},
    append() { queueMicrotask(() => fromFrame({ gameChooser: 'ready' })); },
    showModal() { this.open = true; },
    close() { this.open = false; },
  });
  host.__TAURI_INTERNALS__ = {
    invoke(command, args) {
      invocations.push({ command, args });
      return new Promise(resolve => { finishLaunch = resolve; });
    },
  };
  host.addEventListener('horizon:game-selected', (event) => launches.push(event.detail));
  const globals = {
    window: host, location: { origin }, isTauri: true,
    document: { activeElement: null, createElement: tag => tag === 'dialog' ? dialog : frame,
      body: { append() {}, classList: { add() {}, remove() {} } } },
  };
  for (const [key, value] of Object.entries(globals)) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => old ? Object.defineProperty(globalThis, key, old) : delete globalThis[key]);
  }

  const game = { id: 'library-nes-1', title: 'Test Game', platformId: 'nes' };
  let gameReads = 0;
  const chooser = mountGameLibrary({ library: { games: async () => { gameReads++; return [game]; } }, reducedMotion: () => true });
  await chooser.warmShell();
  assert.equal(gameReads, 0);
  assert.deepEqual(chooserMessages, []);
  chooser.runAction('launch-game');
  await chooser.open({ id: 'nes' });
  assert.equal(gameReads, 1);
  chooser.runAction('filters');
  assert.deepEqual(chooserMessages.map(message => message.gameChooser), ['prepare', 'resume', 'action']);
  assert.deepEqual(chooserMessages.at(-1), { gameChooser: 'action', action: 'filters' });
  const launch = (studioRequest, gameId) => ({ studioRequest, command: 'launch_game', args: { gameId } });
  fromFrame(launch('wrong-window', game.id), {});
  fromFrame(launch('wrong-origin', game.id), frame.contentWindow, 'http://other.test');
  fromFrame(launch('other-game', 'library-unknown'));
  fromFrame(launch('selected', game.id));
  fromFrame(launch('repeat', game.id));
  assert.deepEqual(invocations, [{ command: 'launch_game', args: { gameId: game.id } }]);
  const finished = new Promise(resolve => host.addEventListener('horizon:game-selected', resolve, { once: true }));
  finishLaunch('Test Emulator');
  await finished;
  assert.deepEqual(launches, [{ ...game, emulator: 'Test Emulator' }]);
  const status = { phase: 'ended', message: 'Launched emulator process exited.' };
  host.dispatchEvent(new CustomEvent('totem:emulator-exit-status', { detail: status }));
  assert.deepEqual(chooserMessages.at(-1), { gameChooser: 'emulator-exit', status });
  chooser.close();
  fromFrame(launch('closed', game.id));
  assert.deepEqual(replies.map(reply => [reply.studioReply, reply.result ?? Boolean(reply.error)]), [
    ['other-game', true], ['repeat', true], ['selected', 'Test Emulator'], ['closed', true],
  ]);
});
