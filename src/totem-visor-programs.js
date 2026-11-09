// Each glyph stores seven rows of five bits, top to bottom.
const FONT = Object.fromEntries(Object.entries({
  A:'0E11111F111111', B:'1E11111E11111E', C:'0F10101010100F', D:'1E11111111111E', E:'1F10101E10101F',
  F:'1F10101E101010', G:'0F10101711110F', H:'1111111F111111', I:'0E04040404040E', J:'0702020212120C',
  K:'11121418141211', L:'1010101010101F', M:'111B1515111111', N:'11191513111111', O:'0E11111111110E',
  P:'1E11111E101010', Q:'0E11111115120D', R:'1E11111E141211', S:'0F10100E01011E', T:'1F040404040404',
  U:'1111111111110E', V:'11111111110A04', W:'11111115151B11', X:'11110A040A1111', Y:'11110A04040404', Z:'1F01020408101F',
  0:'0E11131519110E', 1:'040C040404040E', 2:'0E11010204081F', 3:'1E01010E01011E', 4:'02060A121F0202',
  5:'1F10101E01011E', 6:'0E10101E11110E', 7:'1F010204080808', 8:'0E11110E11110E', 9:'0E11110F01010E',
  '!':'04040404040004', '?':'0E110102040004', '.':'00000000000004', '-':'0000001F000000', ' ':'00000000000000',
}).map(([key, rows]) => [key, rows.match(/../g).map(row => Number.parseInt(row, 16))]));

const LED_WIDTH = 40, LED_HEIGHT = 20;
export const MESSAGE_STEP_MS = 42;
const messageText = text => String(text).toUpperCase().slice(0, 32);
const widthOf = text => Math.max(0, text.length * 6 - 1);
export const message = (text, hold = 0) => ({ message: text, hold, duration: hold || (LED_WIDTH + widthOf(messageText(text)) + 1) * MESSAGE_STEP_MS });

function dot(pixels, x, y, level = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x >= 0 && x < LED_WIDTH && y >= 0 && y < LED_HEIGHT) pixels[y * LED_WIDTH + x] = Math.max(pixels[y * LED_WIDTH + x], level);
}

function rect(pixels, x, y, width, height, level) {
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) dot(pixels, x + i, y + j, level);
}

function drawText(pixels, text, x, top, scale = 1, level = 255) {
  for (const character of text) {
    const glyph = FONT[character] ?? FONT['?'];
    if (x + 5 * scale > 0 && x < LED_WIDTH) {
      for (let y = 0; y < 7; y++) for (let bit = 0; bit < 5; bit++) {
        if (glyph[y] & (16 >> bit)) rect(pixels, x + bit * scale, top + y * scale, scale, scale, level);
      }
    }
    x += 6 * scale;
  }
}

export function drawVisorMessage(pixels, value, elapsed = 0, hold = 0) {
  pixels.fill(0);
  const text = messageText(value);
  const x = hold ? Math.floor((LED_WIDTH - widthOf(text)) / 2) : LED_WIDTH - Math.floor(elapsed / MESSAGE_STEP_MS);
  drawText(pixels, text, x, 6);
}

const triangle = value => 1 - Math.abs(2 * (((value % 1) + 1) % 1) - 1);
function rand(seed, index) {
  const bits = Math.imul(index + 1, 0x9e3779b1) ^ seed;
  const mixed = Math.imul(bits ^ (bits >>> 16), 0x85ebca6b);
  return ((mixed ^ (mixed >>> 13)) >>> 0) / 4294967296;
}
const clamp = (t, low = 0, high = 1) => Math.max(low, Math.min(high, t));
const mix = (a, b, t) => a + (b - a) * t;
const tau = Math.PI * 2;
function track(frames, t) {
  let next = frames.findIndex(([at]) => at > t);
  if (next < 0) next = frames.length - 1;
  const [start, x, y] = frames[Math.max(0, next - 1)], [end, toX, toY] = frames[next];
  const progress = end > start ? clamp((t - start) / (end - start)) : 0;
  return [mix(x, toX, progress), mix(y, toY, progress)];
}
function mask(p, layer, dx = 0, dy = 0, level = 255, from = 0, to = LED_WIDTH) {
  for (let y = 0; y < LED_HEIGHT; y++) for (let x = from; x < to; x++) {
    const intensity = layer[y * LED_WIDTH + x];
    if (intensity) dot(p, x + dx, y + dy, intensity * level);
  }
}
function sprite(p, rows, x, y, level = 255) {
  rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '1') dot(p, x + i, y + j, level); });
}
const circle = (pixels, x, y, radius, level = 255) => {
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 12;
    dot(pixels, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, level);
  }
};
const heart = (pixels, x, y, scale = 1) => {
  ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'].forEach((row, j) => {
    [...row].forEach((bit, i) => { if (bit === '1') rect(pixels, x + i * scale, y + j * scale, scale, scale); });
  });
};

