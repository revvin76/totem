import test from 'node:test';
import assert from 'node:assert/strict';
import { TotemLedMatrix } from '../src/totem-led-display.js';
import { TotemPersonality } from '../src/totem-personality.js';
import { drawVisorAnimation, drawVisorMessage, message, MESSAGE_STEP_MS, VISOR_PROGRAMS } from '../src/totem-visor-programs.js';

function companion(config, random = () => 0) {
  const display = new TotemLedMatrix();
  const personality = new TotemPersonality({ display, config, random });
  personality.show();
  advance(personality, 600);
  return { personality, display };
}

function advance(personality, time, reduced = false) {
  while (time > 0) {
    const dt = Math.min(time, 100);
    personality.update(dt, reduced);
    time -= dt;
  }
}

const matrix = new TotemLedMatrix();
const neutral = { ...matrix.masks.neutral, happy: matrix.masks.happy };
function frame(name, t) {
  const pixels = new Uint8Array(800);
  drawVisorAnimation(pixels, name, t, 42, neutral);
  return pixels;
}
const at = (p, x, y) => p[y * 40 + x];
function points(pixels, level = 1) {
  return Array.from(pixels.entries()).flatMap(([i, value]) => value >= level ? [[i % 40, Math.floor(i / 40)]] : []);
}
function bounds(pixels, level) {
  const lit = points(pixels, level), x = lit.map(point => point[0]), y = lit.map(point => point[1]);
  return { left: Math.min(...x), right: Math.max(...x), top: Math.min(...y), bottom: Math.max(...y) };
}

test('short and long messages enter from the right and exit left, with an authored BOO hold', () => {
  for (const text of ['HI!', 'WHERE ARE WE GOING?']) {
    const pixels = new Uint8Array(800), duration = message(text).duration;
    drawVisorMessage(pixels, text, 0);
    assert.ok(!pixels.some(Boolean));
    drawVisorMessage(pixels, text, 3 * MESSAGE_STEP_MS);
    assert.ok(bounds(pixels).left >= 37);
    drawVisorMessage(pixels, text, duration - 4 * MESSAGE_STEP_MS);
    assert.ok(bounds(pixels).right <= 2 && pixels.some(Boolean));
    drawVisorMessage(pixels, text, duration - MESSAGE_STEP_MS);
    assert.ok(!pixels.some(Boolean));
  }
  const [{ message: text, hold }] = VISOR_PROGRAMS.cheeky_boo.steps;
  const pixels = new Uint8Array(800);
  drawVisorMessage(pixels, text, 0, hold);
  const opening = pixels.slice();
  drawVisorMessage(pixels, text, 600, hold);
  assert.deepEqual(pixels, opening);
  assert.equal(text, 'BOO!');
});

test('battery shows a low bar, empties, flashes twice, shows a bolt and fills five bars', () => {
  const bars = t => [8, 13, 18, 23, 28].map(x => at(frame('battery_recharge', t), x, 7) > 100);
  assert.deepEqual(bars(.02), [true, false, false, false, false]);
  assert.deepEqual(bars(.20), Array(5).fill(false));
  assert.deepEqual([.25, .30, .35, .40].map(t => at(frame('battery_recharge', t), 4, 9) > 100), [true, false, true, false]);
  assert.equal(at(frame('battery_recharge', .48), 19, 9), 255);
  assert.deepEqual(bars(.65), [true, true, false, false, false]);
  assert.deepEqual(bars(.95), Array(5).fill(true));
  assert.equal(at(frame('battery_recharge', .95), 11, 7), 0, 'no eyes remain between battery bars');
});

test('Pong moves both paddles, bounces at the walls, misses the left paddle and draws the winner score', () => {
  const ball = t => bounds(frame('pixel_pong', t), 255);
  assert.deepEqual([.18, .25, .40, .50, .64].map(t => ball(t).top), [3, 1, 11, 18, 11]);
  assert.ok(ball(.18).left > 30 && ball(.40).right < 7);
  const paddleTop = (t, x) => points(frame('pixel_pong', t), 215).filter(([column, row]) => column === x && at(frame('pixel_pong', t), x, row) === 215)[0][1];
  assert.ok(paddleTop(.18, 37) < paddleTop(.64, 37));
  assert.ok(paddleTop(.4, 2) > paddleTop(.18, 2));
  assert.ok(ball(.84).bottom < paddleTop(.84, 2));
  assert.equal(at(frame('pixel_pong', .95), 20, 9), 255, 'score has a centre dash');
  assert.equal(at(frame('pixel_pong', .95), 36, 9), 0, 'paddles clear for the score');
});

