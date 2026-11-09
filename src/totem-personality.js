import { normalizePersonality, PERSONALITY_PRESETS } from './totem-personality-config.js';
import { TIKO_ANIMATION_CUES } from './tiko-animation-cues.js';
import { applyVisorMotion, drawVisorAnimation, drawVisorMessage, message, MESSAGE_STEP_MS, VISOR_MESSAGES, VISOR_PROGRAMS } from './totem-visor-programs.js';

const sequence = (expressions, duration, body = 'hover', wing = 'normal', priority = 0, category = 'playful') => ({
  steps: expressions.map(expression => expression === 'blink' ? { blink: true, duration: 160 } : { expression, duration: duration / expressions.length }),
  body, wing, priority, category, duration, interruptible: true, recovery: 'base',
  spin: ['spin', 'roll', 'somersault', 'dizzy'].includes(body),
});
export const TOTEM_SEQUENCES = {
  blink: { ...sequence(['blink'], 160), steps: [{ blink: true, duration: 160 }] },
  surprised_reaction: sequence(['neutral', 'surprised', 'blink', 'neutral'], 1800, 'startle'),
  excited_reaction: sequence(['curious', 'excited', 'happy'], 2000, 'bounce', 'flutter'),
  laugh: sequence(['happy', 'laughing', 'happy', 'laughing', 'happy'], 2200, 'bounce'),
  sleep: sequence(['neutral', 'sleepy', 'blink', 'sleepy'], 4200, 'sink', 'slow', 0, 'relaxed'),
  wake_up: sequence(['sleepy', 'surprised', 'happy'], 1800, 'rise', 'flutter'),
  confused: sequence(['neutral', 'confused', 'thinking', 'neutral'], 2400, 'tilt', 'normal', 0, 'curious'),
  sad_to_happy: sequence(['sad', 'blink', 'neutral', 'happy'], 2400, 'droop'),
  cheeky_wink: sequence(['curious', 'cheeky', 'blink', 'happy'], 2000, 'tilt'),
  thinking: sequence(['neutral', 'thinking', 'curious', 'neutral'], 2400, 'tilt', 'normal', 0, 'curious'),
  celebrate_favourite: sequence(['curious', 'excited', 'laughing', 'happy'], 2600, 'bounce', 'flutter', 2),
  launch_game: sequence(['excited', 'happy', 'blink'], 650, 'leave', 'flutter', 3),
  welcome_back: sequence(['surprised', 'sad', 'happy'], 2800, 'droop', 'flutter', 2),
  discover_game: sequence(['curious', 'surprised', 'happy'], 2400, 'inspect', 'normal', 1, 'curious'),
  get_dizzy: sequence(['confused', 'blink', 'sleepy'], 3200, 'dizzy'),
  fall_asleep: sequence(['neutral', 'sleepy', 'blink'], 4500, 'sink', 'slow', 0, 'relaxed'),
  playful_wink: sequence(['curious', 'cheeky', 'happy'], 2400, 'tilt'),
  wanderer: sequence(['curious', 'happy', 'neutral'], 7000, 'wander', 'normal', 0, 'curious'),
  sleepy_floater: sequence(['sleepy', 'blink', 'surprised', 'happy'], 5500, 'sink', 'slow', 0, 'relaxed'),
  show_off: sequence(['cheeky', 'surprised', 'laughing'], 4000, 'somersault', 'flutter'),
  butterfly_effect: sequence(['curious', 'excited', 'confused'], 6000, 'chase', 'flutter', 0, 'curious'),
  hide_and_seek: sequence(['cheeky', 'curious', 'happy'], 5000, 'peek', 'normal', 0, 'mischievous'),
  wing_stretch: sequence(['neutral', 'happy'], 3600, 'look', 'stretch', 0, 'relaxed'),
  look_at_camera: sequence(['curious', 'happy', 'cheeky'], 4000, 'look', 'normal', 0, 'curious'),
  pretend_game: sequence(['neutral', 'blink', 'cheeky'], 4000, 'freeze', 'fold', 0, 'mischievous'),
  sneeze: sequence(['thinking', 'blink', 'surprised'], 2500, 'startle', 'burst'),
  patrol: sequence(['curious', 'neutral'], 6500, 'patrol', 'normal', 0, 'curious'),
  playful_roll: sequence(['happy', 'laughing'], 3600, 'roll', 'flutter'),
  hiccup: sequence(['surprised', 'cheeky'], 1800, 'hiccup'),
  daydream: sequence(['thinking', 'sleepy', 'happy'], 5500, 'daydream', 'slow', 0, 'relaxed'),
  console_inspection: sequence(['curious', 'surprised', 'happy'], 6000, 'inspect', 'normal', 0, 'curious'),
  favourite_removed: sequence(['confused', 'sad'], 1800, 'droop', 'slow', 2),
  recent_game: sequence(['curious'], 1600, 'inspect', 'normal', 1),
  platform_changed: sequence(['surprised', 'curious'], 1600, 'look', 'normal', 1),
  search_empty: sequence(['confused'], 1600, 'tilt', 'normal', 1),
  search_found: sequence(['happy'], 1500, 'bounce', 'normal', 1),
  launch_failed: sequence(['surprised', 'sad'], 2200, 'startle', 'burst', 3),
  controller_connected: sequence(['happy'], 1600, 'bounce', 'flutter', 2),
  controller_disconnected: sequence(['surprised'], 1600, 'startle', 'burst', 2),
  upside_down_flight: { ...sequence(['cheeky', 'surprised', 'laughing', 'happy'], 6500, 'upside_down', 'flutter', 0, 'mischievous'), spin: true },
  ...VISOR_PROGRAMS,
};
export const TOTEM_EVENTS = Object.freeze({
  favourite_highlighted: { probability: .45, sequence: 'excited_reaction', category: 'favourites', hover: true, priority: 1 },
  favourite_added: { probability: .9, sequence: 'celebrate_favourite', category: 'favourites', priority: 2 },
  favourite_removed: { probability: .45, sequence: 'favourite_removed', category: 'favourites', priority: 2 },
  recent_highlighted: { probability: .35, sequence: 'recent_game', category: 'games', hover: true, priority: 1 },
  new_highlighted: { probability: .35, sequence: 'discover_game', category: 'games', hover: true, priority: 1 },
  play_selected: { probability: 1, sequence: 'launch_game', category: 'games', priority: 3 },
  return_from_game: { probability: .6, sequence: 'welcome_back', category: 'games', priority: 2 },
  rapid_scrolling: { probability: .25, sequence: 'get_dizzy', category: 'games', priority: 0 },
  scrolling_stopped: { probability: .35, sequence: 'recent_game', category: 'games', hover: true, priority: 0 },
  platform_changed: { probability: .3, sequence: 'platform_changed', category: 'platforms', priority: 1 },
  arcade_selected: { probability: .35, sequence: 'excited_reaction', category: 'games', hover: true, priority: 1 },
  details_opened: { probability: .3, sequence: 'thinking', category: 'games', priority: 1 },
  search_started: { probability: .25, sequence: 'recent_game', category: 'games', priority: 1 },
  search_empty: { probability: .75, sequence: 'search_empty', category: 'games', priority: 1 },
  search_found: { probability: .4, sequence: 'search_found', category: 'games', priority: 1 },
  launch_failed: { probability: .9, sequence: 'launch_failed', category: 'games', priority: 3 },
  controller_connected: { probability: .7, sequence: 'controller_connected', category: 'controllers', priority: 2 },
  controller_disconnected: { probability: .7, sequence: 'controller_disconnected', category: 'controllers', priority: 2 },
  library_scan_complete: { probability: .7, sequence: 'search_found', category: 'library', priority: 2 },
  emulator_updated: { probability: .55, sequence: 'playful_roll', category: 'emulators', priority: 2 },
  emulator_failed: { probability: .6, sequence: 'confused', category: 'emulators', priority: 2 },
  long_loading: { probability: .25, sequence: 'daydream', category: 'library', priority: 0 },
  settings_opened: { probability: .2, sequence: 'thinking', category: 'settings', priority: 0 },
});
export const AMBIENT_NAMES = Object.freeze(['wanderer', 'sleepy_floater', 'show_off', 'butterfly_effect', 'hide_and_seek', 'wing_stretch', 'look_at_camera', 'pretend_game', 'sneeze', 'patrol', 'playful_roll', 'hiccup', 'daydream', 'console_inspection']);
const weights = { playful: .4, curious: .3, relaxed: .2, mischievous: .1 };
const flights = new Set(['wander', 'chase', 'peek', 'patrol', 'inspect']);
const VISOR_INTERVALS = { gaze: [10, 25], animation: [20, 45], message: [180, 300], game: [300, 600], major: [180, 360], surprise: [540, 960] };
const EVENT_MESSAGES = {
  favourite_highlighted: 'NICE!', play_selected: 'GO!', return_from_game: 'GG!', rapid_scrolling: 'WHOA!',
  launch_failed: 'OOPS!', new_highlighted: '1UP!', emulator_updated: 'YAY!', search_found: 'NICE!',
};
const EVENT_MOODS = {
  favourite_added: 'excited', favourite_highlighted: 'playful', return_from_game: 'excited', platform_changed: 'curious',
  search_started: 'curious', search_found: 'excited', controller_connected: 'playful', rapid_scrolling: 'mischievous',
  library_scan_complete: 'excited', launch_failed: 'curious', emulator_updated: 'excited',
};
const STARTUP_WELCOMES = ['HELLO!', 'HI!', 'READY?', 'LET\'S PLAY!'];

