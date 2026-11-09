import {
  CanvasTexture, DataTexture, LinearFilter, Matrix4, Quaternion, SRGBColorSpace, Vector2, Vector3, VideoTexture,
} from 'three';

const smooth = time => time * time * (3 - 2 * time);
const PREVIEW_LEAD_IN = 3;

function screenGeometry(mesh, uncroppedUV) {
  const positions = mesh?.geometry?.getAttribute('position');
  const uv = uncroppedUV ?? mesh?.geometry?.getAttribute('uv');
  if (!positions || !uv || !mesh.material?.map) return null;
  mesh.updateWorldMatrix(true, false);
  // Use the actual UV corners so rotated or differently oriented model parts
  // keep their artwork upright in the final shot.
  const corner = (u, v) => {
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(uv.getX(i) - u) < 0.001 && Math.abs(uv.getY(i) - v) < 0.001)
        return new Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
    }
    return null;
  };
  const lowerLeft = corner(0, 0);
  const lowerRight = corner(1, 0);
  const upperLeft = corner(0, 1);
  const upperRight = corner(1, 1);
  if (![lowerLeft, lowerRight, upperLeft, upperRight].every(Boolean)) return null;
  const right = lowerRight.sub(lowerLeft);
  const up = upperLeft.sub(lowerLeft);
  const width = right.length(), height = up.length();
  if (!(width > 0 && height > 0) || Math.abs(right.dot(up) / width / height) > 0.015) return null;
  if (upperRight.distanceTo(lowerLeft.clone().add(right).add(up)) > Math.min(width, height) * 0.015) return null;
  const center = lowerLeft.addScaledVector(right, 0.5).addScaledVector(up, 0.5);
  right.normalize();
  up.normalize();
  const normal = right.clone().cross(up).normalize();
  return { center, normal, right, up, width, height };
}

