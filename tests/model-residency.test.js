import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelResidency } from '../src/model-residency.js';

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const loads = [], attached = new Map(), disposed = [], events = [];
  let active = 0, maximum = 0;
  const controller = createModelResidency({
    idle: () => Promise.resolve(),
    load(platform, tier) {
      active++; maximum = Math.max(maximum, active);
      return new Promise((resolve, reject) => loads.push({ id: platform.id, tier,
        finish(fail = false) {
          active--;
          if (fail) reject(new Error('fixture failure'));
          else resolve({ id: platform.id, tier, token: Symbol() });
        },
      }));
    },
    attach(platform, model) { attached.set(platform.id, model); events.push(['attach', platform.id, model.tier]); },
    detach(platform, model) {
      assert.equal(attached.get(platform.id), model);
      attached.delete(platform.id); events.push(['detach', platform.id, model.tier]);
    },
    dispose(model) { assert.ok(![...attached.values()].includes(model)); disposed.push(model); },
  });
  const drain = async () => {
    for (let i = 0; i < 100; i++) {
      await tick();
      if (!loads.length && controller.snapshot().inFlight === 0) break;
      for (const request of loads.splice(0)) request.finish();
      assert.ok(controller.snapshot().displayIds.length <= 3);
    }
    await controller.settled();
    assert.ok(maximum <= 3);
  };
  return { controller, loads, attached, disposed, events, drain };
}
const platforms = Array.from({ length: 8 }, (_, i) => ({ id: String(i) }));

test('previews preserve all carousel positions while only three wrapping neighbours retain display assets', async () => {
  const f = fixture();
  const settled = f.controller.setCollection(platforms, 0);
  await tick();
  assert.deepEqual(f.loads.map(p => [p.id, p.tier]), [['0', 'preview'], ['7', 'preview'], ['1', 'preview']]);
  await f.drain(); await settled;
  assert.deepEqual(new Set(f.controller.snapshot().displayIds), new Set(['0', '7', '1']));
  assert.equal(f.controller.snapshot().previewIds.length, 8);
  assert.equal(f.attached.size, 8);
  await f.controller.ensure('0');
  const next = f.controller.reprioritize(4);
  assert.equal(f.attached.get('0').tier, 'preview');
  await f.drain(); await next;
  assert.deepEqual(new Set(f.controller.snapshot().displayIds), new Set(['4', '3', '5']));
  assert.equal(f.attached.size, 8);
});

test('stale display completion after a jump is disposed without attachment', async () => {
  const f = fixture();
  void f.controller.setCollection(platforms, 0);
  await tick();
  f.loads.shift().finish(); // Selected preview permits its display request.
  await tick();
  const stale = f.loads.find(request => request.id === '0' && request.tier === 'display');
  assert.ok(stale);
  void f.controller.reprioritize(4);
  stale.finish(); f.loads.splice(f.loads.indexOf(stale), 1);
  await tick();
  assert.ok(!f.events.some(event => event[0] === 'attach' && event[1] === '0' && event[2] === 'display'));
  assert.ok(f.disposed.some(model => model.id === '0' && model.tier === 'display'));
  await f.drain();
});

test('display failure retains preview and ensure resolves without waiting for the whole collection', async () => {
  const f = fixture();
  void f.controller.setCollection(platforms, 0);
  const ensured = f.controller.ensure('0');
  await tick();
  f.loads.shift().finish(); await tick();
  const display = f.loads.find(request => request.id === '0' && request.tier === 'display');
  display.finish(true); f.loads.splice(f.loads.indexOf(display), 1);
  await tick();
  assert.equal((await ensured).tier, 'preview');
  assert.equal(f.attached.get('0').tier, 'preview');
  assert.ok(f.controller.snapshot().inFlight > 0);
  await f.drain();
});

