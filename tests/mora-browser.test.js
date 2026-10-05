import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {MoraWorkspace} from '../src/mora-workspace.js';
import {browserRequired} from '../src/mora-browser.js';

test('web previews require browser verification without a checked-in HTML file; CLI and libraries do not',()=>{
 const source=(pkg,files={})=>new Map([['package.json',Buffer.from(JSON.stringify(pkg))],...Object.entries(files).map(([name,data])=>[name,Buffer.from(data)])]);
 for(const pkg of [{scripts:{dev:'vite'}},{scripts:{start:'next start'},dependencies:{next:'1'}},{scripts:{dev:'node server.js'},dependencies:{express:'1'}},{scripts:{dev:'custom-preview'}}]){const files=source(pkg,pkg.scripts.dev==='custom-preview'?{'src/App.tsx':'export default()=> <main>Hi</main>;'}:{});assert.equal(browserRequired(files,files),true);}
 const server=source({scripts:{start:'node server.js'}},{'server.js':"import {createServer} from 'node:http';createServer((req,res)=>res.end('<h1>App</h1>')).listen(3000);"});assert.equal(browserRequired(server,server),true);
 const cli=source({scripts:{start:'node cli.js'}},{'cli.js':"console.log('Ready');"}),library=source({dependencies:{react:'1'}},{'Component.tsx':'export const Component=()=> <main>Hi</main>;'});assert.equal(browserRequired(cli,cli),false);assert.equal(browserRequired(library,library),false);assert.equal(browserRequired(cli,cli,true),true);
 const documentation=source({}, {'docs/index.html':'<h1>Library docs</h1>','templates/page.html':'<main>Template</main>'}),watcher=source({scripts:{dev:'tsup --watch'},dependencies:{react:'1'}},{'Component.tsx':'export const Component=()=> <main>Hi</main>;'});assert.equal(browserRequired(documentation,documentation),false);assert.equal(browserRequired(watcher,watcher),false);
 const web=source({scripts:{dev:'vite'}});assert.equal(browserRequired(web,cli),true,'candidate edits cannot remove the baseline browser requirement');
});

test('non-UI changes in a web app cannot skip a failing browser',async()=>{
 const {workspace,job,project}=await fixture();await writeFile(path.join(project,'data.json'),'{}');job.baseline.set('data.json',Buffer.from('{}'));await writeFile(path.join(job.root,'data.json'),'{"changed":true}');job.task.files.push('data.json');await writeFile(path.join(job.root,'index.html'),'<title>Broken</title><script>throw Error("broken product")</script>');job.baseline.set('index.html',await readFile(path.join(job.root,'index.html')));
 const result=await workspace.verify(job);assert.equal(result.browser,'Failed');assert.equal(result.passed,false);await assert.rejects(workspace.integrate(job,{current:()=>true}),/checks/i);
});

test('server-rendered apps with no source HTML get mandatory checks and broken previews block integration',async()=>{
 const {workspace,job}=await fixture();await rm(path.join(job.root,'index.html'));job.baseline.delete('index.html');job.task.files.push('server.js','http.js','package.json');
 const server="import {createServer} from 'node:http';const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Server product</h1><button>Add</button>');});server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));";
 await writeFile(path.join(job.root,'server.js'),"import {boot} from './http.js';boot();");await writeFile(path.join(job.root,'http.js'),server.replace('const server=createServer','export function boot(){const server=createServer')+'}');await writeFile(path.join(job.root,'package.json'),JSON.stringify({type:'module',scripts:{start:'node server.js'}}));for(const name of ['server.js','http.js','package.json'])job.baseline.set(name,await readFile(path.join(job.root,name)));job.projectCommands=true;
 const positive=await workspace.verify(job);assert.equal(positive.browser,'Smoke passed');assert.ok(positive.browserEvidence.screenshot);await writeFile(path.join(job.root,'http.js'),(await readFile(path.join(job.root,'http.js'),'utf8')).replace('<button>Add</button>','<script>throw Error("SSR broken")</script>'));const negative=await workspace.verify(job);assert.equal(negative.passed,false);assert.equal(negative.browser,'Failed');await assert.rejects(workspace.integrate(job,{current:()=>true}),/checks/i);
});

