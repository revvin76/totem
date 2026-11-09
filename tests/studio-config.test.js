import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSettings,settingsOverride,resolvedSettings,platformType,platformOverrideEnabled} from '../src/studio-config.js';
test('platform overrides inherit subsequent type default changes',()=>{
  const base={settings:{brightness:1,cameraX:0},uiDesign:{elements:{title:{fontSize:20,color:'#fff'}}},bottomNav:[]};
  const edited=structuredClone(base);edited.uiDesign.elements.title.fontSize=30;
  const override=settingsOverride(base,edited);
  const document={defaults:{handheld:mergeSettings(base,{settings:{brightness:2},uiDesign:{elements:{title:{color:'#f00'}}}})},overrides:{handheld:{switch:override}}};
  const result=resolvedSettings(document,'handheld','switch',base);
  assert.equal(result.settings.brightness,2);assert.equal(result.uiDesign.elements.title.fontSize,30);assert.equal(result.uiDesign.elements.title.color,'#f00');
});
test('type and platform overrides stay isolated',()=>{
  const document={defaults:{handheld:{settings:{brightness:1}},console:{settings:{brightness:2}}},overrides:{handheld:{switch:{settings:{brightness:3}}}}};
  assert.equal(resolvedSettings(document,'handheld','switch',{}).settings.brightness,3);
  assert.equal(resolvedSettings(document,'handheld','gameboy',{}).settings.brightness,1);
  assert.equal(resolvedSettings(document,'console','switch',{}).settings.brightness,2);
});
test('an independent platform snapshot survives changes to every type default',()=>{
  const original={settings:{switchPosition:[1,2,3],switchScale:[130,130,130]},uiDesign:{elements:{}},bottomNav:[]};
  const document={defaults:{handheld:{settings:{switchPosition:[9,9,9]},uiDesign:{elements:{title:{x:99}}},bottomNav:[{icon:'a'}]}},overrides:{handheld:{switch:{...structuredClone(original),_snapshot:true,_enabled:true}}}};
  assert.deepEqual(resolvedSettings(document,'handheld','switch',{}),original);
  document.overrides.handheld.switch._enabled=false;
  assert.deepEqual(resolvedSettings(document,'handheld','switch',{}),document.defaults.handheld);
  document.overrides.handheld.switch._enabled=true;
  assert.deepEqual(resolvedSettings(document,'handheld','switch',{}),original);
});
test('button rows replace as an ordered collection and may be empty',()=>{
  assert.deepEqual(mergeSettings({bottomNav:[{icon:'a'}]},{bottomNav:[]}),{bottomNav:[]});
  assert.deepEqual(settingsOverride({bottomNav:[{icon:'a'}]},{bottomNav:[]}),{bottomNav:[]});
});
test('resolving a document never mutates defaults',()=>{
  const original={settings:{x:1},bottomNav:[{icon:'a'}]};const copy=structuredClone(original);const result=mergeSettings(original,{settings:{x:2}});result.bottomNav[0].icon='b';assert.deepEqual(original,copy);
});
test('hybrid platforms appear in the handheld platform list',()=>{
  assert.equal(platformType({kind:'hybrid'}),'handheld');
});
test('platform overrides are direct replacements and can be disabled',()=>{
  const document={defaults:{handheld:{settings:{brightness:1,cameraX:8}}},overrides:{handheld:{switch:{settings:{brightness:2,cameraX:-3},_enabled:true}}}};
  assert.deepEqual(resolvedSettings(document,'handheld','switch',{}),{settings:{brightness:2,cameraX:-3}});
  assert.equal(platformOverrideEnabled(document,'handheld','switch'),true);
  document.overrides.handheld.switch._enabled=false;
  assert.deepEqual(resolvedSettings(document,'handheld','switch',{}),{settings:{brightness:1,cameraX:8}});
  assert.equal(platformOverrideEnabled(document,'handheld','switch'),false);
});
test('catalogue kinds route into supported chooser profile types',()=>{
  assert.equal(platformType({kind:'handheld'}),'handheld');assert.equal(platformType({kind:'hybrid'}),'handheld');assert.equal(platformType({kind:'arcade'}),'arcade');assert.equal(platformType({kind:'other'}),'device-only');
});
