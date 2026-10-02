import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access} from 'node:fs/promises';
import path from 'node:path';
import {projectFile,projectScripts} from './project.js';

const exec=promisify(execFile),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clean=text=>String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
export function localURL(text) {
  for(const match of clean(text).matchAll(/https?:\/\/[^\s<>"']+/g))try{
    const url=new URL(match[0].replace(/[),.;]+$/,''));
    if(['localhost','127.0.0.1','[::1]'].includes(url.hostname) && !url.username && !url.password)return url.href;
  }catch{}
  return null;
}
export async function scriptCommand(root,manager,script) {
  if(!['npm','pnpm','yarn'].includes(manager) || !/^[a-zA-Z0-9_:-]{1,80}$/.test(script))throw new Error('Choose a configured project script.');
  await projectFile(root);
  const env={...process.env,CI:'true',BROWSER:'none',FORCE_COLOR:'0'};
  try{await exec('node',['--version'],{windowsHide:true,timeout:5000});}catch{throw new Error('Install Node.js, then restart Mora so Run and Test can find it.');}
  if(process.platform!=='win32')return {file:manager,args:['run',script],env};
  let command;
  try {command=(await exec('where.exe',[`${manager}.cmd`],{windowsHide:true,timeout:5000})).stdout.trim().split(/\r?\n/)[0];await access(command);}
  catch {throw new Error(`Install ${manager}, then restart Mora so it can run this project.`);}
  if(/["&|<>%^!\r\n]/.test(command))throw new Error('The package manager path contains unsupported characters.');
  return {file:process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',args:['/d','/s','/c',`""${command}" run ${script}"`],env,windowsVerbatimArguments:true};
}
export async function occupiedPorts() {
  if(process.platform!=='win32')return new Set();
  const {stdout}=await exec('netstat.exe',['-ano','-p','tcp'],{windowsHide:true,timeout:5000,maxBuffer:2*1024*1024});
  return new Set(stdout.split(/\r?\n/).filter(line=>/LISTENING/.test(line)).map(line=>Number(/:\s*(\d+)\s/.exec(line)?.[1])).filter(Boolean));
}
export class ProjectRunner {
  constructor(onChange,{command=scriptCommand,occupied=occupiedPorts,startupMs=30000,checkMs=120000}={}) {
    Object.assign(this,{onChange,command,occupied,startupMs,checkMs});this.state={root:null,run:{status:'stopped',output:''},tests:{status:'not checked',results:[],interactions:'not checked'}};this.children=new WeakMap();
  }
  publish(){this.onChange(this.state);}
  launch(root,settings,onOutput) {
    const child=spawn(settings.file,settings.args,{cwd:root,env:settings.env,windowsHide:true,windowsVerbatimArguments:settings.windowsVerbatimArguments,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    const done=new Promise(resolve=>{let error;child.once('error',value=>{error=value;});child.once('close',(code,signal)=>resolve({code,signal,error:error?.message}));});
    this.children.set(child,done);child.stdout.on('data',chunk=>onOutput(clean(chunk)));child.stderr.on('data',chunk=>onOutput(clean(chunk)));return child;
  }
  async terminate(child) {
    if(!child || child.exitCode!==null)return;
    if(child.pid) {
      if(process.platform==='win32')await exec('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:10000}).catch(()=>child.kill());
      else {try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}
    }
    await this.children.get(child);
  }
  async run(root) {
    if(this.active || this.runChild)throw new Error('Stop the current Run or Test first.');
    this.active=true;const attempt=this.runAttempt=Symbol('run');
    try {
      const config=await projectScripts(root);if(!config.start)throw new Error('Add a dev, start or serve script to package.json before running this app.');
      const settings=await this.command(root,config.manager,config.start),occupied=await this.occupied();
      if(this.runAttempt!==attempt)return this.state;
      this.state.root=root;this.state.run={status:'starting',script:config.start,output:'',message:'Starting your app…',url:null};this.publish();
      const child=this.launch(root,settings,text=>{this.state.run.output=(this.state.run.output+text).slice(-24000);this.publish();});this.runChild=child;
      this.children.get(child).then(result=>{
        if(this.runChild!==child)return;this.runChild=null;
        if(!['stopping','stopped','failed'].includes(this.state.run.status)){this.state.run.status='failed';this.state.run.message=result.error || `App exited (${result.code ?? result.signal}). Check its output; install project dependencies if they are missing.`;this.publish();}
      });
      this.waitReady(child,occupied).catch(error=>this.failRun(child,error.message));return this.state;
    }finally{this.active=false;}
  }
  async failRun(child,message) {
    if(this.runChild!==child)return;this.state.run.status='failed';this.state.run.message=message;this.publish();await this.terminate(child);if(this.runChild===child)this.runChild=null;
  }
  async waitReady(child,occupied) {
    const deadline=Date.now()+this.startupMs;
    while(this.runChild===child && this.state.run.status==='starting') {
      const url=localURL(this.state.run.output);
      if(url) {
        const port=Number(new URL(url).port || (url.startsWith('https:')?443:80));
        if(occupied.has(port)){await this.failRun(child,'This preview port was already in use. Choose another port in your project; the other app was left running.');return;}
        try {
          const response=await fetch(url,{signal:AbortSignal.timeout(700),redirect:'manual'});await response.body?.cancel();
          if(response.ok && this.runChild===child && this.state.run.status==='starting'){this.state.run={...this.state.run,status:'ready',url,message:'Your app is ready.'};this.publish();return;}
        }catch{}
      }
      if(Date.now()>=deadline){await this.failRun(child,'Startup timed out. Check the output and make the script print its localhost URL.');return;}
      await pause(100);
    }
  }
  async stopRun() {
    this.runAttempt=null;
    const child=this.runChild;this.state.run.status='stopping';this.state.run.message='Stopping your app…';this.publish();await this.terminate(child);if(this.runChild===child)this.runChild=null;
    this.state.run.status='stopped';this.state.run.message='App stopped.';this.publish();
  }
  async test(root,{previewCheck}={}) {
    if(this.active)throw new Error('A project command is already starting or running.');
    if(this.runChild && this.state.root!==root)throw new Error('Stop the other project before testing.');
    this.active=true;this.cancelled=false;this.state.root=root;this.state.tests={status:'running',results:[],preview:{status:'not checked',message:'Run the app to check page loading.'},interactions:'not checked'};this.publish();
    try {
      const config=await projectScripts(root);
      for(const script of config.checks) {
        if(this.cancelled)break;
        const item={script,status:'running',output:''};this.state.tests.results.push(item);this.publish();
        try {
          const settings=await this.command(root,config.manager,script);if(this.cancelled){item.status='stopped';break;}
          const child=this.launch(root,settings,text=>{item.output=(item.output+text).slice(-24000);this.publish();});this.testChild=child;
          let timedOut=false;const timer=setTimeout(()=>{timedOut=true;this.terminate(child).catch(()=>{});},this.checkMs);
          const result=await this.children.get(child);clearTimeout(timer);this.testChild=null;item.code=result.code;
          item.status=this.cancelled?'stopped':timedOut || result.error || result.code!==0?'failed':'passed';
          item.message=timedOut?'Check timed out. Use a script that exits when finished.':result.error || (result.code===0?'Completed successfully.':`Exited with ${result.code ?? result.signal}.`);
        }catch(error){item.status='failed';item.message=error.message;}
        this.publish();
      }
      if(!this.cancelled && previewCheck)try{this.state.tests.preview=await previewCheck();}catch(error){this.state.tests.preview={status:'failed',message:error.message};}
      const results=this.state.tests.results;
      this.state.tests.status=this.cancelled?'stopped':results.some(x=>x.status==='failed') || this.state.tests.preview.status==='failed'?'failed':results.length?'passed':'not configured';
      this.state.tests.message=this.state.tests.status==='passed'?'Configured checks passed. App interactions need their own tests.':this.state.tests.status==='not configured'?'No check, typecheck, build or test scripts are configured.':this.state.tests.status==='stopped'?'Checks stopped.':'Some checks failed. Review their output.';
      return this.state.tests;
    }finally{this.active=false;this.publish();}
  }
  async stopTests(){this.cancelled=true;await this.terminate(this.testChild);}
  async shutdown(){await this.stopTests();await this.stopRun();}
}
