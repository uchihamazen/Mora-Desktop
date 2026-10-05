import {mkdir,readFile,writeFile,rename,rm,readdir,statfs} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {Checkpoints,checkpointSource,checkpointSnapshot} from './checkpoints.js';
import {projectFile} from './project.js';
import {projectChecks,sourceDigest,filesDigest,noTestsExecuted} from './mora-checks.js';
import {browserChecks} from './mora-browser.js';

const exec=promisify(execFile),hash=data=>data===undefined?null:createHash('sha256').update(data).digest('hex');
const owns=(files,name)=>files.some(file=>file==='*'||file===name||(file.endsWith('/**')&&name.startsWith(file.slice(0,-2))));
const nodeTest=name=>/\.(?:test|spec)\.[cm]?js$/i.test(name);
const safeId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(value);
const loader=fileURLToPath(new URL('./mora-test-loader.js',import.meta.url));

export function validateMoraTask(description){
  let task;try{task=JSON.parse(description);}catch{throw Error('A coding task needs a structured objective and file ownership.');}
  if(!task||typeof task.title!=='string'||!task.title.trim()||task.title.length>100||typeof task.objective!=='string'||!task.objective.trim()||task.objective.length>50000||!Array.isArray(task.files)||!task.files.length||task.files.length>200)throw Error('Invalid coding task.');
  const files=[...new Set(task.files)];
  for(const name of files){
    if(typeof name!=='string'||name.length>400)throw Error('Invalid file ownership.');
    if(name==='*')continue;
    const plain=name.endsWith('/**')?name.slice(0,-3):name;
    if(!plain||/[\\:*?\x00-\x1f]/.test(plain)||plain.startsWith('/')||plain.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part))||!checkpointSource(plain))throw Error('Invalid file ownership path.');
  }
  if(files.includes('*')&&files.length!==1)throw Error('Whole-project ownership cannot be mixed with file assignments.');
  const dependsOn=task.dependsOn||[];
  if(task.key!==undefined&&!safeId(task.key))throw Error('Invalid task key.');
  if(!Array.isArray(dependsOn)||dependsOn.length>20||dependsOn.some(id=>typeof id!=='string'||!safeId(id)))throw Error('Invalid task dependencies.');
  return {title:task.title.trim(),objective:task.objective,files,dependsOn:[...new Set(dependsOn)],...(task.key?{key:task.key}:{})};
}
export function overlappingFiles(left,right){return left.some(a=>right.some(b=>a==='*'||b==='*'||a===b||owns([a],b.replace(/\/\*\*$/,''))||owns([b],a.replace(/\/\*\*$/,''))));}

