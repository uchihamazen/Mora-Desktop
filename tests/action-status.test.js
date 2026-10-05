import test from 'node:test';
import assert from 'node:assert/strict';
import {idleReason,moraToggleReason,taskPhase} from '../src/action-status.js';
import {assertIdle} from '../src/state.js';
test('disabled mode controls explain every backend work blocker',()=>{
  const ready={projectPath:'project',connection:'ready'};
  for(const state of [{busy:true},{loading:true},{testerActive:true},{websiteActive:true},{projectOperation:true},{projectRepair:true},{pendingQueue:[{}]},{activeRequest:{}},{moraMode:{tasks:[{status:'running'}]}}])assert.ok(moraToggleReason({...ready,...state}));
  assert.equal(moraToggleReason({...ready,projectWork:{run:{status:'ready'}}}),'');
  assert.equal(moraToggleReason(ready),'');
});
test('shared idle explanations match thrown guards',()=>{
  for(const state of [{busy:true},{loading:true},{websiteActive:true},{moraMode:{replying:true}}])assert.throws(()=>assertIdle(state),{message:idleReason(state)});
});
test('task phases distinguish checking, blocked, analysis and applied changes',()=>{
  assert.equal(taskPhase({status:'running',detail:'Reviewing changes'}),'Checking');
  assert.equal(taskPhase({status:'running',detail:'Coding'}),'Working');
  assert.equal(taskPhase({status:'success',result:{files:[]}}),'Completed');
  assert.equal(taskPhase({status:'success',result:{files:['a']}}),'Applied');
  assert.equal(taskPhase({status:'error'}),'Blocked');
});
test('an idle enabled Mora Mode can be turned off while offline',()=>{assert.equal(moraToggleReason({projectPath:'project',connection:'disconnected',moraMode:{enabled:true,tasks:[]}}),'');assert.match(moraToggleReason({projectPath:'project',connection:'disconnected',moraMode:{enabled:false}}),/Connect/);});
