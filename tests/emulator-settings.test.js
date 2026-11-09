import test from "node:test";
import assert from "node:assert/strict";
import { initialEmulators, normalizeExtensions, validateEmulator, emulatorSettingsStore, platformExtensionStore } from "../src/emulator-settings.js";
test("the known catalogue starts disabled with valid settings", () => {
  const doc=initialEmulators(); assert.equal(new Set(doc.emulators.map(e=>e.id)).size,doc.emulators.length);
  for(const e of doc.emulators){assert.equal(e.enabled,false);assert.equal(e.autoUpdate,false);validateEmulator(e);}
  const a=initialEmulators();a.emulators[0].switches[0].enabled=true;assert.equal(initialEmulators().emulators[0].switches[0].enabled,false);
});
test("extensions normalise separators and reject wildcard or path expressions",()=>{
  assert.deepEqual(normalizeExtensions('.ZIP, zip; .chd iso'),['zip','chd','iso']);
  for(const text of ['', '*', '../exe', 'bad/ext'])assert.throws(()=>normalizeExtensions(text));
});
test("configured emulators require executable details and validated update choices",()=>{
  const e=initialEmulators().emulators[0];e.enabled=true;assert.throws(()=>validateEmulator(e));
  e.workingFolder='D:\\Emulators\\RetroArch';e.executable='retroarch.exe';assert.equal(validateEmulator(e).enabled,true);
  e.website='javascript:alert(1)';assert.throws(()=>validateEmulator(e));
  const custom={...initialEmulators().emulators[1],id:'user-custom',autoUpdate:true};assert.throws(()=>validateEmulator(custom));
});
test("browser settings save/readback and conflict protection use independent fixture data",async()=>{
  const values=new Map();globalThis.window={};globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  try{
    const store=emulatorSettingsStore();const first=await store.load();const stale=structuredClone(first);
    first.emulators[0].name='Fixture';const saved=await store.save(first);assert.equal((await store.load()).emulators[0].name,'Fixture');
    await assert.rejects(store.save(stale),/another window/);
    saved.emulators=saved.emulators.slice(1);await store.save(saved);assert.equal((await store.load()).emulators.some(e=>e.name==='Fixture'),false);
    const extensions=platformExtensionStore();const original=await extensions.load();await extensions.save(original,'gb',['gb']);assert.deepEqual((await extensions.load()).platforms.gb,['gb']);
  }finally{delete globalThis.window;delete globalThis.localStorage;}
});
