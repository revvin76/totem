import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuTimer } from '../src/gpu-timer.js';

function context({ supported = true } = {}) {
  const extension = { GPU_DISJOINT_EXT: 'disjoint', TIME_ELAPSED_EXT: 'elapsed' };
  const state = { queries: [], deleted: [], active: null, disjoint: false, lost: false, ready: false, failAllocation: false };
  const gl = {
    QUERY_RESULT_AVAILABLE: 'available', QUERY_RESULT: 'result',
    getExtension: () => supported ? extension : null,
    isContextLost: () => state.lost,
    getParameter: () => state.disjoint,
    createQuery: () => {
      if (state.failAllocation) return null;
      const query = { id: state.queries.length };
      state.queries.push(query); return query;
    },
    beginQuery: (_, query) => { assert.ok(query); assert.equal(state.active, null); state.active = query; },
    endQuery: () => { assert.ok(state.active); state.active = null; },
    getQueryParameter: (_, parameter) => parameter === 'available' ? state.ready : 16_000_000,
    deleteQuery: query => { assert.ok(!state.deleted.includes(query)); state.deleted.push(query); },
  };
  return { gl, state };
}

test('GPU queries are nonblocking and outstanding work is bounded to four', () => {
  const { gl, state } = context();
  const timer = createGpuTimer(gl);
  for (let i = 0; i < 20; i++) { timer.begin(); timer.end(); }
  assert.equal(state.queries.length, 4);
  assert.equal(timer.samples.length, 0);
  state.ready = true;
  timer.begin(); timer.end();
  assert.equal(state.deleted.length, 4);
  assert.deepEqual(timer.samples, [16, 16, 16, 16]);
  timer.dispose();
  assert.equal(state.deleted.length, state.queries.length);
});

test('disjoint periods discard pending results and do not begin invalid intervals', () => {
  const { gl, state } = context();
  const timer = createGpuTimer(gl);
  timer.begin(); timer.end();
  state.disjoint = true;
  timer.begin(); timer.end();
  assert.equal(state.deleted.length, 1);
  assert.equal(state.queries.length, 1);
  assert.equal(timer.samples.length, 0);
  state.disjoint = false;
  state.ready = true;
  timer.begin(); timer.end();
  assert.equal(timer.samples.length, 0);
  timer.dispose();
});

test('tagged frame completion is reported only for a ready, valid GPU query', () => {
  const { gl, state } = context();
  const timer = createGpuTimer(gl);
  const completed = [];
  timer.begin(() => completed.push('valid')); timer.end();
  timer.begin(); timer.end();
  assert.deepEqual(completed, []);
  state.ready = true;
  timer.begin(() => completed.push('disjoint')); timer.end();
  assert.deepEqual(completed, ['valid']);
  state.disjoint = true;
  timer.begin();
  assert.deepEqual(completed, ['valid']);
  timer.dispose();
});

test('reentrant begin and failed query allocation do not leak or issue invalid GL calls', () => {
  const { gl, state } = context();
  const timer = createGpuTimer(gl);
  timer.begin(); timer.begin(); timer.end();
  assert.equal(state.queries.length, 1);
  timer.dispose();
  assert.equal(state.deleted.length, 1);
  state.failAllocation = true;
  timer.begin(); timer.end();
});

test('unsupported or lost contexts do no work, sample retention remains bounded', () => {
  const unsupported = context({ supported: false });
  const noTimer = createGpuTimer(unsupported.gl);
  noTimer.begin(); noTimer.end(); noTimer.dispose();
  assert.equal(unsupported.state.queries.length, 0);
  const { gl, state } = context();
  const timer = createGpuTimer(gl);
  state.lost = true;
  timer.begin(); timer.end();
  assert.equal(state.queries.length, 0);
  state.lost = false; state.ready = true;
  for (let i = 0; i < 600; i++) { timer.begin(); timer.end(); }
  assert.equal(timer.samples.length, 512);
  timer.dispose();
  assert.equal(state.deleted.length, state.queries.length);
});
