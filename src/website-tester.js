import {mkdir,readFile,writeFile,rename,rm,readdir,stat} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {normalizeWebsiteScope,websiteURL,redactText} from './website-policy.js';

export function parseWebsiteTesterCommand(text) {
  const match=/^\s*\/tester(?:\s+([\s\S]*))?$/i.exec(text);if(!match)return null;
  const request=(match[1]||'').trim();
  if(/^solver\b/i.test(request))throw Error('Website testing cannot repair source. Use /project-tester solver for the separate project workflow.');
  if(!request)return {request:''};
  const [url,...rest]=request.split(/\s+/);websiteURL(url);return {url,request:rest.join(' ')};
}
export class WebsiteReports {
  constructor(profile,{crypto}={}){this.directory=path.join(profile,'website-reports');this.crypto=crypto;this.writes=new Map();}
  filename(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Choose a valid website report.');return path.join(this.directory,`${id}.json`);}
  async create(input) {
    const scope=normalizeWebsiteScope(input);
    const report={schemaVersion:1,kind:'website',id:randomUUID(),createdAt:new Date().toISOString(),scope,request:redactText(String(input.request||'Check the main visible workflow.')).slice(0,12000),status:'ready',message:'Open the browser, sign in if needed, then start checking.',policyVersion:1,steps:[],findings:[],gaps:[],actions:0};
    await this.save(report);return report;
  }
  valid(report){return report?.kind==='website'&&report.schemaVersion===1&&!('project' in report)&&!('revision' in report)&&!('solver' in report)&&Array.isArray(report.steps)&&Array.isArray(report.findings)&&Array.isArray(report.gaps)&&report.scope&&normalizeWebsiteScope(report.scope);}
  async save(report) {
    if(!this.valid(report))throw Error('Invalid website report; project data is not accepted.');
    const filename=this.filename(report.id),data=JSON.stringify(report);if(data.length>4*1024*1024)throw Error('Website report reached its size limit.');
    const operation=(this.writes.get(filename)||Promise.resolve()).catch(()=>{}).then(async()=>{await mkdir(this.directory,{recursive:true});for(const target of [filename.replace('.json','.backup.json'),filename]){const temp=`${target}.${randomUUID()}.tmp`;try{await writeFile(temp,data,{flag:'wx',flush:true});await rename(temp,target);}finally{await rm(temp,{force:true});}}});
    this.writes.set(filename,operation);try{await operation;}finally{if(this.writes.get(filename)===operation)this.writes.delete(filename);}
  }
  async load(id) {
    const file=this.filename(id);
    for(const filename of [file,file.replace('.json','.backup.json')])try{if((await stat(filename)).size>4*1024*1024)continue;const report=JSON.parse(await readFile(filename,'utf8'));if(report.id!==id||!this.valid(report))continue;
      if(['running','awaiting permission','opening','manual'].includes(report.status)){report.status='paused';report.message='Interrupted session. Review uncertain actions before starting a fresh check.';for(const step of report.steps)if(step.status==='pending')step.status='uncertain';for(const c of report.cases||[]){if(['running','queued'].includes(c.status)){c.status='not tested';c.reason='Interrupted before the case finished. Start a fresh check.';}for(const execution of c.executions||[])for(const step of execution.steps||[])if(step.status==='pending')step.status='uncertain';}delete report.pending;}
      return report;
    }catch{}
    throw Error('Website report and backup could not be read. Files were preserved.');
  }
  async list(){let files;try{files=await readdir(this.directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}const reports=[];for(const file of files.filter(s=>/^[a-f0-9-]{36}\.json$/.test(s))){try{reports.push(await this.load(file.slice(0,-5)));}catch{}}return reports.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  async evidence(id,name){this.filename(id);if(!/^screen-[a-f0-9-]+\.png$/.test(name))throw Error('Choose valid website evidence.');const file=path.join(this.directory,id,name);if((await stat(file)).size>10*1024*1024)throw Error('Evidence is too large.');return (await readFile(file)).toString('base64');}
  loginFilename(scope){return path.join(this.directory,'logins',createHash('sha256').update(JSON.stringify([new URL(scope.entryUrl).origin,scope.roleId])).digest('hex')+'.bin');}
  async saveLogin(scope,value){if(!this.crypto?.isEncryptionAvailable())throw Error('Operating-system encryption is unavailable. Login cannot be saved.');const file=this.loginFilename(scope);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,this.crypto.encryptString(JSON.stringify(value)),{flush:true});}
  async loadLogin(scope){if(!this.crypto?.isEncryptionAvailable())return;try{return JSON.parse(this.crypto.decryptString(await readFile(this.loginFilename(scope))));}catch(error){if(error.code==='ENOENT')return;throw Error('Saved login could not be decrypted. Sign in again.');}}
  async forgetLogin(scope){await rm(this.loginFilename(scope),{force:true});}
}
