import test from 'node:test';
import assert from 'node:assert/strict';
import {effortForPreset} from '../src/speed.js';
test('speed presets always choose an effort supported by the selected model',()=>{
  const model={variants:['minimal','low','medium','high','xhigh']};
  assert.equal(effortForPreset(model,'quick'),'low');
  assert.equal(effortForPreset(model,'balanced'),'medium');
  assert.equal(effortForPreset(model,'thorough'),'xhigh');
  assert.equal(effortForPreset({variants:['high']},'quick'),'high');
  assert.throws(()=>effortForPreset({variants:[]},'balanced'),/supported effort/);
});
