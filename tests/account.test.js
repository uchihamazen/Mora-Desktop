import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {accountState,verificationURL,AccountLogin} from '../src/account.js';

test('account projection distinguishes credential lanes and never forwards secret fields',()=>{
  assert.equal(accountState({state:'accountLogin',credentialRequired:true,token:'private'}).status,'signedIn');
  assert.equal(accountState({state:'loggedOut',credentialRequired:true}).status,'required');
  assert.equal(accountState({state:'loggedOut',credentialRequired:false}).status,'ready');
  assert.equal(accountState({state:'envKey',credentialRequired:true}).status,'apiKey');
  assert.equal(accountState({state:'new-unknown',credentialRequired:true}).status,'unknown');
  assert.equal(JSON.stringify(accountState({state:'accountLogin',credentialRequired:true,token:'private'})).includes('private'),false);
});
test('browser sign-in accepts only native HTTPS Meta verification links',()=>{
  assert.equal(verificationURL('https://auth.meta.com/device').hostname,'auth.meta.com');
  for(const value of ['http://auth.meta.com','https://auth.meta.com.evil.test','https://a:b@auth.meta.com','javascript:alert(1)','https://auth.meta.com:8080'])assert.throws(()=>verificationURL(value));
});
test('native login opens browser once, clears ephemeral code and closes its host on completion',async()=>{
  const client=new EventEmitter();let closes=0,opens=0,last;
  client.connect=async()=>{};client.close=async()=>{closes++;};
  client.request=async()=>({verificationUrl:'https://auth.meta.com/device',userCode:'DEMO-CODE'});
  const login=new AccountLogin(value=>{last=value;},{clientFactory:()=>client,openExternal:async()=>{opens++;}});
  await login.start({executable:'fixture',workspace:'fixture'});
  assert.equal(last.status,'pending');assert.equal(last.userCode,'DEMO-CODE');assert.equal(opens,1);
  client.emit('notification','account/loginCompleted',{outcome:'granted'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(last.status,'signedIn');assert.equal(last.userCode,undefined);assert.equal(closes,1);
});
test('denied, expired and cancelled flows clear code without changing real stored credentials',async()=>{
  for(const outcome of ['denied','expired','cancelled','failed']){
    const client=new EventEmitter();let last;
    client.connect=async()=>{};client.close=async()=>{};client.request=async()=>({verificationUrl:'https://auth.meta.com/device',userCode:'DEMO'});
    const login=new AccountLogin(value=>{last=value;},{clientFactory:()=>client,openExternal:async()=>{}});
    await login.start({});client.emit('notification','account/loginCompleted',{outcome,message:'token=private'});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(last.status,'required');assert.equal(last.userCode,undefined);assert.equal(JSON.stringify(last).includes('private'),false);
  }
});
test('cancelling while the host connects prevents a stale browser sign-in opening',async()=>{
  const client=new EventEmitter();let release,opens=0;
  client.connect=()=>new Promise(resolve=>{release=resolve;});client.close=async()=>{};client.request=async()=>({verificationUrl:'https://auth.meta.com/device',userCode:'DEMO'});
  const login=new AccountLogin(()=>{},{clientFactory:()=>client,openExternal:async()=>{opens++;}});
  const started=login.start({});await login.cancel();release();await started;assert.equal(opens,0);
});