export class MoraWorkspace {
  constructor(profile,project,{projectCommands=false,browserOptions={},checkTimeoutMs=120000,browserTimeoutMs=45000,browserAssertionMs=2500}={}){Object.assign(this,{projectCommands,browserOptions,checkTimeoutMs,browserTimeoutMs,browserAssertionMs});this.profile=profile;this.project=path.resolve(project);this.checkpoints=new Checkpoints(profile,this.project);this.directory=path.join(profile,'mora-mode-workspaces',hash(this.project).slice(0,16));}
  threadDirectory(threadId){if(!safeId(threadId))throw Error('Invalid worker identity.');return path.join(this.directory,hash(threadId).slice(0,16));}
  async prepare(threadId,runId,task,{projectCommands=this.projectCommands}={}){
    if(!safeId(threadId)||!safeId(runId))throw Error('Invalid worker identity.');
    const baseline=await this.checkpoints.snapshot(),directory=path.join(this.threadDirectory(threadId),hash(runId).slice(0,16)),root=path.join(directory,'source');
    await mkdir(root,{recursive:true});const space=await statfs(directory);if(space.bavail*space.bsize<128*1024*1024)throw Error('Not enough free space for an isolated coding task.');
    for(const name of task.files)if(name!=='*')await projectFile(this.project,name.replace(/\/\*\*$/,''));
    for(const [name,data] of baseline.files){const file=await projectFile(root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data,{flag:'wx'});}
    const base=Object.fromEntries([...baseline.files].map(([name,data])=>[name,data.toString('base64')]));
    await writeFile(path.join(directory,'baseline.json'),JSON.stringify({project:this.project,threadId,runId,task,files:base}),{flush:true});
    return {root,directory,threadId,runId,task,baseline:baseline.files,verified:null,projectCommands};
  }
  async changed(job,files){
    const candidate=files?{files}:await checkpointSnapshot(job.root);
    if(candidate.partial)throw Error('The worker source snapshot is incomplete.');
    const changes=[];for(const name of new Set([...job.baseline.keys(),...candidate.files.keys()])){
      const before=job.baseline.get(name),after=candidate.files.get(name);if(hash(before)===hash(after))continue;
      if(!owns(job.task.files,name))throw Error(`File ownership violation: ${name}`);
      changes.push({path:name,before,after});
    }
    return changes;
  }
  async runNode(job,args,{signal}={}){
    const temporary=path.join(job.directory,'test-temp');await mkdir(temporary,{recursive:true});
    const env={};for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','ComSpec','COMSPEC','PATHEXT','WINDIR'])if(process.env[key])env[key]=process.env[key];
    Object.assign(env,{TEMP:temporary,TMP:temporary,TMPDIR:temporary,MORA_MODE_DEPENDENCY_ROOT:this.project});
    const flags=['--permission',`--allow-fs-read=${job.root}`,`--allow-fs-read=${path.join(this.project,'node_modules')}`,`--allow-fs-read=${path.join(this.project,'package.json')}`,`--allow-fs-read=${loader}`,`--allow-fs-read=${temporary}`,`--allow-fs-write=${temporary}`,'--import',pathToFileURL(loader).href];
    try{const result=await exec('node',[...flags,...args],{cwd:job.root,env,windowsHide:true,timeout:120000,maxBuffer:2*1024*1024,signal});return {passed:true,output:result.stdout.slice(-12000)};}
    catch(error){if(signal?.aborted)throw Error('Task verification stopped.');return {passed:false,output:String(error.stdout||error.stderr||error.message).slice(-12000)};}
  }
  async syntax(job,change,candidate,{signal}={}){
    let type=change.path.endsWith('.mjs')?'module':change.path.endsWith('.cjs')?'commonjs':null;
    if(!type)for(let folder=path.posix.dirname(change.path);;folder=path.posix.dirname(folder)){
      const manifest=candidate.get(folder==='.'?'package.json':folder+'/package.json');
      if(manifest){try{const value=JSON.parse(manifest.toString()).type;if(['module','commonjs'].includes(value))type=value;}catch{}break;}
      if(folder==='.')break;
    }
    const temporary=path.join(job.directory,'test-temp');await mkdir(temporary,{recursive:true});let result;
    // Explicit extensions avoid ambiguous .js syntax detection accepting malformed module source.
    for(const format of type?[type]:['commonjs','module']){
      const file=path.join(temporary,'syntax-'+randomUUID()+(format==='module'?'.mjs':'.cjs'));await writeFile(file,change.after);
      try{result=await this.runNode(job,['--check',file],{signal});if(result.passed)return result;}finally{await rm(file,{force:true});}
    }
    return result;
  }
  async refreshInputs(job){
    await this.changed(job);const current=await this.checkpoints.snapshot();
    for(const name of new Set([...job.baseline.keys(),...current.files.keys()]))if(!owns(job.task.files,name)&&hash(job.baseline.get(name))!==hash(current.files.get(name))){
      const file=await projectFile(job.root,name),data=current.files.get(name);if(data===undefined){await rm(file,{force:true});job.baseline.delete(name);}else{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data);job.baseline.set(name,data);}
    }
    return hash(JSON.stringify([...current.files].filter(([name])=>!owns(job.task.files,name)).map(([name,data])=>[name,hash(data)]).sort(([a],[b])=>a.localeCompare(b))));
  }
  verify(job,options={}){const operation=(job.checking||Promise.resolve()).catch(()=>{}).then(()=>this.verifySource(job,options));job.checking=operation;return operation;}
  async verifySource(job,{signal}={}){
    job.checkRoot=null;job.buildPassed=false;
    try{
    const inputRevision=await this.refreshInputs(job);
    const snapshot=await checkpointSnapshot(job.root);if(snapshot.partial)throw Error('Verification source is incomplete.');
    const candidate=snapshot.files,changes=await this.changed(job,candidate),checks=[],capturedDigest=filesDigest(candidate);
    const runTests=async(name,files)=>{const before=await sourceDigest(job.root),result=await this.runNode(job,['--test','--test-isolation=none','--test-concurrency=1',...files],{signal});if(await sourceDigest(job.root)!==before){result.passed=false;result.output+='\nSource changed while tests ran. Delivery refused.';}if(result.passed&&noTestsExecuted(result.output)){result.passed=false;result.output+='\nNo tests executed. Delivery refused.';}checks.push({name,...result});};
    for(const change of changes)if(change.after&&/\.[cm]?js$/i.test(change.path))checks.push({name:`Syntax: ${change.path}`,...await this.syntax(job,change,candidate,{signal})});
    let packageTests=false;try{packageTests=job.projectCommands&&!!JSON.parse(job.baseline.get('package.json')?.toString()||'{}').scripts?.test;}catch{}
    const originalTests=[...job.baseline.keys()].filter(nodeTest),candidateTests=[...candidate.keys()].filter(nodeTest);
    if(originalTests.length&&!packageTests){
      const restored=[];
      try{
        for(const name of originalTests){const file=await projectFile(job.root,name);let current;try{current=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}restored.push({file,current});await mkdir(path.dirname(file),{recursive:true});await writeFile(file,job.baseline.get(name));}
        await runTests('Original regression tests',originalTests);
      }finally{for(const {file,current} of restored)if(current===undefined)await rm(file,{force:true});else await writeFile(file,current);}
    }
    if(candidateTests.length&&!packageTests)await runTests('Current tests',candidateTests);
    checks.push(...await projectChecks(this,job,candidate,{signal}));
    const browserEvidence=await browserChecks(this,job,candidate,{signal});if(browserEvidence.passed!==undefined)checks.push({name:browserEvidence.name,passed:browserEvidence.passed,output:browserEvidence.output});
    if(await sourceDigest(job.root)!==capturedDigest)checks.push({name:'Verified source revision',passed:false,output:'Worker source changed while verification ran. Run checks again.'});
    await this.changed(job);
    const fingerprint=hash(JSON.stringify(changes.map(change=>[change.path,hash(change.after)])));
    job.verified={passed:checks.length>0&&checks.every(check=>check.passed),checks,fingerprint,inputRevision,browser:browserEvidence.summary,browserEvidence};
    await writeFile(path.join(job.directory,'verification.json'),JSON.stringify(job.verified),{flush:true});return job.verified;
    }finally{for(const root of job.checkCopies||[])await rm(root,{recursive:true,force:true});job.checkCopies=[];job.checkRoot=null;}
  }
  async integrate(job,{current,signal}){
    const operation=(this.integrations||Promise.resolve()).catch(()=>{}).then(()=>this.apply(job,{current,signal}));this.integrations=operation;return operation;
  }
  async apply(job,{current,signal}){
    if(!current()||signal?.aborted)throw Error('Task was stopped or superseded.');
    if(!job.verified?.passed)throw Error('Source checks must pass before integration.');
    const revision=await this.refreshInputs(job);
    if(revision!==job.verified.inputRevision){await this.verify(job,{signal});if(!job.verified.passed)throw Error('Checks failed against newer project inputs. Changes remain isolated.');if(await this.refreshInputs(job)!==job.verified.inputRevision)throw Error('Project inputs changed during verification. Run checks again.');}
    const changes=await this.changed(job),fingerprint=hash(JSON.stringify(changes.map(change=>[change.path,hash(change.after)])));
    if(fingerprint!==job.verified.fingerprint)throw Error('Worker source changed after verification. Run checks again.');
    if(job.review&&(!job.review.approved||job.review.fingerprint!==fingerprint||job.review.inputRevision!==job.verified.inputRevision))throw Error('Independent review is stale after project inputs changed. Changes remain isolated; resume to review current source.');
    for(const change of changes)if(hash(await this.checkpoints.physical(change.path))!==hash(change.before))throw Error(`Project file changed while the task was running: ${change.path}`);
    if(!changes.length)return {files:[],checkpointId:null,checks:job.verified.checks,browser:job.verified.browser,browserEvidence:job.verified.browserEvidence};
    const checkpoint=await this.checkpoints.create(`Before ${job.task.title}`,{manual:false}),applied=[];
    const rollback=async()=>{for(const change of [...applied].reverse())if(hash(await this.checkpoints.physical(change.path))===hash(change.after)){const target=await projectFile(this.project,change.path);if(change.before===undefined)await rm(target,{force:true});else await writeFile(target,change.before,{flush:true});}};
    try{
      for(const change of changes){
        if(!current()||signal?.aborted)throw Error('Task was stopped or superseded.');
        if(hash(await this.checkpoints.physical(change.path))!==hash(change.before))throw Error(`Project file changed during integration: ${change.path}`);
        const target=await projectFile(this.project,change.path);await mkdir(path.dirname(target),{recursive:true});
        if(change.after===undefined)await rm(target);else{const stage=target+'.'+randomUUID()+'.tmp';try{await writeFile(stage,change.after,{flush:true});await rename(stage,target);}finally{await rm(stage,{force:true});}}
        applied.push(change);
      }
      await this.checkpoints.seal(checkpoint.id);
      if(!current()||signal?.aborted)throw Error('Task was stopped during integration.');
    }catch(error){
      await rollback();
      throw error;
    }
    return {files:changes.map(change=>({path:change.path,status:change.before===undefined?'added':change.after===undefined?'deleted':'modified'})),checkpointId:checkpoint.id,checks:job.verified.checks,browser:job.verified.browser,browserEvidence:job.verified.browserEvidence,rollback};
  }
}
