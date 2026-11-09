import { planTikoVoice, voiceGestureAt } from './tiko-voice-plan.js';
import { scheduleTikoVoice } from './tiko-voice-synth.js';

const STOP_FADE = .018;
const LEAD = .028;

export class TikoVoiceEngine {
  constructor(createContext = () => new AudioContext({ latencyHint: 'interactive' })) {
    this.createContext = createContext;
    this.request = 0;
    this.muted = false;
    this.disposed = false;
  }

  async prepare() {
    if (this.disposed || this.muted) return;
    if (!this.context || this.context.state === 'closed') {
      if (this.context) {
        this.context.onstatechange = null;
        this.analyser.disconnect();
      }
      const context = this.createContext();
      this.context = context;
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(context.destination);
      context.onstatechange = () => {
        if (this.context === context && context.state !== 'running' && (this.active || this.releasing)) this.stop();
      };
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  async speak(expression, options = {}) {
    if (this.disposed || this.muted) return null;
    const plan = planTikoVoice(expression, options);
    this.stop();
    const request = this.request;
    if (!plan.level) return null;
    this.target = options.target;
    if (this.context?.state !== 'running') {
      const resume = this.prepare();
      let timeout;
      try {
        await Promise.race([resume, new Promise((_, reject) => {
          timeout = setTimeout(() => reject(Error('Tiko could not start the audio output. Try Play again.')), 900);
        })]);
      } catch (error) {
        if (request !== this.request) return null;
        this.stop();
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (request !== this.request) return null;
    const context = this.context;
    if (context.state !== 'running') {
      this.stop();
      throw Error('Tiko’s audio output is unavailable.');
    }
    const start = context.currentTime + LEAD;
    const playback = scheduleTikoVoice(context, this.analyser, plan, start);
    const event = {
      plan, start, target: options.target, ended: playback.ended,
      elapsed: () => context.state === 'running' ? context.currentTime - start : -1,
      gesture: elapsed => voiceGestureAt(plan, elapsed),
    };
    this.active = { event, playback };
    void playback.ended.then(() => {
      if (this.active?.event !== event) return;
      this.active = null;
      this.target = null;
    });
    return event;
  }

  stop() {
    this.request++;
    this.target = null;
    const now = this.context?.currentTime ?? 0;
    // Keep one release tail through rapid replays. A replacement starts after it.
    if (this.context?.state !== 'running') {
      this.releasing?.stop(now);
      this.releasing = null;
    }
    if (!this.active) return;
    const { event, playback } = this.active;
    this.active = null;
    const fade = this.context.state === 'running' && now >= event.start ? STOP_FADE : 0;
    playback.stop(now, fade);
    if (fade) {
      this.releasing?.stop(now);
      this.releasing = playback;
      void playback.ended.then(() => { if (this.releasing === playback) this.releasing = null; });
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted) this.stop();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.releasing?.stop(this.context.currentTime);
    this.analyser?.disconnect();
    if (this.context) {
      this.context.onstatechange = null;
      if (this.context.state !== 'closed') await this.context.close();
    }
  }
}
