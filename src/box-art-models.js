import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { parseModel, disposeImported } from './platform-assets.js';
import { BOX_ART_TEMPLATES, BOX_ART_PANELS } from './box-art.js';

export function fitArtwork(imageWidth, imageHeight, width, height, fit = 'contain') {
  const scale = fit === 'cover'
    ? Math.max(width / imageWidth, height / imageHeight)
    : Math.min(width / imageWidth, height / imageHeight);
  const fittedWidth = imageWidth * scale, fittedHeight = imageHeight * scale;
  return { x: (width - fittedWidth) / 2, y: (height - fittedHeight) / 2, width: fittedWidth, height: fittedHeight };
}

export const PANEL_COLORS = { front: '#47dcff', back: '#ffc76b', spine: '#ed83ff' };
function material(color, extra = {}) { return new THREE.MeshStandardMaterial({color, roughness: 0.5, ...extra}); }
function block(root, size, position, color, radius = 0.035) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(x => x / 3))), material(color));
  mesh.position.set(...position); root.add(mesh); return mesh;
}
export function generatedPackage(template) {
  const spec = BOX_ART_TEMPLATES[template], [w,h,d] = spec.size;
  const root = new THREE.Group(); root.userData.imported = true;
  block(root, [w,h,d], [0,0,0], spec.color);
  if (template.includes('jewel')) {
    block(root,[w*.91,h*.97,d*.12],[w*.025,0,d*.49],'#a4bbc7',.015).material = material('#b8cad4',{transparent:true,opacity:.18,roughness:.18,depthWrite:false});
    block(root,[w*.065,h*.95,d*1.02],[-w*.46,0,0],'#20242a',.008);
    for (const y of [-h*.4,h*.4]) block(root,[w*.1,.08,d*.8],[-w*.44,y,0],'#15181d',.01);
  } else if (template.includes('cartridge')) {
    // Editable, application-authored shells; the supplied ND Duck Hunt GLB stays intact.
    block(root,[w*.72,h*.09,d*.9],[0,-h*.43,0],'#323334',.01);
    for(let i=0;i<6;i++) block(root,[w*.035,h*.19,.025],[-w*.38+i*w*.045,h*.34,d/2+.012],'#55595b',.006);
    if(template==='n64-cartridge') for(const x of [-w*.4,w*.4]) block(root,[w*.12,h*.16,d*.7],[x,-h*.42,0],'#66696b');
  } else if (template !== 'cardboard') {
    block(root,[w*.025,h*.96,d*.9],[-w*.48,0,0],spec.color,.01);
  }
  return root;
}
function panelTexture(game, slot, size, image, guides) {
  const canvas = document.createElement('canvas'); canvas.height = Math.min(2048, Math.round(768*size[1]/size[0])); canvas.width = Math.max(16, Math.round(canvas.height*size[0]/size[1]));
  const c=canvas.getContext('2d'); c.fillStyle=guides? '#14202f':'#172019';c.fillRect(0,0,canvas.width,canvas.height);
  if(image && !guides) {
    const fit = slot === 'front' ? 'cover' : 'contain';
    const rect=fitArtwork(image.width,image.height,canvas.width,canvas.height,fit);c.drawImage(image,rect.x,rect.y,rect.width,rect.height);
  } else {
    if(guides) {
      c.strokeStyle=PANEL_COLORS[slot];c.lineWidth=3;
      for(let x=0;x<canvas.width;x+=96){c.beginPath();c.moveTo(x,0);c.lineTo(x,canvas.height);c.stroke();}
      for(let y=0;y<canvas.height;y+=96){c.beginPath();c.moveTo(0,y);c.lineTo(canvas.width,y);c.stroke();}
      c.lineWidth=16;c.strokeRect(8,8,canvas.width-16,canvas.height-16);
    }
    c.fillStyle=guides?PANEL_COLORS[slot]:'#d9e6df';c.textAlign='center';c.font='bold 54px Segoe UI, sans-serif';
    c.fillText(guides?slot.toUpperCase():game.title,canvas.width/2,canvas.height/2,canvas.width*.9);
    c.font='28px Segoe UI, sans-serif';c.fillText(guides?'↑ TOP':`${slot} artwork unavailable`,canvas.width/2,canvas.height/2+60,canvas.width*.9);
  }
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;return map;
}
export async function createBoxArtModel(config, game = {title:'Artwork preview'}, store, options = {}) {
  const root=new THREE.Group();root.userData.imported=true;
  try {
    let base;
    if(config.template==='custom') {
      const bytes=options.buffer ?? await store.readAsset(config.modelFile);base=await parseModel(bytes instanceof ArrayBuffer?bytes:Uint8Array.from(bytes).buffer);
    } else if (!BOX_ART_TEMPLATES[config.template].path) {
      base=generatedPackage(config.template);
    } else {
      const response=await fetch(new URL(BOX_ART_TEMPLATES[config.template].path,document.baseURI));
      if(!response.ok) throw new Error('The bundled Box Art model is unavailable.');
      base=await parseModel(await response.arrayBuffer());
    }
    base.rotation.set(...config.rotation.map(THREE.MathUtils.degToRad));root.add(base);
    const names=new Set(),materials=new Set(),removed=new Set();const neutral=new Set(config.neutralMaterials);
    base.traverse(p=>{if(p.isMesh)for(const m of Array.isArray(p.material)?p.material:[p.material])materials.add(m);});
    let unnamed=0;
    for(const m of materials){
      if(!m.name)m.name=`Material ${++unnamed}`;names.add(m.name);
      if(neutral.has(m.name)){
        for(const [key,value]of Object.entries(m))if(value?.isTexture){removed.add(value);m[key]=null;}
        m.color.set('#24262b');m.metalness=0;m.roughness=.7;m.needsUpdate=true;
      }
    }
    const retained=new Set([...materials].flatMap(m=>Object.values(m).filter(v=>v?.isTexture)));
    const retainedImages=new Set([...retained].map(t=>t.image)),closed=new Set();
    for(const texture of removed)if(!retained.has(texture)){
      texture.dispose();if(texture.image?.close&&!retainedImages.has(texture.image)&&!closed.has(texture.image)){texture.image.close();closed.add(texture.image);}
    }
    root.userData.materialNames=[...names];root.userData.boxArtConfig=config;
    const content={front:game.cover,back:game.backCover,spine:game.spineCover};
    for(const slot of BOX_ART_PANELS) {
      const panel=config.panels[slot];if(!panel.enabled) continue;
      let image,texture;
      if(content[slot] && !options.guides) {texture=await new THREE.TextureLoader().loadAsync(content[slot]);image=texture.image;}
      const map=panelTexture(game,slot,panel.size,image,options.guides);texture?.dispose();
      const face=new THREE.Mesh(new THREE.PlaneGeometry(...panel.size),new THREE.MeshBasicMaterial({color:'#ffffff',map,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
      face.name=`artwork-${slot}`;face.position.set(...panel.position);face.rotation.set(...panel.rotation.map(THREE.MathUtils.degToRad));root.add(face);
    }
    return root;
  } catch(error) {disposeImported(root);throw error;}
}
