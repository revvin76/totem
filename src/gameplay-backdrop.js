import * as THREE from 'three';
import { normalizeGameplayBackdrop } from './gameplay-backdrop-settings.js';

export function createGameplayBackdrop(scene, wall, floor) {
  // Blend over both room surfaces before foreground objects draw. This
  // viewport-space layer leaves the room's depth buffer intact.
  wall.renderOrder = -1001;
  floor.renderOrder = -1000;
  const uniforms = {
    footage: { value: null }, frame: { value: new THREE.Vector4() },
    effects: { value: new THREE.Vector4() }, fade: { value: new THREE.Vector4() },
    style: { value: new THREE.Vector4() }, crop: { value: new THREE.Vector2() },
    pixel: { value: new THREE.Vector2() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `
      varying vec2 stage;
      void main() {
        stage = vec2(uv.x, 1.0 - uv.y);
        gl_Position = vec4(position.xy, 0.999, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 stage;
      uniform sampler2D footage;
      uniform vec4 frame, effects, fade, style;
      uniform vec2 crop, pixel;
      vec3 readVideo(vec2 uv) {
        return texture2D(footage, clamp(uv, 0.0, 1.0)).rgb;
      }
      void main() {
        vec2 point = (stage - frame.xy) / frame.zw;
        vec2 uv = (point - 0.5) * crop + 0.5;
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))) ||
            any(lessThan(point, vec2(0.0))) || any(greaterThan(point, vec2(1.0)))) discard;
        if (style.w > 0.5) uv.y = 1.0 - uv.y;
        vec3 color = readVideo(uv);
        if (effects.y > 0.0) {
          vec2 stepSize = pixel * effects.y;
          color *= 0.20;
          for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
            if (x != 0 || y != 0) color += readVideo(uv + vec2(float(x), float(y)) * stepSize) * 0.10;
          }
        }
        float alpha = effects.x;
        if (effects.z > 0.0) {
          vec2 edge = min(point, 1.0 - point);
          alpha *= smoothstep(0.0, effects.z, edge.x) * smoothstep(0.0, effects.z, edge.y);
        }
        if (fade.x > 0.0) {
          float axis = fade.x < 1.5 ? point.x : fade.x < 2.5 ? 1.0 - point.x :
            fade.x < 3.5 ? point.y : 1.0 - point.y;
          alpha *= 1.0 - fade.w * smoothstep(fade.y, fade.z, axis);
        }
        float shade = 1.0 - style.y * smoothstep(0.18, 0.70, length(point - 0.5));
        shade *= 1.0 - style.z * step(2.0, mod(gl_FragCoord.y, 4.0));
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = clamp(mix(vec3(luma), color, style.x) * effects.w * shade, 0.0, 1.0);
        gl_FragColor = sRGBTransferEOTF(vec4(color, alpha));
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.name = 'Gameplay backdrop';
  mesh.renderOrder = floor.renderOrder + 1;
  mesh.frustumCulled = mesh.visible = false;
  mesh.raycast = () => {};
  scene.add(mesh);

  let settings = normalizeGameplayBackdrop();
  return {
    mesh,
    apply(value) { settings = normalizeGameplayBackdrop(value); },
    update(texture, width, height, brightness = 1) {
      const video = texture?.image;
      mesh.visible = settings.enabled && settings.opacity > 0 && !!video?.videoWidth && video.readyState >= 2;
      if (!mesh.visible) { uniforms.footage.value = null; return; }
      const { fit, fade, fadeStart, fadeEnd, fadeStrength } = settings;
      const w = settings.width / 100, h = settings.height / 100;
      const ratio = width * w / (height * h) / (video.videoWidth / video.videoHeight);
      const x = fit === 'cover' ? Math.min(1, ratio) : fit === 'contain' ? Math.max(1, ratio) : 1;
      const y = fit === 'cover' ? Math.min(1, 1 / ratio) : fit === 'contain' ? Math.max(1, 1 / ratio) : 1;
      uniforms.footage.value = texture;
      uniforms.crop.value.set(x, y);
      uniforms.pixel.value.set(x / (width * w), y / (height * h));
      uniforms.frame.value.set(settings.left / 100, settings.top / 100, w, h);
      uniforms.effects.value.set(settings.opacity / 100, settings.blur, settings.feather / 100, settings.brightness / 100 * brightness);
      uniforms.fade.value.set(['none', 'right', 'left', 'down', 'up'].indexOf(fade),
        fadeStart / 100, Math.max(fadeEnd, fadeStart + 1) / 100, fadeStrength / 100);
      uniforms.style.value.set(settings.saturation / 100, settings.vignette / 100, settings.scanlines / 100, Number(texture.flipY));
    },
  };
}
