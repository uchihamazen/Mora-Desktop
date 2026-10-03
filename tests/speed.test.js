import test from 'node:test';
import assert from 'node:assert/strict';
import * as speed from '../src/speed.js';
const {effortForPreset}=speed;
test('fresh profiles use Balanced while existing effort choices remain explicit',()=>{
 assert.equal(typeof speed.initialEffort,'function');
 assert.deepEqual(speed.initialEffort({}),{reasoningEffort:'medium',speedPreset:'balanced'});
 assert.deepEqual(speed.initialEffort({reasoningEffort:'max'}),{reasoningEffort:'max',speedPreset:'custom'});
 assert.deepEqual(speed.initialEffort({reasoningEffort:'low',speedPreset:'quick'}),{reasoningEffort:'low',speedPreset:'quick'});
});
test('speed presets always choose an effort supported by the selected model',()=>{
  const model={variants:['minimal','low','medium','high','xhigh']};
  assert.equal(effortForPreset(model,'quick'),'low');
  assert.equal(effortForPreset(model,'balanced'),'medium');
  assert.equal(effortForPreset(model,'thorough'),'xhigh');
  assert.equal(effortForPreset({variants:['high']},'quick'),'high');
  assert.throws(()=>effortForPreset({variants:[]},'balanced'),/supported effort/);
});