const PONG_BALL = [[0, 5, 9], [.18, 35, 3], [.25, 25, 1], [.40, 4, 11], [.50, 18, 18], [.64, 35, 11], [.78, 13, 4], [.85, -2, 1]];
const PONG_LEFT = [[0, 0, 9], [.20, 0, 5], [.40, 0, 11], [.58, 0, 14], [.74, 0, 12], [.85, 0, 8]];
const PONG_RIGHT = [[0, 0, 13], [.18, 0, 3], [.40, 0, 6], [.64, 0, 11], [.85, 0, 5]];
const CHASING_DOT = [[0, 20, 4], [.12, 20, 4], [.25, 34, 9], [.34, 33, 10], [.49, 8, 15], [.63, 20, 17], [.76, 20, 17], [.94, 39, 3], [1, 46, 0]];
const BLOCKS = [
  { cells: [[0, 0], [0, 1], [0, 2], [1, 2]], x: 0, y: 5, spawn: 4 },
  { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], x: 7, y: 6, spawn: 3 },
  { cells: [[0, 0], [1, 0], [2, 0], [3, 0]], x: 3, y: 8, spawn: 0 },
];
const EYE_PATH = [[0, 0, 0], [.16, -4, -4], [.34, 17, -4], [.53, 22, 8], [.72, 6, 8], [1, 0, 0]];
const SNAKE = [
  [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [7, 2], [7, 3],
  [7, 4], [6, 4], [5, 4], [4, 4], [4, 3], [5, 3], [6, 3], [6, 4],
];
const FOOD = [3, 6, 8, 10, 12];
const ALIEN = ['001000100', '000101000', '001111100', '011010110', '111111111', '101111101', '101000101', '000101000'];
const SLOT_SYMBOLS = [['010', '111', '010'], ['101', '010', '101'], ['111', '101', '111'], ['101', '111', '010']];
const BOLT = ['00011', '00110', '01100', '11111', '00110', '01100', '01000'];

const PROGRAMS = {
  pixel_pong(p, t) {
    if (t >= .86) { drawText(p, '0-1', 3, 3, 2); return; }
    const [x, y] = track(PONG_BALL, t);
    rect(p, 2, clamp(track(PONG_LEFT, t)[1] - 2, 0, 15), 2, 5, 215);
    rect(p, 36, clamp(track(PONG_RIGHT, t)[1] - 2, 0, 15), 2, 5, 215);
    for (let row = 1; row < 20; row += 3) dot(p, 20, row, 42);
    rect(p, x, y, 2, 2);
  },
  falling_blocks(p, t) {
    const block = (x, y, level) => { rect(p, 10 + x * 2, 1 + y * 2, 2, 2, level); };
    for (let y = 1; y < 19; y++) { dot(p, 8, y, 52); dot(p, 31, y, 52); }
    const clearing = t >= .78 && t < .91;
    if (clearing) {
      if (Math.floor((t - .78) * 48) % 2 === 0) for (let x = 0; x < 10; x++) block(x, 8, 255);
    } else if (t < .78) for (const x of [0, 1, 2, 7, 8, 9]) block(x, 8, 145);
    BLOCKS.forEach((piece, index) => {
      const fall = (t - index * .26) / .26;
      if (fall < 0 || (index === 2 && t >= .78)) return;
      const x = Math.round(mix(piece.spawn, piece.x, clamp((fall - .22) * 2.5)));
      const y = Math.floor(mix(-2, piece.y, clamp(fall * 1.07))) + (t >= .91 ? 1 : 0);
      for (const [dx, dy] of piece.cells) if (y + dy >= 0) block(x + dx, y + dy, fall < 1 ? 235 : 157);
    });
  },
  matrix_rain(p, t, seed, face) {
    const slowdown = Math.max(0, t - .65);
    const travel = t - slowdown ** 2 / .72;
    const reveal = clamp((t - .75) * 4);
    for (let x = 1; x < 40; x += 2) {
      const y = (rand(seed, x) * 27 + travel * (29 + rand(seed, x + 1) * 19)) % 27;
      for (let tail = 0; tail < 6; tail++) dot(p, x, y - tail, (255 - tail * 40) * (1 - reveal));
    }
    mask(p, face.eyes, 0, 0, 255 * reveal); mask(p, face.mouth, 0, 0, 255 * reveal);
  },
  loading_brain(p, t) {
    if (t > .80) { sprite(p, ['00000011', '00000110', '00001100', '10011000', '11110000', '01100000'], 16, 7); return; }
    const front = Math.floor(t * 48) % 12;
    for (let i = 0; i < 12; i++) {
      const angle = i * tau / 12;
      rect(p, 19 + Math.cos(angle) * 10, 9 + Math.sin(angle) * 7, 2, 2, Math.max(65, 255 - (front - i + 12) % 12 * 33));
    }
  },
  pixel_heartbeat(p, t) {
    const pulse = Math.sin(t * tau) ** 6, scale = 2 + pulse * .7;
    const rows = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
    for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) {
      if (rows[Math.floor((y - 10) / scale + 3)]?.[Math.floor((x - 20) / scale + 3.5)] === '1') dot(p, x, y, 156 + pulse * 99);
    }
  },
  screen_glitch(p, t, seed, face) {
    const tick = Math.floor(t * 18), surge = Math.sin(t * Math.PI);
    for (let i = 0; i < p.length; i++) {
      const level = Math.max(face.eyes[i], face.mouth[i]);
      if (!level) continue;
      const x = i % 40, y = Math.floor(i / 40);
      const shift = (rand(seed + tick, y) - .5) * 15 * surge;
      const stray = t > .44 && t < .67 && face.eyes[i] && x > 20;
      dot(p, x + shift - (stray ? 6 : 0), y + (stray ? 5 : 0), 255 * level);
    }
    for (let i = 0; i < 16; i++) dot(p, rand(seed + tick, i * 2) * 39, rand(seed + tick, i * 2 + 1) * 19, surge * 165);
  },
  led_wave(p, t) {
    const crest = t < .52 ? mix(-6, 39, t / .52) : mix(39, -6, (t - .52) / .48);
    const dissolve = clamp((t - .77) / .23);
    for (let x = 0; x < 40; x++) {
      const strength = clamp(1 - Math.abs(x - crest) / 14);
      if (!strength || (dissolve && rand(92, x) < dissolve)) continue;
      const y = 10 + mix(3.5, 8, t) * Math.sin((x - crest) / 2.6) * strength;
      dot(p, x, y, strength * 255); dot(p, x, y + 1, strength * (1 - dissolve) * 170);
    }
  },
  chasing_dot(p, t, seed, face) {
    const [x, y] = track(CHASING_DOT, t);
    mask(p, face.eyes, clamp((x - 20) * .17, -3, 3), clamp((y - 9) * .25, -2, 2), 170);
    dot(p, x, y);
  },
  pixel_sneeze(p, t, seed, face) {
    for (let i = 0; i < p.length; i++) {
      if (!face.eyes[i] && !face.mouth[i]) continue;
      const scatter = Math.sin(t * Math.PI) ** 2;
      dot(p, i % 40 + (rand(seed, i) - .5) * 32 * scatter, Math.floor(i / 40) + (rand(seed, i + 800) - .5) * 22 * scatter, 235);
    }
  },
  battery_recharge(p, t) {
    const alert = t >= .24 && t < .44;
    const full = t >= .83;
    const outline = alert ? (Math.floor((t - .24) * 20) % 2 ? 42 : 255) : full ? 190 + 65 * Math.sin((t - .83) * 17) ** 2 : 230;
    rect(p, 5, 2, 28, 2, outline); rect(p, 5, 16, 28, 2, outline);
    rect(p, 4, 4, 2, 12, outline); rect(p, 32, 4, 2, 12, outline); rect(p, 34, 7, 3, 6, outline);
    if (t < .17 && Math.floor(t * 24) % 2 === 0) rect(p, 7, 6, 4, 8, 255);
    if (alert && outline > 100) drawText(p, '!', 17, 6);
    if (t >= .44 && t < .57) sprite(p, BOLT, 17, 6);
    if (t >= .57) {
      const bars = Math.min(5, 1 + Math.floor((t - .57) / .052));
      for (let i = 0; i < bars; i++) rect(p, 7 + i * 5, 6, 4, 8, full ? outline : 245);
    }
  },
  hypnotic_spiral(p, t) {
    for (let ring = 1; ring <= 4; ring++) {
      for (let i = 0; i < ring * 8; i++) {
        const angle = i * tau / (ring * 8) + t * tau * (ring % 2 ? -1 : 1);
        dot(p, 19 + Math.cos(angle) * ring * 4, 9 + Math.sin(angle) * ring * 2.1, 66 + ring * 18);
      }
    }
    const r = Math.abs(2 * t - 1), angle = t * tau * 3;
    dot(p, 19 + Math.cos(angle) * r * 16, 9 + Math.sin(angle) * r * 8);
  },
  pixel_fireworks(p, t) {
    for (let burst = 0; burst < 3; burst++) {
      const age = (t - burst * .24) / .52;
      if (age < 0 || age >= 1) continue;
      const x = 9 + burst * 10, y = 6 + (burst % 2) * 3;
      if (age < .31) {
        const tip = mix(19, y, age / .31);
        dot(p, x, tip); dot(p, x, tip + 2, 115);
      } else {
        const bloom = (age - .31) / .69;
        for (let spoke = 0; spoke < 12; spoke++) {
          const angle = spoke * tau / 12 + burst * .35;
          const r = 1 + bloom * (spoke % 2 ? 6 : 9);
          dot(p, x + Math.cos(angle) * r, y + Math.sin(angle) * r + bloom * 2, 255 * (1 - bloom));
        }
      }
    }
  },
  eye_escape(p, t, seed, face) {
    const [x, y] = track(EYE_PATH, t), angle = t * tau * 2;
    const sin = Math.sin(angle), cos = Math.cos(angle);
    for (let i = 0; i < p.length; i++) {
      if (!face.eyes[i] || i % 40 >= 20) continue;
      const dx = i % 40 - 11, dy = Math.floor(i / 40) - 8;
      dot(p, 11 + x + dx * cos - dy * sin, 8 + y + dx * sin + dy * cos);
    }
    mask(p, face.eyes, clamp((11 + x - 27) * .14, -2, 2) * Math.sin(Math.PI * t), y * .16, 165, 20);
    mask(p, face.mouth);
  },
  face_melt(p, t, seed, face) {
    for (let i = 0; i < p.length; i++) {
      const intensity = Math.max(face.eyes[i], face.mouth[i]);
      if (!intensity) continue;
      const x = i % 40, y = Math.floor(i / 40), delay = rand(seed, x) * .25;
      const pool = 17 + (x + y) % 3;
      const fall = t < .64 ? clamp((t - delay) * 2.8) ** 2 : 1 - clamp((t - .64) / .31) ** .62;
      const scatter = Math.sin(Math.PI * fall);
      dot(p, x + (rand(seed, i) - .5) * scatter * 4, mix(y, pool, fall), intensity * (255 - fall * 60));
    }
  },
  snake_game(p, t) {
    const step = Math.min(SNAKE.length - 1, Math.floor(t * 20));
    const length = 3 + FOOD.filter(index => index <= step).length;
    const tile = ([x, y], level) => rect(p, 3 + x * 4, 2 + y * 3, 2, 2, level);
    const food = FOOD.find(index => index > step);
    if (food !== undefined) tile(SNAKE[food], 170 + 65 * Math.sin(t * tau * 4) ** 2);
    SNAKE.slice(Math.max(0, step - length + 1), step + 1).forEach((cell, index, body) => tile(cell, index === body.length - 1 ? 255 : 120 + index * 10));
    if (step === SNAKE.length - 1 && Math.floor(t * 16) % 2) drawText(p, '!', 32, 4);
  },
  pixel_alien(p, t) {
    const [x] = track([[0,-9,0],[.36,15,0],[.68,15,0],[1,40,0]], t);
    const walk = t < .36 || t > .68;
    sprite(p, ALIEN, x, 6 + (walk ? Math.floor(t * 28) % 2 : 0));
    if (!walk) {
      const up = Math.floor(t * 18) % 2;
      sprite(p, up ? ['001', '010', '110'] : ['000', '000', '111'], x + 8, 7);
    }
  },
  slot_machine(p, t) {
    for (let reel = 0; reel < 3; reel++) {
      const stop = .57 + reel * .13, x = 5 + reel * 12;
      const roll = Math.min(1, t / stop);
      const position = (1 - (1 - roll) ** 2) * (11 + reel * 4);
      const offset = Math.floor((position % 1) * 7);
      const symbol = (Math.floor(position) + reel) % SLOT_SYMBOLS.length;
      if (roll === 1) heart(p, x, 7);
      else {
        sprite(p, SLOT_SYMBOLS[symbol], x + 2, 7 + offset);
        sprite(p, SLOT_SYMBOLS[(symbol + 1) % SLOT_SYMBOLS.length], x + 2, offset, 120);
        sprite(p, SLOT_SYMBOLS[(symbol + 3) % SLOT_SYMBOLS.length], x + 2, 14 + offset, 120);
      }
      if (reel < 2) for (let y = 2; y < 19; y += 2) dot(p, x + 9, y, 60);
    }
  },
  pixel_caterpillar(p, t) {
    for (let i = 6; i >= 0; i--) {
      const [x, y] = track([[0,-5,13],[.42,31,13],[.59,33,5],[.78,-9,5],[1,-20,5]], clamp(t - i * .033));
      rect(p, x, y + Math.sin(t * tau * 5 - i * .8) * 2, 2, 2, 255 - i * 18);
    }
  },
  countdown(p, t) {
    drawText(p, String(3 - Math.min(2, Math.floor(t * 3))), 15, 3, 2);
  },
  screen_cleaner(p, t, seed, face) {
    const bar = Math.floor(t < .5 ? t * 80 : (1 - t) * 80);
    if (t < .5) { mask(p, face.eyes, 0, 0, 255, bar); mask(p, face.mouth, 0, 0, 255, bar); }
    else {
      const happy = face.happy ?? face;
      mask(p, happy.eyes, 0, 0, 255, bar); mask(p, happy.mouth, 0, 0, 255, bar);
    }
    rect(p, bar, 1, 2, 18);
    if (bar > 0 && bar < 40) dot(p, bar - 2, 3 + rand(seed, Math.floor(t * 36)) * 13, 140);
  },
  pixel_dance(p, t) {
    const beats = [2, 5, 3, 7, 4, 8, 2, 5, 8, 4, 6, 2, 7, 4, 1, 0];
    for (let column = 0; column < 10; column++) {
      const beat = beats[Math.min(beats.length - 1, Math.floor(t * beats.length + (column % 5) * .68))];
      const height = beat * (column % 5 === 2 ? 2 : 1) + 1;
      for (let row = 0; row < height; row++) rect(p, 2 + column * 4, 17 - row, 2, 1, 116 + row * 8);
    }
  },
  searching_radar(p, t) {
    const angle = Math.min(.82, t) * tau * 2;
    circle(p, 20, 10, 9, 78); circle(p, 20, 10, 5, 55);
    for (let r = 0; r <= 9; r++) {
      dot(p, 20 + Math.cos(angle) * r, 10 + Math.sin(angle) * r, 240);
      dot(p, 20 + Math.cos(angle - .23) * r, 10 + Math.sin(angle - .23) * r, 103);
    }
    if (t > .80) rect(p, 15, 4, 2, 2, Math.floor(t * 22) % 2 ? 255 : 145);
  },
  mini_space_battle(p, t) {
    const ship = track([[0,6,0],[.31,31,0],[.55,23,0],[1,23,0]], t)[0];
    sprite(p, ['00100', '01110', '11111'], ship - 2, 17);
    for (let i = 0; i < 3; i++) {
      const y = 1 + t * (10 - i * 2), x = [23, 11, 32][i];
      if (i !== 0 || t < .76) sprite(p, ['010', '111', '101'], x - 1, y, 180);
      else if (t < .94) circle(p, x, 9, 1 + (t - .76) * 37, 255 * (1 - (t - .76) / .18));
    }
    if (t >= .55 && t < .76) rect(p, 23, mix(16, 9, (t - .55) / .21), 1, 2);
  },
  escaped_heart(p, t) {
    const x = 16 + 11 * Math.sin(t * Math.PI * 4), y = 3 + 9 * triangle(t * 2);
    rect(p, 10 + (x - 16) / 6, 7, 3, 4, 180);
    rect(p, 26 + (x - 16) / 6, 7, 3, 4, 180);
    heart(p, Math.round(x), Math.round(y));
  },
  pixel_hiccup(p, t, seed, face) {
    for (let i = 0; i < p.length; i++) {
      if (face.eyes[i] || face.mouth[i]) dot(p, i % 40, Math.floor(i / 40) + (i % 7 === 0 ? 9 * triangle(t) : 0));
    }
  },
};

