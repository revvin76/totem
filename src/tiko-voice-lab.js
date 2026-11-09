import { TIKO_EMOTIONS, TIKO_EXPRESSIONS } from './tiko-voice-language.js';
import { DEFAULT_VOICE_PATCH, MAX_VOICE_PRESETS, randomizeVoicePatch, VOICE_CONTROLS } from './tiko-voice-settings.js';

const GROUPS = {
  Pitch: { pitch: 'Base pitch (Hz)', range: 'Pitch range', modulation: 'FM depth', glide: 'Glide speed',
    vibratoRate: 'Vibrato rate (Hz)', vibrato: 'Vibrato depth (cents)' },
  Timbre: { blend: 'Triangle blend', resonance: 'Resonance', filter: 'Low-pass (Hz)',
    harmonics: 'Harmonics', articulation: 'Vowel colour' },
  Timing: { duration: 'Syllable duration', separation: 'Syllable gap', variation: 'Variation', volume: 'Master volume' },
};

export function mountTikoVoiceLab({ section, voice, visible, getSettings, saveSettings, previewSection, previewCanvas }) {
  const make = (tag, parent, text) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    parent.append(node);
    return node;
  };
  const label = (parent, text, tag) => {
    const input = make(tag, make('label', parent, text));
    input.setAttribute('aria-label', text);
    return input;
  };
  const action = (parent, text, run) => {
    const button = make('button', parent, text);
    button.type = 'button';
    button.addEventListener('click', run);
    return button;
  };
  const check = (parent, text) => {
    const input = label(parent, text, 'input');
    input.type = 'checkbox';
    return input;
  };
  const fieldset = (parent, title) => {
    const group = make('fieldset', parent);
    make('legend', group, title);
    return group;
  };

  const lab = document.createElement('details');
  lab.className = 'tiko-voice-lab';
  section.insertBefore(lab, previewSection);
  make('summary', lab, 'Tiko Voice Lab');
  const enabled = check(lab, 'Enable Tiko’s voice in the launcher');
  make('p', lab, 'Tiko speaks during his launcher animations. You can audition sounds here even when launcher voice is off.');
  const grid = make('div', lab);
  grid.className = 'tiko-voice-grid';
  const browser = fieldset(grid, 'Expressions');
  const expression = label(browser, 'Expression', 'select');
  for (const [id, entry] of Object.entries(TIKO_EXPRESSIONS)) expression.add(new Option(entry.label, id));
  expression.size = Object.keys(TIKO_EXPRESSIONS).length;
  expression.value = 'hello';
  expression.parentElement.className = 'tiko-expression-list';
  const emotion = label(browser, 'Emotion', 'select');
  for (const id of Object.keys(TIKO_EMOTIONS)) emotion.add(new Option(id[0].toUpperCase() + id.slice(1), id));
  const transport = make('div', browser);
  transport.className = 'totem-preview-actions';
  action(transport, 'Play', () => { stop(); void play(revision); });
  const stopButton = action(transport, 'Stop', () => { stop(); status.textContent = 'Stopped'; });
  const loop = check(browser, 'Loop preview');
  const compare = check(browser, 'Compare with default');
  const designer = make('div', grid);
  const controls = new Map();
  let patch = { ...DEFAULT_VOICE_PATCH };
  for (const [group, entries] of Object.entries(GROUPS)) {
    const panel = fieldset(designer, group);
    for (const [key, title] of Object.entries(entries)) {
      const input = label(panel, title, 'input');
      const [, min, max, step] = VOICE_CONTROLS[key];
      Object.assign(input, { type: 'range', min, max, step });
      const output = make('output', input.parentElement);
      output.setAttribute('aria-hidden', 'true');
      controls.set(key, { input, output });
      input.addEventListener('input', () => { patch[key] = input.valueAsNumber; output.textContent = input.value; });
    }
  }
  const editing = make('div', designer);
  editing.className = 'totem-preview-actions';
  action(editing, 'Reset to default', () => setPatch(DEFAULT_VOICE_PATCH));
  action(editing, 'Randomise', () => setPatch(randomizeVoicePatch(patch)));
  const preview = fieldset(grid, 'Tiko preview');
  const previewNote = make('p', preview, 'The visor and head follow the syllables as Tiko speaks.');
  const monitor = fieldset(lab, 'Audio waveform');
  const canvas = make('canvas', monitor);
  canvas.className = 'tiko-voice-wave';
  canvas.width = 512;
  canvas.height = 64;
  canvas.setAttribute('aria-hidden', 'true');
  const status = make('p', monitor, 'Ready');
  status.setAttribute('role', 'status');
  const context = canvas.getContext('2d');
  const samples = new Float32Array(512);

  const presets = fieldset(lab, 'Voice presets');
  const selection = label(presets, 'Saved preset', 'select');
  const name = label(presets, 'Preset name', 'input');
  Object.assign(name, { type: 'text', maxLength: 40, autocomplete: 'off' });
  const presetActions = make('div', presets);
  presetActions.className = 'totem-preview-actions';
  const load = action(presetActions, 'Load and use', async () => {
    const settings = getSettings();
    const next = settings.presets.find(preset => preset.name === selection.value);
    if (await persist({ ...settings, active: next?.name ?? '' }, `Loaded ${next?.name ?? 'factory voice'}`)) {
      setPatch(next?.patch ?? DEFAULT_VOICE_PATCH);
      name.value = next?.name ?? '';
    }
  });
  const save = action(presetActions, 'Save and use', async () => {
    const title = name.value.trim();
    if (!title) { status.textContent = 'Enter a preset name.'; name.focus(); return; }
    const settings = getSettings();
    const entries = [...settings.presets];
    const index = entries.findIndex(preset => preset.name === title);
    const entry = { name: title, patch: { ...patch } };
    if (index >= 0) entries[index] = entry;
    else if (entries.length >= MAX_VOICE_PRESETS) {
      status.textContent = `You can save up to ${MAX_VOICE_PRESETS} presets. Use an existing name to update it.`;
      return;
    } else entries.push(entry);
    await persist({ ...settings, active: title, presets: entries }, `Saved ${title}`);
  });
  enabled.addEventListener('change', () => void persist({ ...getSettings(), enabled: enabled.checked },
    enabled.checked ? 'Launcher voice enabled' : 'Launcher voice disabled'));
  let revision = 0, replay, meter, closed = false;

  function setPatch(value) {
    patch = { ...value };
    compare.checked = false;
    for (const [key, { input, output }] of controls) {
      input.value = patch[key];
      output.textContent = input.value;
    }
  }
  function refreshSettings() {
    const settings = getSettings();
    enabled.checked = settings.enabled;
    selection.replaceChildren(new Option('Factory voice', ''),
      ...settings.presets.map(preset => new Option(preset.name, preset.name)));
    selection.value = settings.active;
  }
  async function persist(value, message) {
    enabled.disabled = load.disabled = save.disabled = true;
    try {
      await saveSettings(value);
      status.textContent = message;
      return true;
    } catch (error) {
      status.textContent = `Voice settings could not be saved. ${error.message}`;
      return false;
    } finally {
      refreshSettings();
      enabled.disabled = load.disabled = save.disabled = false;
    }
  }
  function waveform(live = false) {
    if (!context) return;
    if (live) voice.analyser?.getFloatTimeDomainData(samples);
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.beginPath();
    context.strokeStyle = '#51f4ff';
    for (let x = 0; x < width; x++) {
      const y = height * (.5 - (live ? samples[x] : 0) * .46);
      if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
  }
  function stop() {
    revision++;
    clearTimeout(replay);
    clearInterval(meter);
    if (voice.target === 'lab') voice.stop();
    waveform();
    stopButton.disabled = true;
  }
  async function play(request) {
    if (closed || !lab.open || !visible()) return;
    stopButton.disabled = false;
    status.textContent = 'Starting preview…';
    try {
      const event = await voice.speak(expression.value, {
        emotion: emotion.value, patch: compare.checked ? DEFAULT_VOICE_PATCH : patch, target: 'lab',
      });
      if (request !== revision) return;
      if (!event) {
        status.textContent = voice.muted ? 'Totem audio is muted.' : 'Master volume is zero.';
        stopButton.disabled = true;
        return;
      }
      status.textContent = `Playing ${TIKO_EXPRESSIONS[event.plan.expression].label}`;
      if (context) meter = setInterval(() => waveform(true), 50);
      await event.ended;
      if (request !== revision) return;
      clearInterval(meter);
      waveform();
      if (loop.checked && !voice.muted && voice.context?.state === 'running') {
        status.textContent = 'Looping preview';
        replay = setTimeout(() => { if (request === revision) void play(request); }, 220);
      } else {
        status.textContent = voice.muted ? 'Totem audio is muted.' : 'Ready';
        stopButton.disabled = true;
      }
    } catch (error) {
      if (request === revision) {
        stop();
        status.textContent = error.message;
      }
    }
  }
  function syncVisibility() {
    if (!lab.open || !visible()) {
      if (!stopButton.disabled) status.textContent = 'Ready';
      stop();
    }
  }
  lab.addEventListener('toggle', () => {
    if (lab.open) preview.prepend(previewCanvas);
    else previewSection.insertBefore(previewCanvas, previewSection.children[1]);
    previewSection.hidden = lab.open;
    syncVisibility();
  });
  loop.addEventListener('change', () => {
    if (!loop.checked && !voice.active && !stopButton.disabled) {
      stop();
      status.textContent = 'Ready';
    }
  });
  const initial = getSettings();
  setPatch(initial.presets.find(preset => preset.name === initial.active)?.patch ?? DEFAULT_VOICE_PATCH);
  name.value = initial.active;
  refreshSettings();
  stop();
  return {
    syncVisibility,
    previewUnavailable() { previewNote.textContent = 'The 3D preview is unavailable. You can still audition the voice and use the waveform.'; },
    dispose() { closed = true; stop(); },
  };
}