test('A–B–A reuses an in-flight display load and never attaches it to B', async () => {
  const f = fixture();
  void f.controller.setCollection(platforms, 0);
  await tick();
  f.loads.shift().finish();
  await tick();
  const original = f.loads.find(request => request.id === '0' && request.tier === 'display');
  assert.ok(original);
  void f.controller.reprioritize(4);
  assert.equal(f.attached.get('0').tier, 'preview');
  void f.controller.reprioritize(0);
  await tick();
  assert.deepEqual(f.loads.filter(request => request.id === '0' && request.tier === 'display'), [original]);
  original.finish();
  f.loads.splice(f.loads.indexOf(original), 1);
  await tick();
  assert.equal(f.attached.get('0').tier, 'display');
  assert.ok(!f.events.some(event => event[1] === '4' && event[2] === 'display'));
  await f.drain();
});

test('filtering and invalidation discard old loads and duplicate IDs are rejected before mutation', async () => {
  const f = fixture();
  void f.controller.setCollection(platforms, 0);
  const oldEnsure = f.controller.ensure('0');
  await tick();
  assert.throws(() => f.controller.setCollection([platforms[0], platforms[0]]), /unique/);
  void f.controller.invalidate('0', { id: '0', edited: true });
  assert.equal(await oldEnsure, null);
  void f.controller.setCollection([platforms[2], platforms[4]], 1);
  await f.drain();
  assert.deepEqual(new Set(f.attached.keys()), new Set(['2', '4']));
  assert.deepEqual(new Set(f.controller.snapshot().displayIds), new Set(['2', '4']));
  assert.equal(await f.controller.ensure('missing'), null);
  await f.controller.setCollection([], 0);
  assert.equal(f.attached.size, 0);
  assert.equal(f.controller.snapshot().displayIds.length, 0);
});

test('invalidation rejects mismatched IDs before changing residents or pending requests', async () => {
  const f = fixture();
  void f.controller.setCollection(platforms, 0);
  await tick();
  const before = f.controller.snapshot();
  assert.throws(() => f.controller.invalidate('0', { id: 'different' }), /retain its ID/);
  assert.throws(() => f.controller.invalidate('0', null), /retain its ID/);
  assert.deepEqual(f.controller.snapshot(), before);
  await f.drain();
  const resident = f.attached.get('0');
  assert.throws(() => f.controller.invalidate('0', { id: 'different' }), /retain its ID/);
  assert.equal(f.attached.get('0'), resident);
  assert.ok(!f.disposed.includes(resident));
  await f.controller.settled();
});

test('failed previews resolve ensure to null and settle without automatic retries', { timeout: 1000 }, async () => {
  const f = fixture();
  const completed = f.controller.setCollection(platforms, 0);
  const ensured = f.controller.ensure('0');
  let attempts = 0;
  for (let i = 0; i < 30; i++) {
    await tick();
    for (const request of f.loads.splice(0)) { attempts++; request.finish(true); }
    if (attempts === platforms.length && f.controller.snapshot().inFlight === 0) break;
  }
  assert.equal(await ensured, null);
  await completed;
  assert.equal(attempts, platforms.length);
  assert.equal(f.controller.snapshot().failures.length, platforms.length);
  assert.equal(f.attached.size, 0);
  await f.controller.reprioritize(4);
  await tick();
  assert.equal(f.loads.length, 0);
  assert.equal(f.controller.snapshot().inFlight, 0);
  assert.equal(await f.controller.ensure('4'), null);
});

test('synchronous loader and idle failures settle every waiting ensure', { timeout: 1000 }, async () => {
  let attempts = 0;
  const controller = createModelResidency({
    load() { attempts++; throw new Error('load threw'); },
    idle() { throw new Error('idle threw'); },
    attach() { assert.fail('failed model cannot attach'); },
    detach() { assert.fail('failed model was never attached'); },
    dispose() { assert.fail('failed model was never returned'); },
  });
  const completed = controller.setCollection(platforms, 0);
  const waiting = platforms.map(platform => controller.ensure(platform.id));
  assert.deepEqual(await Promise.all(waiting), platforms.map(() => null));
  await completed;
  await controller.settled();
  assert.equal(attempts, platforms.length);
  assert.equal(controller.snapshot().failures.length, platforms.length);
  assert.equal(controller.snapshot().inFlight, 0);
  assert.ok(controller.snapshot().maxObservedInFlight <= 3);
});