test('Chasing Dot follows the storyboard and moves both eyes; Eye Escape detaches and returns', () => {
  for (const [t, x, y] of [[.12, 20, 4], [.25, 34, 9], [.49, 8, 15], [.68, 20, 17], [.94, 39, 3]]) {
    assert.deepEqual(points(frame('chasing_dot', t), 255), [[x, y]]);
  }
  const eyeLeft = t => bounds(frame('chasing_dot', t), 160).left;
  assert.ok(eyeLeft(.25) > eyeLeft(.12));
  assert.ok(bounds(frame('chasing_dot', .68), 160).top > bounds(frame('chasing_dot', .12), 160).top);
  assert.equal(points(frame('chasing_dot', .995), 255).length, 0);
  assert.ok(bounds(frame('eye_escape', .34), 240).top < bounds(frame('eye_escape', 0), 240).top);
  assert.ok(bounds(frame('eye_escape', .53), 240).right > 32);
  assert.deepEqual(frame('eye_escape', 1), frame('eye_escape', 0));
});

test('Face Melt pools both features at the bottom and rain drops descend before revealing the live face', () => {
  const pool = bounds(frame('face_melt', .63));
  assert.ok(pool.top >= 17 && pool.bottom === 19);
  assert.deepEqual(frame('face_melt', .98), frame('face_melt', 0));
  const first = frame('matrix_rain', .05), later = frame('matrix_rain', .15);
  assert.ok(points(first, 255).some(([x, y]) => y < 15 && [3, 4, 5].some(dy => at(later, x, y + dy) === 255)));
  assert.ok(points(first, 1).every(([x]) => x % 2 === 1), 'the opening completely replaces the face');
  assert.deepEqual(frame('matrix_rain', 1), frame('face_melt', 0));
});

test('blocks shift and clear a row, a spinner makes a tick, the heart pulses twice, and a wave reflects and dissolves', () => {
  assert.ok(bounds(frame('falling_blocks', .10), 200).bottom > bounds(frame('falling_blocks', .035), 200).bottom);
  assert.deepEqual(points(frame('falling_blocks', .785), 255).map(([, y]) => y), [...Array(20).fill(17), ...Array(20).fill(18)]);
  assert.equal(points(frame('falling_blocks', .94), 200).length, 0);
  assert.ok(bounds(frame('loading_brain', .09), 200).top > bounds(frame('loading_brain', .005), 200).top);
  assert.equal(at(frame('loading_brain', .90), 23, 7), 255);
  const area = t => points(frame('pixel_heartbeat', t)).length;
  assert.ok(area(.25) > area(.05) && area(.75) > area(.50));
  assert.ok(bounds(frame('led_wave', .50), 200).left > bounds(frame('led_wave', .20), 200).left);
  assert.ok(bounds(frame('led_wave', .74), 200).right < 25 && points(frame('led_wave', .96), 200).length < 3);
});

test('other cartoons have readable moving subjects and payoffs', () => {
  assert.ok(bounds(frame('hypnotic_spiral', .02), 255).left > 25);
  assert.deepEqual(points(frame('hypnotic_spiral', .50), 255), [[19, 9]]);
  assert.ok(bounds(frame('hypnotic_spiral', .97), 255).left > 25);
  assert.deepEqual(frame('screen_glitch', 0), frame('screen_glitch', 1));
  assert.ok(bounds(frame('screen_glitch', .55), 200).left < 4);
  assert.ok(bounds(frame('pixel_fireworks', .12), 200).top < bounds(frame('pixel_fireworks', .03), 200).top);
  assert.ok(points(frame('pixel_fireworks', .42), 200).length > 4);
  assert.ok(bounds(frame('pixel_alien', .15), 200).right < bounds(frame('pixel_alien', .88), 200).left);
  assert.notEqual(at(frame('pixel_alien', .37), 25, 7), at(frame('pixel_alien', .41), 25, 7));
  assert.ok(points(frame('snake_game', .62)).length > points(frame('snake_game', .12)).length);
  assert.equal(at(frame('snake_game', .84), 27, 14), 255);
  assert.ok([5, 17, 29].every(x => at(frame('slot_machine', .90), x, 8) === 255));
  assert.ok(bounds(frame('pixel_caterpillar', .49), 200).left > 25 && !frame('pixel_caterpillar', .99).some(Boolean));
  assert.deepEqual([.10, .45, .81].map(t => points(frame('countdown', t)).length), [60, 56, 40]);
  assert.ok(frame('screen_cleaner', 0).some(Boolean) && points(frame('screen_cleaner', .50), 100).length === 0);
  assert.equal(at(frame('screen_cleaner', 1), 31, 8), matrix.masks.happy.eyes[8 * 40 + 31] * 255);
  assert.notEqual(bounds(frame('pixel_dance', .03), 120).top, bounds(frame('pixel_dance', .95), 120).top);
  assert.ok(bounds(frame('searching_radar', .08), 200).bottom > bounds(frame('searching_radar', .20), 200).bottom);
  assert.deepEqual([.79, .83, .88].map(t => at(frame('searching_radar', t), 16, 4)), [0, 145, 255]);
  assert.ok(bounds(frame('mini_space_battle', .66), 200).top < bounds(frame('mini_space_battle', .57), 200).top);
  assert.ok(points(frame('mini_space_battle', .79), 200).length > 15);
  assert.ok(bounds(frame('pixel_sneeze', .50), 200).left < bounds(frame('pixel_sneeze', 0), 200).left);
  assert.ok(bounds(frame('escaped_heart', .10), 200).left > bounds(frame('escaped_heart', .30), 200).left);
  assert.ok(bounds(frame('pixel_hiccup', .45), 200).bottom > bounds(frame('pixel_hiccup', 0), 200).bottom);
});

