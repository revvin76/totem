import assert from 'node:assert/strict';
import test from 'node:test';
import { TikoVoiceEngine } from '../src/tiko-voice-engine.js';
import { TIKO_EXPRESSIONS, TIKO_EMOTIONS } from '../src/tiko-voice-language.js';
import { planTikoVoice, voiceGestureAt } from '../src/tiko-voice-plan.js';
import { DEFAULT_VOICE_PATCH, normalizeVoicePatch, VOICE_CONTROLS } from '../src/tiko-voice-settings.js';
import { createPersonalitySettingsStore } from '../src/totem-personality-config.js';
import { TotemLedMatrix } from '../src/totem-led-display.js';

test('the vocabulary has distinct contours and the cue track respects gaps', () => {
  const expected = { hello: 2, boo: 1, yes: 2, no: 2, wow: 2, hmm: 1, huh: 1, yay: 3, oops: 2, goodbye: 3, laugh: 4, curious: 3 };
  assert.deepEqual(Object.keys(TIKO_EXPRESSIONS), Object.keys(expected));
  for (const [id, count] of Object.entries(expected)) {
    const plan = planTikoVoice(id, { seed: 42 });
    assert.equal(plan.syllables.length, count, id);
    for (const syllable of plan.syllables) {
      assert.equal(voiceGestureAt(plan, (syllable.start + syllable.end) / 2), syllable);
      assert.equal(voiceGestureAt(plan, syllable.end), null);
    }
  }
  const delta = syllable => syllable.pitch.at(-1).hz - syllable.pitch[0].hz;
  assert.ok(delta(planTikoVoice('hello', { seed: 42 }).syllables[1]) > 0);
  for (const emotion of ['neutral', 'playful']) {
    const { duration, syllables: [boo] } = planTikoVoice('boo', { emotion, seed: 42 });
    assert.ok(duration < .25 && boo.attack <= .012);
    assert.ok(boo.pitch[1].hz > boo.pitch[0].hz && delta(boo) < 0);
  }
  const [scoop, hold] = planTikoVoice('wow', { seed: 42 }).syllables;
  assert.ok(delta(scoop) > 100 && hold.pitch[0].hz > scoop.pitch.at(-1).hz);
  assert.throws(() => planTikoVoice('constructor'), /Unknown Tiko expression/);
});

test('patch extremes, mood transforms and variation preserve playable timings and bounds', () => {
  assert.deepEqual(normalizeVoicePatch({ pitch: NaN, volume: Infinity }), DEFAULT_VOICE_PATCH);
  const bounds = [1, 2].map(index => Object.fromEntries(Object.entries(VOICE_CONTROLS).map(([key, spec]) => [key, spec[index]])));
  for (const expression of Object.keys(TIKO_EXPRESSIONS)) {
    for (const emotion of Object.keys(TIKO_EMOTIONS)) {
      for (const patch of bounds) {
        const plan = planTikoVoice(expression, { emotion, patch, seed: 123, intensity: 99 });
        assert.deepEqual(plan, planTikoVoice(expression, { emotion, patch, seed: 123, intensity: 99 }));
        assert.ok(plan.level >= 0 && plan.level <= 1);
        assert.ok(plan.duration > 0 && plan.duration < 5);
        for (const gesture of plan.syllables) {
          assert.ok(gesture.attack > 0 && gesture.release > 0 && gesture.end - gesture.start > gesture.attack + gesture.release);
          assert.ok(gesture.pitch.every(point => point.hz >= 65 && point.hz <= 2250));
          assert.ok(gesture.formants.every(point => point.low < point.high));
        }
      }
    }
  }
  const hello = (emotion, seed) => planTikoVoice('hello', { emotion, seed });
  assert.notDeepEqual(hello('neutral', 1), hello('neutral', 2));
  assert.ok(hello('happy', 1).duration < hello('sad', 1).duration);
  assert.ok(hello('happy', 1).syllables[0].pitch[0].hz > hello('sad', 1).syllables[0].pitch[0].hz);
  assert.ok(hello('happy', 1).syllables[0].formants[0].high > hello('sad', 1).syllables[0].formants[0].high);
});