export function drawVisorAnimation(pixels, name, progress, seed, face) {
  pixels.fill(0);
  PROGRAMS[name]?.(pixels, clamp(progress), seed, face);
}

export function applyVisorMotion(pose, name, t) {
  if (name === 'chasing_dot' || name === 'eye_escape' || (name === 'pixel_pong' && t < .86)) {
    const path = name === 'chasing_dot' ? CHASING_DOT : name === 'eye_escape' ? EYE_PATH : PONG_BALL;
    const [x, y] = track(path, t);
    const envelope = Math.sin(Math.PI * t) ** .45;
    pose.headYaw = clamp((x - (name === 'eye_escape' ? 5 : 20)) * .019, -.29, .29) * envelope;
    pose.headPitch = clamp((y - (name === 'eye_escape' ? 2 : 10)) * .018, -.18, .18) * envelope;
    pose.headRoll = -pose.headYaw * .45;
  } else if (name === 'pixel_pong') {
    pose.headPitch = .19; pose.headRoll = Math.sin((t - .86) * 55) * .17 * (1 - t) / .14;
  } else if (name === 'battery_recharge') {
    pose.wing = t < .24 ? 'fold' : t < .44 ? 'burst' : t < .83 ? 'slow' : 'flutter';
    pose.headRoll = t >= .24 && t < .44 ? Math.sin((t - .24) * 110) * .20 : 0;
    pose.headPitch = .19 * (1 - t);
  } else if (name === 'pixel_heartbeat') {
    pose.wing = Math.sin(t * tau) ** 6 > .32 ? 'flutter' : 'normal';
  } else if (name === 'led_wave') {
    pose.roll = Math.sin(t * tau) * .12;
  } else if (name === 'hypnotic_spiral') {
    pose.headRoll = Math.sin(t * tau * (t > .8 ? 3 : 1)) * Math.sin(t * Math.PI) * .19;
  }
}

