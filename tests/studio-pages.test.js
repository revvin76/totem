import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene, Mesh, BoxGeometry, MeshBasicMaterial, MeshStandardMaterial, Matrix4 } from 'three';
import { platformChooserSettings, normalizeDepthOfField, applyPlatformChooserElements, bottomNavOrder, changeStudioPage, PLATFORM_NAV_ACTIONS, platformGamepadAction, platformBottomNavLabel } from '../src/studio-page-settings.js';
import { resolvedSettings, loadStudioDocument, saveStudioDocument } from '../src/studio-config.js';
import { createDepthOfField } from '../src/depth-of-field.js';
import { resolveChooserLayout, resolveChooserPole, saveChooserPole, updateChooserPage } from '../light-study/chooser-layout.js';
import { chooserActions } from '../light-study/chooser-controls.js';
import { applyConsoleSkin, cycleConsoleSkin } from '../src/console-skins.js';

test('the assigned Cycle skin action and GBA colour survive a platform reload', () => {
  const button = { id: 'skins', icon: 'y', action: 'cycle-skin', label: 'Cycle skin', align: 'end' };
  const { bottomNav } = platformChooserSettings({ pages: { platformChooser: { bottomNavVersion: 1, bottomNav: [button] } } });
  assert.equal(platformGamepadAction('y', bottomNav), 'cycle-skin');
  let stored;
  const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  const initial = { userData: { skinMaterial: new MeshStandardMaterial() } };
  assert.equal(applyConsoleSkin(initial, 'gba', storage), 'Indigo');
  for (const name of ['Arctic', 'Platinum', 'Fuchsia'])
    assert.equal(cycleConsoleSkin(initial, 'gba', storage), name);
  const replacement = { userData: { skinMaterial: new MeshStandardMaterial() } };
  assert.equal(applyConsoleSkin(replacement, 'gba', storage), 'Fuchsia');
  assert.equal(replacement.userData.skinMaterial.color.getHex(), initial.userData.skinMaterial.color.getHex());
  assert.ok(replacement.userData.skinMaterial.transparent);
  for (const name of ['Orange', 'Glacier', 'Black', 'Gold', 'Milky Pink', 'Indigo'])
    assert.equal(cycleConsoleSkin(replacement, 'gba', storage), name);
  assert.equal(replacement.userData.skinMaterial.transparent, false);
});

test('Game Chooser pole settings survive page saves and resolve from platform, type and all-platform defaults', () => {
  const document = { defaults: {}, overrides: {} };
  const fallback = { uiDesign: {}, bottomNav: [] };
  assert.deepEqual(resolveChooserPole(document, 'console', 'snes'), {});
  updateChooserPage(document, fallback, fallback, fallback, null);
  const page = document.pages.gameChooser;
  const all = { poleEnabled: true, polePosition: [0, 0, -11] };
  const console = { poleEnabled: true, polePosition: [4, 0, -11] };
  const hidden = { poleEnabled: false };
  saveChooserPole(page, 'handheld', 'gba', true, all);
  saveChooserPole(page, 'console', null, false, console);
  saveChooserPole(page, 'console', 'snes', false, hidden);
  updateChooserPage(document, fallback, fallback, fallback, 'snes');
  const reopened = JSON.parse(JSON.stringify(document));
  assert.deepEqual(resolveChooserPole(reopened, 'console', 'snes'), hidden);
  assert.deepEqual(resolveChooserPole(reopened, 'console', 'nes'), console);
  assert.deepEqual(resolveChooserPole(reopened, 'handheld', 'gba'), all);
  assert.deepEqual(resolveChooserPole(reopened, 'console', 'snes', true), all);
});

test('every Game Chooser action survives a Platform Chooser nav reload on any glyph', () => {
  for (const [action, label] of Object.entries(chooserActions)) {
    const button = { id: 'custom', icon: 'y-active', label: '', action, align: 'end' };
    const page = { bottomNavVersion: 2, bottomNav: [button] };
    const { bottomNav } = platformChooserSettings({ pages: { platformChooser: page } });
    assert.equal(PLATFORM_NAV_ACTIONS[action], label);
    assert.deepEqual(bottomNav, [button]);
    assert.equal(platformGamepadAction('y', bottomNav), action);
  }
});

