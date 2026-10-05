import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MoraWorkspace} from '../src/mora-workspace.js';

async function fixture(scripts={}){
 const profile=await mkdtemp(path.join(tmpdir(),'mora-native-checks-')),project=path.join(profile,'project');await mkdir(project);
 const files={'package.json':JSON.stringify({type:'module',scripts}),'value.js':'export const value=1;','checks/typecheck.js':"import {value} from '../value.js';if(typeof value!=='number')process.exit(1);",'checks/build.js':"import {mkdirSync,writeFileSync} from 'node:fs';import {value} from '../value.js';if(value<0)process.exit(1);mkdirSync('dist',{recursive:true});writeFileSync('dist/result.txt',String(value));"};
 for(const [name,data] of Object.entries(files)){await mkdir(path.dirname(path.join(project,name)),{recursive:true});await writeFile(path.join(project,name),data);}
 const workspace=new MoraWorkspace(profile,project,{projectCommands:true}),job=await workspace.prepare('worker','run',{title:'Improve',files:['value.js','package.json','checks/typecheck.js']});return {workspace,job,project};
}
test('worker verification uses established typecheck and build commands on disposable copies',async()=>{
 const {workspace,job,project}=await fixture({typecheck:'node checks/typecheck.js',build:'node checks/build.js'});await writeFile(path.join(job.root,'value.js'),'export const value=2;');
 const result=await workspace.verify(job);assert.equal(result.passed,true);assert.ok(result.checks.some(c=>/typecheck/.test(c.name)));assert.ok(result.checks.some(c=>/build/.test(c.name)));assert.equal(await readFile(path.join(project,'value.js'),'utf8'),'export const value=1;');
 await writeFile(path.join(job.root,'value.js'),'export const value="broken";');assert.equal((await workspace.verify(job)).passed,false);
});
test('original check scripts cannot be weakened by a worker',async()=>{
 const {workspace,job}=await fixture({typecheck:'node checks/typecheck.js'});await writeFile(path.join(job.root,'value.js'),'export const value="wrong";');await writeFile(path.join(job.root,'checks/typecheck.js'),'// disabled check');
 assert.equal((await workspace.verify(job)).passed,false);
});
test('changed verification scripts and timeouts cannot silently count as passing checks',async()=>{
 const {workspace,job}=await fixture({typecheck:'node checks/typecheck.js'});await writeFile(path.join(job.root,'package.json'),JSON.stringify({type:'module',scripts:{typecheck:'node --version'}}));assert.equal((await workspace.verify(job)).passed,false);
});
test('zero test suites and project-script source mutation cannot greenlight integration',async()=>{
 let {workspace,job}=await fixture({test:'node --test'});const empty=await workspace.verify(job);assert.equal(empty.passed,false);assert.match(empty.checks.find(c=>/project: test/.test(c.name)).output,/No tests executed/);
 ({workspace,job}=await fixture({typecheck:'node checks/typecheck.js'}));await writeFile(path.join(job.root,'checks/typecheck.js'),"import {writeFileSync} from 'node:fs';writeFileSync('value.js','export const value=-1;');");const mutation=await workspace.verify(job);assert.equal(mutation.passed,false);assert.match(mutation.checks.find(c=>!c.passed).output,/Source changed/);assert.equal(await readFile(path.join(job.root,'value.js'),'utf8'),'export const value=1;');
});
test('Full access controls native project execution and hung commands stop within their deadline',async()=>{
 const {workspace,job}=await fixture({typecheck:'node checks/typecheck.js'});job.projectCommands=false;assert.equal((await workspace.verify(job)).passed,false);
 job.projectCommands=true;workspace.checkTimeoutMs=500;await writeFile(path.join(job.root,'checks/typecheck.js'),'setInterval(()=>{},1000);');const result=await workspace.verify(job);assert.equal(result.passed,false);assert.match(result.checks.find(c=>!c.passed).output,/timed out/);
});

test('a source edit during copied checks cannot receive the captured candidate fingerprint',async()=>{
 const {workspace,job}=await fixture({typecheck:'node checks/typecheck.js'});await writeFile(path.join(job.root,'checks/typecheck.js'),"await new Promise(resolve=>setTimeout(resolve,800));");
 const checking=workspace.verify(job);for(let i=0;i<100;i++){if((await readdir(workspace.profile)).some(name=>name.startsWith('checks-')))break;await new Promise(resolve=>setTimeout(resolve,20));}
 await writeFile(path.join(job.root,'value.js'),'export const value=999;');const result=await checking;
 assert.equal(result.passed,false);assert.ok(result.checks.some(check=>check.name==='Verified source revision'&&!check.passed));await assert.rejects(workspace.integrate(job,{current:()=>true}),/checks/i);
});

test('dev-only command changes are refused before execution',async()=>{
 const {workspace,job}=await fixture({dev:'node server.js'});await writeFile(path.join(job.root,'package.json'),JSON.stringify({type:'module',scripts:{dev:'node --version'}}));
 const result=await workspace.verify(job);assert.equal(result.passed,false);assert.ok(result.checks.some(check=>check.name==='Established project commands'&&!check.passed));
});

test('Vitest zero-suite wording cannot count as a passing test run',async()=>{
 const {workspace,job}=await fixture({test:'node checks/typecheck.js'});await writeFile(path.join(job.root,'checks/typecheck.js'),"console.log('No test files found, exiting with code 0');");
 const result=await workspace.verify(job);assert.equal(result.passed,false);assert.match(result.checks.find(check=>/Current project: test/.test(check.name)).output,/No tests executed/);
});

test('empty configured browser-flow test suites also refuse integration',async()=>{
 const {workspace,job}=await fixture({'test:flows':'node checks/typecheck.js'});await writeFile(path.join(job.root,'checks/typecheck.js'),"console.log('No tests found');");const result=await workspace.verify(job);assert.equal(result.passed,false);assert.match(result.checks.find(check=>/Current project: test:flows/.test(check.name)).output,/No tests executed/);
});

test('long Windows project paths use short owned check homes and clean them afterward',async()=>{
 const {workspace,job}=await fixture({typecheck:'node checks/typecheck.js'});job.directory=path.join(job.directory,'nested-'.repeat(10));await mkdir(job.directory,{recursive:true});
 await writeFile(path.join(job.root,'checks/typecheck.js'),"console.log(process.env.HOME);if(process.env.HOME.length>150)process.exit(1);");workspace.checkTimeoutMs=10000;
 const result=await workspace.verify(job);assert.equal(result.passed,true,JSON.stringify(result.checks));const home=result.checks.find(check=>/Current project: typecheck/.test(check.name)).output.trim().split(/\r?\n/).at(-1);await assert.rejects(access(home),{code:'ENOENT'});assert.equal((await readdir(workspace.profile)).some(name=>name.startsWith('checks-')),false);
});
