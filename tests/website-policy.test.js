import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/website-policy.js').catch(()=>({}));
test('live interactions require scoped grants and page labels cannot grant consent',()=>{
 const observation={id:'obs1',url:'https://shop.example/',controls:[{id:'e1',name:'Delete account',tag:'a',href:'https://shop.example/delete',type:'',sensitive:false}]};
 const scope=api.normalizeWebsiteScope({url:observation.url});
 const step={action:'click',target:'e1',observationId:'obs1'};
 assert.equal(api.authorizeStep(step,observation,{scope,version:1,grants:[]}).decision,'pending');
 assert.equal(api.authorizeStep({...step,action:'evaluate'},observation,{scope,version:1,grants:[]}).decision,'deny');
 assert.equal(api.authorizeStep({...step,observationId:'old'},observation,{scope,version:1,grants:[]}).decision,'deny');
 const fingerprint=api.stepFingerprint(step,observation,1);
 assert.equal(api.authorizeStep(step,observation,{scope,version:1,grants:[fingerprint]}).decision,'allow');
 assert.equal(api.authorizeStep(step,observation,{scope,version:2,grants:[fingerprint]}).decision,'pending');
});
test('checks are typed, read-only and grounded before evaluating',()=>{
 const observation={id:'o',url:'https://site.example/',controls:[]},p={scope:api.normalizeWebsiteScope({url:observation.url}),version:1,grants:[]};
 assert.equal(api.authorizeStep({action:'assert',observationId:'o',check:'visible',expected:'',basis:'user'},observation,p).decision,'deny');
 assert.equal(api.authorizeStep({action:'assert',observationId:'o',check:'text',expected:'Hello',basis:''},observation,p).decision,'deny');
 assert.equal(api.authorizeStep({action:'assert',observationId:'o',check:'text',expected:'Hello',basis:'User asked for Hello'},observation,p).decision,'allow');
});
test('redaction removes secrets, contact details and private control values',()=>{
 const clean=api.redactObservation({id:'o',url:'https://site.example/?token=abc&search=one',visibleText:'Contact me@example.com +201001234567 Bearer abcdef123456',controls:[{id:'e1',name:'Password',type:'password',value:'hide-me',sensitive:true},{id:'e2',name:'Email',type:'email',value:'me@example.com',sensitive:true}]});
 const text=JSON.stringify(clean);for(const value of ['hide-me','me@example.com','201001234567','abcdef123456','token=abc'])assert.equal(text.includes(value),false,value);
 assert.match(text,/redacted/i);
});
test('redaction preserves typed numeric checks and rejects secrets in starting URLs',()=>{
 assert.deepEqual(api.redactValue({expected:1234567890,value:'me@example.com'}),{expected:1234567890,value:'[redacted email]'});
 assert.throws(()=>api.normalizeWebsiteScope({url:'https://site.example/?access_token=private'}),/sign.in|secret|token/i);
});

test('private dropdown options are omitted and ordinary options are redacted',()=>{
 const clean=api.redactObservation({id:'12345678-1234-4321-9876-abcdefabcdef',controls:[{id:'e1',sensitive:true,options:[{label:'Private account',value:'private-account-id'}]},{id:'e2',options:[{label:'me@example.com',value:'https://site.example/?token=private'}]}]});
 assert.equal(clean.id,'12345678-1234-4321-9876-abcdefabcdef');
 assert.equal(clean.controls[0].options,undefined);
 assert.equal(JSON.stringify(clean).includes('private-account'),false);
 assert.equal(JSON.stringify(clean).includes('me@example.com'),false);
 assert.equal(JSON.stringify(clean).includes('token=private'),false);
});

test('visibility checks require a real observed target even when checking absence',()=>{
 const observation={id:'o',url:'https://site.example/',controls:[]},policy={scope:api.normalizeWebsiteScope({url:observation.url}),version:1,grants:[]};
 for(const expected of [true,false])assert.equal(api.authorizeStep({action:'assert',observationId:'o',target:'e9999',check:'visible',expected,basis:'User expectation'},observation,policy).decision,'deny');
});