test('Platform Chooser mute labels survive reload and follow the audio state', () => {
  for (const action of ['toggle-mute', 'mute', 'unmute']) {
    const button = { id: 'x', icon: 'x', action, align: 'end', label: 'Audio',
      toggleLabel: true, labelOn: '', labelOff: 'Enable sound' };
    const page = { bottomNavVersion: 1, bottomNav: [button] };
    const { bottomNav: [restored] } = platformChooserSettings({ pages: { platformChooser: page } });
    assert.deepEqual(restored, { ...button, action: 'toggle-mute' });
    assert.equal(platformBottomNavLabel(restored, true), '');
    assert.equal(platformBottomNavLabel(restored, false), 'Enable sound');
    assert.equal(platformBottomNavLabel({ ...restored, toggleLabel: false }, false), 'Audio');
    assert.equal(platformBottomNavLabel({ ...restored, labelOn: undefined }, true), 'Mute');
    assert.equal(platformBottomNavLabel({ ...restored, labelOff: undefined }, false), 'Unmute');
  }
});

test('Game Chooser seeds page navigation and layout from Handheld, then shares nav edits across profiles', () => {
  const fallback = { uiDesign: {}, bottomNav: [{ icon: 'a' }] };
  const handheld = {
    uiDesign: {
      elements: { 'game-title': { x: 40 }, 'game-rail': { width: 280 } },
      removed: ['menu-button'],
      thumbnails: { enabled: true, type: 'logo' },
    },
    bottomNav: [{ icon: 'rb', action: 'next-platform', align: 'start' }],
  };
  const document = {
    defaults: { handheld, console: { uiDesign: { elements: { 'game-title': { x: 500 } } }, bottomNav: [] } },
    overrides: { handheld: { switch: {
      _snapshot: true, _enabled: true, settings: { cameraX: 10 },
      uiDesign: { elements: { 'game-title': { x: 90 }, 'game-rail': { width: 99 } } },
      bottomNav: [{ icon: 'y' }],
    } } },
    pages: { platformChooser: { bottomNav: [{ icon: 'lb' }] } },
  };
  const profiles = structuredClone({ defaults: document.defaults, overrides: document.overrides });
  const previous = resolveChooserLayout(document, 'handheld', 'switch', fallback);
  assert.equal(previous.uiDesign.elements['game-title'].x, 90);
  assert.equal(previous.uiDesign.elements['game-rail'].width, 280);
  assert.deepEqual(previous.uiDesign.removed, ['menu-button']);
  assert.deepEqual(previous.bottomNav.slice(0, 1), handheld.bottomNav);
  assert.deepEqual(previous.bottomNav.slice(1).map(item => item.action), ['previous-letter', 'next-letter']);
  assert.equal(resolveChooserLayout(document, 'console', null, fallback).uiDesign.elements['game-title'].x, 40);

  const edited = structuredClone(previous);
  delete edited.uiDesign.elements['game-rail'];
  edited.uiDesign.removed = [];
  edited.bottomNav = [];
  assert.equal(updateChooserPage(document, fallback, edited, previous, 'switch').layoutChanged, false);
  const reopened = JSON.parse(JSON.stringify(document));
  for (const [type, id] of [['handheld', 'switch'], ['console', 'nes'], ['arcade', null]]) {
    const result = resolveChooserLayout(reopened, type, id, fallback);
    assert.equal(result.uiDesign.elements['game-rail'], undefined);
    assert.deepEqual(result.uiDesign.removed, []);
    assert.deepEqual(result.uiDesign.thumbnails, handheld.uiDesign.thumbnails);
    assert.deepEqual(result.bottomNav, []);
  }
  assert.equal(resolveChooserLayout(reopened, 'handheld', 'switch', fallback).uiDesign.elements['game-title'].x, 90);
  assert.deepEqual(reopened.defaults, profiles.defaults);
  assert.deepEqual(reopened.overrides, profiles.overrides);
  assert.deepEqual(reopened.pages.platformChooser.bottomNav, [{ icon: 'lb' }]);
});

