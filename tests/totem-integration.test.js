import test from 'node:test';
import assert from 'node:assert/strict';
import { connectTotemClicks, connectTotemEvents, personalitySettingsStore } from '../src/totem-personality-integration.js';

test('Totem consumes a mascot click without hijacking control presses or carousel drags', () => {
  const target = new EventTarget(), gaze = []; let reactions = 0, scenePresses = 0;
  const stop = connectTotemClicks(target, event => event.clientX < 50, () => reactions++, () => true,
    event => gaze.push([event?.clientX, reactions]));
  target.addEventListener('pointerdown', () => scenePresses++);
  const pointer = (type, x, pointerType = 'mouse') => {
    const event = Object.assign(new Event(type, { cancelable: true }), { button: 0, clientX: x, clientY: 10, pointerId: 1, pointerType });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(pointer('pointerdown', 60), false);
  assert.equal(pointer('pointermove', 31), false);
  pointer('pointermove', 36, 'touch');
  pointer('pointerup', 25);
  assert.equal(pointer('pointerdown', 25), true);
  pointer('pointerup', 42);
  assert.equal(pointer('pointerdown', 25), true);
  pointer('pointerup', 27);
  pointer('pointerout', 27);
  assert.deepEqual([scenePresses, reactions], [1, 1]);
  assert.deepEqual(gaze, [[31, 0], [27, 0], [undefined, 1]]);
  stop();
  pointer('pointerdown', 25); pointer('pointerup', 25);
  assert.deepEqual([scenePresses, reactions], [2, 1]);
});

test('actual launcher event names connect once, do not infer launches, and disconnect cleanly', () => {
  const target = new EventTarget(), events = []; let cancellations = 0;
  const personality = { now: 100, event: (...args) => events.push(args), cancelHover: () => cancellations++ };
  const disconnect = connectTotemEvents(personality, target, null);
  const dispatch = (name, detail, gamepad) => { const event = new Event(name); Object.assign(event, { detail, gamepad }); target.dispatchEvent(event); };
  dispatch('horizon:platform-selected', { id: 'switch' }); dispatch('totem:library-rescanned', { revision: 'one' });
  dispatch('gamepadconnected', null, { index: 0 }); dispatch('gamepaddisconnected', null, { index: 0 });
  dispatch('horizon:game-selected', { id: 'game' });
  assert.deepEqual(events.map(([name]) => name), ['platform_changed', 'library_scan_complete', 'controller_connected', 'controller_disconnected']);
  assert.equal(cancellations, 2); disconnect(); dispatch('gamepadconnected', null, { index: 0 }); assert.equal(events.length, 4);
});

test('real browser Studio configuration adapter survives fresh store creation, verifies persistence and rejects concurrent personality edits', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const store = personalitySettingsStore(storage), initial = await store.load();
  await store.save({ ...initial, brightness: .4, color: '#12abcd', blinking: false });
  const reloaded = personalitySettingsStore(storage); const config = await reloaded.load();
  assert.equal(config.brightness, .4); assert.equal(config.color, '#12abcd'); assert.equal(config.blinking, false);
  const other = personalitySettingsStore(storage); await other.load(); await other.save({ ...config, enabled: false });
  await assert.rejects(reloaded.save({ ...config, brightness: .5 }), /changed in another editor/);
  const document = JSON.parse(storage.getItem('totem.studio.preview')); assert.equal(document.personality.enabled, false); assert.equal(values.size, 1);
});