test('a browser app cannot apply changes when its browser executable is unavailable',async()=>{
 const {workspace,job,project}=await fixture();workspace.browserOptions={executablePath:path.join(project,'missing-browser.exe')};const result=await workspace.verify(job);assert.equal(result.passed,false);assert.equal(result.browser,'Failed');assert.match(result.browserEvidence.output,/executable|doesn't exist|not exist/i);await assert.rejects(workspace.integrate(job,{current:()=>true}),/checks/i);
});

test('an observed preview requires browser checks even when source detection cannot recognize it',async()=>{
 const {workspace,job}=await fixture();await rm(path.join(job.root,'index.html'));job.baseline.delete('index.html');job.task.files.push('server.js','package.json');const server="import {createServer as serve} from 'node:http';const preview=serve((req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Custom product</h1><script>throw Error(\"custom broken\")</script>');});preview.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+preview.address().port));";await writeFile(path.join(job.root,'server.js'),server);await writeFile(path.join(job.root,'package.json'),JSON.stringify({type:'module',scripts:{start:'node server.js'}}));for(const name of ['server.js','package.json'])job.baseline.set(name,await readFile(path.join(job.root,name)));assert.equal(browserRequired(job.baseline,job.baseline),false);job.projectCommands=true;job.browserRequired=true;const result=await workspace.verify(job);assert.equal(result.browser,'Failed');assert.equal(result.passed,false);await assert.rejects(workspace.integrate(job,{current:()=>true}),/checks/i);
});

test('built-only web output is verified even without HTML, frontend dependencies or a preview script in source',async()=>{
 const profile=await mkdtemp(path.join(tmpdir(),'mora-built-browser-')),project=path.join(profile,'project');await mkdir(project);const page='<h1>Built product</h1><button>Open</button>';
 await writeFile(path.join(project,'package.json'),JSON.stringify({type:'module',scripts:{build:'node build.js'}}));await writeFile(path.join(project,'content.js'),'export const html='+JSON.stringify(page)+';');await writeFile(path.join(project,'build.js'),"import {mkdirSync,writeFileSync} from 'node:fs';import {html} from './content.js';mkdirSync('dist',{recursive:true});writeFileSync('dist/index.html',html);");
 const workspace=new MoraWorkspace(profile,project);workspace.projectCommands=true;const job=await workspace.prepare('worker','run',{title:'Built product',files:['content.js']});const positive=await workspace.verify(job);assert.equal(positive.passed,true);assert.equal(positive.browser,'Smoke passed');assert.ok(positive.browserEvidence.screenshot);await writeFile(path.join(job.root,'content.js'),'export const html='+JSON.stringify(page+'<script>throw Error("built app broken")</script>')+';');const negative=await workspace.verify(job);assert.equal(negative.passed,false);assert.equal(negative.browser,'Failed');await assert.rejects(workspace.integrate(job,{current:()=>true}),/checks/i);
});

async function fixture(plan){const profile=await mkdtemp(path.join(tmpdir(),'mora-browser-check-')),project=path.join(profile,'project');await mkdir(path.join(project,'.mora'),{recursive:true});await writeFile(path.join(project,'index.html'),'<title>Counter</title><button onclick="document.querySelector(\'output\').textContent=\'1\'">Add</button><output aria-label="Count">0</output>');if(plan)await writeFile(path.join(project,'.mora/verification.json'),JSON.stringify({browser:plan}));const workspace=new MoraWorkspace(profile,project),job=await workspace.prepare('worker','run',{title:'Counter',files:['index.html','.mora/verification.json']});return {workspace,job,project};}
test('static UI changes get separate browser smoke evidence',async()=>{
 const {workspace,job}=await fixture();const result=await workspace.verify(job);assert.equal(result.passed,true);assert.equal(result.browser,'Smoke passed');assert.equal(result.browserEvidence.status,'passed');assert.equal(result.browserEvidence.kind,'smoke');assert.ok(result.browserEvidence.screenshot);assert.equal((await readFile(result.browserEvidence.screenshot)).subarray(1,4).toString(),'PNG');
});
test('baseline browser workflows check real user interactions and refuse broken outcomes',async()=>{
 const {workspace,job}=await fixture({steps:[{action:'click',role:'button',name:'Add'},{action:'assert',role:'status',name:'Count',check:'text',expected:'1'}]});assert.equal((await workspace.verify(job)).browser,'Workflow passed');
 await writeFile(path.join(job.root,'index.html'),'<title>Counter</title><button>Add</button><output aria-label="Count">0</output>');const result=await workspace.verify(job);assert.equal(result.passed,false);assert.equal(result.browser,'Failed');assert.ok(result.browserEvidence.trace);await assert.rejects(workspace.integrate(job,{current:()=>true}),/checks/i);
});
test('worker changes cannot replace the baseline browser requirements',async()=>{
 const {workspace,job}=await fixture({steps:[{action:'assert',role:'status',name:'Count',check:'text',expected:'1'}]});await writeFile(path.join(job.root,'.mora/verification.json'),JSON.stringify({browser:{steps:[]}}));assert.equal((await workspace.verify(job)).passed,false);
});

test('worker-added browser requirements need a separate review even with passing code tests',async()=>{
 const {workspace,job}=await fixture();await mkdir(path.join(job.root,'.mora'),{recursive:true});await writeFile(path.join(job.root,'.mora/verification.json'),JSON.stringify({browser:{steps:[{action:'assert',role:'button',name:'Add',check:'visible',expected:'true'}]}}));
 const result=await workspace.verify(job);assert.equal(result.passed,false);assert.match(result.checks.find(check=>!check.passed).output,/changed browser requirements/);
});

test('runtime errors and external websocket attempts are visible failures',async()=>{
 for(const script of ["throw Error('broken runtime')","new WebSocket('ws://example.invalid/socket')"]){const {workspace,job}=await fixture();await writeFile(path.join(job.root,'index.html'),`<title>Broken</title><button>Add</button><script>${script}</script>`);const result=await workspace.verify(job);assert.equal(result.passed,false);assert.equal(result.browser,'Failed');assert.ok(result.browserEvidence.errors.length||result.browserEvidence.blocked.length);}
});

test('subresource redirects cannot escape the owned preview',async()=>{
 let foreignRequests=0;const foreign=createServer((request,response)=>{foreignRequests++;response.end('foreign');});await new Promise(resolve=>foreign.listen(0,'127.0.0.1',resolve));
 const {workspace,job}=await fixture();const foreignURL=`http://127.0.0.1:${foreign.address().port}/`;
 await writeFile(path.join(job.root,'package.json'),JSON.stringify({type:'module',scripts:{dev:'node server.js'}}));job.baseline.set('package.json',await readFile(path.join(job.root,'package.json')));job.task.files.push('server.js','package.json');
 await writeFile(path.join(job.root,'server.js'),`import {createServer} from 'node:http';const server=createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{location:'/hop'});res.end();}else if(req.url==='/hop'){res.writeHead(302,{location:${JSON.stringify(foreignURL)}});res.end();}else if(req.url==='/favicon.ico'){res.end();}else{res.setHeader('content-type','text/html');res.end('<title>Redirect test</title><button>Add</button><img src="/redirect">');}});server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));`);job.baseline.set('server.js',await readFile(path.join(job.root,'server.js')));job.projectCommands=true;
 try{const result=await workspace.verify(job);assert.equal(result.passed,false);assert.ok(result.browserEvidence.errors.some(error=>/redirects are unsupported/.test(error)));assert.equal(foreignRequests,0);}finally{await new Promise(resolve=>foreign.close(resolve));}
});
