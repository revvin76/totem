import { normalizeGameplayBackdrop, VIDEO_FADES, VIDEO_FIELDS, VIDEO_FITS, VIDEO_PRESETS } from './gameplay-backdrop-settings.js';
import './gameplay-backdrop-panel.css';

export function mountGameplayBackdropPanel(toolbar, initial, onChange) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Video';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'studio-video-panel');
  toolbar.append(button);

  const panel = document.createElement('aside');
  panel.id = 'studio-video-panel';
  panel.className = 'studio-video-panel studio-control-panel';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'studio-video-title');
  panel.innerHTML = `
    <header><h2 id="studio-video-title">Video</h2><button type="button" aria-label="Close Video panel">×</button></header>
    <p>Show gameplay behind the scene. These settings apply to both pages.</p>
    <label class="video-enabled"><input type="checkbox"> Enabled</label>
    <fieldset aria-label="Video treatment">
      <label>Preset <select data-preset></select></label>
      <details open><summary>Picture</summary></details>
      <details><summary>Position and size</summary></details>
      <details><summary>Fades and effects</summary></details>
    </fieldset>`;
  document.body.append(panel);
  const enabled = panel.querySelector('input');
  const fields = panel.querySelector('fieldset');
  const preset = panel.querySelector('[data-preset]');
  const [picture, geometry, fades] = panel.querySelectorAll('details');
  preset.add(new Option('Custom', ''));
  for (const [key, [title]] of Object.entries(VIDEO_PRESETS)) preset.add(new Option(title, key));
  let value;
  const controls = new Map();
  function change(patch) {
    setValue({ ...value, ...patch });
    onChange(value);
  }
  function setValue(next) {
    value = normalizeGameplayBackdrop(next);
    enabled.checked = value.enabled;
    fields.disabled = !value.enabled;
    const match = Object.entries(VIDEO_PRESETS).find(([, [, patch]]) =>
      JSON.stringify(normalizeGameplayBackdrop({ ...patch, enabled: value.enabled })) === JSON.stringify(value));
    preset.value = match?.[0] ?? '';
    for (const [key, { input, output, unit }] of controls) {
      input.value = value[key];
      if (output) {
        output.textContent = value[key] + unit;
        input.setAttribute('aria-valuetext', output.textContent);
      }
    }
  }
  function addField(group, key, choices) {
    const label = document.createElement('label');
    const [title, min, max, , unit] = VIDEO_FIELDS[key] ?? [key === 'fit' ? 'Video fit' : 'Fade direction'];
    label.append(title);
    const input = document.createElement(choices ? 'select' : 'input');
    let output;
    if (choices) {
      for (const [id, name] of Object.entries(choices)) input.add(new Option(name, id));
      input.onchange = () => change({ [key]: input.value });
    } else {
      Object.assign(input, { type: 'range', min, max });
      output = document.createElement('span');
      output.setAttribute('aria-hidden', 'true');
      label.append(output);
      input.oninput = () => change({ [key]: input.valueAsNumber });
    }
    label.append(input);
    group.append(label);
    controls.set(key, { input, output, unit });
  }
  for (const key of ['opacity', 'blur', 'brightness', 'saturation']) addField(picture, key);
  addField(geometry, 'fit', VIDEO_FITS);
  for (const key of ['left', 'top', 'width', 'height']) addField(geometry, key);
  addField(fades, 'fade', VIDEO_FADES);
  for (const key of ['fadeStart', 'fadeEnd', 'fadeStrength', 'feather', 'vignette', 'scanlines']) addField(fades, key);
  enabled.onchange = () => change({ enabled: enabled.checked });
  preset.onchange = () => {
    if (!preset.value) return;
    change(normalizeGameplayBackdrop({ ...VIDEO_PRESETS[preset.value][1], enabled: value.enabled }));
  };
  function show(open) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) enabled.focus();
  }
  function close() { show(false); button.focus(); }
  button.onclick = () => show(panel.hidden);
  panel.querySelector('header button').onclick = close;
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  });
  setValue(initial);
  return { setValue, open: () => show(true), hide: () => show(false) };
}
