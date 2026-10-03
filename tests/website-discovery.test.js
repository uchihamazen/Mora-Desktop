import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/website-discovery.js').catch(()=>({}));
const obs=(extra={})=>({id:'o1',url:'https://site.example/cart',roleId:'guest',title:'Shop',visibleText:'Cart empty Updated 2026-10-02T12:00:00Z',controls:[{id:'e1',name:'Add',tag:'button',type:'button'}],regions:[],unsupported:[],...extra});

test('discovery ignores clocks but preserves cart state, dialogs and roles',()=>{
 const map=api.createDiscovery();const first=api.observeState(map,obs());
 assert.equal(api.observeState(map,obs({id:'o2',visibleText:'Cart empty Updated 2026-10-02T12:01:35Z'})).stateId,first.stateId);
 const populated=api.observeState(map,obs({visibleText:'Cart 2 items Total 50'}));assert.notEqual(populated.stateId,first.stateId);
 assert.notEqual(api.observeState(map,obs({dialogs:['Confirm removal']})).stateId,first.stateId);
 assert.notEqual(api.observeState(map,obs({roleId:'staff'})).stateId,first.stateId);
 assert.equal(map.states.length,4);
});

test('relationships stay hypothetical until an evidenced transition and repeated cycles stop',()=>{
 const map=api.createDiscovery(),before=obs({regions:[{name:'Cart summary',text:'Empty'}]});const a=api.observeState(map,before);
 assert.equal(map.relations[0].status,'hypothesis');
 const after=obs({id:'o2',visibleText:'Cart 1 item',regions:[{name:'Cart summary',text:'1 item'}]});const b=api.observeState(map,after);
 const control=api.controlKey(before.controls[0]);
 api.recordTransition(map,a.stateId,{action:'click',targetKey:control,stepId:'s1'},b.stateId);
 assert.equal(map.transitions[0].stepId,'s1');assert.ok(map.relations.some(r=>r.status==='observed'));
 for(let i=0;i<4;i++)api.recordTransition(map,b.stateId,{action:'click',targetKey:control,stepId:'s'+(i+2)},b.stateId);
 assert.equal(api.nextDiscovery(map,{navigationOrigins:['https://site.example'],includePaths:[],excludePaths:[]},b.stateId).item,undefined);
});

test('frontier preserves out-of-scope and unsupported gaps, and bounds pagination',()=>{
 const map=api.createDiscovery({maxStates:4,maxVisitsPerPath:2});
 const page=n=>obs({url:'https://site.example/list?page='+n,controls:[{id:'e1',name:'Next',tag:'a',href:'https://site.example/list?page='+(n+1)}],unsupported:['Canvas chart']});
 const one=api.observeState(map,page(1));api.observeState(map,page(2));api.observeState(map,page(3));
 const scope={navigationOrigins:['https://site.example'],includePaths:['/cart'],excludePaths:[]};
 assert.equal(api.nextDiscovery(map,scope,one.stateId).item,undefined);
 assert.ok(map.gaps.some(g=>/pagination|page limit/i.test(g)));assert.ok(map.gaps.includes('Canvas chart'));
});

test('control identities survive new observation references and values but distinguish frames',()=>{
 const a={id:'e1',name:'Search',tag:'input',type:'search',value:'old',frameUrl:'https://site.example/'};
 assert.equal(api.controlKey(a),api.controlKey({...a,id:'e9',value:'new'}));
 assert.notEqual(api.controlKey(a),api.controlKey({...a,frameUrl:'https://site.example/frame'}));
});

test('page discovery stays on the chosen path and includes native toggles',()=>{
 const scope={entryUrl:'https://site.example/cart',navigationOrigins:['https://site.example'],includePaths:[],excludePaths:[]},map=api.createDiscovery();
 const initial=api.observeState(map,obs({controls:[{id:'e1',name:'Settings',tag:'a',href:'https://site.example/settings'},{id:'e2',name:'Updates',tag:'input',type:'checkbox'}]}));
 assert.equal(api.nextDiscovery(map,scope,initial.stateId,{pageOnly:true}).item?.name,'Updates');
});
test('revealed discovery selects only new controls in the current evidenced transition',()=>{
 const map=api.createDiscovery(),scope={entryUrl:'https://site.example/cart',navigationOrigins:['https://site.example'],includePaths:[],excludePaths:[]},initial=obs();
 const before=api.observeState(map,initial),after=api.observeState(map,obs({controls:[...initial.controls,{id:'e2',name:'Details',tag:'a',href:'https://site.example/details'}]}));
 api.recordTransition(map,before.stateId,{action:'click',targetKey:api.controlKey(initial.controls[0])},after.stateId);
 assert.equal(api.nextDiscovery(map,scope,after.stateId,{revealedOnly:true}).item?.name,'Details');
 assert.equal(api.nextDiscovery(map,scope,before.stateId,{revealedOnly:true}).item,undefined);
});
test('revisiting an existing transition uses its latest traversal to identify revealed controls',()=>{
 const map=api.createDiscovery(),scope={entryUrl:'https://site.example/cart',navigationOrigins:['https://site.example'],includePaths:[],excludePaths:[]},details={id:'e2',name:'Details',tag:'a',href:'https://site.example/details'};
 const a=api.observeState(map,obs()),b=api.observeState(map,obs({controls:[...obs().controls,details]})),c=api.observeState(map,obs({visibleText:'Other state',controls:[...obs().controls,details]}));
 api.recordTransition(map,a.stateId,{action:'click',targetKey:'reveal'},b.stateId);api.recordTransition(map,c.stateId,{action:'click',targetKey:'return'},b.stateId);api.recordTransition(map,a.stateId,{action:'click',targetKey:'reveal'},b.stateId);
 assert.equal(api.nextDiscovery(map,scope,b.stateId,{revealedOnly:true}).item?.name,'Details');assert.equal(map.transitions.length,2);
});
