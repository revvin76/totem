// Three's WebGL upload code checks typed-array constructors. Geometry made by
// the same-origin chooser iframe must use the host realm's arrays once adopted.
export function adoptViewBuffers(root, constructors = globalThis) {
  const adopt = (attribute) => {
    const buffer = attribute?.isInterleavedBufferAttribute ? attribute.data : attribute;
    const array = buffer?.array;
    if (!array || !ArrayBuffer.isView(array)) return;
    const Type = constructors[array.constructor.name];
    if (Type && !(array instanceof Type)) {
      buffer.array = new Type(array);
      buffer.needsUpdate = true;
    }
  };
  root.traverse((part) => {
    if (!part.geometry) return;
    adopt(part.geometry.index);
    for (const attribute of Object.values(part.geometry.attributes)) adopt(attribute);
    for (const attributes of Object.values(part.geometry.morphAttributes ?? {}))
      for (const attribute of attributes) adopt(attribute);
  });
}

export function createSharedSceneRuntime({ scene, renderer, environment, homeContent, homeCamera, homeCameraOverride, homeEditorPerch, selectedConsoleId }) {
  const views = new Map();
  let active = null;
  environment.setPlatformChooserActive(true);
  return {
    scene, renderer, environment,
    adoptContent: adoptViewBuffers,
    registerView(name, view) {
      if (views.has(name)) throw Error(`Scene view already registered: ${name}`);
      adoptViewBuffers(view.content);
      view.content.visible = false;
      scene.add(view.content);
      views.set(name, view);
    },
    activateView(name = null) {
      if (name !== null && !views.has(name)) throw Error(`Scene view is not ready: ${name}`);
      active = name;
      homeContent.visible = name === null;
      for (const [key, view] of views) view.content.visible = key === name;
      environment.setContentRoots([name === null ? homeContent : views.get(name).content]);
      environment.setPlatformChooserActive(name === null);
    },
    get activeView() { return active === null ? null : views.get(active); },
    get editorPerch() { return active === null ? homeEditorPerch?.() : null; },
    get selectedConsoleId() { return selectedConsoleId?.(); },
    get camera() { return active === null ? homeCameraOverride?.() ?? homeCamera : views.get(active).camera; },
    async prepareView(name) {
      const view = views.get(name);
      if (!view) throw Error(`Scene view is not ready: ${name}`);
      adoptViewBuffers(view.content);
      view.content.traverse((part) => {
        for (const material of part.isMesh ? (Array.isArray(part.material) ? part.material : [part.material]) : [])
          for (const value of Object.values(material))
            if (value?.isTexture && !value.isVideoTexture && value.image?.width) renderer.initTexture(value);
      });
      environment.setPlatformChooserActive(false);
      let compilation;
      try { compilation = renderer.compileAsync(view.content, view.camera, scene); }
      finally { environment.setPlatformChooserActive(active === null); }
      await compilation;
    },
    update(now, dt) {
      environment.update(now / 1000);
      if (active === null) return false;
      views.get(active).update(now, dt);
      return true;
    },
    resize(width, height) {
      for (const view of views.values()) {
        view.camera.aspect = width / height;
        view.camera.updateProjectionMatrix();
      }
    },
  };
}
