import { Vector3, WebGLRenderer } from "three";

const foregroundLayer = 30;

// Only Tiko can appear in front of the HTML details. The canvas ignores input
// so the details retain their hit targets, scrolling and keyboard focus.
export function createPlatformForeground(host, scene, renderer, lights) {
  let overlay;
  const center = new Vector3();
  function hide() {
    if (overlay) overlay.domElement.hidden = true;
  }
  function render(camera, pole, mascot, panelDepth, renderScene) {
    const showPole = panelDepth == null && pole?.visible;
    if (!showPole && (!mascot || panelDepth == null)) {
      hide();
      renderScene();
      return;
    }
    const beforeRender = scene.onBeforeRender;
    const layers = new Map();
    const move = root => root?.traverse(object => {
      if (!layers.has(object)) layers.set(object, object.layers.mask);
      object.layers.set(foregroundLayer);
    });
    const background = scene.background;
    const cameraMask = camera.layers.mask;
    const inFront = object => panelDepth != null &&
      -object.getWorldPosition(center).applyMatrix4(camera.matrixWorldInverse).z < panelDepth;
    try {
      scene.onBeforeRender = function (...args) {
        beforeRender.apply(this, args);
        if (args[2] !== camera || layers.size) return;
        if (showPole) move(pole);
        if (mascot?.visible && (showPole ? mascot.userData.onPole : inFront(mascot))) move(mascot);
      };
      renderScene();
      if (!layers.size) { hide(); return; }
      if (!overlay) {
        overlay = new WebGLRenderer({ alpha: true, antialias: true });
        const canvas = overlay.domElement;
        canvas.className = "platform-foreground";
        canvas.setAttribute("aria-hidden", "true");
        host.append(canvas);
      }
      const { clientWidth: width, clientHeight: height } = renderer.domElement;
      const ratio = renderer.getPixelRatio();
      if (overlay.domElement.width !== Math.floor(width * ratio) ||
          overlay.domElement.height !== Math.floor(height * ratio)) {
        overlay.setPixelRatio(ratio);
        overlay.setSize(width, height, false);
      }
      overlay.toneMapping = renderer.toneMapping;
      overlay.toneMappingExposure = renderer.toneMappingExposure;
      overlay.outputColorSpace = renderer.outputColorSpace;
      overlay.domElement.hidden = false;
      camera.layers.set(foregroundLayer);
      lights.traverse(object => { if (object.isLight) move(object); });
      scene.onBeforeRender = () => {};
      scene.background = null;
      overlay.render(scene, camera);
    } finally {
      scene.background = background;
      scene.onBeforeRender = beforeRender;
      camera.layers.mask = cameraMask;
      for (const [object, mask] of layers) object.layers.mask = mask;
    }
  }
  return { render, hide, dispose() { overlay?.dispose(); overlay?.domElement.remove(); } };
}
