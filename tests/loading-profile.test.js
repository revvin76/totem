import test from 'node:test';
import assert from 'node:assert/strict';
import { beginLoadingPhase, loadingProfile, recordLoadingTime, recordFrameTiming, resetFrameTiming, setLoadingSession, snapshotLoadingProfile, timeLoading } from '../src/loading-profile.js';

test('profiling bounds its own browser entries without clearing unrelated measures', () => {
  const debug = console.debug;
  console.debug = () => {};
  performance.measure('other-component', { start: 0, end: performance.now() });
  try {
    for (let i = 0; i < 600; i++) recordLoadingTime('retention', performance.now());
    assert.equal(loadingProfile.entries.length, 512);
    assert.equal(performance.getEntriesByType('measure').filter(e => e.name.startsWith('totem:')).length, 512);
    assert.equal(performance.getEntriesByName('other-component').length, 1);
  } finally { console.debug = debug; performance.clearMeasures('other-component'); }
});

test('async timings preserve results and failures and phase completion is idempotent', async () => {
  const debug = console.debug;
  console.debug = () => {};
  try {
    assert.equal(await timeLoading('success', async () => 42), 42);
    assert.equal(loadingProfile.entries.at(-1).status, 'ok');
    const failure = new Error('fixture failure');
    await assert.rejects(timeLoading('failure', () => { throw failure; }), e => e === failure);
    assert.equal(loadingProfile.entries.at(-1).status, 'error');
    assert.equal(loadingProfile.entries.at(-1).error, 'fixture failure');
    const finish = beginLoadingPhase('once');
    finish('cancelled');
    const count = loadingProfile.entries.length;
    finish();
    assert.equal(loadingProfile.entries.length, count);
    assert.equal(loadingProfile.entries.at(-1).status, 'cancelled');
  } finally { console.debug = debug; }
});

test('frame statistics and session labels are bounded and snapshot samples do not grow later', () => {
  for (let i = 0; i < 600; i++) recordFrameTiming(i * 16, i % 20);
  const snapshot = snapshotLoadingProfile();
  assert.equal(snapshot.frames.count, 600);
  assert.equal(snapshot.frames.samples.length, 512);
  assert.equal(snapshot.frames.intervalMs.median, 16);
  assert.equal(snapshot.frames.intervalMs.p95, 16);
  assert.equal(snapshot.frames.renderSubmissionMs.p95, 19);
  recordFrameTiming(600 * 16, 3);
  assert.equal(snapshot.frames.samples.at(-1).renderDurationMs, 19);
  setLoadingSession({ label: 'x'.repeat(200), cacheCondition: 'process-cold' });
  assert.equal(loadingProfile.session.label.length, 120);
  assert.equal(loadingProfile.session.cacheCondition, 'process-cold');
});

test('resetting frame timing excludes hidden or unmeasured view pauses', () => {
  resetFrameTiming();
  recordFrameTiming(10, 1);
  resetFrameTiming();
  recordFrameTiming(10000, 1);
  assert.equal(loadingProfile.frames.samples.at(-1).interval, null);
  const count = loadingProfile.frames.count;
  recordFrameTiming(9999, 1);
  assert.equal(loadingProfile.frames.count, count);
  recordFrameTiming(10016, 1);
  assert.equal(loadingProfile.frames.samples.at(-1).interval, 16);
});
