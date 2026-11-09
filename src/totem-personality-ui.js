import * as THREE from 'three';
import { createTotemCompanion } from './totem-personality-integration.js';
import { createTotemMascot, hasTotemAsset } from './totem-mascot.js';
import { EXPRESSION_NAMES } from './totem-led-display.js';
import { VISOR_PROGRAMS, message } from './totem-visor-programs.js';
import { AMBIENT_NAMES, TOTEM_SEQUENCES } from './totem-personality.js';
import { normalizePersonality, applyPersonalityPreset, prefersReducedTotemMotion } from './totem-personality-config.js';
import { recordFailure } from './error-log.js';
import { mountTikoVoiceLab } from './tiko-voice-lab.js';
import './totem-personality.css';

function element(tag, text, className) {
  const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node;
}
function button(text, action) { const node = element('button', text); node.type = 'button'; node.addEventListener('click', action); return node; }
function options(names) { const node = element('select'); for (const name of names) node.add(new Option(name.replaceAll('_', ' '), name)); return node; }
function fieldset(parent, title) { const node = element('fieldset'); node.append(element('legend', title)); parent.append(node); return node; }
function labelled(parent, title, control) { const label = element('label', title); label.append(control); parent.append(label); return control; }

export async function mountTotemPersonality(section) {
  section.classList.add('totem-personality');
  const status = element('p', 'Loading Totem…'); status.setAttribute('role', 'status'); section.append(status);
  if (!hasTotemAsset) {
    status.textContent = 'The optional Tiko model is not bundled.';
    return;
  }
  let service;
  try {
    service = await createTotemCompanion({
      sceneInteractive: () => !document.body.classList.contains('studio-platform-chooser'),
    });
  }
  catch (error) {
    void recordFailure('little-totem.initialize', error);
    status.textContent = `Totem unavailable: ${error.message}`;
    return;
  }
  let config = normalizePersonality(service.config), saving = Promise.resolve(), sequence = 0;
  const controls = new Map();
  function refresh() {
    for (const [key, input] of controls) {
      const value = key.startsWith('categories.') ? config.categories[key.slice(11)] : config[key];
      if (input.type === 'checkbox') input.checked = value; else input.value = value;
      if (input.nextElementSibling?.tagName === 'OUTPUT') input.nextElementSibling.textContent = value;
    }
  }
  function save(next) {
    config = normalizePersonality(next); refresh(); const revision = ++sequence;
    const captured = structuredClone(config); status.textContent = 'Saving…';
    saving = saving.then(() => service.save({ ...captured, voice: service.config.voice })).then(() => { if (revision === sequence) status.textContent = 'Saved'; }).catch(error => {
      void recordFailure('little-totem.save-settings', error);
      status.textContent = `Not saved: ${error.message}. Reopen the application before retrying.`;
    });
  }
  function control(parent, title, key, type = 'checkbox', min, max, step) {
    const input = element('input'); input.type = type;
    if (min !== undefined) Object.assign(input, { min, max, step });
    labelled(parent, title, input); controls.set(key, input);
    if (type === 'range') { const output = element('output'); input.after(output); input.addEventListener('input', () => output.textContent = input.value); }
    input.addEventListener('change', () => {
      const value = type === 'checkbox' ? input.checked : type === 'range' ? Number(input.value) : input.value;
      save(key.startsWith('categories.') ? { ...config, categories: { ...config.categories, [key.slice(11)]: value } } : { ...config, [key]: value });
    });
    return input;
  }
  const mascot = fieldset(section, 'Mascot'); control(mascot, 'Enable Totem mascot', 'enabled');
  const activity = fieldset(section, 'Personality activity'), preset = options(['subtle', 'balanced', 'playful']);
  controls.set('preset', preset); labelled(activity, 'Activity preset', preset);
  preset.addEventListener('change', () => save(applyPersonalityPreset(config, preset.value)));
  activity.append(element('p', 'Subtle is restrained. Balanced adds occasional activity. Playful reacts and wanders more often.'));
  const behaviours = fieldset(section, 'Behaviours');
  for (const [key, text] of [['reactions', 'React to user actions'], ['ambient', 'Random idle behaviours'], ['flight', 'Fly around the scene'], ['easterEggs', 'Rare Easter eggs']]) control(behaviours, text, key);
  const motion = element('select');
  for (const [value, label] of [['system', 'Follow launcher'], ['full', 'Always animate'], ['always', 'Always reduce motion']]) motion.add(new Option(label, value));
  controls.set('reducedMotion', motion); labelled(behaviours, 'Totem motion', motion);
  motion.addEventListener('change', () => save({ ...config, reducedMotion: motion.value }));
  const led = fieldset(section, 'LED face');
  control(led, 'LED display enabled', 'displayEnabled'); control(led, 'LED brightness', 'brightness', 'range', 0, 1.5, .05);
  control(led, 'LED glow intensity', 'glow', 'range', 0, 2, .05); control(led, 'LED colour', 'color', 'color'); control(led, 'Blinking enabled', 'blinking');
  control(led, 'Show random messages', 'randomMessages');
  control(led, 'Play mini LED animations', 'miniAnimations');
  control(led, 'Allow rare screen surprises', 'screenSurprises');
  led.append(button('Restore default LED appearance', () => save({ ...config, displayEnabled: true, brightness: 1, glow: 1, color: '#51F4FF', blinking: true })));
  const previewSection = fieldset(section, 'Real-time preview'), canvas = element('canvas');
  canvas.setAttribute('aria-label', 'Animated 3D Totem preview'); canvas.setAttribute('role', 'img'); previewSection.append(canvas);
  const voiceLab = mountTikoVoiceLab({
    section, voice: service.voice, visible, previewSection, previewCanvas: canvas,
    getSettings: () => service.config.voice,
    saveSettings(voice) {
      const write = saving.then(async () => {
        const saved = await service.save({ ...service.config, voice });
        config.voice = saved.voice;
      });
      saving = write.catch(error => { void recordFailure('little-totem.voice.save', error); });
      return write;
    },
  });
  const expression = options(EXPRESSION_NAMES); expression.value = 'neutral'; labelled(previewSection, 'Expression', expression);
  const closeUp = element('input'); closeUp.type = 'checkbox'; labelled(previewSection, 'Visor close-up', closeUp);
  const previewControls = element('div', null, 'totem-preview-actions'); previewSection.append(previewControls);
  const expressionStatus = element('p', 'Neutral'); expressionStatus.setAttribute('role', 'status'); previewSection.append(expressionStatus);
  let preview, previewRenderer, scene, camera, last = null, manual = true, playback = null;
  const stopPreviewVoice = () => { if (service.voice.target === 'preview') service.voice.stop(); };
  function manualFace() {
    stopPreviewVoice();
    manual = true; playback = null; refreshPlayback();
    if (!preview) return;
    preview.personality.active = null; preview.personality.resetPose(); preview.personality.clearVisor();
    preview.body.position.set(0, 0, 0); preview.body.rotation.set(0, 0, 0);
    preview.resetArticulation();
  }
  function setExpression() {
    manualFace(); preview?.display.setExpression(expression.value, prefersReduced() ? 0 : 100);
    expressionStatus.textContent = expression.value;
  }
  previewControls.append(button('Play expression', setExpression), button('Blink', () => { if (!prefersReduced()) preview?.display.blink(); }), button('Play random animation', () => {
    if (!preview) return; manualFace(); manual = false;
    // Preview intentionally ignores ambient frequency while retaining reduced
    // motion and flight settings; it does not mutate the saved configuration.
    const candidates = AMBIENT_NAMES.filter(name => name !== 'hide_and_seek' && (!prefersReduced() || !TOTEM_SEQUENCES[name].spin));
    const name = candidates[Math.floor(Math.random() * candidates.length)];
    preview.personality.play(name, 3, 'AMBIENT', true);
    expressionStatus.textContent = name.replaceAll('_', ' ');
  }), button('Preview head and wings', () => {
    if (!preview) return;
    if (prefersReduced()) { expressionStatus.textContent = 'Motion preview is unavailable while reduced motion is on.'; return; }
    manualFace();
    if (preview.personality.play('wing_stretch', 3, 'AMBIENT', true)) {
      manual = false;
      expressionStatus.textContent = 'Head and wings';
    }
  }), button('Reset pose', () => { preview?.personality.reset(); expression.value = 'neutral'; setExpression(); }));
  expression.addEventListener('change', setExpression);
  const visorControls = fieldset(previewSection, 'Animation preview');
  previewSection.insertBefore(visorControls, expressionStatus);
  const visorProgram = element('select');
  for (const [key, value] of Object.entries(VISOR_PROGRAMS)) visorProgram.add(new Option(value.label, key));
  labelled(visorControls, 'Visor animation', visorProgram);
  const previewSpeed = element('select');
  for (const [label, value] of [['Normal', '1'], ['Half speed', '.5'], ['Quarter speed', '.25']]) previewSpeed.add(new Option(label, value));
  labelled(visorControls, 'Preview speed', previewSpeed);
  const sampleMessage = element('input'); sampleMessage.type = 'text'; sampleMessage.maxLength = 32; sampleMessage.value = 'HELLO!';
  const pause = button('Pause preview', () => {
    if (!playback || prefersReduced()) return;
    playback.paused = !playback.paused;
    if (playback.paused) stopPreviewVoice();
    refreshPlayback();
  });
  const advanceFrame = button('Advance frame', () => { if (playback?.paused) advancePreview(100, prefersReduced()); });
  function refreshPlayback() {
    pause.textContent = playback?.paused ? 'Resume preview' : 'Pause preview';
    pause.disabled = !playback || prefersReduced();
    advanceFrame.disabled = !playback?.paused;
  }
  function advancePreview(dt, reducedMotion) {
    preview.update(dt, reducedMotion);
    if (!preview.personality.active) {
      const label = playback.label;
      manualFace(); expressionStatus.textContent = `${label} finished`;
    }
  }
  function previewVisor(name, definition) {
    if (!preview) return;
    manualFace();
    const inspect = prefersReduced();
    playback = { paused: inspect, label: definition.label };
    preview.personality.reducedMotion = inspect;
    if (preview.personality.playDefinition(name, definition, 3, 'AMBIENT', true, undefined, { inspect: true })) {
      manual = false;
      refreshPlayback(); advancePreview(0, inspect);
      expressionStatus.textContent = inspect ? `${definition.label} ready. Use Advance frame to inspect with reduced motion.` : definition.label;
    } else {
      playback = null;
      expressionStatus.textContent = 'Preview unavailable with the current LED or motion settings.';
    }
  }
  const visorActions = element('div', null, 'totem-preview-actions'); visorControls.append(visorActions);
  visorActions.append(button('Play visor animation', () => previewVisor(visorProgram.value, VISOR_PROGRAMS[visorProgram.value])), pause, advanceFrame);
  refreshPlayback();
  labelled(visorControls, 'Preview message', sampleMessage);
  visorControls.append(button('Show message', () => {
    const text = sampleMessage.value.trim();
    if (!text) { expressionStatus.textContent = 'Enter a message to preview.'; return; }
    previewVisor('preview_message', { label: text, kind: 'message', body: 'hover', steps: [message(text)] });
  }));
  const advanced = element('details'); advanced.append(element('summary', 'Advanced personality')); section.append(advanced);
  control(advanced, 'Reaction cooldown (seconds)', 'cooldown', 'range', 2, 60, 1);
  control(advanced, 'Minimum idle interval (seconds)', 'idleMin', 'range', 20, 300, 5);
  control(advanced, 'Maximum idle interval (seconds)', 'idleMax', 'range', 20, 600, 5);
  control(advanced, 'Animation speed', 'speed', 'range', .5, 2, .1);
  for (const key of Object.keys(config.categories)) control(advanced, `React to ${key}`, `categories.${key}`);
  control(advanced, 'Visual effects', 'effects'); advanced.append(button('Reset personality settings', () => save({})));
  function prefersReduced() { return prefersReducedTotemMotion(config.reducedMotion); }
  let diagnostic, raw, diagnosticStatus, eyesControl, mouthControl;
  {
    diagnostic = element('details'); diagnostic.append(element('summary', 'Developer LED diagnostics')); advanced.append(diagnostic);
    const eyes = options(EXPRESSION_NAMES), mouth = options(EXPRESSION_NAMES);
    eyesControl = eyes; mouthControl = mouth;
    labelled(diagnostic, 'Eye mask', eyes); labelled(diagnostic, 'Mouth mask', mouth);
    eyes.value = mouth.value = 'neutral';
    eyes.addEventListener('change', () => { manualFace(); preview?.display.setEyes(eyes.value, prefersReduced() ? 0 : 100); });
    mouth.addEventListener('change', () => { manualFace(); preview?.display.setMouth(mouth.value, prefersReduced() ? 0 : 100); });
    const choreography = options(Object.keys(TOTEM_SEQUENCES).filter(name => name !== 'hide_and_seek')); labelled(diagnostic, 'Animation sequence', choreography);
    diagnostic.append(button('Play sequence', () => { if (preview) { manualFace(); manual = false; preview.personality.play(choreography.value, 3, 'AMBIENT', true); } }));
    raw = element('canvas'); raw.width = 450; raw.height = 250; raw.setAttribute('aria-label', 'Raw LED grid with column and row coordinates'); diagnostic.append(raw);
    diagnosticStatus = element('p'); diagnostic.append(diagnosticStatus);
    const metrics = element('p'); metrics.setAttribute('role', 'status');
    const measure = button('Measure scene performance', async () => {
      measure.disabled = true; metrics.textContent = 'Measuring the stationary launcher for ten seconds…';
      try {
        const { result, path } = await service.measureScenePerformance();
        metrics.textContent = `Submission median: ${result.disabled.submissionMs.median?.toFixed(2)} → ${result.enabled.submissionMs.median?.toFixed(2)} ms. GPU median: ${result.disabled.gpuMs.median?.toFixed(2) ?? 'unavailable'} → ${result.enabled.gpuMs.median?.toFixed(2) ?? 'unavailable'} ms.${path ? ` Profile: ${path}` : ''}`;
      } catch (error) {
        void recordFailure('little-totem.measurement', error);
        metrics.textContent = `Measurement incomplete: ${error.message}`;
      }
      finally { measure.disabled = false; }
    });
    diagnostic.append(measure, metrics);
  }
  function diagnostics() {
    if (!diagnostic?.open || !preview) return;
    const matrix = preview.display.matrix, context = raw.getContext('2d');
    eyesControl.value = matrix.layers.eyes.name; mouthControl.value = matrix.layers.mouth.name;
    context.fillStyle = '#080e23'; context.fillRect(0, 0, 450, 250); context.font = '8px monospace';
    for (let row = 0; row < 20; row++) for (let column = 0; column < 40; column++) {
      context.strokeStyle = '#29404f'; context.strokeRect(30 + column * 10, 25 + row * 10, 10, 10);
      const level = matrix.intensity[row * 40 + column] / 255;
      context.fillStyle = level ? `rgba(81, 244, 255, ${level})` : '#142736'; context.beginPath(); context.arc(35 + column * 10, 30 + row * 10, 3, 0, Math.PI * 2); context.fill();
    }
    context.fillStyle = '#d9f7ff';
    for (let x = 0; x < 40; x++) context.fillText(x, 31 + x * 10, 16);
    for (let y = 0; y < 20; y++) context.fillText(y, 9, 33 + y * 10);
    diagnosticStatus.textContent = `Mode: ${matrix.mode} · Expression: ${matrix.expression} · Eyes: ${matrix.blinkRemaining > 0 ? 'blink overlay' : matrix.layers.eyes.name} · Mouth: ${matrix.layers.mouth.name} · 40 × 20 · top-left origin`;
  }
  function render(now) {
    if (!preview) return;
    const dt = last === null ? 0 : Math.min(100, now - last); last = now;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    if (canvas.width !== Math.round(width * previewRenderer.getPixelRatio()) || canvas.height !== Math.round(height * previewRenderer.getPixelRatio())) {
      previewRenderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    }
    const reducedMotion = prefersReduced();
    if (playback) {
      if (reducedMotion && !playback.paused) { playback.paused = true; refreshPlayback(); }
      if (pause.disabled !== reducedMotion) pause.disabled = reducedMotion;
      if (!playback.paused) advancePreview(dt * Number(previewSpeed.value), false);
    } else if (!manual) preview.update(dt, reducedMotion);
    else preview.display.update(reducedMotion ? 1000 : dt);
    if (reducedMotion) { preview.body.position.set(0, 0, 0); preview.body.rotation.set(0, 0, 0); preview.resetArticulation(); }
    const voiceEvent = service.voice.active?.event;
    preview.updateVoice(['lab', 'preview'].includes(voiceEvent?.target) ? voiceEvent : null, dt, reducedMotion);
    preview.root.visible = true; previewRenderer.render(scene, camera); diagnostics();
  }
  function visible() { return !document.hidden && !section.hidden && section.closest('dialog')?.open; }
  const observer = new MutationObserver(() => visibilityChanged());
  observer.observe(section, { attributes: true, attributeFilter: ['hidden'] });
  const dialog = section.closest('dialog'); if (dialog) observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  function visibilityChanged() {
    voiceLab.syncVisibility();
    if (!visible()) stopPreviewVoice();
    if (previewRenderer) { last = null; previewRenderer.setAnimationLoop(visible() ? render : null); }
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  try {
    preview = createTotemMascot(service.asset, config, undefined, (expression, options) => {
      if (!visible() || playback?.paused) return;
      void service.previewVoice(expression, options).catch(error => recordFailure('little-totem.voice.preview', error));
    });
    service.preview = preview; preview.personality.show();
    scene = new THREE.Scene(); scene.background = new THREE.Color('#100923');
    scene.add(new THREE.HemisphereLight('#e2f5ff', '#39245c', 2.5)); const key = new THREE.DirectionalLight('#fff5eb', 3); key.position.set(-2, 3, 5); scene.add(key);
    scene.add(preview.root); preview.root.scale.setScalar(3.7);
    camera = new THREE.PerspectiveCamera(30, 2, .1, 40); camera.position.set(0, 0, 7);
    preview.root.updateMatrixWorld(true);
    const faceCenter = new THREE.Box3().setFromObject(preview.visor).getCenter(new THREE.Vector3());
    closeUp.addEventListener('change', () => {
      if (closeUp.checked) {
        camera.position.copy(faceCenter); camera.position.z += 1.8; camera.lookAt(faceCenter);
      } else { camera.position.set(0, 0, 7); camera.lookAt(0, 0, 0); }
    });
    previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true }); previewRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    status.textContent = 'Ready'; visibilityChanged();
  } catch (error) {
    void recordFailure('little-totem.preview', error);
    expressionStatus.textContent = `Preview unavailable: ${error.message}`;
    voiceLab.previewUnavailable();
  }
  refresh();
  addEventListener('pagehide', () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibilityChanged); voiceLab.dispose(); previewRenderer?.setAnimationLoop(null); previewRenderer?.dispose(); service.dispose(); }, { once: true });
}
