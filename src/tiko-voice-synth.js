const RELEASE_TAIL = .012;

// This native graph is shared by live playback and the offline evidence
// renderer. JS schedules a handful of ramps per phrase; DSP runs in Web Audio.
export function scheduleTikoVoice(context, output, plan, start) {
  const { voice } = plan;
  const sources = [];
  const nodes = [];
  const node = name => { const next = context[name](); nodes.push(next); return next; };
  const gain = (value, destination) => {
    const next = node('createGain');
    next.gain.value = value;
    next.connect(destination);
    return next;
  };
  const oscillator = (type, destination) => {
    const next = node('createOscillator');
    next.type = type;
    next.connect(destination);
    sources.push(next);
    return next;
  };
  const level = gain(.68 * plan.level, output);
  const envelope = gain(0, level);
  const lowpass = node('createBiquadFilter');
  lowpass.type = 'lowpass';
  lowpass.Q.value = -3;
  lowpass.frequency.value = voice.filter;
  lowpass.connect(envelope);
  const mix = gain(1, gain(1 - .63 * voice.articulation, lowpass));
  const formant = weight => {
    const filter = node('createBiquadFilter');
    filter.type = 'bandpass';
    filter.Q.value = voice.resonance;
    mix.connect(filter);
    filter.connect(gain(weight * voice.articulation, lowpass));
    return filter.frequency;
  };
  const low = formant(.54), high = formant(.34);
  const rounded = gain(1, mix);
  const coloured = gain(0, mix);
  const sine = oscillator('sine', gain(1 - .83 * voice.blend, rounded));
  const triangle = oscillator('triangle', gain(.83 * voice.blend, rounded));
  // Even partials give the bright syllables their buzzy edge. The rounded
  // carrier stays present, with vowel colour crossfading the two sources.
  const pulse = oscillator('sine', coloured);
  pulse.setPeriodicWave(context.createPeriodicWave(
    new Float32Array(8), new Float32Array([0, 1, 1.14, .62, .37, .16, .085, .048]),
  ));
  const vibrato = node('createGain');
  vibrato.gain.value = 0;
  oscillator('sine', vibrato).frequency.value = voice.vibratoRate;
  const fm = node('createGain');
  fm.gain.value = 0;
  const modulator = oscillator('sine', fm);
  const carriers = [sine, triangle, pulse];
  for (const carrier of carriers) {
    vibrato.connect(carrier.detune);
    fm.connect(carrier.frequency);
  }
  for (const gesture of plan.syllables) {
    const at = start + gesture.start, end = start + gesture.end;
    const sustain = end - gesture.release;
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(gesture.accent, at + gesture.attack);
    envelope.gain.linearRampToValueAtTime(gesture.accent * .88, sustain);
    envelope.gain.linearRampToValueAtTime(0, end);
    vibrato.gain.setValueAtTime(gesture.vibrato * .25, at);
    vibrato.gain.linearRampToValueAtTime(gesture.vibrato, sustain);
    fm.gain.setValueAtTime(gesture.pitch[0].hz * voice.modulation * .7, at);
    if (gesture.glitch) {
      const flicker = at + (gesture.end - gesture.start) * .48;
      fm.gain.setValueAtTime(gesture.pitch[0].hz * voice.modulation * 2.3, flicker);
      fm.gain.linearRampToValueAtTime(gesture.pitch[0].hz * voice.modulation * .7, flicker + .013);
    }
    for (const [index, point] of gesture.pitch.entries()) {
      const method = index ? 'exponentialRampToValueAtTime' : 'setValueAtTime';
      for (const carrier of carriers) carrier.frequency[method](point.hz, start + point.time);
      modulator.frequency[method](point.hz * 1.5, start + point.time);
    }
    for (const [index, point] of gesture.formants.entries()) {
      const method = index ? 'linearRampToValueAtTime' : 'setValueAtTime';
      low[method](point.low, start + point.time);
      high[method](point.high, start + point.time);
      const richness = voice.harmonics * (.36 + .62 * point.colour);
      rounded.gain[method](1 - richness, start + point.time);
      coloured.gain[method](richness, start + point.time);
    }
  }

  let resolve;
  let disconnected = false;
  const ended = new Promise(done => { resolve = done; });
  function disconnect() {
    if (disconnected) return;
    disconnected = true;
    sources[0].onended = null;
    for (const next of nodes) next.disconnect();
    resolve();
  }
  sources[0].onended = disconnect;
  const end = start + plan.duration + RELEASE_TAIL;
  for (const source of sources) { source.start(start); source.stop(end); }
  return {
    ended,
    stop(now, fade = 0) {
      if (disconnected) return;
      const stopAt = Math.max(now, Math.min(end, now + fade));
      level.gain.setValueAtTime(level.gain.value, now);
      level.gain.linearRampToValueAtTime(0, stopAt);
      for (const source of sources) source.stop(stopAt);
      if (!fade) disconnect();
    },
  };
}
