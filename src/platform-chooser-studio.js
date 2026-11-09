import { saveStudioDocument } from './studio-config.js';
import { createLayoutControl } from './controls.js';
import { HOME_ELEMENTS, PLATFORM_NAV_ACTIONS, normalizeCameraSettings, platformChooserSettings, applyPlatformChooserElements, scalePlatformPole, studioPageSelector } from './studio-page-settings.js';
import { createStudioMuteButton } from './studio-audio.js';
import { bindBottomNavDrag, createBottomNavEditor } from './bottom-nav-editor.js';
import { mountGameplayBackdropPanel } from './gameplay-backdrop-panel.js';
import { bindStudioPanelResize } from './studio-panel-resize.js';
import { audioToggleLabels } from '../light-study/chooser-controls.js';
import { PLATFORM_METRIC_ICONS, platformMetricIcon } from './platform-details.js';
import { DEFAULT_PLATFORM_LIGHT, PLATFORM_LIGHTS, resolveStudioEnvironment, normalizeEnvironmentSettings } from './studio-environment-settings.js';
import '../light-study/studio.css';
import './platform-chooser-studio.css';

const make = (tag, text) => { const node=document.createElement(tag); if(text)node.textContent=text;return node; };

function draggablePanel(panel) {
  const heading = panel.querySelector('.panel-heading');
  const key = `totem.studio.platform-chooser.${panel.id}.position`;
  let position, drag;
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) position = saved;
  } catch { /* An unreadable position falls back to the default. */ }
  const place = () => {
    if (!position || panel.hidden) return;
    const top = document.querySelector('.studio-toolbar').getBoundingClientRect().bottom;
    const x = Math.max(0, Math.min(position.x, innerWidth - panel.offsetWidth));
    const y = Math.max(top, Math.min(position.y, innerHeight - panel.offsetHeight));
    Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, right: 'auto' });
  };
  const save = () => {
    try { localStorage.setItem(key, JSON.stringify(position)); }
    catch { /* The current window can still use the new position. */ }
  };
  heading.tabIndex = 0;
  heading.title = 'Drag to move this panel';
  heading.setAttribute('aria-label', `Move ${heading.querySelector('h2').textContent} panel with arrow keys`);
  heading.onpointerdown = event => {
    if (event.button !== 0 || drag || event.target.closest('button')) return;
    const bounds = panel.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    heading.focus({ preventScroll: true });
    heading.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  heading.onpointermove = event => {
    if (event.pointerId !== drag?.id) return;
    position = { x: event.clientX - drag.x, y: event.clientY - drag.y };
    place();
  };
  heading.onlostpointercapture = event => {
    if (event.pointerId !== drag?.id) return;
    drag = null;
    if (position) save();
  };
  heading.onkeydown = event => {
    if (event.target !== heading || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const { left, top } = panel.getBoundingClientRect();
    const step = event.shiftKey ? 32 : 8;
    position = { x: left + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
      y: top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) };
    event.preventDefault();
    event.stopPropagation();
    place();
    save();
  };
  addEventListener('resize', place);
  new ResizeObserver(place).observe(panel);
  bindStudioPanelResize(panel, {
    top: () => document.querySelector('.studio-toolbar').getBoundingClientRect().bottom,
    onResize: ({ left, top }) => { position = { x: left, y: top }; },
  });
  return place;
}