test('home depth of field and layout stay isolated from game type/platform profiles',()=>{
  const original={version:1,revision:'old',environment:{hue:180},defaults:{handheld:{settings:{depthOfFieldEnabled:true,depthOfFieldBlur:0.002}}},overrides:{handheld:{gameboy:{settings:{depthOfFieldEnabled:false},_snapshot:true}}},pages:{platformChooser:{depthOfField:{enabled:false,blur:0.009},elements:{details:{x:80,scale:1.2}}}}};
  const before=structuredClone(original);
  assert.deepEqual(platformChooserSettings(original,{enabled:true,blur:0.006}).depthOfField,{enabled:false,blur:0.009});
  assert.equal(platformChooserSettings(original).elements.details.x,80);
  assert.equal(resolvedSettings(original,'handheld',null,{}).settings.depthOfFieldBlur,0.002);
  assert.equal(resolvedSettings(original,'handheld','gameboy',{}).settings.depthOfFieldEnabled,false);
  assert.deepEqual(original,before);
  assert.deepEqual(platformChooserSettings({}, {enabled:true,blur:0.004}).depthOfField,{enabled:true,blur:0.004});
  assert.deepEqual(normalizeDepthOfField({enabled:false,blur:100}),{enabled:false,blur:0.012});
  assert.deepEqual(normalizeDepthOfField({blur:NaN}),{enabled:false,blur:0.006});
  assert.deepEqual(normalizeDepthOfField(null),{enabled:false,blur:0.006});
});
test('home element layout applies its offsets without replacing existing transforms',()=>{
  const target={style:{transform:'rotate(5deg)'}};
  const doc={pages:{platformChooser:{elements:{details:{x:12,y:-8,scale:1.4,visible:false,width:320,height:500}}}}};
  applyPlatformChooserElements(doc,{querySelector:selector=>selector==='.hero'?target:null});
  assert.deepEqual(target.style,{transform:'rotate(5deg)',translate:'12px -8px',scale:'1.4',visibility:'hidden',width:'320px',height:'500px'});
  applyPlatformChooserElements({}, {querySelector:selector=>selector==='.hero'?target:null});
  assert.equal(target.style.visibility,'');assert.equal(target.style.scale,'1');
});
test('home and game saves share revisions and preserve the other page and legacy profiles',async()=>{
  const values=new Map();globalThis.window={};globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  try {
    const first=await loadStudioDocument(false);first.defaults.handheld={settings:{cameraX:9},bottomNav:[{icon:'a'}]};
    const legacy=await saveStudioDocument(first,null);
    const home=structuredClone(legacy);home.pages={platformChooser:{depthOfField:{enabled:false,blur:0.003},
      bottomNav:[{id:'select',align:'start',label:'Choose'}]}};
    const saved=await saveStudioDocument(home,legacy.revision);
    assert.deepEqual(saved.defaults,legacy.defaults);
    await assert.rejects(saveStudioDocument(legacy,legacy.revision),/another editor/);
    const game=structuredClone(saved);game.defaults.handheld.settings.depthOfFieldEnabled=true;
    const next=await saveStudioDocument(game,saved.revision);
    assert.deepEqual(next.pages,saved.pages);assert.deepEqual(await loadStudioDocument(false),next);

    const edited = structuredClone(next);
    const page = platformChooserSettings(edited);
    assert.equal(page.pole.enabled, true);
    assert.equal(page.pole.mascotScale, 1);
    assert.equal(page.pole.mascotYaw, 0);
    assert.equal(page.pole.alignWithDetails, true);
    const pole = { enabled: true, alignWithDetails: false, position: [5, -3, -2], rotation: [0, Math.PI / 4, 0], scale: [2, 3, 2],
      mascotScale: .75, mascotYaw: 90 };
    page.pole = pole;
    const added = { id: 'new', icon: 'y', label: 'Browse', action: 'next', align: 'start', region: 'hardware-start' };
    page.bottomNav = [added, page.bottomNav.find(item => item.id === 'select')];
    page.text['games-label'] = { text: 'Library', fontWeight: '700', color: '#ffeeff' };
    page.icons.games = 'star';
    edited.pages.platformChooser = page;
    const custom = await saveStudioDocument(edited, next.revision);
    const reopened = await loadStudioDocument(false);
    assert.deepEqual(platformChooserSettings(reopened).pole, pole);
    assert.deepEqual(platformChooserSettings(reopened).bottomNav, page.bottomNav);
    assert.deepEqual(platformChooserSettings(reopened).text, page.text);
    assert.deepEqual(platformChooserSettings(reopened).icons, page.icons);
    assert.deepEqual(reopened.defaults, next.defaults);
    reopened.pages.platformChooser.bottomNav = [];
    await saveStudioDocument(reopened, custom.revision);
    assert.deepEqual(platformChooserSettings(await loadStudioDocument(false)).bottomNav, []);
  } finally {delete globalThis.window;delete globalThis.localStorage;}
});
test('footer defaults put bumpers first and explicit alignment survives a reload',()=>{
  const defaults=platformChooserSettings({}).bottomNav;
  assert.deepEqual(defaults.map(({icon,align})=>[icon,align]),[
    ['lb','start'],['rb','start'],['left','end'],['right','end'],['a','end'],['lt','end'],['rt','end'],
  ]);
  const page={bottomNav:[{id:'select',align:'start',label:''},{id:'next-filter',align:'end'}]};
  const nav=platformChooserSettings({pages:{platformChooser:page}}).bottomNav;
  assert.deepEqual(bottomNavOrder(nav).map(({item})=>[item.icon,item.label]),[
    ['lb',''],['a',''],['rb','Platform'],['left',''],['right','Rotate'],['lt','Previous letter'],['rt','Next letter'],
  ]);
  const existing=[{icon:'a'},{icon:'rb-active'},{icon:'lb',align:'end'},{icon:'b',align:'start'}];
  assert.deepEqual(bottomNavOrder(existing).map(({index})=>index),[1,3,0,2]);
});
test('the shared blur pass keeps the full visible model in focus in each camera',()=>{
  const scene=new Scene(),home=new PerspectiveCamera(36,1,0.01,160),game=new PerspectiveCamera(43,1,0.1,160);
  home.position.z=10;game.position.z=22;
  const model=new Mesh(new BoxGeometry(2,2,2),new MeshBasicMaterial());scene.add(model);
  const tray = new Mesh(model.geometry, model.material);
  tray.position.z = 4;
  model.add(tray);
  const effect=createDepthOfField(scene,home);
  try {
    assert.equal(effect.supported,true);
    effect.update({enabled:true,blur:0.004},home,model);
    assert.equal(effect.pass.enabled,true);
    assert.equal(effect.pass.uniforms.focusNear?.value,5);
    assert.equal(effect.pass.uniforms.focusFar?.value,11);
    effect.update({enabled:true,blur:0.009},game,model);
    assert.equal(effect.pass.camera,game);assert.equal(effect.pass.uniforms.nearClip.value,0.1);
    assert.equal(effect.pass.uniforms.focusNear?.value,17);
    assert.equal(effect.pass.uniforms.focusFar?.value,23);
    assert.equal(effect.pass.uniforms.maxblur.value,0.009);
    tray.visible = false;
    effect.update({enabled:true,blur:0.004},home,model);
    assert.equal(effect.pass.uniforms.focusNear?.value,9);
    assert.equal(effect.pass.uniforms.focusFar?.value,11);
    model.rotation.set(0.4, -0.7, 0.2);
    model.scale.set(0.8, 1.7, 2.1);
    home.lookAt(1, 2, 0);
    const transform = new Matrix4();
    effect.update({enabled:true,blur:0.004},home,model);
    const bounds = model.geometry.boundingBox.clone().applyMatrix4(
      transform.multiplyMatrices(home.matrixWorldInverse, model.matrixWorld),
    );
    assert.equal(effect.pass.uniforms.focusNear.value, -bounds.max.z);
    assert.equal(effect.pass.uniforms.focusFar.value, -bounds.min.z);
    effect.update({enabled:false,blur:0.009},home,model);assert.equal(effect.pass.enabled,false);
    effect.update({enabled:true,blur:0},game,model);assert.equal(effect.pass.enabled,false);
  } finally {effect.pass.dispose();model.geometry.dispose();model.material.dispose();}
});
test('page navigation awaits pending saves and remains in the editor after a save failure',async()=>{
  const calls=[];globalThis.location={assign:url=>calls.push(url)};
  try{
    assert.equal(await changeStudioPage('platformChooser',async()=>false),false);assert.deepEqual(calls,[]);
    assert.equal(await changeStudioPage('platformChooser',async()=>{calls.push('saved');return true;}),true);
    assert.deepEqual(calls,['saved','/index.html?studio=platformChooser']);
    await assert.rejects(changeStudioPage('unknown'),/Unknown Studio page/);
  }finally{delete globalThis.location;}
});
