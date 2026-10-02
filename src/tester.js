import {mkdir,readFile,writeFile,rename,rm,readdir,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {snapshotProject} from './changes.js';
import {checkpointSource} from './checkpoints.js';

export function parseTesterCommand(text) {
  const match=/^\s*\/project-tester\s+(report|solver)(?:\s+([\s\S]*))?$/i.exec(text);
  if(!match)return null;
  const mode=match[1].toLowerCase(),request=(match[2]||'').trim();
  if(mode==='solver'&&!request)throw Error('Specify issue IDs or all confirmed issues to solve.');
  return {mode,request};
}
export function testerURL(value) {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('AI Tester requires a local app URL without credentials.');
  return url.href;
}
export async function projectRevision(root) {
  const snapshot=await snapshotProject(root,{filter:checkpointSource,refuseLinks:true});
  if(snapshot.partial)throw Error('Project source exceeds review limits; a reliable testing revision cannot be recorded.');
  const hash=createHash('sha256');
  for(const [name,data] of [...snapshot.files].sort(([a],[b])=>a.localeCompare(b)))hash.update(name).update('\0').update(createHash('sha256').update(data).digest());
  return hash.digest('hex');
}
export function reportForRevision(report,revision){
  const copy=structuredClone(report),expected=report.solver?.revision||report.revision;
  if(revision!==expected){copy.status='stale';copy.message='Historical results: project source differs from the revision that supports this report. Start a new report for current behavior.';}
  return copy;
}
export class TesterReports {
  constructor(profile){this.directory=path.join(profile,'tester-reports');this.writes=new Map();}
  filename(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Choose a valid tester report.');return path.join(this.directory,`${id}.json`);}
  async create({project,url,request,revision}) {
    const report={id:randomUUID(),project:path.resolve(project),url:testerURL(url),request:String(request).slice(0,12000),revision,createdAt:new Date().toISOString(),status:'planned',cases:[],issues:[],gaps:[],actions:0,elapsedMs:0};
    await this.save(report);return report;
  }
  async save(report) {
    const filename=this.filename(report.id),data=JSON.stringify(report);
    if(!path.isAbsolute(report.project)||!Array.isArray(report.cases)||!Array.isArray(report.issues)||data.length>4*1024*1024)throw Error('Invalid or oversized tester report.');
    const pending=(this.writes.get(filename)||Promise.resolve()).catch(()=>{}).then(async()=>{
      await mkdir(this.directory,{recursive:true});
      for(const target of [filename.replace(/\.json$/,'.backup.json'),filename]) {
        const temp=`${target}.${randomUUID()}.tmp`;
        try{await writeFile(temp,data,{flag:'wx',flush:true});await rename(temp,target);}finally{await rm(temp,{force:true});}
      }
    });this.writes.set(filename,pending);try{await pending;}finally{if(this.writes.get(filename)===pending)this.writes.delete(filename);}
  }
  async load(id) {
    const filename=this.filename(id);
    for(const file of [filename,filename.replace(/\.json$/,'.backup.json')])try{
      if((await stat(file)).size>4*1024*1024)throw Error('Oversized tester report.');
      const report=JSON.parse(await readFile(file,'utf8'));
      if(report.id!==id||!path.isAbsolute(report.project)||!Array.isArray(report.cases)||!Array.isArray(report.issues))throw Error('Invalid tester report.');
      if(['running','reproducing','solving'].includes(report.status)){
        report.status='paused';report.message='Interrupted work is saved. Resume explicitly; the unfinished case will start again.';
        for(const item of report.cases)if(item.status==='running')item.status='not tested';
      }
      return report;
    }catch{}
    throw Error('Tester report and backup could not be read. Files were preserved.');
  }
  async list(project) {
    let names;try{names=await readdir(this.directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const reports=[];
    for(const name of names.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n))){const report=await this.load(name.slice(0,-5));if(report.project===path.resolve(project))reports.push(report);}
    return reports.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
}
export function caseOutcome(item,requested) {
  const steps=item.steps||[],checks=steps.filter(step=>step.action.action==='assert'&&typeof step.result?.passed==='boolean');
  if(steps.some(step=>step.result?.error))return {status:'blocked',reason:'Browser control failed. This is not evidence of an application defect.'};
  if(checks.some(step=>!step.result.passed))return {status:'suspected',reason:'An assertion failed; reproduction is required.'};
  if(requested==='passed'&&checks.length)return {status:'passed',reason:'Recorded assertions passed.'};
  return {status:'not tested',reason:'No complete verified outcome.'};
}
export function confirmCase(item,replay,before,after) {
  if(before!==after)return 'stale';
  const failed=item.steps.filter(step=>step.action.action==='assert'&&step.result?.passed===false);
  if(!failed.length||replay.length!==item.steps.length||replay.some(step=>step.result?.error))return 'suspected';
  for(const check of failed){const same=replay.find(step=>JSON.stringify(step.action)===JSON.stringify(check.action));if(!same)return 'suspected';if(same.result?.passed!==false)return 'not reproduced';}
  return 'confirmed';
}
