import bundledPlatforms from '../platforms.json' with {type:'json'};
import { isTauri } from '@tauri-apps/api/core';
import { createStudioMuteButton } from '../src/studio-audio.js';
import { DEVICE_TYPES, platformType, resolvedSettings, platformOverrideEnabled, loadStudioDocument, saveStudioDocument, studioInvoke } from '../src/studio-config.js';
import { bottomNavOrder, studioPageSelector } from '../src/studio-page-settings.js';
import { bottomNavButton, bottomNavToggleValues, refreshBottomNavArtwork, setBottomNavLabel } from '../src/bottom-nav.js';
import { initialiseControllerMappings } from '../src/app-controller-mappings.js';
import { bindBottomNavDrag, createBottomNavEditor } from '../src/bottom-nav-editor.js';
import { bindStudioPanelResize } from '../src/studio-panel-resize.js';
import { mountGameplayBackdropPanel } from '../src/gameplay-backdrop-panel.js';
import './studio.css';
import { normalizeEnvironmentSettings, resolveStudioEnvironment } from '../src/studio-environment-settings.js';
import { audioToggleLabels, chooserActions } from './chooser-controls.js';
import { resolveChooserLayout, resolveChooserPole, saveChooserPole, updateChooserPage } from './chooser-layout.js';

const label = type => ({'device-only':'Device only'})[type] || type[0].toUpperCase()+type.slice(1);
const emptyDocument = () => ({version:1,revision:null,defaults:{},overrides:{}});
const playbackLabels = { on: 'Pause', off: 'Resume', state: 'playback' };
const toggleLabels = Object.assign(Object.create(null), {
  ...audioToggleLabels,
  enter: playbackLabels,
  video: playbackLabels,
  filters: { on: 'Close filters', off: 'Search & filters', state: 'filters' },
});

