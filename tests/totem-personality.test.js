import test from 'node:test';
import assert from 'node:assert/strict';
import { TotemPersonality, TOTEM_EVENTS, TOTEM_SEQUENCES, AMBIENT_NAMES } from '../src/totem-personality.js';
import { TotemLedMatrix } from '../src/totem-led-display.js';
import { normalizePersonality, applyPersonalityPreset, createPersonalitySettingsStore, prefersReducedTotemMotion } from '../src/totem-personality-config.js';
import { TIKO_ANIMATION_CUES } from '../src/tiko-animation-cues.js';
import { TIKO_EMOTIONS, TIKO_EXPRESSIONS } from '../src/tiko-voice-language.js';
const advance = (personality, time) => { for (let left = time; left > 0; left -= 100) personality.update(Math.min(100, left)); };

test('Totem can follow the launcher choice or explicitly override the Windows preference', () => {
  const launcher = checked => ({ getElementById: () => checked === undefined ? null : { checked } });
  const windowsReduced = () => ({ matches: true });
  assert.equal(prefersReducedTotemMotion('system', launcher(false), windowsReduced), false);
  assert.equal(prefersReducedTotemMotion('system', launcher(undefined), windowsReduced), true);
  assert.equal(prefersReducedTotemMotion('full', launcher(true), windowsReduced), false);
  assert.equal(prefersReducedTotemMotion('always', launcher(false), windowsReduced), true);
  assert.equal(normalizePersonality({ reducedMotion: 'full' }).reducedMotion, 'full');
});
function companion(config = {}, random = () => 0) {
  const display = new TotemLedMatrix(); display.configure = () => {};
  const personality = new TotemPersonality({ display, config: { ambient: false, ...config }, random }); personality.show(); advance(personality, 600);
  return { personality, display };
}

test('docked startup leaves the visor off, then wakes with a random welcome', () => {
  for (const [roll, expected] of [[0, 'HELLO!'], [.99, "LET'S PLAY!"]]) {
    const { personality, display } = companion({ randomMessages: false }, () => roll);
    const power = [];
    display.setPowered = value => power.push(value);
    personality.startDocked();
    advance(personality, 1000);
    assert.deepEqual(power, [false]);
    assert.equal(personality.active, null);
    advance(personality, 100);
    assert.deepEqual(power, [false, true]);
    assert.equal(personality.active.name, 'wake_up');
    assert.equal(personality.active.steps.at(-1).message, expected);
    advance(personality, personality.active.duration + 100);
    assert.equal(personality.state, 'IDLE');
  }
});

test('event probabilities roll once; repeated logical events deduplicate including failed rolls', () => {
  let rolls = 0;
  const { personality } = companion({}, () => { rolls++; return .5; });
  assert.equal(personality.event('platform_changed', 'a'), false);
  const count = rolls; personality.event('platform_changed', 'a'); advance(personality, 2000); assert.equal(rolls, count);
  assert.equal(personality.event('favourite_added', 'game'), true); assert.equal(personality.active.name, 'celebrate_favourite');
  for (const rule of Object.values(TOTEM_EVENTS)) { assert.ok(rule.probability > 0 && rule.probability <= 1); assert.ok(TOTEM_SEQUENCES[rule.sequence]); }
});

test('hover settles for 600ms, cancels stale selection, and observes cooldown', () => {
  const { personality } = companion();
  personality.event('new_highlighted', 'a'); advance(personality, 500); assert.equal(personality.active, null);
  personality.event('new_highlighted', 'b'); advance(personality, 500); assert.equal(personality.active, null);
  advance(personality, 100); assert.equal(personality.active.name, 'discover_game');
  personality.reset(); personality.event('platform_changed', 'c'); assert.equal(personality.active, null);
  personality.event('favourite_added', 'd'); assert.equal(personality.active.name, 'celebrate_favourite');
});

test('high priority interrupts ambient; welcome is respected but critical failure can interrupt', () => {
  const { personality, display } = companion(); personality.play('show_off');
  personality.event('favourite_added', 'a'); assert.equal(personality.active.name, 'celebrate_favourite');
  personality.event('platform_changed', 'b'); assert.equal(personality.active.name, 'celebrate_favourite');
  personality.play('welcome_back', 2, 'REACTING', true);
  personality.event('controller_connected', 'pad'); assert.equal(personality.active.name, 'welcome_back');
  personality.event('launch_failed', 'attempt'); assert.equal(personality.active.name, 'launch_failed');
  advance(personality, 6000); assert.equal(display.expression, 'neutral'); assert.equal(personality.active, null);
});

