import {launchDesktop,waitForCondition} from './electron-ui.js';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {WebsiteReports} from '../src/website-tester.js';
const supplied=process.argv[2],root=path.resolve('artifacts/build-temp');await mkdir(root,{recursive:true});const profile=await mkdtemp(path.join(root,'website-export-journey-')),store=new WebsiteReports(profile),report=await store.create({url:'https://example.com',request:'<script>injected</script> private@example.com'});report.status='stopped';await store.save(report);
const env={...process.env,TEMP:root,TMP:root,MUSE_DESKTOP_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
let desktop;
try{
 desktop=await launchDesktop(supplied,env);const page=await desktop.firstWindow();await page.waitForFunction(()=>window.muse?.websiteTesterCommand);await waitForCondition(page,async()=>!!(await window.muse.getState()).engineVersion,null,{timeout:40000});
 await page.evaluate(id=>window.muse.websiteTesterCommand('load',{id}),report.id);
 // Stub only the operating-system picker, in the isolated application's main process.
 // The real renderer IPC, report loader, export generation and writes remain in use.
 await desktop.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});assert.equal((await page.evaluate(id=>window.muse.websiteTesterCommand('export',{id,format:'html'}),report.id)).cancelled,true);
 for(const format of ['html','json']){const file=path.join(profile,'export.'+format);await desktop.evaluate(({dialog},file)=>{dialog.showSaveDialog=async(_window,options)=>{if(!options.filters?.length)throw Error('Missing format restriction');return {canceled:false,filePath:file};};},file);
  const result=await page.evaluate(({id,format,path})=>window.muse.websiteTesterCommand('export',{id,format,filePath:path,includeEvidence:false}),{id:report.id,format,path:path.join(profile,'untrusted-output.txt')});assert.equal(result.saved,true);const content=await readFile(file,'utf8');assert.ok(!content.includes('private@example.com'));if(format==='html')assert.ok(!content.includes('<script>'));else assert.equal(JSON.parse(content).kind,'website-test-export');}
 await assert.rejects(stat(path.join(profile,'untrusted-output.txt')),error=>error.code==='ENOENT');await assert.rejects(page.evaluate(id=>window.muse.websiteTesterCommand('export',{id,format:'exe'}),report.id),/format/i);
 console.log(`PASS ${supplied?'packaged':'source'} export journey: cancellation, trusted save destination, HTML/JSON, privacy and invalid format`,profile);
}finally{await desktop?.close();}
