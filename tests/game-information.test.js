import assert from 'node:assert/strict';
import test from 'node:test';
import { mountGameInformation } from '../light-study/game-information.js';

function fixture(inspect) {
  const status = {};
  const details = {
    children: [],
    replaceChildren() { this.children = []; },
    append(...children) { this.children.push(...children); },
  };
  const button = { addEventListener(_event, callback) { this.click = callback; } };
  const dialog = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; this.onClose(); },
    addEventListener(_event, callback) { this.onClose = callback; },
    querySelector(selector) { return selector === 'dl' ? details : status; },
    ownerDocument: { createElement(tag) { return { tag }; } },
  };
  const view = mountGameInformation(button, dialog, () => ({ id: 'indexed-game' }), inspect);
  return { button, status, details, view };
}

test('game information shows source and ambiguous emulator details as text', async () => {
  const { button, details, view } = fixture(async id => {
    assert.equal(id, 'indexed-game');
    return {
      id, title: '<Game>', platformId: 'windows', platformName: 'Windows PC',
      originalPath: 'D:\\Left\\Same.cmd', extension: 'cmd', fileStatus: 'regularFile',
      provenance: { root: 'D:\\Left', admissions: [
        { kind: 'imported', collectionName: 'Left', collectionId: 'left', rule: 'override' },
      ] },
      launch: { status: 'ambiguous', reason: 'More than one runtime is available.', matchingEmulators: [
        { id: 'one', name: 'Runtime One', executableAvailable: true },
        { id: 'two', name: 'Runtime Two', executableAvailable: true },
      ] },
    };
  });
  view.setAvailable(true);
  assert.equal(button.hidden, false);
  await button.click();
  const values = details.children.filter(node => node.tag === 'dd').map(node => node.textContent);
  assert.ok(values.includes('<Game>'));
  assert.ok(values.includes('D:\\Left\\Same.cmd'));
  assert.ok(values.includes('Imported collection · Left · left'));
  assert.ok(values.some(value => value.includes('platform extension override')));
  assert.ok(values.includes('More than one runtime is available.'));
  assert.ok(values.includes('Runtime Two · Executable present'));
});

test('game information ignores stale replies and shows recoverable request errors', async () => {
  let resolve;
  let requests = 0;
  const { button, status, details, view } = fixture(() => {
    if (++requests === 1) return new Promise(done => { resolve = done; });
    throw new Error('Game is no longer indexed.');
  });
  const stale = button.click();
  assert.equal(status.textContent, 'Loading game information…');
  view.close();
  await button.click();
  resolve(null);
  await stale;
  assert.match(status.textContent, /Could not load game information.*no longer indexed/);
  assert.deepEqual(details.children, []);
  view.close();
  assert.equal(view.open, false);
});
