import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWebsiteScope} from '../src/website-policy.js';
const api=await import('../src/website-teaching.js').catch(()=>({}));
const scope=normalizeWebsiteScope({url:'https://example.com'});
const event=(extra={})=>({action:'type',url:'https://example.com/',control:{tag:'input',type:'search',name:'Search',frameUrl:'https://example.com/'},value:'Tea',...extra});
test('teaching accepts bounded rendered controls, never secrets or external actions',()=>{
 assert.equal(api.sanitizeTeachingEvent(event(),scope).value,'Tea');
 assert.throws(()=>api.sanitizeTeachingEvent(event({value:'private@example.com'}),scope),/private/i);
 assert.throws(()=>api.sanitizeTeachingEvent(event({control:{tag:'input',type:'password',name:'Password',sensitive:true},value:'abc'}),scope),/private/i);
 assert.throws(()=>api.sanitizeTeachingEvent(event({url:'https://elsewhere.example'}),scope),/scope/i);
 assert.throws(()=>api.sanitizeTeachingEvent(event({action:'evaluate'}),scope),/action/i);
 assert.throws(()=>api.sanitizeTeachingEvent(event({control:{tag:'input',name:'Search',role:'a'.repeat(2000)}}),scope),/control/i);
});
test('recorded typing coalesces, workflow limits remain explicit, and no recording becomes approval',()=>{
 const teaching={steps:[]};api.appendTeachingStep(teaching,api.sanitizeTeachingEvent(event({value:'T'}),scope));api.appendTeachingStep(teaching,api.sanitizeTeachingEvent(event(),scope));assert.equal(teaching.steps.length,1);assert.equal(teaching.steps[0].value,'Tea');assert.equal(teaching.approved,undefined);
 for(let i=0;i<10;i++)api.appendTeachingStep(teaching,api.sanitizeTeachingEvent(event({action:'click',control:{tag:'button',name:'Next '+i},value:''}),scope));assert.ok(teaching.steps.length<=8);assert.equal(teaching.truncated,true);
});
test('teaching requires an explicit outcome and never invents one from clicks',()=>{
 assert.throws(()=>api.teachingObjective({steps:[{action:'click',targetLabel:'Save'}]},''),/expected/i);
 const request=api.teachingObjective({steps:[{action:'click',targetLabel:'Save'}]},'Saving shows Ready');assert.match(request,/Saving shows Ready/);assert.match(request,/demonstration/i);assert.match(request,/Save/);
});
