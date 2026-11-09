import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeThumbnails, THUMBNAIL_TYPES } from '../light-study/thumbnail-settings.js';
test('thumbnail preference is one shared switch and artwork type',()=>{
  assert.deepEqual(normalizeThumbnails(),{enabled:false,type:'front-cover'});
  assert.deepEqual(normalizeThumbnails({thumbnails:{enabled:true,type:'cartridge'}}),{enabled:true,type:'cartridge'});
});
test('legacy individual thumbnail slots consolidate without retaining game IDs',()=>{
  const legacy={thumbnails:{'mario-kart':'logo','zelda':'front-cover'},defaultThumbnailType:'logo'};
  assert.deepEqual(normalizeThumbnails(legacy),{enabled:true,type:'logo'});
});
test('disabled thumbnails retain the shared artwork choice',()=>{
  assert.deepEqual(normalizeThumbnails({thumbnails:{enabled:false,type:'3d-artwork'}}),{enabled:false,type:'3d-artwork'});
});
test('invalid stored artwork choices fall back to the case cover',()=>{
  assert.deepEqual(normalizeThumbnails({thumbnails:{enabled:true,type:'../secret'}}),{enabled:true,type:'front-cover'});
});
test('every offered artwork type survives normalisation',()=>{
  for(const [type] of THUMBNAIL_TYPES)assert.deepEqual(normalizeThumbnails({thumbnails:{enabled:true,type}}),{enabled:true,type});
});
