import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {WebsiteBrowser} from '../src/website-browser.js';
import {normalizeWebsiteScope,stepFingerprint} from '../src/website-policy.js';
import {createDiscovery,observeState,recordTransition} from '../src/website-discovery.js';
import {constraintCases} from '../src/website-cases.js';
import {startWebsiteFixture} from '../tests/fixtures/website-tester/site.js';
const root=path.resolve('artifacts/build-temp');await mkdir(root,{recursive:true});
for(const faulty of [false,true]) {
 const fixture=await startWebsiteFixture({faulty}),browser=new WebsiteBrowser({directory:await mkdtemp(path.join(root,'website-map-')),headless:true,executablePath:process.argv[2]});
 try {
  await browser.open(normalizeWebsiteScope({url:fixture.url}));browser.manual=false;const map=createDiscovery();
  let observation=await browser.observe();const first=observeState(map,observation);const quantity=observation.controls.find(c=>c.name==='Quantity');assert.equal(quantity.constraints.max,'5');assert.ok(quantity.key);
  const step={action:'click',observationId:observation.id,target:observation.controls.find(c=>c.name==='Details').id};browser.grant(stepFingerprint(step,browser.observation,browser.policy.version));assert.equal((await browser.perform(step)).status,'ok');
  observation=await browser.observe();const modal=observeState(map,observation);assert.notEqual(first.stateId,modal.stateId);assert.deepEqual(observation.dialogs,['Details']);recordTransition(map,first.stateId,{...step,targetKey:observation.controls.find(c=>c.name==='Details').key,stepId:'dialog-open'},modal.stateId);
  const before=browser.page;const scan=await browser.accessibility();assert.equal(browser.page,before,'axe aggregation must not change the active website page');assert.equal(scan.status,'completed');assert.ok(Array.isArray(scan.incomplete));
  await browser.page.getByRole('button',{name:'Cancel',exact:true}).click();const documentScan=await browser.accessibility();
  assert.equal(documentScan.violations.some(v=>v.id==='label'),faulty,'seeded missing label must be detected only on faulty fixture');
  assert.ok(map.relations.some(r=>r.status==='observed'));assert.equal(JSON.stringify(documentScan).includes('html":"<'),false,'raw axe HTML must not be retained');
  await browser.page.setContent('<label>Odd quantity<input type="number" value="1" step="2" max="5"></label>');
  const numeric=await browser.observe(),cases=constraintCases({observation:numeric,scope:browser.scope,request:'Check odd quantity'});
  assert.equal(numeric.controls[0].constraints.valueAttribute,'1');
  for(const record of cases){await browser.page.getByLabel('Odd quantity').fill(record.steps[0].value);assert.equal(await browser.page.getByLabel('Odd quantity').evaluate(e=>e.validity.valid),record.steps[1].expected);}
  await browser.page.getByLabel('Odd quantity').evaluate(e=>{e.readOnly=true;e.required=true;});
  assert.equal(constraintCases({observation:await browser.observe(),scope:browser.scope,request:'Check odd quantity'}).length,0);
  console.log(`PASS ${faulty?'faulty':'healthy'} browser map and axe: distinct dialog state, evidenced transition, active page preserved, label oracle correct`);
 }finally{await browser.close();await fixture.close();}
}