// One scene-clock owner for major behaviour, choreography, blinking and hover
// eligibility. Randomness is sampled once per event, never once per frame.
export class TotemPersonality {
  constructor({ display, config, onVoice, random = Math.random } = {}) {
    this.display = display; this.onVoice = onVoice; this.random = random; this.config = normalizePersonality(config);
    this.state = 'HIDDEN'; this.visible = false; this.gameplay = false; this.disposed = false;
    this.now = 0; this.elapsed = 0; this.history = []; this.seen = new Map(); this.pendingHover = null;
    this.lastReaction = -Infinity; this.nextAmbient = Infinity; this.nextBlink = Infinity; this.lastEgg = 0;
    this.active = null; this.reducedMotion = false;
    this.visorPixels = new Uint8Array(800);
    this.visorDue = {};
    this.visorIdle = 0;
    this.lastInput = 0;
    this.mood = 'relaxed'; this.moodUntil = 0;
    this.pose = { x: 0, y: 0, pitch: 0, yaw: 0, roll: 0, headPitch: 0, headYaw: 0, headRoll: 0, wing: 'normal' };
  }
  configure(config) {
    this.config = normalizePersonality(config);
    this.display?.configure?.({ ...this.config, glow: this.config.effects ? this.config.glow : 0 });
    if (!this.config.enabled) this.hide();
    if (!this.config.reactions) this.pendingHover = null;
    if (this.active && ((this.state === 'AMBIENT' && !this.config.ambient) || (this.state === 'REACTING' && !this.config.reactions))) {
      this.reset(this.active.definition.kind ? null : 'neutral');
    }
    this.scheduleIdle();
  }
  scheduleIdle() {
    this.nextAmbient = this.now + (this.config.idleMin + this.random() * (this.config.idleMax - this.config.idleMin)) * 1000;
  }
  show() {
    if (this.disposed || !this.config.enabled || this.gameplay || this.visible) return;
    this.visible = true; this.state = 'ENTERING'; this.elapsed = 0; this.active = null;
    this.scheduleIdle(); this.scheduleBlink(); this.lastInput = this.now;
    for (const kind of Object.keys(VISOR_INTERVALS)) this.scheduleVisor(kind);
  }
  hide() {
    if (this.bootUntil != null) this.display?.setPowered?.(true);
    this.bootUntil = null;
    this.visible = false; this.state = 'HIDDEN'; this.active = null; this.pendingHover = null;
    this.nextAmbient = this.nextBlink = Infinity; this.resetPose(); this.clearVisor();
  }
  startDocked() {
    this.show();
    if (!this.visible) return;
    this.bootUntil = this.now + 1100;
    this.display?.setPowered?.(false);
  }
  setGameplay(value) {
    if (value === this.gameplay) return;
    this.gameplay = value;
    if (value) this.hide();
    else { this.show(); this.event('return_from_game', `session:${this.now}`); }
  }
  resetPose() {
    this.pose.x = this.pose.y = this.pose.pitch = this.pose.yaw = this.pose.roll = 0;
    this.pose.headPitch = this.pose.headYaw = this.pose.headRoll = 0;
    this.pose.wing = 'normal';
  }
  clearVisor() {
    this.display?.presentFrame?.(null);
  }
  reset(expression = 'neutral', reschedule = true) {
    this.active = null; this.pendingHover = null; this.resetPose();
    this.state = this.visible ? 'IDLE' : 'HIDDEN';
    this.clearVisor(); if (expression !== null) this.display?.setExpression(expression, this.reducedMotion ? 0 : 100);
    if (reschedule) this.scheduleIdle();
  }
  cancelHover() { this.pendingHover = null; }
  navigation() {
    this.lastInput = this.now;
    if (this.state === 'AMBIENT' && this.active) this.reset(this.active.definition.kind ? null : 'neutral');
  }
  event(name, id = name) {
    const rule = TOTEM_EVENTS[name];
    if (this.disposed || !this.visible || !this.config.reactions || !rule || !this.config.categories[rule.category]
      || (this.bootUntil != null && rule.priority < 3)) return false;
    const key = `${name}:${id}`;
    if (rule.hover) {
      if (this.pendingHover?.key !== key) this.pendingHover = { name, key, due: this.now + 600 };
      return true;
    }
    return this.react(name, key);
  }
  react(name, key) {
    const rule = TOTEM_EVENTS[name];
    if (!this.visible || !this.config.reactions || !this.config.categories[rule.category]) return false;
    if (this.seen.has(key) && this.now - this.seen.get(key) < 30000) return false;
    this.seen.delete(key); this.seen.set(key, this.now);
    if (this.seen.size > 128) this.seen.delete(this.seen.keys().next().value);
    if (rule.priority < 2 && this.now - this.lastReaction < this.config.cooldown * 1000) return false;
    if (rule.sequence === 'celebrate_favourite' && this.history.at(-1)?.name === rule.sequence && this.now - this.lastReaction < this.config.cooldown * 1000) return false;
    if (this.active && (this.active.priority > rule.priority || (this.active.name === 'welcome_back' && rule.priority < 3))) return false;
    if (name !== 'play_selected' && this.random() >= Math.min(1, rule.probability * PERSONALITY_PRESETS[this.config.preset].probability)) return false;
    if (!this.play(rule.sequence, rule.priority, 'REACTING', false, EVENT_MESSAGES[name])) return false;
    this.lastReaction = this.now;
    if (EVENT_MOODS[name]) { this.mood = EVENT_MOODS[name]; this.moodUntil = this.now + 90000; }
    return true;
  }
  play(name, priority = 0, state = 'AMBIENT', force = false, line) {
    return this.playDefinition(name, TOTEM_SEQUENCES[name], priority, state, force, line);
  }
  playPeekBoo(upsideDown) {
    const boo = VISOR_PROGRAMS.cheeky_boo;
    if (!this.config.displayEnabled) {
      return this.playDefinition('cheeky_boo', { ...boo, kind: null, steps: [boo.steps[1]] }, 2, 'REACTING', true);
    }
    return this.playDefinition('cheeky_boo', boo, 2, 'REACTING', true, undefined, { flipMessage: upsideDown });
  }
  playDefinition(name, definition, priority = 0, state = 'AMBIENT', force = false, line, { inspect = false, flipMessage = false } = {}) {
    if (!definition || !this.visible || this.disposed || (!force && this.active && this.active.priority > priority)) return false;
    if (!force && definition.spin && this.history.at(-1)?.spin) return false;
    if (definition.kind && !this.config.displayEnabled) return false;
    let steps = definition.steps.filter(step => this.visorStepAllowed(step, definition, force, inspect));
    if (definition.kind && !steps.some(step => step.message || step.animation || step.gaze)) return false;
    if (line) {
      const caption = message(line, name === 'launch_game' ? 600 : 0);
      if (this.visorStepAllowed(caption, definition, force)) steps = [caption, ...steps];
    }
    if (!steps.length) return false;
    // Recover before another spin or celebration; there is no deferred timer
    // which could later overwrite an interrupting high-priority reaction.
    if (this.condition && (state === 'REACTING' || definition.spin)) {
      if (name !== 'wake_up' && name !== 'launch_game') steps = [...TOTEM_SEQUENCES.wake_up.steps, ...steps];
      this.condition = null;
    }
    const cue = TIKO_ANIMATION_CUES[name];
    const voiceStep = cue && definition.steps[cue[2] ?? 0];
    this.active = { name, definition, steps, index: 0, stepElapsed: 0, elapsed: 0, priority, force, inspect, flipMessage, voiceStep, duration: steps.reduce((sum, step) => sum + step.duration, 0) };
    this.state = state; this.pendingHover = null; this.resetPose(); this.enterStep(steps[0]); this.renderVisor();
    this.history.push({ name, spin: definition.spin }); if (this.history.length > 12) this.history.shift();
    return true;
  }
  enterStep(step) {
    const active = this.active;
    active.visorFrame = -1;
    if (step === active.voiceStep) {
      const [expression, emotion] = TIKO_ANIMATION_CUES[active.name];
      this.onVoice?.(expression, { emotion });
    }
    if (step.animation) active.visorSeed = Math.floor(this.random() * 2147483647);
    if (active.definition.kind) {
      // Story expressions belong to the temporary picture. Keep the live face underneath.
      if (step.expression) active.visorExpression = step.expression;
      return;
    }
    this.clearVisor();
    const duration = this.reducedMotion ? 0 : 100;
    if (step.expression) this.display?.setExpression(step.expression, duration);
    if (step.eyes) this.display?.setEyes(step.eyes, duration);
    if (step.mouth) this.display?.setMouth(step.mouth, duration);
    if (step.blink && this.config.blinking && !this.reducedMotion) this.display?.blink();
  }
  visorStepAllowed(step, definition, force, inspect = false) {
    if (!step.message && !step.animation && !step.gaze) return true;
    if (!this.config.displayEnabled || (definition.kind === 'surprise' && !force && !this.config.screenSurprises)) return false;
    if (step.message) return (force || this.config.randomMessages) && (!this.reducedMotion || step.hold || inspect);
    return (!this.reducedMotion || inspect) && (step.gaze || force || this.config.miniAnimations);
  }
  renderVisor() {
    const active = this.active, step = active?.steps[active.index];
    if (!step || (!step.message && !step.animation && !step.gaze && !active.definition.kind)) return;
    if (!this.visorStepAllowed(step, active.definition, active.force, active.inspect)) { this.clearVisor(); return; }
    const interval = step.message ? MESSAGE_STEP_MS : 32;
    const frame = Math.floor(active.stepElapsed / interval);
    if (frame === active.visorFrame) return;
    active.visorFrame = frame;
    const matrix = this.display?.matrix ?? this.display;
    const storyFace = matrix?.masks?.[active.visorExpression];
    const face = { eyes: storyFace?.eyes ?? matrix?.layers?.eyes.current, mouth: storyFace?.mouth ?? matrix?.layers?.mouth.current, happy: matrix?.masks?.happy };
    if (step.message) {
      drawVisorMessage(this.visorPixels, step.message, active.stepElapsed, step.hold);
      if (active.flipMessage) this.visorPixels.reverse();
    }
    else if (step.animation && face.eyes) drawVisorAnimation(this.visorPixels, step.animation, frame * interval / step.duration, active.visorSeed, face);
    else if (face.eyes) {
      this.visorPixels.fill(0);
      const gaze = step.gaze ?? 0;
      const eyes = step.blink && this.config.blinking && !this.reducedMotion && active.stepElapsed < 140 ? matrix.masks.blink.eyes : face.eyes;
      for (let i = 0; i < 800; i++) {
        const col = i % 40 - gaze;
        const eye = col >= 0 && col < 40 ? eyes[i - gaze] : 0;
        this.visorPixels[i] = Math.round(255 * Math.max(eye, face.mouth[i]));
      }
    }
    this.display?.presentFrame?.(this.visorPixels, step.message ? 'message' : 'animation');
  }
  scheduleBlink() { this.nextBlink = this.now + 3000 + this.random() * 5000; }
  scheduleVisor(kind) {
    const [min, max] = VISOR_INTERVALS[kind];
    const factor = { subtle: 1.6, balanced: 1, playful: .65 }[this.config.preset];
    this.visorDue[kind] = this.visorIdle + (min + this.random() * (max - min)) * 1000 * factor;
  }
  get currentMood() {
    if (this.moodUntil > this.now) return this.mood;
    return this.now - this.lastInput > 180000 ? 'sleepy' : 'relaxed';
  }
  randomVisorActivity() {
    const quiet = this.now - this.lastInput;
    const pick = values => values[Math.floor(this.random() * values.length)];
    for (const kind of ['surprise', 'game', 'message', 'major', 'animation', 'gaze']) {
      if (this.visorIdle < this.visorDue[kind]) continue;
      if (['surprise', 'game', 'message', 'major'].includes(kind) && quiet < VISOR_INTERVALS[kind][0] * 1000) continue;
      if (kind === 'surprise' && (!this.config.screenSurprises || this.reducedMotion)) continue;
      if (['game', 'animation'].includes(kind) && (!this.config.miniAnimations || this.reducedMotion)) continue;
      if (kind === 'message' && (!this.config.randomMessages || this.reducedMotion)) continue;
      if (kind === 'gaze' && this.reducedMotion) continue;
      if (kind === 'major' && (!this.config.flight || this.reducedMotion)) continue;
      this.scheduleVisor(kind);
      if (kind === 'major') return this.play(pick(['show_off', 'playful_roll']));
      if (kind === 'gaze') return this.playDefinition('visor_gaze', { kind, body: 'hover', steps: [{ gaze: this.random() < .5 ? -2 : 2, duration: 480 }] });
      if (kind === 'message') {
        const mood = this.random() < .7 ? this.currentMood : pick(Object.keys(VISOR_MESSAGES));
        return this.playDefinition('visor_message', { kind, body: 'hover', steps: [message(pick(VISOR_MESSAGES[mood])), { expression: this.currentMood === 'sleepy' ? 'sleepy' : 'cheeky', duration: 650 }] });
      }
      const previous = this.history.at(-1)?.name;
      const programs = Object.keys(VISOR_PROGRAMS).filter(name => name !== previous && VISOR_PROGRAMS[name].kind === kind);
      const matching = programs.filter(name => VISOR_PROGRAMS[name].moods.includes(this.currentMood));
      return this.play(pick(matching.length && this.random() < .7 ? matching : programs));
    }
    return false;
  }
  randomActivity() {
    if (!this.visible || !this.config.ambient) return false;
    const previous = this.history.at(-1);
    const categoryRoll = this.random(); let category = 'mischievous', cumulative = 0;
    for (const [name, weight] of Object.entries(weights)) { cumulative += weight; if (categoryRoll < cumulative) { category = name; break; } }
    const allowFlight = this.config.flight && !this.reducedMotion && this.random() < PERSONALITY_PRESETS[this.config.preset].flight;
    let candidates = AMBIENT_NAMES.filter(name => {
      const item = TOTEM_SEQUENCES[name];
      return name !== 'hide_and_seek' && name !== previous?.name && !item.spin && (allowFlight || !flights.has(item.body));
    });
    const matching = candidates.filter(name => TOTEM_SEQUENCES[name].category === category);
    if (matching.length) candidates = matching;
    if (this.config.easterEggs && allowFlight && !previous?.spin && this.now - this.lastEgg > 600000 && this.random() < .01) {
      candidates = ['upside_down_flight']; this.lastEgg = this.now;
    }
    return this.play(candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))]);
  }
  update(deltaMs, reducedMotion = false) {
    if (this.disposed || !this.visible) return;
    // Capping elapsed time prevents catch-up storms after minimisation.
    const dt = Number.isFinite(deltaMs) ? Math.min(100, Math.max(0, deltaMs)) : 0;
    this.now += dt;
    this.reducedMotion = reducedMotion || this.config.reducedMotion === 'always';
    if (this.bootUntil != null) {
      if (this.now < this.bootUntil) return;
      this.bootUntil = null;
      this.display?.setPowered?.(true);
      if (!this.active) {
        const wake = TOTEM_SEQUENCES.wake_up;
        const greeting = STARTUP_WELCOMES[Math.floor(this.random() * STARTUP_WELCOMES.length)];
        this.playDefinition('wake_up', { ...wake, steps: [...wake.steps, message(greeting)] },
          2, 'ENTERING', true, undefined, { inspect: true });
      }
    }
    this.elapsed += dt;
    if (this.state === 'ENTERING' && this.elapsed >= (this.reducedMotion ? 0 : 600)) this.state = 'IDLE';
    if (this.pendingHover && this.now >= this.pendingHover.due) {
      const event = this.pendingHover; this.pendingHover = null;
      this.react(event.name, event.key);
    }
    const active = this.active;
    if (active) {
      const advance = dt * this.config.speed;
      active.elapsed += advance; active.stepElapsed += advance;
      while (active.stepElapsed >= active.steps[active.index].duration) {
        active.stepElapsed -= active.steps[active.index].duration;
        active.index++;
        if (active.index >= active.steps.length) {
          if (['sleep', 'fall_asleep'].includes(active.name)) this.condition = 'sleepy';
          else if (active.name === 'get_dizzy') this.condition = 'dizzy';
          else if (['wake_up', 'battery_recharge'].includes(active.name)) this.condition = null;
          const leaving = active.name === 'launch_game';
          this.reset(active.definition.kind ? null : 'neutral', !active.definition.kind);
          if (leaving) this.hide();
          break;
        }
        this.enterStep(active.steps[active.index]);
      }
    } else if (this.state === 'IDLE' && this.config.ambient && this.now - this.lastInput >= 3000) {
      this.visorIdle += dt;
      const visorStarted = this.config.displayEnabled && !this.pendingHover && this.randomVisorActivity();
      if (!visorStarted && this.now >= this.nextAmbient) { this.randomActivity(); this.scheduleIdle(); }
    }
    if (!this.active && this.config.blinking && !this.reducedMotion && this.now >= this.nextBlink) {
      this.display?.blink(); this.scheduleBlink();
    }
    this.updatePose(); this.display?.update(dt * this.config.speed); this.renderVisor();
  }
  updatePose() {
    this.resetPose();
    if (this.reducedMotion) return;
    const active = this.active;
    const t = active ? Math.min(1, active.elapsed / active.duration) : 0;
    const pose = this.pose;
    pose.y = Math.sin(this.now / 900) * .012;
    if (!active) { if (this.state === 'ENTERING') pose.x = (1 - Math.min(1, this.elapsed / 600)) * .3; return; }
    const step = active.steps[active.index];
    const body = step.body ?? active.definition.body;
    const phase = step.body ? active.stepElapsed / step.duration : t;
    const envelope = Math.sin(phase * Math.PI), cycle = phase * Math.PI * 2;
    pose.wing = step.wing ?? active.definition.wing ?? 'normal';
    if (body === 'freeze') { pose.y = 0; return; }
    if (body === 'bounce') {
      pose.y += Math.abs(Math.sin(cycle * 2)) * .09 * envelope;
      pose.headPitch = Math.sin(cycle * 2) * envelope * .15;
    }
    if (['sink', 'droop'].includes(body)) { pose.y -= envelope * .1; pose.headPitch = envelope * .23; }
    if (body === 'rise') pose.y += envelope * .1;
    if (body === 'tilt' || body === 'look' || body === 'inspect') {
      pose.roll = envelope * .035;
      pose.headYaw = Math.sin(cycle) * envelope * (body === 'look' ? .48 : .28);
      pose.headRoll = envelope * (body === 'tilt' ? .26 : .17);
      pose.headPitch = Math.cos(cycle) * envelope * (body === 'inspect' ? -.22 : .16);
    }
    if (body === 'shake') pose.headYaw = Math.sin(cycle * 4) * envelope * .32;
    if (body === 'concentrate') pose.headPitch = envelope * .19;
    if (['startle', 'hiccup'].includes(body)) { pose.y += Math.sin(cycle * 2) * envelope * .06; pose.headPitch = envelope * -.22; }
    if (this.config.flight && flights.has(body)) {
      pose.x = Math.sin(cycle) * .22;
      pose.y += Math.sin(cycle * 2) * envelope * .07;
      pose.yaw = Math.sin(cycle) * .2;
    }
    if (['spin', 'roll', 'somersault', 'dizzy'].includes(body)) {
      if (body === 'somersault') pose.pitch = cycle;
      else if (body === 'spin') pose.yaw = cycle;
      else pose.roll = cycle;
    }
    if (body === 'upside_down' && this.config.flight) {
      pose.x = Math.sin(cycle) * .22;
      pose.roll = t < .25 ? t * Math.PI * 4 : t < .75 ? Math.PI : Math.PI + (t - .75) * Math.PI * 4;
    }
    if (body === 'daydream') { pose.y += envelope * .06; pose.headPitch = -envelope * .19; }
    if (body === 'leave') { pose.x = t * .3; this.state = 'LEAVING'; }
    if (step.animation) applyVisorMotion(pose, step.animation, active.stepElapsed / step.duration);
    const movement = PERSONALITY_PRESETS[this.config.preset].movement;
    pose.x *= movement; pose.y *= movement;
  }
  dispose() { this.hide(); this.disposed = true; this.seen.clear(); this.history.length = 0; }
}
