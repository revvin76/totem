import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveredPlatformIds,gameWindow} from '../src/library-client.js';
test('startup visibility comes from game counts and excludes unknown or empty platforms',()=>{
 const catalogue=[{id:'nes'},{id:'playstation'},{id:'wii'}];
 assert.deepEqual(discoveredPlatformIds(catalogue,{wii:0,nes:3,unknown:50,playstation:2}),['nes','playstation']);
 assert.deepEqual(discoveredPlatformIds(catalogue,{}),[]);
 assert.deepEqual(discoveredPlatformIds(catalogue,{nes:NaN,wii:-1,playstation:1.2}),[]);
});
test('large libraries keep a bounded wrapping window including the selected game',()=>{
 for(const count of [0,1,2,9,20,1000,50000])for(const selected of [0,Math.max(0,count-1)]){
  const indices=gameWindow(selected,count);assert.equal(indices.length,Math.min(count,9));assert.equal(new Set(indices).size,indices.length);assert.ok(indices.every(i=>i>=0&&i<count));if(count)assert.ok(indices.includes(selected));
 }
 assert.deepEqual(gameWindow(0,100),[96,97,98,99,0,1,2,3,4]);
});