export function mountPlatformChooserStudio({
  initialDocument, initialSceneLayout, restoreSceneLayout, depthOfField, onDocument,
  sceneTools, poleObject, native = false, onAutosaveChange = () => {}, saveExtra = () => {},
}) {
  document.body.classList.add('studio-platform-chooser');document.title='Totem Studio · Platform Chooser';
  let documentState={version:1,revision:null,defaults:{},overrides:{},...structuredClone(initialDocument)};
  const cameraFallback=sceneTools.cameraSettings();
  let page=platformChooserSettings(documentState,depthOfField,cameraFallback), environment=resolveStudioEnvironment(documentState);
  page.sceneLayout = initialSceneLayout;
  sceneTools.applyCameraSettings(page.camera);
  let video = documentState.gameplayBackdrop;
  let timer,dirty=false,pending=0,conflict=false,queue=Promise.resolve(),autosave=true;
  const undoEdits = [], redoEdits = [], refreshFields = [];
  const editSnapshot = () => structuredClone({ page, environment, video });
  let lastEdit = editSnapshot(), activePointer = null, recordedPointer = null;
  addEventListener('pointerdown', event => { if (event.isPrimary) activePointer = event.pointerId; }, true);
  for (const type of ['pointerup', 'pointercancel']) addEventListener(type, event => {
    if (activePointer === event.pointerId) activePointer = recordedPointer = null;
  }, true);
  const header=make('header');header.className='studio-toolbar';
  header.append(make('strong','Totem Studio'),studioPageSelector('platformChooser',async()=>{
    if(autosave)await flush();
    if(!autosave&&dirty)status.textContent='Save or discard your changes before leaving Studio.';
    return !conflict&&!dirty&&!pending;
  }),make('span','Home screen'));
  const status=make('span',native?'Shared settings':'Browser preview · local settings');status.id='studio-status';status.setAttribute('role','status');
  const autosaveLabel=make('label','Autosave');autosaveLabel.className='studio-autosave-toggle';
  const autosaveInput=make('input');autosaveInput.type='checkbox';autosaveInput.checked=true;autosaveInput.setAttribute('aria-label','Autosave');autosaveLabel.append(autosaveInput);
  const saveAll=make('button','Save all');saveAll.type='button';saveAll.disabled=true;saveAll.setAttribute('aria-label','Save all Studio changes');
  const discard=make('button','Discard changes');discard.type='button';discard.disabled=true;
  const undoEdit=make('button','Undo'), redoEdit=make('button','Redo');
  undoEdit.type=redoEdit.type='button';
  undoEdit.disabled=redoEdit.disabled=true;
  const burger=make('button','☰');burger.type='button';burger.setAttribute('aria-label','Open editor menu');burger.setAttribute('aria-expanded','false');
  const menu=make('nav');menu.id='studio-menu';menu.hidden=true;
  const freeLook=make('button','Free Look'), editLights=make('button','Edit Lights');
  for(const button of [freeLook,editLights]){button.type='button';button.setAttribute('aria-pressed','false');}
  header.append(autosaveLabel,saveAll,discard,undoEdit,redoEdit,status,createStudioMuteButton(),freeLook,editLights,burger,menu);document.body.append(header);
  const videoPanel = mountGameplayBackdropPanel(header, video, value => { video = value; changed(); });
  function toggleFreeLook(enabled) {
    freeLook.setAttribute('aria-pressed',String(enabled));
    sceneTools.setFreeLook(enabled);
  }
  function updateSaveControls() {
    saveAll.disabled=autosave||pending>0||conflict;
    discard.disabled=autosave||!dirty||pending>0;
    undoEdit.disabled=!undoEdits.length;
    redoEdit.disabled=!redoEdits.length;
  }
  freeLook.onclick=()=>{
    const enabled=freeLook.getAttribute('aria-pressed')==='false';
    toggleFreeLook(enabled);
    if(!enabled&&cameraPanel)cameraPanel.hidden=true;
  };
  sceneTools.onExitLook=()=>{if(cameraPanel)cameraPanel.hidden=true;toggleFreeLook(false);burger.focus();};
  function snapshot() {
    const next=structuredClone(documentState);next.pages ||= {};
    next.pages.platformChooser={...next.pages.platformChooser,...structuredClone(page)};
    if (video) next.gameplayBackdrop = video;
    else delete next.gameplayBackdrop;
    next.environment=normalizeEnvironmentSettings(environment);return next;
  }
  function preview() {
    onDocument(snapshot());
    syncLogoHandles();
  }
  function changed(remember = true) {
    if (remember) {
      const next = editSnapshot();
      if (JSON.stringify(next) === JSON.stringify(lastEdit)) return;
      if (activePointer === null || recordedPointer !== activePointer) {
        undoEdits.push(lastEdit);
        if (undoEdits.length > 50) undoEdits.shift();
        recordedPointer = activePointer;
      }
      redoEdits.length = 0;
      lastEdit = next;
    }
    dirty=true;status.textContent=autosave?'Saving…':'Unsaved changes';status.classList.remove('error');preview();clearTimeout(timer);
    if(autosave)timer=setTimeout(()=>flush(),350);
    updateSaveControls();
  }
  function restoreEdit(from, to) {
    if (!from.length) return;
    to.push(lastEdit);
    lastEdit = from.pop();
    const previousNav = JSON.stringify(page.bottomNav);
    const previousLayout = page.sceneLayout;
    ({ page, environment, video } = structuredClone(lastEdit));
    if (JSON.stringify(page.sceneLayout) !== JSON.stringify(previousLayout)) restoreSceneLayout(page.sceneLayout);
    cameraValue = normalizeCameraSettings(page.camera, cameraFallback);
    if (JSON.stringify(page.bottomNav) !== previousNav) {
      navSnapshot = structuredClone(page.bottomNav);
      undo.length = redo.length = 0;
      bottomEditor.render();
    }
    changed(false);
    syncCameraInputs();
    refreshFields.forEach(refresh => refresh());
    blur.disabled = !enabled.checked;
    selectLight(selectedLight);
    renderElement();
    videoPanel.setValue(video);
  }
  undoEdit.onclick=()=>restoreEdit(undoEdits,redoEdits);
  redoEdit.onclick=()=>restoreEdit(redoEdits,undoEdits);
  addEventListener('totem:studio-draft-dirty',()=>{
    if(autosave)return;
    dirty=true;status.textContent='Unsaved changes';updateSaveControls();
  });
  function flush(manual=false) {
    clearTimeout(timer);
    if (!dirty || conflict || (!autosave&&!manual)) return queue;
    const edited=structuredClone(page),lights=structuredClone(environment),footage=video;dirty=false;pending++;
    updateSaveControls();status.textContent='Saving…';
    queue=queue.then(async()=>{
      if(conflict)throw new Error('Reload Studio before saving.');
      const next=structuredClone(documentState);next.pages ||= {};
      next.pages.platformChooser={...next.pages.platformChooser,...edited};next.environment=lights;
      if (footage) next.gameplayBackdrop = footage;
      else delete next.gameplayBackdrop;
      let rollbackExtra=null;
      if(manual){
        try{rollbackExtra=await saveExtra();}
        catch(error){dirty=true;status.textContent=`Layout draft was not saved: ${error.message||error}`;status.classList.add('error');return;}
      }
      try{documentState=await saveStudioDocument(next,documentState.revision);}
      catch(error){rollbackExtra?.();throw error;}
      if(!dirty)status.textContent='Saved';else status.textContent=autosave?'Saving…':'Unsaved changes';
      if(!dirty)preview();
    }).catch(error=>{conflict=true;dirty=true;status.textContent=`Not saved: ${error.message||error}`;status.classList.add('error');}).finally(()=>{pending--;updateSaveControls();});
    return queue;
  }
  autosaveInput.onchange=()=>{
    autosave=autosaveInput.checked;
    try{onAutosaveChange(autosave);}catch(error){autosave=false;autosaveInput.checked=false;status.textContent=`Autosave could not save the layout draft: ${error.message||error}`;status.classList.add('error');updateSaveControls();return;}
    clearTimeout(timer);
    if(autosave&&dirty){status.textContent='Saving…';timer=setTimeout(()=>flush(),120);}
    else if(dirty)status.textContent='Unsaved changes';
    else if(!pending)status.textContent=autosave?'Autosave on':'Autosave off';
    updateSaveControls();
  };
  saveAll.onclick=()=>{void flush(true);};
  discard.onclick=()=>{
    if(autosave||!dirty||pending||!window.confirm('Discard all unsaved Studio changes?'))return;
    clearTimeout(timer);dirty=false;status.textContent='Changes discarded';window.location.reload();
  };
  function panel(title,id) {
    const aside=make('aside');aside.id=id;aside.className='studio-home-panel studio-control-panel';aside.hidden=true;aside.setAttribute('aria-label',title);
    const heading=make('div');heading.className='panel-heading';const close=make('button','×');close.type='button';close.setAttribute('aria-label',`Close ${title}`);close.onclick=()=>{aside.hidden=true;burger.focus();};heading.append(make('h2',title),close);aside.append(heading);document.body.append(aside);return aside;
  }
  function inspectorGroup(title, name, open = false) {
    const group = make('details');
    group.className = 'studio-inspector-group';
    group.setAttribute('name', name);
    group.open = open;
    group.append(make('summary', title));
    return group;
  }
  function makeLayoutGroups(buttons, name) {
    for (const [index, button] of [...buttons.querySelectorAll('button[aria-controls]')].entries()) {
      const fields = document.getElementById(button.getAttribute('aria-controls'));
      const group = inspectorGroup(button.textContent.trim(), name, index === 0);
      fields.before(group);
      fields.hidden = false;
      group.append(fields);
    }
    buttons.remove();
  }
  function field(parent,text,value,{type='range',min=0,max=1,step=0.01,format=value=>String(value),read}={},update) {
    const label=make('label'),caption=make('span',text),input=make('input'),output=make('output');input.type=type;
    input.id=`studio-home-${text.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`;label.htmlFor=input.id;input.setAttribute('aria-label',text);
    if(type==='checkbox')input.checked=value;else{Object.assign(input,{min,max,step,value});output.value=format(value);}
    if (read) refreshFields.push(() => {
      const next = read();
      if (type === 'checkbox') input.checked = next;
      else { input.value = next; output.value = format(next); }
    });
    input.oninput=()=>{const next=type==='checkbox'?input.checked:input.valueAsNumber;if(type!=='checkbox'&&!Number.isFinite(next))return;if(type!=='checkbox')output.value=format(next);update(next);changed();};
    label.append(caption);if(type!=='checkbox')label.append(output);label.append(input);parent.append(label);return input;
  }
  const scene=panel('Scene Controls','studio-home-scene');
  const cameraPanel=panel('Camera','studio-home-camera');
  cameraPanel.classList.add('studio-camera-panel');
  const cameraHelp=make('p','Camera mode: left stick pans, right stick orbits, and LT/RT zoom. Use the controls below for precise framing and field of view.');
  cameraPanel.append(cameraHelp);
  let cameraValue=normalizeCameraSettings(page.camera,cameraFallback);
  const cameraFields={};
  function updateCamera(next) {
    cameraValue=normalizeCameraSettings(next,cameraFallback);page.camera=cameraValue;
    sceneTools.setCameraSettings(cameraValue);syncCameraInputs();
  }
  function syncCameraInputs() {
    const values=[['Camera target X',cameraValue.target[0]],['Camera target Y',cameraValue.target[1]],['Camera target Z',cameraValue.target[2]],
      ['Camera yaw',cameraValue.yaw],['Camera pitch',cameraValue.pitch],['Camera distance',cameraValue.distance],['Field of view',cameraValue.fov]];
    for(const [name,value] of values){const input=cameraFields[name];if(!input)continue;input.value=String(value);input.parentElement.querySelector('output').value=String(Math.round(value*10)/10);}
  }
  for(const [name,key,min,max,step] of [
    ['Camera target X','targetX',-100,100,.1],['Camera target Y','targetY',-100,100,.1],['Camera target Z','targetZ',-100,100,.1],
    ['Camera yaw','yaw',-180,180,.1],['Camera pitch','pitch',-85,85,.1],['Camera distance','distance',1,115,.1],['Field of view','fov',20,80,1],
  ]){
    const index=key.startsWith('target')?{targetX:0,targetY:1,targetZ:2}[key]:null;
    cameraFields[name]=field(cameraPanel,name,index===null?cameraValue[key]:cameraValue.target[index],{min,max,step,format:value=>Number(value).toFixed(step<1?1:0)},value=>{
      const next=structuredClone(cameraValue);
      if(index===null)next[key]=value;else next.target[index]=value;
      updateCamera(next);
    });
  }
  syncCameraInputs();
  const cameraReset=make('button','Reset camera');cameraReset.type='button';
  cameraReset.onclick=()=>{updateCamera(normalizeCameraSettings(cameraFallback,cameraFallback));changed();};cameraPanel.append(cameraReset);
  sceneTools.onCameraChange=value=>{
    cameraValue=normalizeCameraSettings(value,cameraFallback);page.camera=cameraValue;syncCameraInputs();changed();
  };
  cameraPanel.querySelector('.panel-heading button').onclick=()=>{
    cameraPanel.hidden=true;toggleFreeLook(false);burger.focus();
  };
  const effects=inspectorGroup('Depth of field','home-scene-groups',true);scene.append(effects);
  const enabled=field(effects,'Enable depth of field',page.depthOfField.enabled,{type:'checkbox',read:()=>page.depthOfField.enabled},value=>{page.depthOfField.enabled=value;blur.disabled=!value;});
  const blur=field(effects,'Blur amount',page.depthOfField.blur,{min:0,max:0.012,step:0.001,read:()=>page.depthOfField.blur},value=>{page.depthOfField.blur=value;});blur.disabled=!enabled.checked;
  const lighting=inspectorGroup('Lighting & reflections','home-scene-groups');scene.append(lighting);
  lighting.append(make('p','Room lighting is shared by both pages. The foreground platform uses a separate white light.'));
  for(const [key,title,min,max,step] of [['hue','Hue',0,360,1],['brightness','Brightness',0.3,2.4,0.05],['lightReflection','Light reflection',0,1,0.01],['consoleReflection','Console reflection',0,1,0.01],['lightX','Light X',-12,12,0.1],['lightY','Light Y',-8,8,0.1],['lightZ','Light Z',-15,15,0.1]]) field(lighting,title,environment[key],{min,max,step,read:()=>environment[key]},value=>{environment[key]=value;});
  for(const [key,title] of [['lightsEnabled','Lights'],['reflectionsEnabled','Reflections']])field(lighting,title,environment[key],{type:'checkbox',read:()=>environment[key]},value=>{environment[key]=value;});
  const individual=inspectorGroup('Individual lights','home-scene-groups');
  scene.append(individual);
  individual.append(make('p','Select a light here or click its marker. Drag the arrows to move it. In Free Look, drag to orbit, right-drag to pan, and scroll to zoom.'));
  const lightLabel=make('label','Selected light'), lightSelect=make('select'), lightFields=make('div');
  for(const [id,label] of Object.entries(PLATFORM_LIGHTS))lightSelect.add(new Option(label,id));
  lightLabel.append(lightSelect);individual.append(lightLabel,lightFields);
  const positionFields={};
  let selectedLight='spot';
  const currentLight=()=>page.lights[selectedLight] ?? DEFAULT_PLATFORM_LIGHT;
  const editLight=patch=>{page.lights[selectedLight]={...currentLight(),...patch};};
  function selectLight(id) {
    selectedLight=lightSelect.value=id;
    sceneTools.selectLight(id);
    lightFields.replaceChildren();
    const value=currentLight();
    field(lightFields,'Light enabled',value.enabled,{type:'checkbox'},enabled=>editLight({enabled}));
    field(lightFields,'Light brightness multiplier',value.intensity,{min:0,max:3,step:.05},intensity=>editLight({intensity}));
    for(const axis of ['x','y','z']) {
      positionFields[axis]=field(lightFields,`Offset ${axis.toUpperCase()}`,value[axis],{type:'number',min:-100,max:100,step:.1},next=>editLight({[axis]:next}));
    }
    const colorLabel=make('label','Light colour'), color=make('input');
    color.type='color';color.value=value.color ?? sceneTools.color(id);
    color.oninput=()=>{editLight({color:color.value});changed();};
    colorLabel.append(color);lightFields.append(colorLabel);
    const reset=make('button','Reset light');reset.type='button';
    reset.onclick=()=>{delete page.lights[id];changed();selectLight(id);};lightFields.append(reset);
  }
  function openLights() {show('scene');individual.open=true;}
  lightSelect.onchange=()=>selectLight(lightSelect.value);
  sceneTools.onPick=id=>{openLights();selectLight(id);};
  sceneTools.onMove=(id,delta)=>{
    if(id!==selectedLight)return;
    const value=currentLight(), offsets={};
    for(const axis of ['x','y','z']) {
      const next=Math.max(-100,Math.min(100,value[axis]+delta[axis]));
      offsets[axis]=next;
      positionFields[axis].value=next.toFixed(2);
      positionFields[axis].parentElement.querySelector('output').value=next.toFixed(2);
    }
    editLight(offsets);changed();
  };
  editLights.onclick=()=>{
    const enabled=editLights.getAttribute('aria-pressed')==='false';
    editLights.setAttribute('aria-pressed',String(enabled));
    if(enabled){openLights();selectLight(selectedLight);}
    sceneTools.showLights(enabled);
  };
  selectLight(selectedLight);
  const layout=panel('2D Elements','studio-home-layout'),targetLabel=make('label','Selected element'),target=make('select');target.id='studio-home-target';
  const placement=inspectorGroup('Placement','home-layout-groups',true);
  layout.append(placement);
  targetLabel.htmlFor=target.id;target.setAttribute('aria-label','Selected element');
  for(const [id,[name]]of Object.entries(HOME_ELEMENTS))target.add(new Option(name,id));targetLabel.append(target);placement.append(targetLabel);
  const textElements = new Map([...document.querySelectorAll('[data-platform-text]')]
    .map(element => [element.dataset.platformText, element]));
  for (const [id, element] of textElements) target.add(new Option(element.dataset.textLabel, id));
  const fields=make('div');placement.append(fields);
  const logo = document.querySelector(HOME_ELEMENTS.brand[1]);
  const logoImage = logo.querySelector('img');
  const logoHandles = make('div');
  logoHandles.className = 'studio-logo-handles';
  logoHandles.hidden = true;
  document.body.append(logoHandles);
  let logoFields;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function syncLogoHandles() {
    logoHandles.hidden = layout.hidden || target.value !== 'brand' ||
      !page.elements.brand.visible || logoImage.hidden || !logoImage.naturalWidth;
    if (logoHandles.hidden) return;
    const bounds = logoImage.getBoundingClientRect();
    const fit = Math.min(bounds.width / logoImage.naturalWidth, bounds.height / logoImage.naturalHeight);
    Object.assign(logoHandles.style, {
      left: `${bounds.left}px`, top: `${bounds.top}px`,
      width: `${logoImage.naturalWidth * fit}px`, height: `${logoImage.naturalHeight * fit}px`,
    });
  }
  function editLogo(patch) {
    Object.assign(page.elements.brand, patch);
    changed();
    for (const [key, input] of Object.entries(logoFields ?? {})) {
      input.value = page.elements.brand[key];
      input.parentElement.querySelector('output').value = input.value;
    }
  }
  for (const [mode, glyph] of [['move', '✥'], ['scale', '↗']]) {
    const handle = make('button', glyph);
    handle.type = 'button';
    handle.dataset.mode = mode;
    const name = `${mode === 'move' ? 'Move' : 'Scale'} Totem logo`;
    handle.title = name;
    handle.setAttribute('aria-label', name);
    let drag;
    handle.onpointerdown = event => {
      if (!event.isPrimary || event.button !== 0) return;
      const bounds = logo.getBoundingClientRect();
      const grip = handle.getBoundingClientRect();
      drag = {
        id: event.pointerId, ...page.elements.brand,
        startX: event.clientX, startY: event.clientY,
        vx: grip.left + grip.width / 2 - (bounds.left + bounds.width / 2),
        vy: grip.top + grip.height / 2 - (bounds.top + bounds.height / 2),
      };
      handle.setPointerCapture(event.pointerId);
    };
    handle.onpointermove = event => {
      if (event.pointerId !== drag?.id) return;
      const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
      if (mode === 'move') editLogo({
        x: clamp(Math.round(drag.x + dx), -1400, 1400), y: clamp(Math.round(drag.y + dy), -900, 900),
      });
      else {
        const distance = drag.vx ** 2 + drag.vy ** 2;
        if (distance === 0) return;
        const scale = drag.scale * (1 + (dx * drag.vx + dy * drag.vy) / distance);
        editLogo({ scale: clamp(Math.round(scale * 100) / 100, .3, 3) });
      }
    };
    handle.onlostpointercapture = () => { drag = null; };
    handle.onkeydown = event => {
      const step = event.shiftKey ? 10 : 1;
      const offset = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (!offset) return;
      event.preventDefault();
      event.stopPropagation();
      const { x, y, scale } = page.elements.brand;
      if (mode === 'move') editLogo({ x: clamp(x + offset[0], -1400, 1400), y: clamp(y + offset[1], -900, 900) });
      else editLogo({ scale: clamp(Math.round((scale + (offset[0] - offset[1]) / 100) * 100) / 100, .3, 3) });
    };
    logoHandles.append(handle);
  }
  const logoObserver = new ResizeObserver(syncLogoHandles);
  logoObserver.observe(logo);
  logoObserver.observe(layout);
  logoImage.addEventListener('load', syncLogoHandles);
  addEventListener('resize', syncLogoHandles);
  addEventListener('pagehide', () => logoObserver.disconnect(), { once: true });
  const details = document.querySelector('.hero');
  const metadata = details.querySelector('.metadata');
  let iconSlot = 'games';
  function renderTextFields(id, element) {
    const style = page.text[id] ?? {};
    const computed = getComputedStyle(element);
    for (const [key, name] of [
      ['text', 'Text'], ['fontSize', 'Size'], ['color', 'Colour'], ['fontFamily', 'Font'],
      ['fontWeight', 'Weight'], ['textAlign', 'Alignment'], ['letterSpacing', 'Letter spacing'], ['lineHeight', 'Line height'],
    ]) {
      const label = make('label', name);
      label.className = 'studio-text-field';
      const input = key === 'textAlign' ? make('select') : make('input');
      if (key === 'textAlign') {
        for (const option of ['', 'left', 'center', 'right', 'justify']) input.add(new Option(option || 'Default', option));
      } else {
        input.type = 'text';
        input.maxLength = key === 'text' ? 512 : 128;
        if (key !== 'text') input.placeholder = computed[key];
      }
      input.value = style[key] ?? (key === 'text' ? element.textContent : '');
      input.onchange = () => {
        const raw = input.value.trim();
        const value = key === 'fontSize' && /^\d+(\.\d+)?$/.test(raw) ? `${raw}px` : raw;
        if (key !== 'text' && value && !CSS.supports(key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`), value)) {
          input.value = page.text[id]?.[key] ?? '';
          return;
        }
        page.text[id] ??= {};
        if (key === 'text' || value) page.text[id][key] = value;
        else delete page.text[id][key];
        changed();
      };
      label.append(input);
      fields.append(label);
    }
    const reset = make('button', 'Reset text and style');
    reset.type = 'button';
    reset.onclick = () => { delete page.text[id]; changed(); renderElement(); };
    fields.append(reset);
  }
  function setMetricIcon(slot, icon) {
    if (!Object.hasOwn(PLATFORM_METRIC_ICONS, icon)) return;
    page.icons[slot] = icon;
    changed();
  }
  function renderIconGallery() {
    const label = make('label', 'Metric icon');
    const slots = make('select');
    for (const row of metadata.querySelectorAll('[data-metric-icon]')) {
      slots.add(new Option(row.querySelector('[data-platform-text]').textContent, row.dataset.metricIcon));
    }
    slots.value = iconSlot;
    slots.onchange = () => { iconSlot = slots.value; };
    label.append(slots);
    const gallery = make('div');
    gallery.className = 'platform-metric-gallery';
    for (const [id, [name]] of Object.entries(PLATFORM_METRIC_ICONS)) {
      const button = make('button');
      button.type = 'button';
      button.title = name;
      button.setAttribute('aria-label', name);
      button.draggable = true;
      button.append(platformMetricIcon(document, id));
      button.onclick = () => setMetricIcon(iconSlot, id);
      button.ondragstart = event => event.dataTransfer.setData('application/totem-metric-icon', id);
      gallery.append(button);
    }
    fields.append(label, gallery);
  }
  function renderElement() {
    logoFields = null;
    syncLogoHandles();
    fields.replaceChildren();
    const textElement = document.querySelector(`[data-platform-text="${CSS.escape(target.value)}"]`);
    if (textElement) { renderTextFields(target.value, textElement); return; }
    const item=page.elements[target.value];
    const x = field(fields,'Position X',item.x,{min:-1400,max:1400,step:1},value=>{item.x=value;});
    const y = field(fields,'Position Y',item.y,{min:-900,max:900,step:1},value=>{item.y=value;});
    const scale = field(fields,'Scale',item.scale,{min:0.3,max:3,step:0.01},value=>{item.scale=value;});
    if (target.value === 'brand') logoFields = { x, y, scale };
    field(fields,'Visible',item.visible,{type:'checkbox'},value=>{item.visible=value;});
    const reset=make('button','Reset selected element');reset.type='button';reset.onclick=()=>{page.elements[target.value]={x:0,y:0,scale:1,visible:true};renderElement();changed();};fields.append(reset);
    if (target.value === 'details') renderIconGallery();
  }
  target.onchange=renderElement;renderElement();
  const metricDropType = 'application/totem-metric-icon';
  metadata.addEventListener('dragover', event => {
    if (event.target.closest('svg') && event.dataTransfer.types.includes(metricDropType)) event.preventDefault();
  });
  metadata.addEventListener('drop', event => {
    const slot = event.target.closest('svg')?.closest('[data-metric-icon]')?.dataset.metricIcon;
    if (!slot) return;
    const icon = event.dataTransfer.getData(metricDropType);
    if (!icon) return;
    event.preventDefault();
    setMetricIcon(slot, icon);
  });
  const grip = make('button', 'Move details');
  grip.type = 'button';
  grip.className = 'platform-details-grip';
  details.append(grip);
  let detailsDrag;
  grip.onpointerdown = event => {
    if (!event.isPrimary || event.button !== 0) return;
    const { x, y } = page.elements.details;
    detailsDrag = { id: event.pointerId, x, y, startX: event.clientX, startY: event.clientY };
    grip.setPointerCapture(event.pointerId);
  };
  grip.onpointermove = event => {
    if (event.pointerId !== detailsDrag?.id) return;
    const value = page.elements.details;
    value.x = Math.round(detailsDrag.x + event.clientX - detailsDrag.startX);
    value.y = Math.round(detailsDrag.y + event.clientY - detailsDrag.startY);
    changed();
  };
  grip.onlostpointercapture = () => { detailsDrag = null; };
  grip.onkeydown = event => {
    const offset = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[event.key];
    if (!offset) return;
    event.preventDefault();
    event.stopPropagation();
    page.elements.details.x += offset[0];
    page.elements.details.y += offset[1];
    changed();
  };
  bindStudioPanelResize(details, {
    container: details.parentElement,
    apply({ left, top, width, height }) {
      const value = page.elements.details;
      Object.assign(value, {
        x: Math.round(left - details.offsetLeft), y: Math.round(top - details.offsetTop),
        width: Math.max(220, Math.round(width / value.scale)), height: Math.max(120, Math.round(height / value.scale)),
      });
      changed();
    },
  });
  const bottom = panel('Bottom Nav', 'studio-home-bottom');
  const bar = document.querySelector('#platform-footer .chooser-bottom-nav');
  const items = () => page.bottomNav;
  let navSnapshot = structuredClone(items());
  const undo = [], redo = [];
  function redrawNav(redrawEditor = true) {
    navSnapshot = structuredClone(items());
    changed();
    if (redrawEditor) bottomEditor.render();
    else bottomEditor.updateHistory();
  }
  function editNav(redrawEditor = true) {
    undo.push(navSnapshot);
    if (undo.length > 50) undo.shift();
    redo.length = 0;
    redrawNav(redrawEditor);
  }
  function restoreNav(from, to) {
    if (!from.length) return;
    to.push(navSnapshot);
    page.bottomNav = from.pop();
    redrawNav();
  }
  function addButton(action, region) {
    if (!Object.hasOwn(PLATFORM_NAV_ACTIONS, action)) return;
    const id = crypto.randomUUID();
    const placement = region ? { region, align: region === "hardware-start" ? "start" : "end" } : {};
    items().push({ id, icon: '', label: PLATFORM_NAV_ACTIONS[action], action, ...placement });
    editNav();
    return id;
  }
  const bottomEditor = createBottomNavEditor({
    items, actions: PLATFORM_NAV_ACTIONS, toggleLabels: audioToggleLabels, add: addButton, change: editNav,
    undo: () => restoreNav(undo, redo), redo: () => restoreNav(redo, undo),
    canUndo: () => undo.length, canRedo: () => redo.length,
  });
  bottom.append(bottomEditor.editor);
  bottomEditor.render();
  const dropBars = [[undefined, bar], ...['hardware-start', 'hardware-end'].map(region =>
    [region, document.getElementById(region).querySelector('.chooser-bottom-nav')])];
  for (const [region, dropZone] of dropBars) {
    bindBottomNavDrag(dropZone, { items, editor: bottomEditor, change: editNav, region, dropBars, openPanel: () => show('bottom', false) });
  }
  const legacy=document.getElementById('settings');
  legacy.querySelector('h2').textContent='3D Elements';
  legacy.setAttribute('aria-label', '3D Elements');
  makeLayoutGroups(legacy.querySelector('[aria-label="Control group"]'), 'home-object-groups');
  const deviceGroups = legacy.querySelector('.device-pose-groups');
  makeLayoutGroups(deviceGroups, 'home-device-pose-groups');
  const deviceGroup = legacy.querySelector('#device-controls').closest('details');
  const poleGroup = inspectorGroup('Totem pole', 'home-object-groups');
  const mascotGroup = inspectorGroup('Mini Totem', 'home-object-groups');
  const selectedObjectGroups = { pole: poleGroup, mascot: mascotGroup, device: deviceGroup };
  function previewPole() {
    return !legacy.hidden && (poleGroup.open || mascotGroup.open) && page.pole.enabled ? poleObject() : null;
  }
  function syncPoleSelection() {
    sceneTools.setPoleAligned(page.pole.alignWithDetails);
    sceneTools.selectPole(poleGroup.open ? previewPole() ?? null : null);
  }
  poleGroup.addEventListener('toggle', syncPoleSelection);
  legacy.querySelector('#settings-close').addEventListener('click', () => {
    sceneTools.selectPole(null);
    burger.focus();
  });
  const showPole = make('input');
  showPole.type = 'checkbox';
  showPole.checked = page.pole.enabled;
  refreshFields.push(() => { showPole.checked = page.pole.enabled; syncPoleSelection(); });
  const visibility = make('label');
  visibility.className = 'check';
  visibility.append(showPole, ' Show Totem pole');
  poleGroup.append(visibility);
  showPole.onchange = () => {
    page.pole.enabled = showPole.checked;
    changed();
    syncPoleSelection();
  };
  const alignPole = make('input');
  alignPole.type = 'checkbox';
  alignPole.checked = page.pole.alignWithDetails;
  const alignment = make('label');
  alignment.className = 'check';
  alignment.append(alignPole, ' Centre under platform details');
  poleGroup.append(alignment);
  alignPole.onchange = () => {
    page.pole.alignWithDetails = alignPole.checked;
    changed();
    syncPoleSelection();
    refreshPoleControls.forEach(refresh => refresh());
  };
  refreshFields.push(() => { alignPole.checked = page.pole.alignWithDetails; });
  const modes = [['translate', 'Move', 'W'], ['rotate', 'Rotate', 'E'], ['scale', 'Scale', 'R']];
  const modeButtons = new Map();
  function setPoleMode(mode) {
    sceneTools.setPoleMode(mode);
    for (const [key, button] of modeButtons) button.setAttribute('aria-pressed', String(key === mode));
  }
  const modeRow = make('div');
  modeRow.className = 'mode-row';
  for (const [mode, label, shortcut] of modes) {
    const button = make('button', `${label} (${shortcut})`);
    button.type = 'button';
    button.onclick = () => setPoleMode(mode);
    modeButtons.set(mode, button);
    modeRow.append(button);
  }
  poleGroup.append(modeRow);
  setPoleMode('translate');
  addEventListener('keydown', event => {
    if (!sceneTools.poleSelected || event.altKey || event.ctrlKey || event.metaKey ||
        event.target.closest?.('input, select, textarea, [contenteditable]')) return;
    const match = modes.find(([, , shortcut]) => event.code === `Key${shortcut}`);
    if (match) { event.preventDefault(); setPoleMode(match[0]); }
  }, true);

  const refreshPoleControls = [];
  function poleControl(group, id, label, min, max, step, unit, read, write) {
    const { row, number, slider } = createLayoutControl(id,
      { label, min, max, step, unit }, `${group.querySelector('summary').textContent} ${label}`, read, value => {
        write(value);
        changed();
        refreshPoleControls.forEach(refresh => refresh());
      });
    group.append(row);
    const refresh = () => {
      number.value = slider.value = read();
      number.disabled = slider.disabled = id === 'pole-position-x' && page.pole.alignWithDetails;
    };
    refresh();
    refreshPoleControls.push(refresh);
  }
  const radians = Math.PI / 180;
  for (const [key, title, step, min, max, units] of [
    ['position', 'Position', .1, -100, 100, 1],
    ['rotation', 'Rotation', 1, -720, 720, radians],
  ]) {
    for (const [index, axis] of ['X', 'Y', 'Z'].entries()) {
      const label = `${title} ${axis}`;
      const read = () => Math.round(page.pole[key][index] / units * 100) / 100;
      poleControl(poleGroup, `pole-${key}-${axis.toLowerCase()}`, label, min, max, step,
        key === 'rotation' ? '°' : '', read, value => { page.pole[key][index] = value * units; });
    }
  }
  poleControl(poleGroup, 'pole-scale', 'Scale', .1, 15, .01, '', () => Math.round(page.pole.scale[0] * 100) / 100,
    value => { page.pole.scale = scalePlatformPole(page.pole.scale, value); });
  const editMascot = make('button', 'Edit Mini Totem on the pole');
  editMascot.type = 'button';
  editMascot.onclick = () => sceneTools.onObjectPick('mascot');
  const syncMascotControl = () => { editMascot.disabled = !page.pole.enabled; };
  syncMascotControl();
  poleGroup.append(editMascot);
  refreshFields.push(syncMascotControl);
  poleControl(mascotGroup, 'mascot-rest-scale', 'Rest scale', .25, 2, .01, '×',
    () => page.pole.mascotScale, value => { page.pole.mascotScale = value; });
  poleControl(mascotGroup, 'mascot-rest-facing', 'Rest facing', -180, 180, 1, '°',
    () => page.pole.mascotYaw, value => { page.pole.mascotYaw = value; });
  refreshFields.push(...refreshPoleControls);
  sceneTools.onPoleTransform = object => {
    const position = object.position.toArray().map(value => Math.max(-100, Math.min(100, value)));
    if (page.pole.alignWithDetails) position[0] = page.pole.position[0];
    page.pole.position = position;
    page.pole.rotation = [object.rotation.x, object.rotation.y, object.rotation.z];
    page.pole.scale = object.scale.toArray();
    changed();
    refreshPoleControls.forEach(refresh => refresh());
  };
  deviceGroup.after(poleGroup, mascotGroup);
  const placePanels = [scene, cameraPanel, layout, bottom, legacy].map(draggablePanel);
  function show(mode, focus = true) {
    const leavingCamera=!cameraPanel.hidden&&mode!=='camera';
    videoPanel.hide();
    scene.hidden=mode!=='scene';cameraPanel.hidden=mode!=='camera';layout.hidden=!['layout','sidenav'].includes(mode);
    bottom.hidden=mode!=='bottom';
    legacy.hidden=mode!=='objects';
    syncLogoHandles();
    syncPoleSelection();
    if(mode==='camera')toggleFreeLook(true);else if(leavingCamera)toggleFreeLook(false);
    document.getElementById('settings-toggle').setAttribute('aria-expanded',String(mode==='objects'));
    if(mode==='objects')document.getElementById('autoplay').checked=false;
    if(mode==='sidenav'){target.value='platforms';renderElement();}
    placePanels.forEach(place => place());
    if(mode==='bottom' && focus) bottom.querySelector('summary').focus();
    if(mode==='camera'&&focus)cameraFields['Camera target X'].focus({preventScroll:true});
    if(mode==='video')videoPanel.open();
  }
  sceneTools.onObjectPick = kind => {
    const group = selectedObjectGroups[kind];
    if (group) {
      group.open = true;
      show('objects');
      group.querySelector('summary').scrollIntoView({ block: 'nearest' });
    } else if (kind) {
      show(kind);
      if (kind === 'scene') lighting.open = true;
    } else if (!legacy.hidden && (poleGroup.open || mascotGroup.open)) {
      poleGroup.open = false;
      mascotGroup.open = false;
      sceneTools.selectPole(null);
    }
  };
  document.querySelector('#app').addEventListener('click', event => {
    if (event.target.closest('.chooser-bottom-nav [data-nav-id], #settings, aside, dialog, #totem-debug')) return;
    if (event.target.closest('.studio-panel-resize')) return;
    const text = event.target.closest('[data-platform-text]') ??
      event.target.closest('#system-types button, #select, .system')?.querySelector('[data-platform-text]');
    const metric = event.target.closest('.metadata svg')?.closest('[data-metric-icon]');
    const entry = Object.entries(HOME_ELEMENTS).find(([, [, selector]]) => event.target.closest(selector));
    if (!entry && !text && !event.target.closest('button')) return;
    event.preventDefault();
    event.stopPropagation();
    if (!entry && !text) return;
    show('layout');
    if (metric) iconSlot = metric.dataset.metricIcon;
    const id = text?.dataset.platformText ?? entry[0];
    if (text && ![...target.options].some(option => option.value === id)) {
      target.add(new Option(text.dataset.textLabel, id));
    }
    target.value = id;
    renderElement();
    target.focus({ preventScroll: true });
  }, true);
  for(const [id,name]of [['sidenav','Platform rail'],['scene','Scene Controls'],['camera','Camera'],['layout','2D Elements'],['objects','3D Elements'],['bottom','Bottom Nav']]){
    const button=make('button',name);button.type='button';button.onclick=()=>{menu.hidden=true;burger.setAttribute('aria-expanded','false');show(id);};menu.append(button);
  }
  burger.onclick=()=>{menu.hidden=!menu.hidden;burger.setAttribute('aria-expanded',String(!menu.hidden));};
  addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if(!menu.hidden){menu.hidden=true;burger.setAttribute('aria-expanded','false');burger.focus();return;}
    const panel=[cameraPanel,scene,layout,bottom,legacy].find(item=>!item.hidden);
    if(panel)panel.querySelector('.panel-heading button').click();
  });
  let previousPadButtons=new Set(),lastDpadRepeat=0;
  function visibleStudioControls() {
    return [...document.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')]
      .filter(element=>!element.closest('[hidden]')&&element.getClientRects().length&&!element.classList.contains('studio-scene-input'));
  }
  function focusStudioControl(direction) {
    const controls=visibleStudioControls();if(!controls.length)return;
    const current=controls.indexOf(document.activeElement);
    controls[(current+direction+controls.length)%controls.length].focus({preventScroll:false});
  }
  function adjustFocusedStudioControl(direction) {
    const control=document.activeElement;
    if(control instanceof HTMLInputElement&&control.type==='range'){
      const step=Number(control.step)||1,min=Number(control.min)||0,max=Number(control.max)||100;
      control.value=String(Math.min(max,Math.max(min,Number(control.value)+direction*step)));
      control.dispatchEvent(new Event('input',{bubbles:true}));
    }else if(control instanceof HTMLSelectElement){
      control.selectedIndex=(control.selectedIndex+direction+control.options.length)%control.options.length;
      control.dispatchEvent(new Event('change',{bubbles:true}));
    }else if(control instanceof HTMLInputElement&&control.type==='checkbox')control.click();
    else focusStudioControl(direction);
  }
  const studioPadTimer=window.setInterval(()=>{
    const pad=[...(navigator.getGamepads?.()??[])].find(item=>item?.connected&&item.mapping==='standard');
    if(!pad){previousPadButtons=new Set();return;}
    const current=new Set(pad.buttons.flatMap((button,index)=>button?.pressed?[index]:[]));
    const pressed=index=>current.has(index)&&!previousPadButtons.has(index);
    const repeat=index=>current.has(index)&&(pressed(index)||performance.now()-lastDpadRepeat>250);
    if(repeat(12)){focusStudioControl(-1);lastDpadRepeat=performance.now();}
    else if(repeat(13)){focusStudioControl(1);lastDpadRepeat=performance.now();}
    else if(repeat(14)){adjustFocusedStudioControl(-1);lastDpadRepeat=performance.now();}
    else if(repeat(15)){adjustFocusedStudioControl(1);lastDpadRepeat=performance.now();}
    else if(pressed(0)){
      const active=document.activeElement;
      if(active instanceof HTMLButtonElement)active.click();
      else if(active instanceof HTMLInputElement&&active.type==='checkbox')active.click();
      else if(active instanceof HTMLSelectElement)try{active.showPicker();}catch{}
    }else if(pressed(1)){
      if(!menu.hidden){menu.hidden=true;burger.setAttribute('aria-expanded','false');burger.focus();}
      else{const panel=[cameraPanel,scene,layout,bottom,legacy].find(item=>!item.hidden);if(panel)panel.querySelector('.panel-heading button').click();}
    }
    previousPadButtons=current;
  },70);
  addEventListener('pagehide',()=>clearInterval(studioPadTimer),{once:true});
  addEventListener('beforeunload',event=>{if(dirty||pending){if(autosave&&dirty)void flush();event.preventDefault();event.returnValue='';}});
  // Keep the existing home layout owner and its explicit Save as Default action.
  // Scene/2D changes share Studio's revision store with Game Chooser profiles.
  applyPlatformChooserElements(documentState);show('scene');
  if (native && !initialDocument.pages?.platformChooser?.sceneLayout) changed(false);
  return {
    previewPole,
    setSceneLayout(settings) {
      page.sceneLayout = settings;
      changed();
    },
  };
}
