import * as THREE from 'three';
import suppliedFaces from './totem-led-faces.json' with { type: 'json' };

export const EXPRESSION_NAMES = Object.freeze(['happy', 'neutral', 'blink', 'curious', 'surprised', 'excited', 'sleepy', 'laughing', 'confused', 'sad', 'cheeky', 'thinking']);
export function validateLedFaces(data) {
  if (data?.schema !== 'totem-led-faces/v2' || data.grid?.width !== 40 || data.grid?.height !== 20 || data.grid?.origin !== 'top-left' || data.grid?.on !== '1' || data.grid?.off !== '0') throw Error('Expected a top-left 40 × 20 totem-led-faces/v2 grid.');
  for (const name of EXPRESSION_NAMES) {
    for (const layer of ['eyes', 'mouth']) {
      const rows = data.expressions?.[name]?.layers?.[layer];
      if (!Array.isArray(rows) || rows.length !== 20 || rows.some(row => typeof row !== 'string' || !/^[01]{40}$/.test(row))) throw Error(`Invalid ${name}.${layer} LED mask.`);
    }
  }
  for (const key of ['led_color', 'core_color', 'recommended_background']) if (!/^#[\da-f]{6}$/i.test(data.render?.[key])) throw Error(`Invalid LED ${key}.`);
  if (!Number.isFinite(data.render?.unlit_led_alpha) || data.render.unlit_led_alpha < 0 || data.render.unlit_led_alpha > 1) throw Error('Invalid unlit LED intensity.');
  return data;
}
export const LED_FACES = validateLedFaces(suppliedFaces);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const AFTERGLOW_STEP_MS = 38;

// The composited target lights immediately. Extinguished pixels leave two dimmer steps.
// Time is supplied by the scene; this class owns no timers or render loop.
export class TotemLedMatrix {
  constructor(faces = LED_FACES) {
    this.faces = validateLedFaces(faces);
    this.masks = Object.fromEntries(EXPRESSION_NAMES.map(name => [name, Object.fromEntries(['eyes', 'mouth'].map(layer => [layer, Float32Array.from(faces.expressions[name].layers[layer].join(''), Number)]))]));
    this.layers = Object.fromEntries(['eyes', 'mouth'].map(layer => [layer, { name: 'neutral', current: this.masks.neutral[layer] }]));
    this.intensity = new Uint8Array(800);
    this.lastLit = new Uint8Array(800);
    this.darkTime = new Float32Array(800).fill(-1);
    this.frame = null;
    this.voiceFace = null;
    this.voiceMouth = null;
    this.mode = 'expression';
    this.blinkRemaining = 0;
    this.expression = 'neutral';
    this.disposed = false;
    this.update(0);
  }
  check(name) {
    if (this.disposed) throw Error('LED matrix is disposed.');
    if (!Object.hasOwn(this.masks, name)) throw Error(`Unknown Totem expression: ${name}`);
  }
  setLayer(layer, name, duration = 100) {
    this.check(name);
    this.layers[layer].name = name;
    this.layers[layer].current = this.masks[name][layer];
    if (layer === 'eyes') this.blinkRemaining = 0;
    this.update(0, duration === 0);
  }
  setExpression(name, duration = 100) {
    this.check(name);
    if (name === 'blink') { this.blink(); return; }
    this.expression = name;
    this.layers.eyes.name = this.layers.mouth.name = name;
    this.layers.eyes.current = this.masks[name].eyes;
    this.layers.mouth.current = this.masks[name].mouth;
    this.blinkRemaining = 0;
    this.update(0, duration === 0);
  }
  setEyes(name, duration = 100) { this.setLayer('eyes', name, duration); }
  setMouth(name, duration = 100) { this.setLayer('mouth', name, duration); }
  setVoiceFace(face, mouth, immediate) {
    if (face === this.voiceFace && mouth === this.voiceMouth) return false;
    this.voiceFace = face;
    this.voiceMouth = mouth;
    return this.update(0, immediate);
  }
  blink(duration = 140) {
    this.check('blink');
    this.blinkRemaining = Number.isFinite(duration) ? clamp(duration, 0, 1000) : 140;
    this.update(0);
  }
  presentFrame(frame, mode = 'animation') {
    if (this.disposed || (frame === null && this.frame === null)) return false;
    if (frame !== null && (!(frame instanceof Uint8Array) || frame.length !== 800 || !['message', 'animation'].includes(mode))) throw Error('Invalid Totem visor frame.');
    this.frame = frame;
    this.mode = frame ? mode : 'expression';
    return this.update(0);
  }
  update(deltaMs, immediate = false) {
    if (this.disposed) return false;
    const dt = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    this.blinkRemaining = Math.max(0, this.blinkRemaining - dt);
    const eyes = this.blinkRemaining > 0 ? this.masks.blink.eyes : this.masks[this.voiceFace]?.eyes ?? this.layers.eyes.current;
    const mouth = this.masks[this.voiceMouth]?.mouth ?? this.layers.mouth.current;
    let changed = false;
    for (let i = 0; i < 800; i++) {
      const target = this.frame ? this.frame[i] : Math.max(eyes[i], mouth[i]) * 255;
      let value = target;
      if (target || immediate) {
        this.lastLit[i] = target;
        this.darkTime[i] = -1;
      } else if (this.lastLit[i]) {
        const elapsed = this.darkTime[i] < 0 ? 0 : this.darkTime[i] + dt;
        this.darkTime[i] = elapsed;
        if (elapsed >= 2 * AFTERGLOW_STEP_MS) this.lastLit[i] = 0;
        else value = Math.round(this.lastLit[i] * (elapsed < AFTERGLOW_STEP_MS ? .5 : .25));
      }
      if (this.intensity[i] !== value) { changed = true; this.intensity[i] = value; }
    }
    return changed;
  }
  dispose() { this.disposed = true; this.frame = null; this.mode = 'expression'; this.blinkRemaining = 0; }
}

const vertexShader = `
varying vec2 screenPoint;
void main() {
  screenPoint = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const fragmentShader = `
uniform sampler2D mask;
uniform vec4 bounds;
uniform vec3 ledColor;
uniform vec3 coreColor;
uniform vec3 background;
uniform float brightness;
uniform float glow;
uniform float unlit;
uniform bool displayEnabled;
varying vec2 screenPoint;
void main() {
  vec2 uv = (screenPoint - bounds.xy) / bounds.zw;
  vec2 maskUv = vec2(uv.x, 1.0 - uv.y);
  vec2 dimensions = vec2(40.0, 20.0);
  vec2 grid = maskUv * dimensions;
  vec2 dx = dFdx(maskUv), dy = dFdy(maskUv);
  float footprint = max(length(dx * dimensions), length(dy * dimensions));
  float radius = length(fract(grid) - 0.5);
  float aa = max(fwidth(radius), 0.025);
  vec3 color = background;
  if (displayEnabled && all(greaterThanEqual(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) {
    float power = texelFetch(mask, min(ivec2(grid), ivec2(39, 19)), 0).r;
    float dotShape = 1.0 - smoothstep(0.31 - aa * 0.5, 0.31 + aa * 0.5, radius);
    float core = 1.0 - smoothstep(0.15 - aa * 0.5, 0.15 + aa * 0.5, radius);
    float halo = exp(-radius * radius * 22.0) * power * glow * 0.4;
    vec3 dots = ledColor * (dotShape * unlit + brightness * power * dotShape * 2.0 + halo)
      + coreColor * core * power * brightness * 0.45;
    // When cells are only a few pixels wide, fade to their average light
    // coverage. Continuous UV gradients also filter the expression itself.
    float filteredPower = textureGrad(mask, maskUv, dx, dy).r;
    vec3 filtered = ledColor * (0.302 * (unlit + brightness * filteredPower * 2.0) + 0.057 * filteredPower * glow)
      + coreColor * 0.071 * filteredPower * brightness * 0.45;
    color += mix(dots, filtered, smoothstep(0.3, 0.85, footprint));
  }
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Replaces only this mesh's material. The curved model geometry, hierarchy and
// shared source material remain untouched. bounds are model-local x/y units.
export class TotemLedDisplay {
  constructor(visor, { bounds, faces = LED_FACES } = {}) {
    if (!visor?.isMesh || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[2] <= 0 || bounds[3] <= 0) throw Error('LED display needs a verified visor mesh and local display bounds.');
    if (Math.abs(bounds[2] / bounds[3] - 2) > 0.02) throw Error('LED bounds must preserve the 40 × 20 aspect ratio.');
    this.matrix = new TotemLedMatrix(faces);
    this.texture = new THREE.DataTexture(this.matrix.intensity, 40, 20, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
    this.visor = visor;
    this.originalMaterial = visor.material;
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, side: visor.material.side,
      uniforms: {
        mask: { value: this.texture }, bounds: { value: new THREE.Vector4(...bounds) },
        ledColor: { value: new THREE.Color(faces.render.led_color) }, coreColor: { value: new THREE.Color(faces.render.core_color) },
        background: { value: new THREE.Color(faces.render.recommended_background) }, brightness: { value: 1 }, glow: { value: 1 },
        unlit: { value: faces.render.unlit_led_alpha }, displayEnabled: { value: true },
      },
    });
    visor.material = this.material;
  }
  upload() { if (!this.disposed) this.texture.needsUpdate = true; }
  setExpression(name, duration) { this.matrix.setExpression(name, duration); this.upload(); }
  setEyes(name, duration) { this.matrix.setEyes(name, duration); this.upload(); }
  setMouth(name, duration) { this.matrix.setMouth(name, duration); this.upload(); }
  setVoiceFace(face, mouth, immediate) { if (this.matrix.setVoiceFace(face, mouth, immediate)) this.upload(); }
  blink(duration) { this.matrix.blink(duration); this.upload(); }
  presentFrame(frame, mode) { if (this.matrix.presentFrame(frame, mode)) this.upload(); }
  configure({ brightness = 1, glow = 1, color = '#51F4FF', displayEnabled = true } = {}) {
    if (!Number.isFinite(brightness) || !Number.isFinite(glow) || !/^#[\da-f]{6}$/i.test(color)) throw Error('Invalid LED appearance.');
    const uniforms = this.material.uniforms;
    uniforms.brightness.value = clamp(brightness, 0, 1.5);
    uniforms.glow.value = clamp(glow, 0, 2);
    uniforms.ledColor.value.set(color);
    this.enabled = Boolean(displayEnabled);
    uniforms.displayEnabled.value = this.enabled && this.powered !== false;
  }
  setPowered(powered) {
    this.powered = powered;
    this.material.uniforms.displayEnabled.value = this.enabled !== false && powered;
  }
  update(dt) { if (this.matrix.update(dt)) this.upload(); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.visor.material === this.material) this.visor.material = this.originalMaterial;
    this.matrix.dispose(); this.texture.dispose(); this.material.dispose();
  }
}