test('voice presets reload through the revisioned personality store and preserve other owners', async () => {
  let document = { version: 1, revision: null, defaults: { console: { other: true } }, overrides: {} };
  const open = () => createPersonalitySettingsStore({
    loadDocument: async () => structuredClone(document),
    saveDocument: async (value, revision) => {
      assert.equal(revision, document.revision);
      document = { ...value, revision: 'saved' };
      return structuredClone(document);
    },
  });
  const first = open(), stale = open();
  const original = await first.load();
  await stale.load();
  assert.equal(original.voice.enabled, false);
  await first.save({ ...original, voice: { enabled: true, active: 'Round', presets: [{ name: ' Round ', patch: { pitch: 225 } }] } });
  const { voice } = await open().load();
  assert.deepEqual(voice, { enabled: true, active: 'Round', presets: [{ name: 'Round', patch: { ...DEFAULT_VOICE_PATCH, pitch: 225 } }] });
  assert.equal(document.defaults.console.other, true);
  await assert.rejects(stale.save(original), /changed in another editor/);
});

test('speech face is a temporary overlay and leaves the underlying LED expression intact', () => {
  const matrix = new TotemLedMatrix();
  matrix.setExpression('curious', 0);
  const original = matrix.intensity.slice();
  matrix.setVoiceFace('happy', 'surprised', true);
  assert.notDeepEqual(matrix.intensity, original);
  matrix.setVoiceFace(null, null, true);
  assert.deepEqual(matrix.intensity, original);
  assert.equal(matrix.expression, 'curious');
});

function fakeAudio(state = 'running') {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const nodes = [], sources = [];
  const make = () => {
    const node = { connect() {}, disconnect() { this.disconnected = true; }, frequency: param(), detune: param(), Q: param(), gain: param() };
    nodes.push(node);
    return node;
  };
  const context = {
    state, currentTime: 0, destination: {}, nodes, sources,
    createAnalyser: make, createGain: make, createBiquadFilter: make, createPeriodicWave() {},
    createOscillator() {
      const source = Object.assign(make(), { start(at) { this.startedAt = at; }, stop(at) { this.stopsAt = at; }, setPeriodicWave() {} });
      sources.push(source);
      return source;
    },
    async close() { this.state = 'closed'; },
  };
  return context;
}

test('preparing the launcher audio leaves it silent until the timed Boo cue', async () => {
  const context = fakeAudio('suspended');
  context.resume = async () => { context.state = 'running'; };
  const engine = new TikoVoiceEngine(() => context);
  await engine.prepare();
  assert.equal(context.sources.length, 0);
  const event = await engine.speak('boo', { target: 'scene', emotion: 'playful', seed: 22 });
  assert.equal(event.plan.expression, 'boo');
  assert.ok(context.sources.some(source => source.startedAt === event.start));
  await engine.dispose();
});

test('the event API cues from the audio clock, fades interruption and cleans up repeated voices', async () => {
  const context = fakeAudio();
  const engine = new TikoVoiceEngine(() => context);
  const first = await engine.speak('hello', { target: 'scene', seed: 22 });
  assert.equal(first.elapsed() < 0, true);
  context.currentTime = first.start + .05;
  assert.equal(first.gesture(first.elapsed()).index, 0);
  const second = await engine.speak('boo', { target: 'lab', seed: 22 });
  assert.ok(context.sources[0].stopsAt > context.currentTime && context.sources[0].stopsAt < second.start);
  await engine.speak('wow');
  assert.equal(context.sources[0].disconnected, undefined);
  context.sources[0].onended();
  await first.ended;
  await second.ended;
  assert.ok(context.sources.slice(0, 10).every(source => source.disconnected));
  engine.setMuted(true);
  assert.equal(await engine.speak('hello'), null);
  assert.equal(engine.active, null);
  await engine.dispose();
  assert.equal(context.state, 'closed');
  assert.ok(context.nodes.every(node => node.disconnected));
});

test('Stop cancels a pending resume and a lost context can be opened again', async () => {
  const first = fakeAudio('suspended'), second = fakeAudio();
  let resume;
  first.resume = () => new Promise(resolve => { resume = resolve; });
  const contexts = [first, second];
  const engine = new TikoVoiceEngine(() => contexts.shift());
  const pending = engine.speak('hello');
  engine.stop();
  first.state = 'running';
  resume();
  assert.equal(await pending, null);
  assert.equal(first.sources.length, 0);
  const event = await engine.speak('huh');
  first.state = 'closed';
  first.onstatechange();
  await event.ended;
  assert.ok(await engine.speak('huh'));
  await engine.dispose();
  assert.equal(second.state, 'closed');
});
