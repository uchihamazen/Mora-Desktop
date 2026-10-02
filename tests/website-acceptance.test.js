import test from 'node:test';
import assert from 'node:assert/strict';
import * as acceptance from './fixtures/website-tester/acceptance.js';
const step=(id,action,control,extra={})=>({id,control,action:{action,...extra},result:{status:action==='assert'?'passed':'ok'}});
const report=steps=>({steps,cases:[{executions:[{steps}]}],findings:[]});
test('acceptance counts target-scoped text assertions after the relevant action',()=>{
 const r=report([step('a','click','Add Tea'),step('b','assert','Cart count',{check:'text',expected:'Cart items: 1'})]);assert.ok(acceptance.scoreAcceptance(r,false).covered.includes('cart'));
 r.steps[1].result={status:'failed',actual:false};r.findings=[{kind:'functional',confidence:'reproduced',stepId:'b',actual:false}];assert.ok(acceptance.scoreAcceptance(r,true).reproduced.includes('cart'));
});
test('acceptance requires reload for persistence and consecutive inputs plus readiness for timing',()=>{
 const persistence=report([step('a','click','Updates'),step('b','assert','Updates',{check:'checked',expected:true})]);assert.ok(!acceptance.scoreAcceptance(persistence,false).covered.includes('persistence'));
 persistence.steps.splice(1,0,step('reload','reload'));assert.ok(acceptance.scoreAcceptance(persistence,false).covered.includes('persistence'));
 const timing=report([step('b','type','Search',{value:'Coffee'}),step('c','assert','Search results',{check:'textValue',expected:'Coffee'})]);assert.ok(!acceptance.scoreAcceptance(timing,false).covered.includes('search'));
 timing.steps.unshift(step('a','type','Search',{value:'Tea'}));timing.steps.splice(2,0,step('ready','assert','Search status',{check:'textValue',expected:'Search ready'}));assert.ok(acceptance.scoreAcceptance(timing,false).covered.includes('search'));
});
