// Keep OUTSIDE the candidate workspace until the interviewer has stated phase 2.
import {test} from 'node:test';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import path from 'node:path';
if(!process.env.REHEARSAL_TARGET)throw new Error('Set REHEARSAL_TARGET to the candidate starter directory');
const {findRoute}=await import(pathToFileURL(path.resolve(process.env.REHEARSAL_TARGET,'src/maze.js')).href);
test('diagonal moves shorten an empty grid after the rule changes',()=>assert.equal(findRoute([[0,0],[0,0]],[0,0],[1,1],{diagonal:true}).length,2));
test('diagonals may not cut a blocked corner',()=>assert.equal(findRoute([[0,1],[1,0]],[0,0],[1,1],{diagonal:true}),null));
test('explicit retraction restores cardinal behavior',()=>assert.equal(findRoute([[0,0],[0,0]],[0,0],[1,1],{diagonal:false}).length,3));
test('goal blocked',()=>assert.equal(findRoute([[0,0],[0,1]],[0,0],[1,1],{diagonal:true}),null));