const face = (expression, duration = 650) => ({ expression, duration });
const effect = (animation, duration, cues) => ({ animation, duration, ...cues });
const program = (label, kind, moods, body, steps, wing) => ({ label, kind, moods, body, steps, wing });
export const VISOR_PROGRAMS = {
  battery_recharge: program('Low Battery Panic', 'animation', ['sleepy'], 'sink', [face('sleepy', 750), effect('battery_recharge', 4700), { ...face('excited', 1050), body: 'roll', wing: 'flutter' }], 'fold'),
  pixel_pong: program('Pixel Pong', 'game', ['playful', 'excited'], 'hover', [effect('pixel_pong', 6550), face('sad', 700)]),
  eye_escape: program('Eye Escape', 'animation', ['curious', 'mischievous'], 'hover', [face('confused', 450), effect('eye_escape', 4100), face('laughing')]),
  chasing_dot: program('Chasing Dot', 'animation', ['curious', 'playful'], 'hover', [effect('chasing_dot', 4400), face('confused')]),
  face_melt: program('Face Melt', 'animation', ['mischievous', 'playful'], 'hover', [face('surprised', 400), effect('face_melt', 3500), face('happy')]),
  matrix_rain: program('Matrix Rain', 'animation', ['relaxed', 'mischievous'], 'freeze', [effect('matrix_rain', 4200)]),
  falling_blocks: program('Falling Blocks', 'game', ['playful', 'curious'], 'hover', [effect('falling_blocks', 6250), { ...face('excited', 950), body: 'bounce', wing: 'flutter' }]),
  loading_brain: program('Loading Brain', 'animation', ['curious'], 'concentrate', [effect('loading_brain', 3450), face('happy')]),
  pixel_heartbeat: program('Pixel Heartbeat', 'animation', ['relaxed', 'excited'], 'hover', [effect('pixel_heartbeat', 2500), face('happy', 500)]),
  screen_glitch: program('Screen Glitch', 'animation', ['mischievous'], 'shake', [effect('screen_glitch', 1450)]),
  led_wave: program('LED Wave', 'animation', ['relaxed', 'playful'], 'hover', [effect('led_wave', 3500)]),
  pixel_sneeze: program('Pixel sneeze', 'animation', ['playful', 'mischievous'], 'startle', [face('confused', 400), { ...effect('pixel_sneeze', 1250), wing: 'burst' }, face('surprised')]),
  hypnotic_spiral: program('Hypnotic Spiral', 'animation', ['mischievous'], 'hover', [effect('hypnotic_spiral', 3850), { ...face('confused', 650), body: 'shake' }]),
  pixel_fireworks: program('Pixel Fireworks', 'animation', ['excited'], 'bounce', [effect('pixel_fireworks', 3900), face('happy')]),
  snake_game: program('Snake Game', 'game', ['playful', 'curious'], 'hover', [effect('snake_game', 5900), face('confused')]),
  pixel_alien: program('Pixel Alien', 'animation', ['curious'], 'look', [effect('pixel_alien', 3800), face('surprised')]),
  slot_machine: program('Slot Machine', 'game', ['excited', 'playful'], 'hover', [effect('slot_machine', 4700), { ...face('excited'), body: 'bounce', wing: 'flutter' }]),
  pixel_caterpillar: program('Pixel Caterpillar', 'animation', ['curious'], 'look', [effect('pixel_caterpillar', 4100), face('curious')]),
  countdown: program('Countdown', 'animation', ['excited'], 'hover', [effect('countdown', 3000), message('GO!', 600), face('excited')]),
  screen_cleaner: program('Screen Cleaner', 'animation', ['mischievous'], 'tilt', [effect('screen_cleaner', 3400), face('happy')]),
  pixel_dance: program('Pixel Dance', 'animation', ['playful'], 'bounce', [effect('pixel_dance', 3300), face('happy')]),
  searching_radar: program('Searching Radar', 'animation', ['curious'], 'concentrate', [effect('searching_radar', 3700), face('surprised')]),
  mini_space_battle: program('Mini Space Battle', 'game', ['playful', 'excited'], 'hover', [effect('mini_space_battle', 5000), { ...face('excited'), body: 'bounce', wing: 'flutter' }]),
  escaped_heart: program('The escaped heart', 'animation', ['curious', 'playful'], 'look', [effect('escaped_heart', 3000), face('confused')]),
  pixel_hiccup: program('The pixel hiccup', 'animation', ['playful'], 'startle', [effect('pixel_hiccup', 1400), face('surprised')]),
  caught_looking: program('Caught you looking', 'surprise', ['mischievous', 'curious'], 'freeze', [face('curious', 450), { blink: true, duration: 220 }, face('curious', 260), { blink: true, duration: 220 }, message('WHAT?'), face('cheeky')]),
  cheeky_boo: program('Cheeky BOO!', 'surprise', ['mischievous'], 'startle', [message('BOO!', 850), face('cheeky')]),
};

export const VISOR_MESSAGES = {
  relaxed: ['HELLO!', 'HI!'], playful: ['HELLO!', 'TA-DA!', 'I LIKE THIS ONE!'],
  curious: ['PLAY?', 'WHERE ARE WE GOING?'], sleepy: ['ZZZ...'],
  mischievous: ['HI!', 'READY?'], excited: ['YAY!', 'TA-DA!'],
};
