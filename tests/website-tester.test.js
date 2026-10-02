import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
const api=await import('../src/website-tester.js').catch(()=>({}));
const policy=await import('../src/website-policy.js').catch(()=>({}));

test('website commands start independently and never select a solver',()=>{
  assert.deepEqual(api.parseWebsiteTesterCommand('/tester'),{request:''});
  assert.deepEqual(api.parseWebsiteTesterCommand('/tester https://shop.example/search Check search'),{url:'https://shop.example/search',request:'Check search'});
  assert.equal(api.parseWebsiteTesterCommand('Explain /tester'),null);
  assert.throws(()=>api.parseWebsiteTesterCommand('/tester solver BUG-001'),/repair|project-tester/i);
  assert.throws(()=>api.parseWebsiteTesterCommand('/tester file:///secret'),/HTTP/i);
});
test('website scope separates navigation from resources and rejects deceptive paths',()=>{
  const scope=policy.normalizeWebsiteScope({url:'https://shop.example/store',includePaths:['/store'],excludePaths:['/store/admin'],resourceOrigins:['https://cdn.example']});
  assert.equal(policy.allowedNavigation(scope,'https://shop.example/store/one'),true);
  for(const url of ['https://shop.example/storefront','https://shop.example/store/admin/x','https://shop.example/store/%61dmin','https://shop.example/store/%2fadmin','https://evil.example/store','https://cdn.example/store','file:///secret'])assert.equal(policy.allowedNavigation(scope,url),false,url);
  for(const url of ['https://user:pass@shop.example','javascript:alert(1)','file:///secret'])assert.throws(()=>policy.normalizeWebsiteScope({url}),/HTTP|credentials/i);
});
test('website reports have no project or source dependency and recover an interrupted result',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'website-store-')),store=new api.WebsiteReports(root);
  const report=await store.create({url:'https://shop.example',request:'Check search',roleId:'guest'});
  assert.equal(report.kind,'website');assert.equal('project' in report,false);assert.equal('revision' in report,false);
  report.status='running';report.steps.push({status:'pending',action:{action:'click',target:'e1'}});await store.save(report);
  await writeFile(store.filename(report.id),'broken');
  const saved=await store.load(report.id);assert.equal(saved.status,'paused');assert.equal(saved.steps[0].status,'uncertain');
  assert.equal((await store.list()).length,1);
  await assert.rejects(store.load('../outside'),/report/i);
  await assert.rejects(store.evidence(report.id,'../secret.png'),/evidence/i);
  report.project='D:\\private';await assert.rejects(store.save(report),/website|project/i);
});
test('persisted website login is encrypted and isolated by origin and role',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'website-roles-'));
  const crypto={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).map(n=>n^42),decryptString:b=>Buffer.from(b).map(n=>n^42).toString()};
  const store=new api.WebsiteReports(root,{crypto});const scope=policy.normalizeWebsiteScope({url:'https://shop.example',roleId:'customer'});
  const auth={cookies:[{name:'session',value:'secret-cookie'}],origins:[]};await store.saveLogin(scope,auth);
  assert.equal((await readFile(store.loginFilename(scope))).includes(Buffer.from('secret-cookie')),false);
  assert.deepEqual(await store.loadLogin(scope),auth);
  assert.equal(await store.loadLogin({...scope,roleId:'admin'}),undefined);
  const unavailable=new api.WebsiteReports(root,{crypto:{isEncryptionAvailable:()=>false}});
  await assert.rejects(unavailable.saveLogin(scope,auth),/encryption/i);
});
