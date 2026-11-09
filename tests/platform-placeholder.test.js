import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import platforms from '../platforms.json' with {type:'json'};
import { createPlatformPlaceholder, loadPlatformModel } from '../src/platform-assets.js';

// Only text-label rasterization needs a browser; geometry is real Three.js.
globalThis.document = {createElement:()=>({width:0,height:0,getContext:()=>({fillText(){}})})};

test('every catalog platform has finite, visible placeholder geometry',()=>{
  for(const platform of platforms) {
    const model=createPlatformPlaceholder(platform);
    const size=new Box3().setFromObject(model).getSize(new Vector3());
    assert.ok(size.toArray().every(n=>Number.isFinite(n)&&n>0),platform.id);
    assert.equal(model.userData.platformId,platform.id);
  }
});

test('missing Game Boy and GBA files return placeholders rather than empty scenes',async()=>{
  const store={readBundledModel:async()=>{throw new Error('Model file missing');}};
  const warn=console.warn;console.warn=()=>{};
  try {
    for(const id of ['gameboy','gba']) {
      const model=await loadPlatformModel(platforms.find(p=>p.id===id),store);
      assert.equal(model.userData.placeholder,true);
      assert.match(model.userData.modelLoadError,/Model file missing/);
      assert.ok(!new Box3().setFromObject(model).isEmpty());
    }
  } finally {console.warn=warn;}
});
