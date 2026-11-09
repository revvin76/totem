import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionRoots,offsetSelection} from '../light-study/layout-selection.js';
test('selected descendants travel with their parent without being offset twice',()=>{
  assert.deepEqual(selectionRoots(['details','description','title'],[
    {id:'details',ancestors:[]},{id:'description',ancestors:['details']},{id:'title',ancestors:[]},
  ]),['details','title']);
});
test('shared styles are moved once and missing selections are ignored',()=>{
  assert.deepEqual(selectionRoots(['inactive','missing'],[{id:'inactive',ancestors:['rail']},{id:'inactive',ancestors:['rail']}]),['inactive']);
});
test('group dragging preserves relative positions and unrelated styles',()=>{
  const elements={title:{x:10,y:20,fontSize:30},year:{x:-4,y:8},other:{x:2,y:3}};
  const origins={title:{x:10,y:20},year:{x:-4,y:8}};
  offsetSelection(elements,origins,5,-2);offsetSelection(elements,origins,8,-4);
  assert.deepEqual(elements,{title:{x:18,y:16,fontSize:30},year:{x:4,y:4},other:{x:2,y:3}});
  assert.deepEqual(origins,{title:{x:10,y:20},year:{x:-4,y:8}});
});
test('newly selected elements start at a neutral offset',()=>{
  const elements={};offsetSelection(elements,{title:{x:0,y:0}},-1,10);assert.deepEqual(elements,{title:{x:-1,y:10}});
});
test('SideNav button styles keep their horizontal position when a group moves',()=>{
  const elements={button:{x:3},title:{x:5}};
  offsetSelection(elements,{button:{x:3,y:0,lockX:true},title:{x:5,y:0}},5,1);
  assert.deepEqual(elements,{button:{x:3,y:1},title:{x:10,y:1}});
});
