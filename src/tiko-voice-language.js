// Gestures describe musical movement, with no phoneme or text processing.
// Each row is duration, gap after it, pitch contour in semitones, vowel
// colour (0 = round, 1 = bright), and optional accent and attack fraction.
const syllable = (duration, gap, pitch, colour, accent = 1, attack = .16) =>
  Object.freeze({ duration, gap, pitch: Object.freeze(pitch), colour: Object.freeze(colour), accent, attack });
const expression = (label, face, ...syllables) => Object.freeze({ label, face, syllables: Object.freeze(syllables) });

export const TIKO_EXPRESSIONS = Object.freeze({
  hello: expression('Hello', 'happy',
    syllable(.208, .048, [0, 1, .6, -1.4, -2], [.90, .82], .80, .09),
    syllable(.385, 0, [0, 4.5, 7, 7, 5.5], [.15, .23, .16], 1, .08)),
  boo: expression('Boo!', 'cheeky', syllable(.22, 0, [5, 10, 8, 5, 0], [.82, .34, .14], 1, .045)),
  yes: expression('Yes', 'happy', syllable(.177, .025, [1, 6, 10], [.65, .93], .9, .08),
    syllable(.134, 0, [12, 14, 13], [.29, .38], .95, .08)),
  no: expression('No', 'sad', syllable(.275, .021, [2, 1, -1, -3], [.86, .74], .77, .1),
    syllable(.28, 0, [-2, -4, -6, -8], [.18, .10], .88, .09)),
  wow: expression('Wow', 'surprised',
    syllable(.195, .027, [2, 7, 10, 12], [.55, .97], .89, .08),
    syllable(.225, 0, [13, 15, 14.5, 14.5], [.32, .24], 1, .08)),
  hmm: expression('Hmm', 'thinking', syllable(.56, 0, [-10, -13, -5], [.10, .06, .23], .80, .29)),
  huh: expression('Huh?', 'surprised', syllable(.16, 0, [-5, 0, 13], [.34, .86], .95, .09)),
  yay: expression('Yay!', 'excited', syllable(.076, .025, [4, 5, 5], [.65, .76], .78),
    syllable(.091, .029, [9, 9, 10], [.74, .83], .9),
    syllable(.22, 0, [14, 15, 12], [.93, .54])),
  oops: expression('Oops', 'confused', syllable(.105, .073, [9, 5, 2], [.25, .15]),
    syllable(.112, 0, [0, -5, -11], [.57, .75], .74, .1)),
  goodbye: expression('Goodbye', 'happy', syllable(.113, .04, [-2, 2, 0], [.34, .25], .77),
    syllable(.13, .055, [3, 7, 5], [.71, .52], .88),
    syllable(.26, 0, [4, 0, -8], [.59, .22], .86)),
  laugh: expression('Laugh', 'laughing', syllable(.115, .052, [7, 10, 9], [.77, .90], .84, .09),
    syllable(.130, .050, [8, 11, 10], [.80, .90], .87, .09),
    syllable(.143, .049, [9, 12, 11], [.82, .92], .9, .09),
    syllable(.153, 0, [10, 13, 12], [.83, .92], .92, .1)),
  curious: expression('Curious', 'curious', syllable(.105, .093, [-2, 4, 1], [.40, .66], .85),
    syllable(.13, .045, [-4, 2, 6], [.28, .58], .86),
    syllable(.19, 0, [3, 4, 13], [.38, .85], .91)),
});

// Each modifier transforms the same gestures. Pitch offsets and inflections
// are in semitones; pace, span, attack and level are multipliers.
export const TIKO_EMOTIONS = Object.freeze({
  neutral:   { pitch: 0,  pace: 1,    span: 1,    lift: 0,  bright: 0,    warble: 1,   attack: 1,   level: 1,   pause: 1 },
  happy:     { pitch: 3,  pace: 1.13, span: 1.05, lift: 3,  bright: .14,  warble: 1.1, attack: .9,  level: 1,   pause: .94 },
  excited:   { pitch: 4,  pace: 1.24, span: 1.23, lift: 2,  bright: .18,  warble: 1.7, attack: .73, level: 1.1, pause: .8 },
  sad:       { pitch: -5, pace: .78,  span: .76,  lift: -4, bright: -.23, warble: .7,  attack: 1.6, level: .73, pause: 1.15 },
  confused:  { pitch: -1, pace: .9,   span: 1.1,  lift: 5,  bright: -.04, warble: 1.5, attack: 1.1, level: .87, pause: 1.65 },
  surprised: { pitch: 1,  pace: 1.18, span: 1.3,  lift: 5,  bright: .21,  warble: 1.3, attack: .60, level: 1.1, pause: .85 },
  sleepy:    { pitch: -6, pace: .73,  span: .69,  lift: -3, bright: -.25, warble: .6,  attack: 1.8, level: .65, pause: 1.2 },
  annoyed:   { pitch: -4, pace: 1.26, span: .81,  lift: -3, bright: -.05, warble: .7,  attack: .65, level: .93, pause: .78 },
  playful:   { pitch: 2,  pace: 1.06, span: 1.2,  lift: 2,  bright: .09,  warble: 1.5, attack: .83, level: .97, pause: 1.08 },
});