export function createCinematicShot({ mesh, camera, uncroppedUV, onLock, onPicture, onSuspend }) {
  const surface = screenGeometry(mesh, uncroppedUV);
  if (!surface) return null;

  const original = {
    position: camera.position.clone(), rotation: camera.quaternion.clone(),
    zoom: camera.zoom, fov: camera.fov, near: camera.near,
  };
  const originalMaterial = mesh.material;
  const originalGeometry = mesh.geometry;
  const position = new Vector3();
  const orbit = new Vector3();
  const rotation = new Quaternion();
  const basis = new Matrix4();
  const offset = original.position.clone().sub(surface.center);
  const radius = offset.length();
  if (radius <= 0) return null;
  const azimuth = Math.atan2(offset.dot(surface.right), offset.dot(surface.normal));
  const elevation = Math.asin(Math.max(-1, Math.min(1, offset.dot(surface.up) / radius)));
  const around = Math.abs(azimuth) > Math.PI / 2 ? 0.6 : 0;
  let texture, material, clip, geometry, preview, frameFit, animation, progress = 0;
  let locked = false, picture = false, suspended = false, returningFrame = false;

  function restoreCamera() {
    camera.position.copy(original.position);
    camera.quaternion.copy(original.rotation);
    camera.zoom = original.zoom;
    camera.fov = original.fov;
    camera.near = original.near;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function pose(value) {
    progress = value;
    if (value === 0) {
      restoreCamera();
      return;
    }
    const { center, normal, right, up, width, height } = surface;
    const vertical = Math.tan(camera.getEffectiveFOV() * Math.PI / 360);
    const distance = 0.99 * Math.min(height * frameFit.y / vertical, width * frameFit.x / vertical / camera.aspect) / 2;
    if (around && value < around) {
      const remainder = 1 - smooth(value / around);
      const yaw = azimuth * remainder, pitch = elevation * remainder;
      orbit.copy(normal).multiplyScalar(Math.cos(yaw) * Math.cos(pitch))
        .addScaledVector(right, Math.sin(yaw) * Math.cos(pitch))
        .addScaledVector(up, Math.sin(pitch));
      position.copy(center).addScaledVector(orbit, radius);
    } else if (around) {
      const approach = smooth((value - around) / (1 - around));
      position.copy(center).addScaledVector(normal, radius + (distance - radius) * approach);
    } else {
      position.copy(center).addScaledVector(normal, distance).lerp(original.position, 1 - value);
    }
    rotation.setFromRotationMatrix(basis.lookAt(position, center, up));
    camera.position.copy(position);
    camera.quaternion.copy(original.rotation).slerp(rotation, around ? Math.min(1, value / around) : value);
    camera.near = original.near + (Math.min(original.near, distance / 8) - original.near) * value;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function pictureMaterial() {
    if (!material) {
      material = originalMaterial.clone();
      material.color.setHex(0xffffff);
      material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
          if (all(greaterThanEqual(vMapUv, vec2(0.0))) && all(lessThanEqual(vMapUv, vec2(1.0)))) {
            #include <map_fragment>
          } else {
            diffuseColor.rgb = vec3(0.0);
          }
        `);
      };
      mesh.material = material;
    }
  }

  function fitTexture(width, height) {
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    const aspect = (width / height) / (surface.width / surface.height);
    frameFit = new Vector2(Math.min(1, aspect), Math.min(1, 1 / aspect));
    texture.repeat.set(1 / frameFit.x, 1 / frameFit.y);
    texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2);
    material.map = texture;
    material.needsUpdate = true;
    activatePicture();
  }

  function showFrame(frame) {
    pictureMaterial();
    const { width, height, pixels } = frame;
    if (!texture || texture.image.width !== width || texture.image.height !== height) {
      texture?.dispose();
      texture = new DataTexture(pixels, width, height);
      fitTexture(width, height);
    } else {
      texture.image.data = pixels;
    }
    texture.needsUpdate = true;
  }

  function activatePicture() {
    if (uncroppedUV && !geometry) {
      geometry = originalGeometry.clone();
      geometry.setAttribute('uv', uncroppedUV.clone());
      mesh.geometry = geometry;
    }
    if (!picture) {
      picture = true;
      onPicture(true);
    }
  }

  function releasePicture() {
    mesh.material = originalMaterial;
    texture?.dispose();
    material?.dispose();
    texture = material = null;
    if (geometry) {
      mesh.geometry = originalGeometry;
      geometry.dispose();
      geometry = null;
    }
    if (clip) {
      clip.pause();
      clip.removeAttribute('src');
      clip.load();
      clip = null;
    }
  }

  function showBlack() {
    releasePicture();
    material = originalMaterial.clone();
    material.map = null;
    material.color.setHex(0x000000);
    mesh.material = material;
    frameFit = new Vector2(1, 1);
    activatePicture();
  }

  function capturePreview() {
    if (preview) return;
    const map = originalMaterial.map;
    const video = map.isVideoTexture && map.image;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let visible = false;
      for (let row = 1; row < 8 && !visible; row++) {
        for (let col = 1; col < 8 && !visible; col++) {
          const pixel = (Math.floor(row * canvas.height / 8) * canvas.width + Math.floor(col * canvas.width / 8)) * 4;
          visible = data[pixel] > 16 || data[pixel + 1] > 16 || data[pixel + 2] > 16;
        }
      }
      if (!visible) return;
    } catch {
      return;
    }
    preview = new CanvasTexture(canvas);
    preview.colorSpace = map.colorSpace;
    preview.minFilter = map.minFilter;
    preview.magFilter = map.magFilter;
    preview.generateMipmaps = map.generateMipmaps;
    preview.offset.copy(map.offset);
    preview.repeat.copy(map.repeat);
  }

  async function preparePreview(signal) {
    capturePreview();
    const map = originalMaterial.map;
    const video = map.isVideoTexture && map.image;
    if (preview || !video || !(video.currentTime < PREVIEW_LEAD_IN && video.duration > PREVIEW_LEAD_IN)) return;
    // Preview clips can begin on black. Seek once while the return canvas is hidden.
    signal.throwIfAborted();
    await new Promise(resolve => {
      const finish = () => {
        clearTimeout(timeout);
        video.removeEventListener('seeked', finish);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timeout = setTimeout(finish, 500);
      video.addEventListener('seeked', finish, { once: true });
      signal.addEventListener('abort', finish, { once: true });
      try { video.currentTime = PREVIEW_LEAD_IN; }
      catch { finish(); }
    });
    signal.throwIfAborted();
    capturePreview();
  }

  function animateFor(duration, signal, step, description) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let began;
      const finish = error => {
        clearTimeout(deadline);
        signal.removeEventListener('abort', stop);
        animation = null;
        if (error) reject(error); else resolve();
      };
      const stop = () => finish(signal.reason);
      const deadline = setTimeout(() => finish(new Error(`Totem did not render the cinematic ${description}.`)), duration + 750);
      signal.addEventListener('abort', stop, { once: true });
      animation = now => {
        began ??= now;
        const elapsed = Math.min(duration, Math.max(0, now - began));
        step(elapsed);
        if (elapsed === duration) finish();
      };
    });
  }

  return {
    lock(sampleGpu) {
      locked = true;
      capturePreview();
      onLock(true, sampleGpu);
    },
    frame: showFrame,
    black: showBlack,
    async startup(url, maxDurationMs, signal) {
      releasePicture();
      const video = document.createElement('video');
      clip = video;
      video.playsInline = true;
      video.muted = false;
      video.crossOrigin = 'anonymous';
      video.src = url;
      await new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        video.play().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      });
      signal.throwIfAborted();
      const durationMs = video.duration * 1000;
      if (!(durationMs > 0 && durationMs <= maxDurationMs && video.videoWidth && video.videoHeight))
        throw new Error('Invalid startup video.');
      pictureMaterial();
      texture = new VideoTexture(video);
      fitTexture(video.videoWidth, video.videoHeight);
      return {
        durationMs,
        stop() { video.pause(); },
        waitForEnd(stop) {
          if (video.ended) return Promise.resolve();
          stop.throwIfAborted();
          return new Promise((resolve, reject) => {
            const finish = error => {
              video.removeEventListener('ended', ended);
              video.removeEventListener('error', failed);
              stop.removeEventListener('abort', abort);
              if (error) reject(error); else resolve();
            };
            const ended = () => finish();
            const failed = () => finish(new Error('The startup video stopped.'));
            const abort = () => finish(stop.reason);
            video.addEventListener('ended', ended);
            video.addEventListener('error', failed);
            stop.addEventListener('abort', abort, { once: true });
          });
        },
      };
    },
    animate(destination, duration, signal) {
      const start = progress;
      return animateFor(duration, signal, elapsed => {
        const ease = smooth(duration ? elapsed / duration : 1);
        pose(start + (destination - start) * ease);
        if (returningFrame) material.color.setScalar(1 - ease);
      }, 'camera animation');
    },
    fadeToBlack(holdMs, fadeMs, signal) {
      // When the chooser preview is the fallback, preserve its original material.
      if (!material) mesh.material = material = originalMaterial.clone();
      const color = material.color.clone();
      return animateFor(holdMs + fadeMs, signal, elapsed => {
        const time = Math.max(0, (elapsed - holdMs) / fadeMs);
        material.color.copy(color).multiplyScalar(1 - smooth(time));
      }, 'exit fade');
    },
    tick(now) { animation?.(now); },
    suspend() {
      suspended = true;
      capturePreview();
      onSuspend(true);
      releasePicture();
    },
    preparePreview,
    resume(frame, { fade = true } = {}) {
      if (frame) showFrame(frame);
      else {
        capturePreview();
        if (preview) {
          material = originalMaterial.clone();
          material.map = preview;
          material.color.setHex(0xffffff);
          mesh.material = material;
        } else if (originalMaterial.map.isVideoTexture) {
          originalMaterial.map.needsUpdate = true;
        }
      }
      returningFrame = Boolean(frame) && fade;
      pose(1);
      suspended = false;
      return onSuspend(false);
    },
    dispose() {
      if (!locked) return;
      releasePicture();
      preview?.dispose();
      preview = null;
      restoreCamera();
      if (picture) onPicture(false);
      if (suspended) onSuspend(false);
      onLock(false);
      locked = false;
    },
  };
}
