import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Box3,Vector3} from 'three';
import platforms from '../platforms.json' with {type:'json'};
import {BOX_ART_TEMPLATES,defaultBoxArt,boxArtForPlatform,validateBoxArt} from '../src/box-art.js';
import {createBoxArtModel,generatedPackage} from '../src/box-art-models.js';
import {inspectGLB,disposeImported} from '../src/platform-assets.js';
import {withDownloadedArtwork} from '../src/igdb-client.js';
test('all platforms have independent packaging defaults; PS1 is ¾ inch deep',()=>{
 for(const p of platforms)validateBoxArt(defaultBoxArt(p));
 for(const [id,t]of [['playstation','ps1-jewel'],['dreamcast','cd-jewel'],['nes','nes-cartridge'],['wiiu','dvd-blue']])assert.equal(defaultBoxArt(id).template,t);
 const [w,h,d]=BOX_ART_TEMPLATES['ps1-jewel'].size;assert.ok(Math.abs(d/h*125-19.05)<.02);assert.ok(w/h<1.2);
 const a=defaultBoxArt('nes'),b=defaultBoxArt('nes');a.panels.front.position[0]=2;assert.notEqual(a.panels.front.position[0],b.panels.front.position[0]);
 const platform={boxArt:a},draft=boxArtForPlatform(platform);draft.panels.front.position[0]=1;assert.equal(platform.boxArt.panels.front.position[0],2);
});
test('packaging GLBs are self-contained and contain no embedded artwork',async()=>{
 for(const [id,t]of Object.entries(BOX_ART_TEMPLATES)){
  if(id==='custom')continue;
  if(!t.path){
   const generated=generatedPackage(id);
   try{
    const size=new Box3().setFromObject(generated).getSize(new Vector3());
    assert.ok(size.toArray().every(dimension=>dimension>0),id);
   }finally{disposeImported(generated);}
   continue;
  }
  const b=await readFile(new URL('../public/'+t.path,import.meta.url)),j=inspectGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));assert.ok(j.meshes.length);
  assert.equal(j.images?.length ?? 0, 0, id + ' must not embed artwork');
 }
});
test('region validation rejects invalid transforms and incomplete custom models; original ND labels remain intact',()=>{
 for(const change of [v=>v.panels.front.position[0]=Infinity,v=>v.panels.back.size[1]=0,v=>v.rotation[1]=181,v=>v.template='unknown',v=>v.template='custom',v=>v.neutralMaterials=['x'.repeat(101)]]){
  const v=defaultBoxArt('playstation');change(v);assert.throws(()=>validateBoxArt(v));
 }
 const original={id:'duck-hunt',model:'nes-cartridge'};assert.equal(withDownloadedArtwork(original,{assets:{front:{url:'own-label'}}}),original);assert.equal(withDownloadedArtwork(original,{assets:{front:{url:'own-label'}}},true).cover,'own-label');
});
test('custom GLB loads with saved surface transforms; disabled surfaces stay absent',async()=>{
 const oldDocument=globalThis.document;globalThis.document={baseURI:'http://test/',createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){},drawImage(){}})})};let model;
 try{
  const b=await readFile(new URL('../public/games/models/templates/ps1-jewel.glb',import.meta.url)),v=defaultBoxArt('playstation');v.template='custom';v.modelFile={kind:'model',id:'a'.repeat(64)+'.glb',name:'test.glb'};
  v.panels.front.position=[.2,.3,.4];v.panels.front.rotation=[10,20,30];v.panels.front.size=[1.5,2.1];v.panels.back.enabled=false;
  model=await createBoxArtModel(JSON.parse(JSON.stringify(validateBoxArt(v))),{title:'Test'},{readAsset:async()=>b},{guides:true});
  const front=model.getObjectByName('artwork-front');assert.deepEqual(front.position.toArray(),[.2,.3,.4]);assert.ok(Math.abs(front.rotation.y-20*Math.PI/180)<1e-12);assert.equal(front.geometry.parameters.width,1.5);assert.equal(front.geometry.parameters.height,2.1);assert.equal(model.getObjectByName('artwork-back'),undefined);assert.ok(new Box3().setFromObject(model).getSize(new Vector3()).length()>1);
 }finally{if(model)disposeImported(model);globalThis.document=oldDocument;}
});
