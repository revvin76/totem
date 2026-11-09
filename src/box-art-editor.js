import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BOX_ART_TEMPLATES, BOX_ART_PANELS, boxArtForPlatform, defaultBoxArt, validateBoxArt } from './box-art.js';
import { createBoxArtModel } from './box-art-models.js';
import { disposeImported } from './platform-assets.js';
import { addStudioLighting, configureStudioRenderer } from './lighting.js';
import './box-art-editor.css';

export function mountBoxArtEditor(store, onDirty) {
  const $=id=>document.getElementById(id), host=$('box-art-section');
  let platform, config, touched=false, pendingFile=null, pendingBuffer=null, token=0, model, renderer, camera, scene, controls, debounce, previewPromise, testImage;
  const inputs=[];
  const select=$('box-art-template');
  select.replaceChildren(...Object.entries(BOX_ART_TEMPLATES).map(([id,t])=>new Option(t.name,id)));
  function dirty(){touched=true;onDirty();$('box-art-status').textContent='Unsaved Box Art placement. Save platform to apply.';}
  function numeric(parent,label,min,max,step,read,write){
    const row=document.createElement('label');row.className='box-art-control';row.append(document.createTextNode(label));
    const range=document.createElement('input');range.type='range';range.min=min;range.max=max;range.step=step;range.setAttribute('aria-label',`${label} slider`);
    const number=document.createElement('input');number.type='number';number.min=min;number.max=max;number.step='any';number.required=true;number.setAttribute('aria-label',label);
    row.append(range,number);parent.append(row);
    const sync=()=>{range.value=number.value=read();};inputs.push(sync);
    for(const input of [range,number]) input.addEventListener('input',()=>{const value=input.valueAsNumber;if(!Number.isFinite(value)||value<min||value>max)return;write(value);sync();dirty();schedule();});
  }
  for(let i=0;i<3;i++)numeric($('box-art-model-rotation'),`Model rotation ${'XYZ'[i]} (°)`,-180,180,1,()=>config.rotation[i],v=>config.rotation[i]=v);
  function panel(){return config.panels[$('box-art-face').value];}
  for(const [key,n,labels,min,max,step] of [
    ['position',3,['Offset X','Offset Y','Offset Z'],-5,5,.005],
    ['rotation',3,['Rotation X (°)','Rotation Y (°)','Rotation Z (°)'],-180,180,1],
    ['size',2,['Artwork width','Artwork height'],.01,5,.005],
  ])for(let i=0;i<n;i++) numeric($('box-art-placement'),labels[i],min,max,step,()=>panel()[key][i],v=>panel()[key][i]=v);
  function sync(){
    select.value=config.template;
    $('box-art-enabled').checked=panel().enabled;
    $('box-art-model-name').textContent=pendingFile?.name??config.modelFile?.name??BOX_ART_TEMPLATES[config.template].path??BOX_ART_TEMPLATES[config.template].name;
    $('box-art-neutral').value=config.neutralMaterials.join(', ');
    for(const key of ['source','author','license'])$('box-art-'+key).value=config[key]??'';
    for(const fn of inputs)fn();
    $('box-art-face').style.borderColor={front:'#47dcff',back:'#ffc76b',spine:'#ed83ff'}[$('box-art-face').value];
  }
  function setup(){
    if(renderer)return;
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));configureStudioRenderer(renderer);
    const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','Box Art 3D preview. Drag to inspect artwork placement.');$('box-art-preview').append(canvas);
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(36,1,.01,100);
    const gen=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=gen.fromScene(room,.04).texture;room.dispose();gen.dispose();addStudioLighting(scene,camera);
    controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.listenToKeyEvents(canvas);resetView();
    new ResizeObserver(()=>{const{width,height}=$('box-art-preview').getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}).observe($('box-art-preview'));
    renderer.setAnimationLoop(()=>{if($('platform-editor').open&&!document.hidden){controls.update();renderer.render(scene,camera);}});
  }
  function resetView(){if(!camera)return;camera.position.set(3.8,2.1,6.7);controls.target.set(0,0,0);controls.update();}
  async function rebuild(){
    const current=++token;const draft=structuredClone(config);$('box-art-preview-status').textContent='Preparing Box Art preview…';
    if(draft.template==='custom'&&!draft.modelFile&&!pendingBuffer){$('box-art-preview-status').textContent='Choose a self-contained GLB to preview the custom model.';if(model){scene.remove(model);disposeImported(model);model=null;}return false;}
    try{
      const next=await createBoxArtModel(draft,{title:platform.name,platformId:platform.id,cover:testImage},store,{guides:$('box-art-guides').checked,buffer:pendingBuffer});
      if(current!==token||!$('platform-editor').open){disposeImported(next);return false;}
      if(model){scene.remove(model);disposeImported(model);}model=next;scene.add(next);
      $('box-art-preview-status').textContent=`${BOX_ART_TEMPLATES[draft.template].name} · front cyan · back amber · spine magenta`;
      $('box-art-materials').textContent=next.userData.materialNames.length?`Model materials: ${next.userData.materialNames.join(', ')}`:'Application-authored editable shell';
      return true;
    }catch(error){if(current===token)$('box-art-preview-status').textContent=`Box Art preview unavailable: ${error.message}`;return false;}
  }
  function schedule(){clearTimeout(debounce);debounce=setTimeout(()=>{previewPromise=rebuild();},120);}
  select.addEventListener('change',()=>{
    const template=select.value;config={...defaultBoxArt(platform),template,source:BOX_ART_TEMPLATES[template].source??'',author:BOX_ART_TEMPLATES[template].author??'',license:BOX_ART_TEMPLATES[template].license??'',rotation:[0,0,0],panels:structuredClone(BOX_ART_TEMPLATES[template].panels),neutralMaterials:[]};
    pendingFile=pendingBuffer=null;$('box-art-model-input').value='';dirty();sync();previewPromise=rebuild();
  });
  $('box-art-face').addEventListener('change',sync);
  $('box-art-enabled').addEventListener('change',()=>{panel().enabled=$('box-art-enabled').checked;dirty();schedule();});
  $('box-art-guides').addEventListener('change',()=>{previewPromise=rebuild();});
  $('box-art-neutral').addEventListener('change',()=>{config.neutralMaterials=$('box-art-neutral').value.split(',').map(v=>v.trim()).filter(Boolean);dirty();schedule();});
  for(const key of ['source','author','license'])$('box-art-'+key).addEventListener('input',()=>{config[key]=$('box-art-'+key).value;dirty();});
  $('box-art-model-input').addEventListener('change',async()=>{
    const file=$('box-art-model-input').files[0];if(!file)return;const currentPlatform=platform.id,currentToken=token;
    if(file.size>128*1048576){$('box-art-status').textContent='GLB limit is 128 MB.';return;}
    try{const buffer=await file.arrayBuffer();if(platform.id!==currentPlatform||token!==currentToken)return;
      pendingFile=file;pendingBuffer=buffer;config.template='custom';delete config.modelFile;config.rotation=[0,0,0];config.source=config.author=config.license='';dirty();sync();previewPromise=rebuild();
    }catch(error){$('box-art-status').textContent=`Model not selected: ${error.message}`;}
  });
  $('box-art-test-image').addEventListener('change',()=>{
    if(testImage)URL.revokeObjectURL(testImage);const file=$('box-art-test-image').files[0];testImage=file?URL.createObjectURL(file):null;
    $('box-art-guides').checked=false;previewPromise=rebuild();
  });
  $('box-art-reset-view').addEventListener('click',resetView);
  $('box-art-reset').addEventListener('click',()=>{config=defaultBoxArt(platform);pendingFile=pendingBuffer=null;dirty();sync();previewPromise=rebuild();});
  return {
    bind(record){
      ++token;clearTimeout(debounce);platform=record;config=boxArtForPlatform(record);touched=false;pendingFile=pendingBuffer=null;
      if(testImage)URL.revokeObjectURL(testImage);testImage=null;$('box-art-test-image').value=$('box-art-model-input').value='';$('box-art-guides').checked=true;
      $('box-art-face').value='front';setup();sync();resetView();previewPromise=rebuild();$('box-art-status').textContent=record.boxArt?'Saved platform Box Art layout loaded.':'Platform default. Edit and Save platform to override it.';
    },
    async forSave(){
      if(!touched)return platform.boxArt?structuredClone(platform.boxArt):undefined;
      clearTimeout(debounce);previewPromise=rebuild();if(!await previewPromise)throw new Error('Box Art preview must load successfully before saving.');
      const value=structuredClone(config);if(pendingFile)value.modelFile=await store.importAsset(pendingFile,'model');
      return validateBoxArt(value);
    },
    close(){++token;clearTimeout(debounce);if(model){scene.remove(model);disposeImported(model);model=null;}if(testImage)URL.revokeObjectURL(testImage);testImage=null;},
  };
}
