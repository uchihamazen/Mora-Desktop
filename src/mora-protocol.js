import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';

const terminal=new Set(['success','error','cancelled','interrupted','timeout']);
const validId=value=>typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value);
const fail=(status,message)=>Object.assign(new Error(message),{status});

/** Private Agent Protocol backend for the official asynchronous subagent SDK. */
export class MoraProtocol extends EventEmitter {
  constructor({directory,execute,maxWorkers=3,ready=()=>true,validate=()=>{},complete=async result=>result}){
    super();if(!path.isAbsolute(directory)||typeof execute!=='function'||!Number.isInteger(maxWorkers)||maxWorkers<1||maxWorkers>3)throw Error('Invalid Mora Mode backend.');
    Object.assign(this,{directory,execute,maxWorkers,ready,validate,complete});this.token=randomBytes(32).toString('hex');this.state={version:1,threads:{}};this.pending=Promise.resolve();this.active=new Map();this.stopped=false;
  }
  async open(){
    await mkdir(this.directory,{recursive:true});let damaged=false,loaded=false;
    for(const name of ['tasks.json','tasks.backup.json'])try{
      const state=JSON.parse(await readFile(path.join(this.directory,name),'utf8'));
      if(state.version!==1||!state.threads||Object.keys(state.threads).length>2000)throw Error('Invalid task storage.');
      for(const [id,thread] of Object.entries(state.threads))if(!validId(id)||thread.thread_id!==id||!thread.runs||!Array.isArray(thread.values?.messages))throw Error('Invalid saved task.');
      this.state=state;loaded=true;break;
    }catch(error){if(error.code!=='ENOENT')damaged=true;}
    if(damaged&&!loaded)throw Error('Saved Mora Mode tasks are damaged. Their files were preserved.');
    for(const thread of Object.values(this.state.threads))for(const run of Object.values(thread.runs))if(!terminal.has(run.status)){run.status='interrupted';run.error='Interrupted by application restart. Resume explicitly.';thread.status='interrupted';}
    await this.save();
    this.server=createServer((request,response)=>this.handle(request,response));
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve);});
    this.url=`http://127.0.0.1:${this.server.address().port}`;return this;
  }
  async save(){
    const data=JSON.stringify(this.state);if(Buffer.byteLength(data)>32*1024*1024)throw Error('Mora Mode task storage is full.');
    for(const name of ['tasks.backup.json','tasks.json']){const file=path.join(this.directory,name);await writeFile(file+'.tmp',data,{flush:true});await rename(file+'.tmp',file);}
  }
  mutate(change,{rollback}={}){
    const operation=this.pending.catch(()=>{}).then(async()=>{const previous=structuredClone(this.state);try{const result=await change();await this.save();return result;}catch(error){try{await rollback?.();}finally{this.state=previous;}throw error;}});
    this.pending=operation;return operation;
  }
  thread(id){if(!validId(id)||!this.state.threads[id])throw fail(404,'Task not found in this conversation.');return this.state.threads[id];}
  run(thread,id){if(!validId(id)||!thread.runs[id])throw fail(404,'Task run not found.');return thread.runs[id];}
  snapshot(){return {threads:structuredClone(Object.values(this.state.threads)),active:this.active.size,maxWorkers:this.maxWorkers};}
  async createThread(){return this.mutate(()=>{if(Object.keys(this.state.threads).length>=2000)throw fail(409,'Mora Mode task limit reached.');const thread={thread_id:randomUUID(),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),status:'idle',metadata:{},values:{messages:[]},runs:{},currentRunId:null};this.state.threads[thread.thread_id]=thread;return thread;});}
  async createRun(id,body){
    if(this.stopped)throw fail(409,'Mora Mode is stopped.');
    const incoming=body.input?.messages;
    if(body.assistant_id!=='mora-worker'||!Array.isArray(incoming)||incoming.length!==1||incoming[0].role!=='user'||typeof incoming[0].content!=='string'||!incoming[0].content.trim()||incoming[0].content.length>200000)throw fail(400,'Invalid worker request.');
    const activeRun=this.thread(id).currentRunId;if(body.multitask_strategy==='interrupt'&&activeRun&&!terminal.has(this.run(this.thread(id),activeRun).status))this.active.get(activeRun)?.abort();
    let previous;
    const run=await this.mutate(()=>{
      const thread=this.thread(id);
      previous=thread.currentRunId;
      if(previous&&!terminal.has(this.run(thread,previous).status)&&body.multitask_strategy!=='interrupt')throw fail(409,'This task already has active work. Use an update.');
      this.validate(thread,body,this.state);
      if(previous&&!terminal.has(this.run(thread,previous).status))this.run(thread,previous).status='interrupted';
      const now=new Date().toISOString(),run={run_id:randomUUID(),thread_id:id,assistant_id:'mora-worker',status:'pending',created_at:now,updated_at:now,metadata:{},input:structuredClone(body.input)};
      thread.values.messages.push(...incoming);thread.currentRunId=run.run_id;thread.runs[run.run_id]=run;thread.status='busy';thread.updated_at=now;return run;
    });
    if(previous)this.active.get(previous)?.abort();
    this.emit('change',{type:'saved',threadId:id,runId:run.run_id});this.pump();return run;
  }
  async cancel(id,runId){
    if(this.run(this.thread(id),runId).status==='success')await this.pending.catch(()=>{});
    if(terminal.has(this.run(this.thread(id),runId).status))return;
    this.active.get(runId)?.abort();
    await this.mutate(()=>{const thread=this.thread(id),run=this.run(thread,runId);if(terminal.has(run.status))return;run.status='cancelled';run.updated_at=new Date().toISOString();if(thread.currentRunId===runId)thread.status='idle';});
    this.active.get(runId)?.abort();this.emit('change',{type:'cancelled',threadId:id,runId});this.pump();
  }
  pump(){
    if(this.stopped)return;
    for(const thread of Object.values(this.state.threads)){
      const run=thread.runs[thread.currentRunId];
      if(this.active.size>=this.maxWorkers)break;
      if(!run||run.status!=='pending'||this.active.has(run.run_id)||!this.ready(thread,this.state))continue;
      const controller=new AbortController();this.active.set(run.run_id,controller);
      controller.done=this.perform(thread.thread_id,run.run_id,controller).catch(error=>this.emit('change',{type:'error',threadId:thread.thread_id,runId:run.run_id,message:error.message})).finally(()=>{this.active.delete(run.run_id);this.pump();});
    }
  }
  async perform(threadId,runId,controller){
    await this.mutate(()=>{const thread=this.thread(threadId),run=this.run(thread,runId);if(run.status==='pending')run.status='running';});
    if(controller.signal.aborted||this.stopped)return;
    this.emit('change',{type:'delivered',threadId,runId});
    const current=()=>!controller.signal.aborted&&!this.stopped&&this.thread(threadId).currentRunId===runId&&this.run(this.thread(threadId),runId).status==='running';
    let rollback;
    try{
      const thread=this.thread(threadId),result=await this.execute({threadId,runId,messages:structuredClone(thread.values.messages),signal:controller.signal,current,progress:message=>{if(current())this.emit('change',{type:'progress',threadId,runId,message:String(message).slice(0,500)});}});
      if(!current())return;
      await this.mutate(async()=>{
        if(!current())return;
        const final=await this.complete(result,{threadId,runId,current,signal:controller.signal,onRollback:callback=>{rollback=callback;}});
        if(!current())throw Error('Task was stopped before integration committed.');
        const activeThread=this.thread(threadId),run=this.run(activeThread,runId);run.status='success';run.result=final;run.updated_at=new Date().toISOString();activeThread.status='idle';activeThread.values.messages.push({role:'assistant',content:typeof final==='string'?final:String(final.text||'Task completed.')});
      },{rollback:()=>rollback?.()});
      if(this.run(this.thread(threadId),runId).status==='success')this.emit('change',{type:'completed',threadId,runId});
    }catch(error){
      if(!current())return;
      await this.mutate(()=>{const thread=this.thread(threadId),run=this.run(thread,runId);run.status='error';run.error=String(error.message||error).slice(0,2000);if(error.verification)run.result=error.verification;run.updated_at=new Date().toISOString();thread.status='error';});
      this.emit('change',{type:'error',threadId,runId,message:error.message});
    }
  }
  async handle(request,response){
    response.setHeader('content-type','application/json');response.setHeader('cache-control','no-store');
    try{
      if(request.headers.authorization!==`Bearer ${this.token}`)throw fail(401,'Authentication required.');
      if(request.headers.origin)throw fail(403,'Browser requests are not allowed.');
      const url=new URL(request.url,'http://127.0.0.1'),parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);let body={};
      if(request.method==='POST'){let bytes=0,text='';for await(const chunk of request){bytes+=chunk.length;if(bytes>1024*1024)throw fail(413,'Task request is too large.');text+=chunk;}if(text)try{body=JSON.parse(text);}catch{throw fail(400,'Invalid request JSON.');}}
      if(request.method!=='POST')await this.pending.catch(()=>{});let result;
      if(request.method==='POST'&&parts.length===1&&parts[0]==='threads')result=await this.createThread();
      else if(parts[0]==='threads'&&parts.length>=2){
        const thread=this.thread(parts[1]);
        if(request.method==='GET'&&parts.length===2)result=thread;
        else if(request.method==='GET'&&parts[2]==='state'&&parts.length===3)result={values:thread.values,next:[],tasks:[],metadata:{},created_at:thread.updated_at,checkpoint:null,parent_checkpoint:null};
        else if(request.method==='POST'&&parts[2]==='runs'&&parts.length===3)result=await this.createRun(parts[1],body);
        else if(request.method==='GET'&&parts[2]==='runs'&&parts.length===4)result=this.run(thread,parts[3]);
        else if(request.method==='POST'&&parts[2]==='runs'&&parts[4]==='cancel'&&parts.length===5){await this.cancel(parts[1],parts[3]);result={};}
      }
      if(result===undefined)throw fail(404,'Unsupported task operation.');response.end(JSON.stringify(result));
    }catch(error){response.statusCode=error.status||400;response.end(JSON.stringify({detail:String(error.message||error).slice(0,1000)}));}
  }
  close(){
    if(this.closing)return this.closing;this.stopped=true;
    this.closing=this.shutdown();return this.closing;
  }
  async shutdown(){
    for(const controller of this.active.values())controller.abort();
    let failure;
    try{await this.mutate(()=>{for(const thread of Object.values(this.state.threads))for(const run of Object.values(thread.runs))if(!terminal.has(run.status)){run.status='interrupted';thread.status='interrupted';}});}catch(error){failure=error;}
    finally{
      if(this.server){this.server.closeIdleConnections();await new Promise(resolve=>this.server.close(resolve));}
      await Promise.allSettled([...this.active.values()].map(controller=>controller.done));
      await this.pending.catch(error=>{failure??=error;});
    }
    if(failure)throw failure;
  }
}
