import test from 'node:test';
import assert from 'node:assert/strict';
import {controlKey} from '../src/website-discovery.js';
import {normalizeWebsiteScope} from '../src/website-policy.js';
const api=await import('../src/website-cases.js').catch(()=>({}));
const observation={id:'o',url:'https://site.example/',roleId:'guest',visibleText:'Search returns matching results.',controls:[{id:'e1',tag:'input',type:'search',name:'Search',value:'',constraints:{}},{id:'e2',tag:'button',name:'Submit'}]};
const context={observation,scope:normalizeWebsiteScope({url:observation.url}),request:'Search for tea must show Tea.',stateId:'state'};
const candidate=()=>({title:'Search for tea',feature:'Search',family:'normal',basisSource:'user',basisQuote:context.request,precondition:'Search',steps:[{action:'type',target:'Search',value:'tea'},{action:'assert',check:'text',expected:'Tea',basis:context.request}],reset:[]});

test('cases require grounded expectations and an actual assertion, not clicks',()=>{
 const valid=api.validateWebsiteCase(candidate(),context);assert.equal(valid.status,'queued');assert.equal(valid.steps[0].target,controlKey(observation.controls[0]));
 assert.equal(api.validateWebsiteCase({...candidate(),steps:[{action:'click',target:'Submit'}]},context).status,'needs clarification');
 assert.equal(api.validateWebsiteCase({...candidate(),basisQuote:'Search must always show 20 items.'},context).status,'needs clarification');
 assert.equal(api.validateWebsiteCase({...candidate(),steps:[{action:'assert',target:'Search',check:'visible',expected:'false',basis:context.request}]},context).status,'needs clarification');
});

test('case validation rejects oversized sequences, secrets and out-of-scope navigation',()=>{
 assert.equal(api.validateWebsiteCase({...candidate(),steps:Array(10).fill({action:'click',target:'Submit'})},context).status,'needs clarification');
 assert.equal(api.validateWebsiteCase({...candidate(),steps:[{action:'navigate',value:'https://other.example/'},candidate().steps[1]]},context).status,'needs clarification');
 const privateObservation={...observation,controls:[{id:'e1',name:'Password',tag:'input',sensitive:true}]};
 assert.equal(api.validateWebsiteCase({...candidate(),steps:[{action:'type',target:'Password',value:'secret'},candidate().steps[1]]},{...context,observation:privateObservation}).status,'needs clarification');
});

test('normal cases cover different features before deep variations and duplicate plans do not grow',()=>{
 const cases=[{id:'a',featureId:'search',family:'boundary',status:'queued'},{id:'b',featureId:'cart',family:'normal',status:'queued'},{id:'c',featureId:'search',family:'normal',status:'queued'}];
 assert.equal(api.nextWebsiteCase(cases).id,'b');cases[1].status='passed';assert.equal(api.nextWebsiteCase(cases).id,'c');
 const report={cases:[]};api.addWebsiteCases(report,[candidate(),candidate()],context);assert.equal(report.cases.length,1);
});

test('interrupted cases can be planned again without losing their history',()=>{
 const report={cases:[]};api.addWebsiteCases(report,[candidate()],context);report.cases[0].status='not tested';
 assert.equal(api.addWebsiteCases(report,[candidate()],context),1);assert.equal(report.cases.length,2);assert.equal(report.cases[0].status,'not tested');
 assert.equal(api.addWebsiteCases(report,[candidate()],context),0);
});

test('exposed constraints generate finite boundary cases and do not invent business limits',()=>{
 const control={id:'e1',name:'Quantity',tag:'input',type:'number',value:'1',constraints:{required:true,min:'1',max:'5',step:'1'}};
 const cases=api.constraintCases({...context,observation:{...observation,controls:[control]}});
 assert.ok(cases.some(c=>c.steps[0].value==='0'));assert.ok(cases.some(c=>c.steps[0].value==='1'));assert.ok(cases.some(c=>c.steps[0].value==='6'));
 assert.ok(cases.every(c=>c.grounding.kind==='constraint'&&c.steps.some(s=>s.check==='validity')));
 assert.deepEqual(api.constraintCases(context),[]);
});

test('sequence targets resolve against fresh observations and ambiguous controls block',()=>{
 const planned=api.validateWebsiteCase(candidate(),context).steps[0];
 assert.equal(api.resolveWebsiteStep(planned,{...observation,id:'fresh',controls:[{...observation.controls[0],id:'e9'}]}).target,'e9');
 assert.throws(()=>api.resolveWebsiteStep(planned,{...observation,controls:[observation.controls[0],{...observation.controls[0],id:'e3'}]}),/ambiguous/i);
 assert.throws(()=>api.resolveWebsiteStep({...planned,guard:'Cart'},observation),/precondition/i);
});

test('numeric constraint cases use HTML value step base and invalid step defaults',()=>{
 const generated=constraints=>api.constraintCases({...context,observation:{...observation,controls:[{id:'e1',name:'Quantity',tag:'input',type:'number',constraints}]}});
 for(const step of ['2','0','-2','invalid']){
  const cases=generated({min:'',max:'5',step,valueAttribute:'1'});
  assert.equal(cases.find(c=>c.steps[0].value==='5').steps[1].expected,true,step);
 }
 const cases=generated({min:'2',max:'5',step:'2',valueAttribute:'1'});
 assert.equal(cases.find(c=>c.steps[0].value==='5').steps[1].expected,false);
 assert.equal(generated({min:'invalid',max:'invalid',step:'2',valueAttribute:'1'}).length,0);
});

test('controls excluded by browser validation do not generate constraint failures',()=>{
 const observation={...context.observation,controls:[{id:'e1',name:'Read only quantity',tag:'input',type:'number',constraints:{required:true,min:'1',max:'5',willValidate:false}}]};
 assert.deepEqual(api.constraintCases({...context,observation}),[]);
});
