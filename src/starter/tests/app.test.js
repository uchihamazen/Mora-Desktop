import test from 'node:test';
import assert from 'node:assert/strict';
import {nextCount} from '../src/app.js';
test('the counter advances by one',()=>{assert.equal(nextCount(0),1);assert.equal(nextCount(4),5);});
test('invalid counts are rejected',()=>{assert.throws(()=>nextCount(-1));assert.throws(()=>nextCount('one'));});
