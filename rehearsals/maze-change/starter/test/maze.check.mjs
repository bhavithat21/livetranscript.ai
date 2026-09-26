import {test} from 'node:test';import assert from 'node:assert/strict';import {findRoute} from '../src/maze.js';
test('finds a shortest cardinal route',()=>assert.equal(findRoute([[0,0],[0,0]],[0,0],[1,1]).length,3));
test('reports an unreachable goal',()=>assert.equal(findRoute([[0,1],[1,0]],[0,0],[1,1]),null));
test('blocked start is not a route',()=>assert.equal(findRoute([[1,0]],[0,0],[0,1]),null));
