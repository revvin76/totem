import { TIKO_EMOTIONS, TIKO_EXPRESSIONS } from './tiko-voice-language.js';
import { clamp, normalizeVoicePatch } from './tiko-voice-settings.js';

const FACES = { happy: 'happy', excited: 'excited', sad: 'sad', confused: 'confused',
  surprised: 'surprised', sleepy: 'sleepy', annoyed: 'sad', playful: 'cheeky' };

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function planTikoVoice(expression, { emotion = 'neutral', intensity = 1, patch, seed } = {}) {
  if (!Object.hasOwn(TIKO_EXPRESSIONS, expression)) throw Error(`Unknown Tiko expression: ${expression}`);
  const definition = TIKO_EXPRESSIONS[expression];
  const mood = Object.hasOwn(TIKO_EMOTIONS, emotion) ? TIKO_EMOTIONS[emotion] : TIKO_EMOTIONS.neutral;
  const voice = normalizeVoicePatch(patch);
  const random = Number.isFinite(seed) ? seededRandom(seed) : Math.random;
  const vary = width => (random() * 2 - 1) * voice.variation * width;
  const pitchOffset = mood.pitch + vary(2.5);
  const pace = mood.pace * (1 + vary(.13));
  let start = 0;
  const syllables = definition.syllables.map((gesture, index) => {
    const duration = clamp(gesture.duration * voice.duration * (1 + vary(.12)) / pace, .047, 1.6);
    const accent = clamp(gesture.accent * mood.level * (1 + vary(.14)), 0, 1);
    const attack = clamp(duration * gesture.attack * mood.attack * (1.35 - .6 * voice.articulation), .006, duration * .42);
    const release = clamp(duration * (.28 - .16 * voice.articulation), .012, duration * .44);
    const end = start + duration;
    const pitch = gesture.pitch.map((note, point) => {
      const progress = point / (gesture.pitch.length - 1);
      const semitones = (note + mood.lift * progress) * voice.range * mood.span + pitchOffset;
      return {
        time: start + duration * progress ** voice.glide,
        hz: clamp(voice.pitch * 2 ** (semitones / 12), 65, 2250),
      };
    });
    const colourOffset = mood.bright + vary(.18);
    const formants = gesture.colour.map((value, point) => {
      const colour = clamp(value + colourOffset, 0, 1);
      return { time: start + duration * point / (gesture.colour.length - 1),
        low: 410 + colour * 640, high: 850 + colour * 1980, colour };
    });
    const vibrato = clamp(voice.vibrato * mood.warble * (1 + vary(.4)), 0, 130);
    const glitch = voice.variation > 0 && (emotion === 'excited' || emotion === 'playful') && random() < .26 * voice.variation;
    const result = { start, end, attack, release, accent, pitch, formants, vibrato, index, glitch };
    start = end + gesture.gap * voice.separation * mood.pause / pace;
    return result;
  });
  return {
    expression, face: Object.hasOwn(FACES, emotion) ? FACES[emotion] : definition.face,
    emotion, duration: syllables.at(-1).end, syllables, voice,
    level: clamp(Number.isFinite(intensity) ? intensity : 1, 0, 1) * voice.volume,
  };
}

// The scene reads the same scheduled timeline as the synth, without measuring
// samples or starting a second animation clock.
export function voiceGestureAt(plan, elapsed) {
  return plan.syllables.find(syllable => elapsed >= syllable.start && elapsed < syllable.end) ?? null;
}
