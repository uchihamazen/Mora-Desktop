import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/desktop-workspace.js').catch(()=>({}));

test('window restore keeps normal bounds and maximize state on connected displays',()=>{
 const displays=[{x:0,y:0,width:1920,height:1040},{x:-1280,y:0,width:1280,height:984}];
 assert.deepEqual(api.restoreWindowBounds({x:-1200,y:80,width:1000,height:750,maximized:true},displays),{x:-1200,y:80,width:1000,height:750,maximized:true});
 const recovered=api.restoreWindowBounds({x:5000,y:9000,width:3000,height:2000},displays);
 assert.equal(recovered.x,0);assert.equal(recovered.y,0);assert.equal(recovered.width,1920);assert.equal(recovered.height,1040);
 const malformed=api.restoreWindowBounds({x:NaN,width:'huge'},[{x:0,y:0,width:800,height:600}]);
 assert.equal(malformed.width,800);assert.equal(malformed.height,600);assert.equal(malformed.maximized,false);
});

test('completion sounds play once for finished work in foreground or background; unread stays independent',()=>{
 const sent=[],saved=[];let foreground=false;
 const notices=new api.CompletionSignals({foreground:()=>foreground,playSound:()=>sent.push(true),save:()=>saved.push(true)});
 const chat={sessionId:'a',title:'Chat'},state={sessionId:'a',sessions:[chat]};
 notices.complete(state,{turnId:'one',status:'finished'});notices.complete(state,{turnId:'one',status:'finished'});
 assert.equal(sent.length,1);assert.equal(chat.unread,true);assert.equal(saved.length,1);
 foreground=true;chat.unread=false;notices.complete(state,{turnId:'two',status:'finished'});assert.equal(sent.length,2);assert.equal(chat.unread,false);
 foreground=false;notices.enabled=false;notices.complete(state,{turnId:'three',status:'finished'});assert.equal(sent.length,2);assert.equal(chat.unread,true);
 notices.enabled=true;chat.unread=false;notices.complete(state,{turnId:'four',status:'interrupted'});assert.equal(sent.length,2);assert.equal(chat.unread,false);
 for(const status of ['failed','attention']){chat.unread=false;notices.complete(state,{turnId:status,status});assert.equal(sent.length,2);assert.equal(chat.unread,true);}
});

test('report notices cover repeated runs, exact permission requests and repair outcomes once per run',()=>{
 const sent=[],state={sessionId:'a',sessions:[{sessionId:'a'}]};const notices=new api.CompletionSignals({foreground:()=>false,playSound:()=>sent.push(true),save:()=>{}});
 notices.report(state,'Tester',{id:'report',status:'completed'});assert.equal(sent.length,0,'Reopening history is quiet');
 for(let i=0;i<2;i++){notices.report(state,'Tester',{id:'report',status:'running'});notices.report(state,'Tester',{id:'report',status:'completed'});notices.report(state,'Tester',{id:'report',status:'completed'});}
 assert.equal(sent.length,2);
 notices.report(state,'Tester',{id:'report',status:'solving'});notices.report(state,'Tester',{id:'report',status:'completed',solver:{status:'unverified'}});assert.equal(sent.length,2,'Unverified repairs stay quiet');
 notices.report(state,'Website tester',{id:'website',status:'running'});notices.report(state,'Website tester',{id:'website',status:'awaiting permission',pending:{id:'request'}});notices.report(state,'Website tester',{id:'website',status:'awaiting permission',pending:{id:'request'}});assert.equal(sent.length,2,'Permissions do not play completion sounds');
 notices.report(state,'Tester',{id:'report',status:'solving'});notices.report(state,'Tester',{id:'report',status:'completed',solver:{status:'verified'}});assert.equal(sent.length,3);
});

test('project tester completion sound waits for cleanup and final source revision',async()=>{
 const {TesterRun}=await import('../src/tester-run.js');
 for(const changed of [false,true]){
  let revision='before',sounds=0,intermediate=false;
  const state={sessionId:'a',sessions:[{sessionId:'a'}]},signals=new api.CompletionSignals({foreground:()=>false,playSound:()=>sounds++,save:()=>{}});
  const report={id:'report',project:'/project',url:'http://localhost:1234',revision:'before',cases:[],issues:[],actions:0};
  const run=new TesterRun({store:{directory:'/reports',save:async()=>{}},revision:async()=>revision,
   makeModel:()=>({initialize:async()=>{},decide:async()=>({action:'finish'}),close:async()=>{if(changed)revision='after';}}),
   makeBrowser:()=>({open:async()=>{},snapshot:async()=>({}),close:async()=>{}}),
   onChange:value=>{if(value.status==='completed'&&run.active){intermediate=true;assert.equal(sounds,0);}}});
  signals.report(state,'Project tester',{...report,status:'running'});
  await run.start(report).then(()=>signals.report(state,'Project tester',report));
  assert.equal(intermediate,true);assert.equal(report.status,changed?'stale':'completed');assert.equal(sounds,changed?0:1);
 }
});