export const studio = {
  runtime:new URLSearchParams(location.search).has('runtime'), type:'handheld', platformId:null, inspector:'sidenav',
  document:emptyDocument(), bottomNav:[], ready:false, timer:null, queue:Promise.resolve(), overrideEnabled:false,
  autosave:true, pending:0, undo:[], redo:[],
  async load(legacy) {
    this.legacy = {settings:{},uiDesign:{},bottomNav:[{id:'enter',icon:'a',label:'Enter',action:'enter'},{id:'back',icon:'b',label:'Back',action:'escape'},{id:'filters',icon:'menu',label:'Search & filters',action:'filters'}]};
    this.platforms = bundledPlatforms;
    try { this.document = await this.read(); }
    catch(error) { this.error = String(error); }
    if (!this.runtime && isTauri()) {
      try { this.platforms = (await studioInvoke('carousel_state')).platforms; }
      catch (error) { this.error ??= String(error); }
    }
    // Only the first shared handheld profile may be seeded from the old editor draft.
    const seedDraft = !this.runtime && !this.document.defaults.handheld && legacy.layoutVersion === 2;
    if (seedDraft) this.legacy.uiDesign = legacy.uiDesign || {};
    const resolved = this.resolve(); this.bottomNav = resolved.bottomNav;
    if (seedDraft) {
      resolved.settings = {...legacy.settings,...resolveStudioEnvironment(this.document)};
    }
    return {...legacy,...resolved, settings: {...resolved.settings, ...resolved.pole}};
  },
  async read() {
    return loadStudioDocument(isTauri() || this.runtime);
  },
  resolve() {
    initialiseControllerMappings(this.document);
    const resolved=resolvedSettings(this.document,this.type,this.platformId,this.legacy);
    resolved.settings={...resolved.settings,...resolveStudioEnvironment(this.document)};
    return {...resolved,...resolveChooserLayout(this.document,this.type,this.platformId,this.legacy),
      gameplayBackdrop:this.document.gameplayBackdrop,
      pole:resolveChooserPole(this.document,this.type,this.platformId,this.editAllPoles)};
  },
  save(snapshot, { seed = false } = {}) {
    if (!this.ready || this.runtime || this.applying) return;
    const next=structuredClone({...snapshot,bottomNav:this.bottomNav});
    const fingerprint=JSON.stringify([this.type,this.platformId,next]);if(fingerprint===this.lastRequested)return;this.lastRequested=fingerprint;
    this.snapshot = next;
    clearTimeout(this.timer);
    this.dirty = seed || JSON.stringify(next) !== JSON.stringify(this.savedSnapshot);
    if (!this.conflict) {
      this.status(this.pending || (this.dirty && this.autosave) ? 'Saving…' : this.dirty ? 'Unsaved changes' : 'Saved');
      if (this.dirty && this.autosave) this.timer = setTimeout(() => this.flush(),350);
    }
    this.updateToolbar();
  },
  flush(manual = false) {
    clearTimeout(this.timer);
    if (!this.dirty || this.runtime || (!this.autosave && !manual) || this.conflict) return this.queue;
    const snapshot = this.snapshot, previous = this.savedSnapshot;
    const type = this.type, id = this.platformId, enabled = this.overrideEnabled, allPoles = this.editAllPoles;
    this.savedSnapshot = snapshot;
    this.dirty = false;
    this.pending++;
    this.status('Saving…');
    this.updateToolbar();
    this.queue = this.queue.then(async () => {
      if (this.conflict) throw new Error(this.conflict);
      const next = structuredClone(this.document);
      const {layout,layoutChanged} = updateChooserPage(next,this.legacy,snapshot,previous,id);
      const settingsChanged = JSON.stringify(snapshot.settings) !== JSON.stringify(previous?.settings);
      if (JSON.stringify(snapshot.gameplayBackdrop) !== JSON.stringify(previous?.gameplayBackdrop))
        next.gameplayBackdrop = snapshot.gameplayBackdrop;
      if (JSON.stringify(snapshot.pole) !== JSON.stringify(previous?.pole))
        saveChooserPole(next.pages.gameChooser,type,id,allPoles,snapshot.pole);
      if (settingsChanged) next.environment=normalizeEnvironmentSettings(snapshot.settings);
      if (id && enabled && (settingsChanged || layoutChanged)) {
        next.overrides[type] ||= {};
        const existing = next.overrides[type][id];
        const profile = {...existing,settings:snapshot.settings,_snapshot:true,_enabled:true};
        if (layoutChanged) {
          profile.layout = layout;
          delete profile.uiDesign;
        } else if (!existing?._snapshot && existing?.uiDesign) {
          // Preserve the resolved 2D layout when promoting an older partial override.
          profile.layout = layout;
          delete profile.uiDesign;
        }
        delete profile.bottomNav;
        next.overrides[type][id] = profile;
      } else if (!id && (settingsChanged || (type === 'handheld' && !next.defaults.handheld))) {
        next.defaults[type] = {settings:snapshot.settings};
      }
      if (JSON.stringify(next) !== JSON.stringify(this.document))
        this.document = await saveStudioDocument(next,this.document.revision);
      this.persistedSnapshot = snapshot;
      this.status(this.dirty ? 'Unsaved changes' : id && !enabled && (settingsChanged || layoutChanged)
        ? 'Shared settings saved · platform edits are preview only' : 'Saved');
    }).catch(error => {
      this.dirty = true;
      this.conflict = String(error);
      this.status(`Not saved: ${error}`,true);
    }).finally(() => {
      this.pending--;
      this.updateToolbar();
    });
    return this.queue;
  },
  async beforeNavigate() {
    await this.flush();
    if (!this.dirty && !this.conflict) return true;
    if (!this.conflict) this.status('Save or discard changes before switching.');
    return false;
  },
  currentSnapshot() {
    return structuredClone({...this.getSnapshot(), bottomNav:this.bottomNav});
  },
  resetHistory() {
    this.undo.length = this.redo.length = 0;
    this.historySnapshot = this.currentSnapshot();
    this.updateToolbar();
  },
  rememberEdit() {
    if (!this.ready || this.runtime || this.applying) return;
    const snapshot = this.currentSnapshot();
    if (JSON.stringify(snapshot) === JSON.stringify(this.historySnapshot)) return;
    this.undo.push(this.historySnapshot);
    if (this.undo.length > 50) this.undo.shift();
    this.redo.length = 0;
    this.historySnapshot = snapshot;
    this.updateToolbar();
  },
  restoreSnapshot(snapshot) {
    this.applying = true;
    try {
      const next = structuredClone(snapshot);
      this.bottomNav = next.bottomNav;
      this.navCommitted = structuredClone(this.bottomNav);
      this.navUndo.length = this.navRedo.length = 0;
      this.apply(next);
      this.renderBar();
      this.renderItems();
    } finally {
      this.applying = false;
    }
  },
  restoreEdit(from, to) {
    if (!from.length) return;
    to.push(this.currentSnapshot());
    this.historySnapshot = from.pop();
    this.restoreSnapshot(this.historySnapshot);
    this.save(this.getSnapshot());
    this.updateToolbar();
  },
  discardChanges() {
    if (!this.dirty || this.pending || !this.persistedSnapshot) return;
    clearTimeout(this.timer);
    this.restoreSnapshot(this.persistedSnapshot);
    this.savedSnapshot = this.persistedSnapshot;
    this.lastRequested = null;
    this.dirty = false;
    this.resetHistory();
    this.status(this.conflict ? 'Changes discarded. Reload Studio before editing.' : 'Changes discarded', !!this.conflict);
  },
  updateToolbar() {
    if (!this.toolbar) return;
    this.toolbar.save.disabled = !this.dirty || !!this.pending || !!this.conflict;
    this.toolbar.discard.disabled = !this.dirty || !!this.pending;
    this.toolbar.undo.disabled = !this.undo.length;
    this.toolbar.redo.disabled = !this.redo.length;
  },
  status(text,error=false) { const node=document.querySelector('#studio-status');if(node){node.textContent=text;node.classList.toggle('error',error);} },
  async setPoleScope(all, apply) {
    const context = this.contextRequest;
    if (!await this.beforeNavigate() || context !== this.contextRequest) return;
    this.editAllPoles = all;
    apply(this.resolve().pole);
    this.savedSnapshot = this.persistedSnapshot = {...this.savedSnapshot, pole:this.getSnapshot().pole};
    this.lastRequested = null;
    this.resetHistory();
  },
  async context(type,id) {
    const request = this.contextRequest = (this.contextRequest || 0) + 1;
    if (!await this.beforeNavigate() || request !== this.contextRequest) return false;
    this.type=type;this.platformId=id;this.editAllPoles=false;
    this.overrideEnabled=id ? platformOverrideEnabled(this.document,type,id) : false;
    const customToggle=document.querySelector('#studio-custom-enabled');
    if(customToggle){customToggle.checked=this.overrideEnabled;customToggle.disabled=!id;}
    const resolved=this.resolve();this.bottomNav=resolved.bottomNav;
    this.navCommitted=structuredClone(this.bottomNav);
    this.apply(resolved);this.renderBar();this.renderItems();
    this.savedSnapshot = this.persistedSnapshot = this.currentSnapshot();
    this.resetHistory();
    this.lastRequested=null;
    const platform=this.platforms.find(p=>p.id===id);
    if (id && !this.overrideEnabled) this.status(`Using ${label(type)} defaults`);
    else this.status('Shared settings · saved');
    await this.onPlatform(id ? platform : null,type);
    if (request !== this.contextRequest) return;
    document.querySelector('#studio-context-label').textContent=`Game Chooser · ${id ? platform.name : `Default ${label(type)}`}`;
    return true;
  },
  mount({apply,getSnapshot,onPlatform,onInspector,onAction,getToggleState,onResume,onPlatformError,gameplay,onGameplayBackdrop}) {
    Object.assign(this,{apply,getSnapshot,onPlatform,onInspector,onAction,getToggleState});
    document.body.classList.toggle('studio-runtime',this.runtime);
    document.body.classList.toggle('browser-preview', this.runtime && new URLSearchParams(location.search).has('browser'));
    const header=document.createElement('header');header.className='studio-toolbar studio-game-toolbar';
    header.innerHTML=`<strong>Totem Studio</strong><span id="studio-context-label">Game Chooser · Default Handheld</span><label>Type <select id="studio-type"></select></label><label>Platform <select id="studio-platform"></select></label><label class="studio-custom-toggle"><input id="studio-custom-enabled" type="checkbox" disabled> Custom platform settings</label><span id="studio-status" role="status"></span><button type="button" id="studio-burger" aria-label="Open editor menu" aria-expanded="false">☰</button><nav id="studio-menu" hidden><button data-panel="sidenav">SideNav Menu</button><button data-panel="scene">Scene Controls</button><button data-panel="camera">Camera</button><button data-panel="layout">2D Elements</button><button data-panel="objects">3D Elements</button><button data-panel="bottom">Bottom Nav</button></nav>`;
    document.body.append(header);
    header.insertBefore(studioPageSelector('gameChooser',()=>this.beforeNavigate()),header.querySelector('label'));
    const typeSelect=header.querySelector('#studio-type'),platformSelect=header.querySelector('#studio-platform');
    DEVICE_TYPES.forEach(type=>typeSelect.add(new Option(label(type),type)));typeSelect.value=this.type;
    const updatePlatforms=()=>{platformSelect.replaceChildren(new Option(`Default ${label(typeSelect.value)}`,''));this.platforms.filter(p=>platformType(p)===typeSelect.value || typeSelect.value==='device-only').sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>platformSelect.add(new Option(p.name,p.id)));};
    updatePlatforms();
    typeSelect.onchange=async()=>{
      if (!await this.context(typeSelect.value,null)) typeSelect.value = this.type;
      updatePlatforms();
      platformSelect.value = this.platformId ?? '';
      reset.disabled = !this.platformId;
    };
    platformSelect.onchange=async()=>{
      if (!await this.context(typeSelect.value,platformSelect.value || null)) platformSelect.value = this.platformId ?? '';
      reset.disabled = !this.platformId;
    };
    this.stepPlatform = direction => {
      if (this.runtime) {
        parent.postMessage({ gameChooser: 'step-platform', direction }, location.origin);
        return;
      }
      const platforms = Array.from(platformSelect.options).slice(1);
      if (!platforms.length) return;
      const index = platformSelect.selectedIndex - 1;
      const next = index < 0 ? (direction > 0 ? 0 : platforms.length - 1) : (index + direction + platforms.length) % platforms.length;
      platformSelect.value = platforms[next].value;
      platformSelect.dispatchEvent(new Event('change'));
    };
    header.querySelector('#studio-custom-enabled').onchange=async event=>{
      const enabled=event.target.checked;
      if (!await this.beforeNavigate()) { event.target.checked = this.overrideEnabled; return; }
      const next=structuredClone(this.document);next.overrides[this.type] ||= {};
      const stored=next.overrides[this.type][this.platformId];
      next.overrides[this.type][this.platformId]={...(stored || {settings:this.getSnapshot().settings,_snapshot:true}),_enabled:enabled};
      try {
        this.document=await saveStudioDocument(next,this.document.revision);
        this.lastRequested=null;await this.context(this.type,this.platformId);this.status('Saved');
      }catch(error){this.status(`Not saved: ${error}`,true);}
    };
    const reset=document.createElement('button');reset.type='button';reset.textContent='Use type defaults';reset.title='Remove this platform’s Game Chooser overrides';reset.disabled=true;
    header.insertBefore(reset,header.querySelector('#studio-status'));
    reset.onclick=async()=>{if(!await this.beforeNavigate()||!this.platformId)return;const next=structuredClone(this.document);delete next.overrides[this.type]?.[this.platformId];delete next.pages?.gameChooser?.pole?.platforms?.[this.platformId];try{this.document=await saveStudioDocument(next,this.document.revision);this.lastRequested=null;await this.context(this.type,this.platformId);}catch(error){this.status(`Not saved: ${error}`,true);}};
    const menu=header.querySelector('#studio-menu'),burger=header.querySelector('#studio-burger');
    if (!this.runtime) {
      const controls = document.createElement('div');
      controls.className = 'studio-edit-actions';
      controls.innerHTML = `<label class="studio-autosave-toggle"><input type="checkbox" checked> Auto-save</label>
        <button type="button" data-edit="save">Save all</button><button type="button" data-edit="discard">Discard</button>
        <button type="button" data-edit="undo">Undo</button><button type="button" data-edit="redo">Redo</button>`;
      this.toolbar = Object.fromEntries([...controls.querySelectorAll('button')].map(button => [button.dataset.edit, button]));
      header.querySelector('#studio-status').before(controls);
      controls.querySelector('input').onchange = event => {
        this.autosave = event.target.checked;
        if (this.autosave) void this.flush();
        else clearTimeout(this.timer);
        if (this.dirty && !this.conflict && !this.pending) this.status('Unsaved changes');
      };
      this.toolbar.save.onclick = () => this.flush(true);
      this.toolbar.discard.onclick = () => this.discardChanges();
      this.toolbar.undo.onclick = () => this.restoreEdit(this.undo, this.redo);
      this.toolbar.redo.onclick = () => this.restoreEdit(this.redo, this.undo);
      new ResizeObserver(() => document.body.style.setProperty('--studio-toolbar-height', `${header.offsetHeight}px`)).observe(header);
      burger.before(createStudioMuteButton(gameplay));
      this.videoPanel = mountGameplayBackdropPanel(header, this.document.gameplayBackdrop, onGameplayBackdrop);
    }
    burger.onclick=()=>{menu.hidden=!menu.hidden;burger.setAttribute('aria-expanded',String(!menu.hidden));};
    menu.onclick=event=>{const button=event.target.closest('[data-panel]');if(!button)return;menu.hidden=true;burger.setAttribute('aria-expanded','false');this.videoPanel?.hide();this.onInspector(button.dataset.panel);};
    this.navCommitted=structuredClone(this.bottomNav);this.navUndo=[];this.navRedo=[];
    this.addBottomEditor();this.renderBar();this.ready=true;
    if (!this.runtime) bindBottomNavDrag(document.querySelector('#bottom-nav'), {
      items: () => this.bottomNav, editor: this.bottomEditor, change: () => this.changedBar(),
      openPanel: () => this.onInspector('bottom'),
    });
    this.status(this.error ? `Not loaded: ${this.error}` : isTauri() ? 'Shared settings · saved' : this.runtime ? '' : 'Browser preview · local settings');
    if(this.error) { this.conflict=this.error;this.status(`Not loaded: ${this.error}`,true); }
    this.savedSnapshot = this.persistedSnapshot = this.currentSnapshot();
    this.resetHistory();
    if(!this.runtime && (!this.document.defaults.handheld || !this.document.pages?.gameChooser)) this.save(this.getSnapshot(), { seed:true });
    if(this.runtime) {
      window.addEventListener('message',async event=>{
        if(event.source!==parent || event.origin!==location.origin) return;
        if(event.data?.gameChooser==='prepare' || event.data?.gameChooser==='open') {
          try {
            this.active=event.data.gameChooser==='open';
            this.native=event.data.native===true;
            this.type=platformType(event.data.platform);this.platformId=event.data.platform?.id;
            this.document=await this.read();const resolved=this.resolve();this.bottomNav=resolved.bottomNav||[];
            this.apply(resolved);this.renderBar();await this.onPlatform(event.data.platform,this.type,event.data.games);
            await parent.totemSceneRuntime?.prepareView('gameChooser');
            if(!this.active) document.querySelector('#gameplay').pause();
            parent.postMessage({gameChooser:'prepared',request:event.data.request},location.origin);
          } catch(error) {
            parent.postMessage({gameChooser:'prepared',request:event.data.request,error:String(error)},location.origin);
          }
        }
        if(event.data?.gameChooser==='resume') {
          this.active=true;
          onResume();
        }
        if(event.data?.gameChooser==='action' && this.active && Object.hasOwn(chooserActions, event.data.action))
          this.onAction(event.data.action);
        if(event.data?.gameChooser==='pause') {this.active=false;document.querySelector('#gameplay').pause();}
        if(event.data?.gameChooser==='platform-error') onPlatformError(event.data.message);
      });
      setInterval(async()=>{if(!this.active)return;try{const next=await this.read();if(next.revision!==this.document.revision){this.document=next;const resolved=this.resolve();this.bottomNav=resolved.bottomNav||[];this.apply(resolved);this.renderBar();}}catch(error){console.warn('Studio refresh failed',error);}},1500);
    } else {
      window.addEventListener("focus", async () => {
        try {
          initialiseControllerMappings(await this.read());
          this.renderBar();
          window.dispatchEvent(new Event("totem:action-mappings-changed"));
        } catch (error) { console.warn("Action mappings could not be refreshed", error); }
      });
    }
    addEventListener('beforeunload',event=>{if(this.dirty || this.pending){void this.flush();event.preventDefault();event.returnValue='';}});
  },
  addBottomEditor() {
    this.bottomEditor = createBottomNavEditor({
      items: () => this.bottomNav, actions: chooserActions, toggleLabels,
      add: action => this.addButton(action), change: redraw => this.changedBar(redraw),
      undo: () => this.restoreNav(this.navUndo, this.navRedo),
      redo: () => this.restoreNav(this.navRedo, this.navUndo),
      canUndo: () => this.navUndo.length, canRedo: () => this.navRedo.length,
    });
    const { editor } = this.bottomEditor;
    const panel=document.createElement('aside');panel.id='bottom-panel';panel.className='scene-controls studio-control-panel bottom-controls is-closed';panel.setAttribute('aria-label','Bottom Nav editor');
    panel.innerHTML='<header class="controls-header"><div class="controls-title"><strong>Bottom Nav</strong></div><div class="history-buttons"><button type="button" aria-label="Close Bottom Nav editor">×</button></div></header><div class="controls-body"></div>';
    panel.querySelector('.controls-body').append(editor);document.querySelector('#stage').append(panel);
    panel.querySelector('header button').onclick=()=>this.setBottomPanelOpen(false);
    const header=panel.querySelector('header');let drag=null;
    let position;try{position=JSON.parse(localStorage.getItem('totem.studio.bottom-panel'));}catch{}
    const place=()=>{if(!position)return;panel.style.right='auto';panel.style.left=`${Math.max(0,Math.min(position.x,innerWidth-panel.offsetWidth))}px`;panel.style.top=`${Math.max(0,Math.min(position.y,document.querySelector('#stage').clientHeight-panel.offsetHeight))}px`;};
    header.onpointerdown=event=>{if(event.button!==0||event.target.closest('button'))return;const bounds=panel.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX-bounds.left,y:event.clientY-bounds.top};header.setPointerCapture(event.pointerId);event.preventDefault();};
    header.onpointermove=event=>{if(!drag||drag.id!==event.pointerId)return;const stage=document.querySelector('#stage').getBoundingClientRect();position={x:event.clientX-stage.left-drag.x,y:event.clientY-stage.top-drag.y};place();};
    header.onpointerup=header.onpointercancel=()=>{drag=null;if(position)localStorage.setItem('totem.studio.bottom-panel',JSON.stringify(position));};
    if (!this.runtime) bindStudioPanelResize(panel, {
      container: document.querySelector('#stage'),
      onResize: ({ left, top }) => { position = { x: left, y: top }; },
    });
    this.positionBottomPanel=place;this.renderItems();
  },
  setBottomPanelOpen(open) {document.querySelector('#bottom-panel')?.classList.toggle('is-closed',!open);if(open)this.positionBottomPanel?.();},
  addButton(action) {
    if (!Object.hasOwn(chooserActions, action)) return;
    const id = crypto.randomUUID();
    this.bottomNav.push({ id, icon: '', label: chooserActions[action], action });
    this.changedBar();
    return id;
  },
  changedBar(renderItems = true) {
    this.navUndo.push(structuredClone(this.navCommitted));
    this.navUndo = this.navUndo.slice(-50);
    this.navRedo = [];
    this.navCommitted = structuredClone(this.bottomNav);
    if (renderItems) {
      this.renderBar();
      this.renderItems();
    } else {
      this.refreshBarLabels();
      this.updateNavHistoryButtons();
    }
    this.save(this.getSnapshot());
    this.rememberEdit();
  },
  restoreNav(from,to) {if(!from.length)return;to.push(structuredClone(this.bottomNav));this.bottomNav=from.pop();this.navCommitted=structuredClone(this.bottomNav);this.renderBar();this.renderItems();this.save(this.getSnapshot());this.rememberEdit();},
  updateNavHistoryButtons() { this.bottomEditor?.updateHistory(); },
  renderItems() { this.bottomEditor?.render(); },
  renderBar() {
    let bar = document.querySelector('#bottom-nav');
    if (!bar) {
      bar = document.createElement('nav');
      bar.id = 'bottom-nav';
      bar.className = 'chooser-bottom-nav';
      bar.setAttribute('aria-label', 'Game controls');
      document.querySelector('#stage').append(bar);
    }
    bar.replaceChildren(...bottomNavOrder(this.bottomNav).map(({ item }) =>
      bottomNavButton(item, () => this.onAction(item.action), "game")));
    this.refreshBarLabels();
  },
  refreshBarLabels() {
    const bar = document.querySelector('#bottom-nav');
    if (!bar) return;
    bottomNavOrder(this.bottomNav).forEach(({item}, index) => {
      const button = bar.children[index];
      if (!button) return;
      refreshBottomNavArtwork(button);
      const labels = toggleLabels[item.action];
      let value = item.label ?? '';
      if (item.toggleLabel === true && labels) {
        value = this.getToggleState(labels.state) ? item.labelOn ?? labels.on : item.labelOff ?? labels.off;
      }
      if (item.action === "filters") {
        button.setAttribute("aria-controls", "game-menu");
        button.setAttribute("aria-expanded", String(this.getToggleState("filters")));
      }
      setBottomNavLabel(button, value, chooserActions[item.action], bottomNavToggleValues(item, labels));
    });
  },
};