test('story frames restore the live expression, including changes made while the visor is covered', () => {
  const { personality, display } = companion({ ambient: false });
  display.setExpression('happy', 0);
  const original = display.intensity.slice();
  personality.play('pixel_pong');
  advance(personality, 500);
  assert.equal(display.mode, 'animation');
  display.setExpression('curious', 0);
  personality.navigation();
  assert.equal(personality.active, null);
  assert.equal(display.mode, 'expression');
  assert.equal(display.expression, 'curious');
  assert.notDeepEqual(display.intensity, original);
  personality.play('pixel_sneeze');
  advance(personality, 500);
  display.setExpression('happy', 0);
  advance(personality, 3000);
  assert.equal(display.expression, 'happy');
  assert.deepEqual(display.intensity, original);
  personality.play('face_melt');
  advance(personality, 500);
  personality.configure({ ambient: false });
  assert.equal(display.mode, 'expression');
  advance(personality, 80);
  assert.deepEqual(display.intensity, original);
});

test('the elapsed clock gives battery cues at the story beats and supports stationary frame inspection', () => {
  const first = companion({ ambient: false }), second = companion({ ambient: false });
  for (const { personality } of [first, second]) personality.play('battery_recharge');
  advance(first.personality, 2160);
  for (let i = 0; i < 72; i++) second.personality.update(30);
  assert.deepEqual(first.display.intensity, second.display.intensity);
  assert.equal(first.personality.pose.wing, 'burst');
  advance(first.personality, 1500);
  assert.equal(first.personality.pose.wing, 'slow');
  advance(first.personality, 1450);
  assert.equal(first.personality.pose.wing, 'flutter');

  const reduced = companion({ ambient: false, reducedMotion: 'always' });
  assert.equal(reduced.personality.play('chasing_dot'), false);
  assert.equal(reduced.personality.playDefinition('chasing_dot', VISOR_PROGRAMS.chasing_dot, 3, 'AMBIENT', true, undefined, { inspect: true }), true);
  reduced.personality.update(0, true);
  assert.deepEqual(points(reduced.display.intensity, 255), [[20, 4]]);
  advance(reduced.personality, 1100, true);
  assert.ok(points(reduced.display.intensity, 255)[0][0] > 31);
  assert.equal(reduced.personality.pose.headYaw, 0);
});

test('the balanced scheduler keeps visor effects and surprises on their separate idle cadences', () => {
  const { personality } = companion({ idleMin: 300, idleMax: 300 });
  const first = {};
  for (let elapsed = 0; elapsed < 750000; elapsed += 100) {
    advance(personality, 100);
    const kind = personality.active?.definition.kind;
    if (kind) first[kind] ??= personality.visorIdle;
  }
  assert.deepEqual(first, { gaze: 10000, animation: 20000, message: 180000, game: 300000, surprise: 540000 });
});

test('a launch event replaces Pong with GO, while toggles and reduced motion prevent automatic visor playback', () => {
  const { personality, display } = companion({ ambient: false, preset: 'subtle' }, () => .99);
  personality.play('sleep');
  advance(personality, 12000);
  assert.equal(personality.condition, 'sleepy');
  personality.play('pixel_pong');
  advance(personality, 400);
  assert.equal(personality.event('play_selected', 'game-1'), true);
  advance(personality, 100);
  assert.equal(personality.active.name, 'launch_game');
  assert.equal(display.mode, 'message');
  advance(personality, 80);
  const expected = new Uint8Array(800); drawVisorMessage(expected, 'GO!', 0, 600);
  assert.deepEqual(display.intensity, expected);
  const disabled = companion({ miniAnimations: false, randomMessages: false, screenSurprises: false });
  assert.equal(disabled.personality.play('matrix_rain'), false);
  disabled.personality.event('search_found', 'search');
  advance(disabled.personality, 200);
  assert.equal(disabled.display.mode, 'expression');
  assert.equal(disabled.personality.currentMood, 'excited');
  const reduced = companion({ ambient: true, idleMin: 300, idleMax: 300 });
  advance(reduced.personality, 46000, true);
  assert.equal(reduced.display.mode, 'expression');
});
