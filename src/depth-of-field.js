import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { Box3, Matrix4, Vector3 } from 'three';
import { normalizeDepthOfField } from './studio-page-settings.js';

const DEFAULT_FOCUS = 16;

// Transparent device edges must contribute their alpha to every bokeh sample.
// Both Studio and the runtime use this same pass and focus calculation.
export function createDepthOfField(scene, camera, backdrop) {
  const pass = new BokehPass(scene, camera, { focus: DEFAULT_FOCUS, aperture: 0.0035, maxblur: 0.006 });
  if (backdrop) {
    // The video quad is already in the colour buffer. Only real geometry
    // belongs in the override-material depth capture.
    const render = pass.render.bind(pass);
    pass.render = (...args) => {
      const visible = backdrop.visible;
      backdrop.visible = false;
      try { return render(...args); }
      finally { backdrop.visible = visible; }
    };
  }
  let samples = 0;
  const weighted = pass.materialBokeh.fragmentShader.replace(/col \+= texture2D\( tColor, ([^\n]+) \);/g,
    (_match, uv) => { samples++; return `{ vec4 sampleColor = texture2D( tColor, ${uv} ); col.rgb += sampleColor.rgb * sampleColor.a; col.a += sampleColor.a; }`; });
  const corrected = weighted.replace(/gl_FragColor = col \/ 41\.0;\s*gl_FragColor\.a = 1\.0;/,
    'gl_FragColor.rgb = col.rgb / max( col.a, 0.00001 );\n\t\t\tgl_FragColor.a = col.a / 41.0;');
  // Measure defocus from the nearest edge of the sharp depth range.
  const ranged = corrected
    .replace('uniform float focus;', 'uniform float focusNear;\n\t\tuniform float focusFar;')
    .replace('float factor = ( focus + viewZ );', 'float factor = clamp( -viewZ, focusNear, focusFar ) + viewZ;');
  const supported = samples === 41 && corrected !== weighted &&
    ranged.includes('clamp( -viewZ, focusNear, focusFar )') && ranged.includes('uniform float focusFar;');
  if (supported) pass.materialBokeh.fragmentShader = ranged;
  else console.warn('Depth of field disabled: required shader adjustments unavailable.');
  pass.uniforms.focusNear = { value: DEFAULT_FOCUS };
  pass.uniforms.focusFar = { value: DEFAULT_FOCUS };
  pass.materialBokeh.needsUpdate = true;
  pass.enabled = false;
  const viewBounds = new Box3();
  const modelToView = new Matrix4();
  const corner = new Vector3();
  return { pass, supported,
    update(value, activeCamera = camera, model = null) {
      const settings = normalizeDepthOfField(value);
      pass.camera = activeCamera;
      pass.uniforms.nearClip.value = activeCamera.near;
      pass.uniforms.farClip.value = activeCamera.far;
      pass.uniforms.maxblur.value = settings.blur;
      pass.enabled = supported && settings.enabled && settings.blur > 0;
      if (!pass.enabled) return;

      let nearest = Infinity;
      let farthest = -Infinity;
      if (model) {
        activeCamera.updateWorldMatrix(true, false);
        model.updateWorldMatrix(true, true);
        model.traverseVisible(part => {
          if (!part.geometry || !part.layers.test(activeCamera.layers)) return;
          const source = part.boundingBox !== undefined ? part : part.geometry;
          if (source.boundingBox === null) source.computeBoundingBox();
          if (!source.boundingBox || source.boundingBox.isEmpty()) return;
          modelToView.multiplyMatrices(activeCamera.matrixWorldInverse, part.matrixWorld);
          const { min, max } = source.boundingBox;
          const matrix = modelToView.elements;
          // View-space depth is affine for ordinary world and camera matrices.
          // Each coefficient picks the extremal corner for that axis.
          if (matrix[3] === 0 && matrix[7] === 0 && matrix[11] === 0 && matrix[15] > 0) {
            const xPositive = matrix[2] >= 0;
            const yPositive = matrix[6] >= 0;
            const zPositive = matrix[10] >= 0;
            nearest = Math.min(nearest, -corner.set(
              xPositive ? max.x : min.x, yPositive ? max.y : min.y, zPositive ? max.z : min.z,
            ).applyMatrix4(modelToView).z);
            farthest = Math.max(farthest, -corner.set(
              xPositive ? min.x : max.x, yPositive ? min.y : max.y, zPositive ? min.z : max.z,
            ).applyMatrix4(modelToView).z);
          } else {
            viewBounds.copy(source.boundingBox).applyMatrix4(modelToView);
            nearest = Math.min(nearest, -viewBounds.max.z);
            farthest = Math.max(farthest, -viewBounds.min.z);
          }
        });
      }
      pass.uniforms.focusNear.value = Math.max(activeCamera.near, Number.isFinite(nearest) ? nearest : DEFAULT_FOCUS);
      pass.uniforms.focusFar.value = Math.max(pass.uniforms.focusNear.value, Number.isFinite(farthest) ? farthest : DEFAULT_FOCUS);
    },
  };
}
