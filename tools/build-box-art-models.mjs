import fs from 'node:fs/promises';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import defaults from '../box-art-defaults.json' with { type: 'json' };
import { generatedPackage } from '../src/box-art-models.js';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(value => {
      this.result = value;
      this.onloadend?.();
    });
  }
};

for (const [id, spec] of Object.entries(defaults.templates)) {
  if (!spec.path) continue;
  const model = generatedPackage(id);
  model.userData = { author: spec.author, license: spec.license, description: spec.name };
  const bytes = await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: true });
  await fs.writeFile(new URL('../public/' + spec.path, import.meta.url), Buffer.from(bytes));
}