test('all sequences complete with bounded movement, recover pose and keep history bounded', () => {
  const { personality } = companion({ flight: true });
  assert.deepEqual(Object.keys(TIKO_ANIMATION_CUES).sort(), Object.keys(TOTEM_SEQUENCES).sort());
  let voice;
  personality.onVoice = (expression, { emotion }) => {
    const { definition, steps, index } = personality.active;
    voice.push([expression, emotion, definition.steps.indexOf(steps[index])]);
  };
  for (const name of Object.keys(TOTEM_SEQUENCES)) {
    voice = [];
    const cue = TIKO_ANIMATION_CUES[name];
    if (cue) {
      assert.ok(Object.hasOwn(TIKO_EXPRESSIONS, cue[0]) && Object.hasOwn(TIKO_EMOTIONS, cue[1]), name);
      assert.ok(TOTEM_SEQUENCES[name].steps[cue[2] ?? 0], name);
    }
    personality.show(); personality.play(name, 3, 'AMBIENT', true);
    for (let i = 0; i < 100; i++) {
      personality.update(100);
      assert.ok(Math.abs(personality.pose.x) <= .31); assert.ok(Math.abs(personality.pose.y) <= .2);
    }
    assert.equal(personality.active, null, name); assert.ok(personality.history.length <= 12);
    assert.deepEqual(voice, cue ? [[cue[0], cue[1], cue[2] ?? 0]] : [], name);
  }
  assert.equal(AMBIENT_NAMES.length, 14); // Chase-own-orbit omitted: model has no orbit.
});

test('hidden/gameplay/disabled state suspends clock and pending work; return uses genuine gameplay boundary', () => {
  const { personality } = companion(); personality.event('new_highlighted', 'a'); personality.setGameplay(true);
  const now = personality.now; advance(personality, 10000); assert.equal(personality.now, now); assert.equal(personality.state, 'HIDDEN'); assert.equal(personality.pendingHover, null);
  personality.setGameplay(false); assert.equal(personality.active.name, 'welcome_back');
  personality.configure({ enabled: false }); assert.equal(personality.state, 'HIDDEN'); personality.show(); assert.equal(personality.visible, false);
  personality.dispose(); assert.equal(personality.history.length, 0);
});

test('reduced motion suppresses flight/spin/bob and category toggles override presets', () => {
  const { personality } = companion({ reducedMotion: 'always', preset: 'playful', categories: { favourites: false } });
  assert.equal(personality.event('favourite_added', 'a'), false);
  personality.play('show_off'); advance(personality, 800);
  assert.deepEqual(personality.pose, { x: 0, y: 0, pitch: 0, yaw: 0, roll: 0, headPitch: 0, headYaw: 0, headRoll: 0, wing: 'normal' });
  personality.event('new_highlighted', 'a'); personality.configure({ reactions: false }); advance(personality, 1000); assert.notEqual(personality.active?.name, 'discover_game');
});

test('ambient eligible time, no consecutive activities/spins, and sleep recovery', () => {
  const { personality } = companion({ ambient: true, idleMin: 20, idleMax: 20 });
  advance(personality, 19400); assert.ok(personality.active);
  advance(personality, 10000); const previous = personality.history.at(-1).name;
  personality.randomActivity(); assert.notEqual(personality.active.name, previous);
  personality.play('fall_asleep', 0, 'AMBIENT', true); advance(personality, 6000);
  personality.play('celebrate_favourite', 2, 'REACTING'); assert.equal(personality.active.steps[0].expression, 'sleepy');
});

test('the rare flight slot cannot select the scene-owned peek-a-boo', () => {
  const { personality } = companion({ ambient: true }, () => 0);
  personality.now = 599999;
  personality.randomActivity(); assert.notEqual(personality.active.name, 'hide_and_seek');
  personality.now = 600001;
  personality.randomActivity(); assert.equal(personality.active.name, 'upside_down_flight');
  personality.now = 606000;
  personality.randomActivity(); assert.notEqual(personality.active.name, 'upside_down_flight');
});

test('bounded configuration and presets preserve disabled categories', () => {
  const config = normalizePersonality({ brightness: Infinity, glow: -1, cooldown: 0, idleMin: 200, idleMax: 30, color: 'bad', categories: { games: false } });
  assert.equal(config.brightness, 1); assert.equal(config.glow, 0); assert.equal(config.cooldown, 2); assert.equal(config.idleMax, 200); assert.equal(config.color, '#51F4FF');
  assert.equal(applyPersonalityPreset(config, 'subtle').categories.games, false); assert.equal(applyPersonalityPreset(config, 'playful').idleMin, 25);
});

test('existing document service persists only personality and preserves other owners through reload and reset', async () => {
  let persisted = { version: 1, revision: null, defaults: { handheld: { setting: 3 } }, overrides: {}, environment: { color: 'purple' }, other: 'keep' };
  const backend = {
    loadDocument: async () => structuredClone(persisted),
    saveDocument: async (next, revision) => { assert.equal(revision, persisted.revision); persisted = JSON.parse(JSON.stringify({ ...next, revision: 'new' })); return structuredClone(persisted); },
  };
  const store = createPersonalitySettingsStore(backend); const config = await store.load(); assert.equal(config.preset, 'balanced');
  await store.save({ ...config, enabled: false, brightness: .3, color: '#123456', categories: { games: false } });
  const reloaded = await createPersonalitySettingsStore(backend).load(); assert.equal(reloaded.enabled, false); assert.equal(reloaded.brightness, .3); assert.equal(reloaded.color, '#123456'); assert.equal(reloaded.categories.games, false);
  assert.deepEqual(persisted.defaults, { handheld: { setting: 3 } }); assert.equal(persisted.other, 'keep'); assert.deepEqual(persisted.environment, { color: 'purple' });
  await store.save({}); assert.equal((await store.load()).enabled, true);
  const failed = createPersonalitySettingsStore({ ...backend, saveDocument: async () => { throw Error('Conflict'); } });
  await assert.rejects(failed.save({ enabled: false }), /Conflict/);
});
