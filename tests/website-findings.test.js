import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/website-findings.js').catch(()=>({}));
const record=()=>({id:'c1',title:'Search',grounding:{supported:true,kind:'user',quote:'Tea must be shown'},start:{url:'https://site.example/',roleId:'guest',stateId:'s1'},steps:[{action:'assert',check:'text',expected:'Tea',basis:'Tea must be shown'}],executions:[{startStateId:'s1',steps:[{id:'step1',action:{action:'assert',check:'text',expected:'Tea',basis:'Tea must be shown'},result:{status:'failed',actual:false}}]}]});

test('invalid rules, automation errors and untested actions cannot become product defects',()=>{
 let c=record();c.grounding.supported=false;assert.equal(api.classifyWebsiteCase(c).status,'needs clarification');
 c=record();c.executions[0].steps[0].result={status:'blocked',reason:'Locator timed out'};assert.equal(api.classifyWebsiteCase(c).status,'blocked');
 c=record();c.executions[0].steps[0]={action:{action:'click'},result:{status:'ok'}};assert.equal(api.classifyWebsiteCase(c).status,'not tested');
});

test('reproduction requires the same start, assertion and basis with a second failure',()=>{
 const c=record();assert.equal(api.classifyWebsiteCase(c).status,'observed failure');
 const replay=structuredClone(c.executions[0]);assert.equal(api.classifyWebsiteCase(c,replay).status,'reproduced finding');
 replay.steps[0].action.expected='Coffee';assert.equal(api.classifyWebsiteCase(c,replay).status,'observed failure');
 replay.steps[0].action.expected='Tea';replay.startStateId='other';assert.equal(api.classifyWebsiteCase(c,replay).status,'observed failure');
 replay.startStateId='s1';replay.steps[0].result.status='passed';assert.equal(api.classifyWebsiteCase(c,replay).status,'observed failure');
});

test('findings deduplicate without combining confidence with severity',()=>{
 const report={findings:[]},c=record();api.recordWebsiteFinding(report,c);api.recordWebsiteFinding(report,{...c,id:'c2'});
 assert.equal(report.findings.length,1);assert.equal(report.findings[0].confidence,'observed');assert.equal(report.findings[0].severity,'unrated');assert.equal(report.findings[0].occurrences,2);
});

test('later occurrences retain established reproduction and its original evidence',()=>{
 const report={findings:[]},c=record(),replay=structuredClone(c.executions[0]);
 api.recordWebsiteFinding(report,c,replay);const evidence=structuredClone(report.findings[0]);
 api.recordWebsiteFinding(report,{...record(),id:'c2'});
 assert.equal(report.findings.length,1);assert.equal(report.findings[0].confidence,'reproduced');
 assert.equal(report.findings[0].status,'reproduced finding');assert.equal(report.findings[0].caseId,'c1');
 assert.deepEqual(report.findings[0].replay,evidence.replay);assert.equal(report.findings[0].occurrences,2);
});

test('accessibility findings keep incomplete checks and omit raw HTML/private details',()=>{
 const report={findings:[],accessibility:[]};
 const scan={violations:[{id:'label',impact:'serious',help:'Label input',helpUrl:'https://dequeuniversity.com/rules/axe/4.13/label',nodes:[{target:['#email'],html:'<input value="private@example.com">',failureSummary:'Add a label'}]}],incomplete:[{id:'color-contrast',nodes:[]}],passes:[{id:'button-name'}]};
 api.recordAccessibility(report,scan,{stateId:'s1',url:'https://site.example/',roleId:'guest'});api.recordAccessibility(report,scan,{stateId:'s2',url:'https://site.example/',roleId:'guest'});
 assert.equal(report.findings.length,1);assert.equal(report.accessibility[0].incomplete.length,1);assert.equal(JSON.stringify(report).includes('private@example.com'),false);assert.equal(JSON.stringify(report).includes('<input'),false);
});

test('replay reports intermittent, changed, blocked and mismatched outcomes without hiding the first failure',()=>{
 const c=record(),report={findings:[]},replay=structuredClone(c.executions[0]);
 replay.steps[0].result.status='passed';api.recordWebsiteFinding(report,c,replay);
 assert.equal(c.status,'observed failure');assert.equal(c.replayStatus,'passed on replay');assert.match(c.reason,/intermittent/i);
 assert.equal(report.findings[0].replay.status,'passed on replay');assert.equal(report.findings[0].actual,false);
 replay.steps[0].result={status:'failed',actual:'Changed failure'};api.recordWebsiteFinding(report,c,replay);assert.equal(c.replayStatus,'changed outcome');
 replay.steps[0].action.expected='Coffee';replay.steps[0].result.status='failed';api.recordWebsiteFinding(report,c,replay);
 assert.equal(c.replayStatus,'changed outcome');
 replay.steps[0].result.status='blocked';api.recordWebsiteFinding(report,c,replay);assert.equal(c.replayStatus,'blocked');
 replay.startStateId='other';api.recordWebsiteFinding(report,c,replay);assert.equal(c.replayStatus,'different starting conditions');
});

test('an uncertain or pending replay cannot establish reproduction even with a matching failed assertion',()=>{
 const c=record(),replay=structuredClone(c.executions[0]);replay.steps.push({action:{action:'click'},status:'uncertain',result:{status:'ok'}});
 assert.equal(api.classifyWebsiteCase(c,replay).status,'observed failure');assert.equal(api.classifyWebsiteCase(c,replay).replayStatus,'blocked');
 replay.steps[1]={action:{action:'click'},result:{status:'pending'}};
 assert.equal(api.classifyWebsiteCase(c,replay).status,'observed failure');
});
