import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {HumanMessage} from '@langchain/core/messages';
import {MoraProtocol} from '../src/mora-protocol.js';
import {MuseChatModel,createMoraAgent} from '../src/mora-agent.js';

test('real LangChain middleware executes all five async tools and restores task state across supervisor calls',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'mora-agent-'));let release;
  const backend=new MoraProtocol({directory,execute:()=>new Promise(resolve=>release=resolve)});await backend.open();t.after(()=>backend.close());
  let action='start_async_task',args={agentName:'coder',description:'Independent task'},observedTools;
  const model=new MuseChatModel({decide:async({messages,tools})=>{
    observedTools=tools;
    if(messages.at(-1).role==='tool')return {message:'Accepted.',tool_calls:[]};
    return {message:'',tool_calls:[{name:action,arguments:JSON.stringify(args)}]};
  }});
  const agent=createMoraAgent({model,backend});
  let result=await agent.invoke({messages:[new HumanMessage('Start')]},{recursionLimit:12});
  assert.deepEqual(observedTools.map(tool=>tool.function.name).sort(),['cancel_async_task','check_async_task','list_async_tasks','start_async_task','update_async_task']);
  const [taskId]=Object.keys(result.asyncTasks);assert.ok(taskId);assert.equal(result.asyncTasks[taskId].status,'running');
  const firstRun=result.asyncTasks[taskId].runId;
  action='list_async_tasks';args={statusFilter:'all'};
  result=await agent.invoke({messages:[new HumanMessage('Status')],asyncTasks:result.asyncTasks},{recursionLimit:12});
  assert.match(result.messages.find(message=>message.type==='tool').content,new RegExp(taskId));
  action='update_async_task';args={taskId,message:'Updated task'};
  result=await agent.invoke({messages:[new HumanMessage('Update')],asyncTasks:result.asyncTasks},{recursionLimit:12});
  assert.notEqual(result.asyncTasks[taskId].runId,firstRun);
  action='cancel_async_task';args={taskId};
  result=await agent.invoke({messages:[new HumanMessage('Cancel')],asyncTasks:result.asyncTasks},{recursionLimit:12});
  assert.equal(result.asyncTasks[taskId].status,'cancelled');
  action='check_async_task';args={taskId};
  result=await agent.invoke({messages:[new HumanMessage('Check')],asyncTasks:result.asyncTasks},{recursionLimit:12});
  assert.equal(result.asyncTasks[taskId].status,'cancelled');
  release?.({text:'Late'});
});

test('Muse model connector rejects unknown tools and malformed arguments rather than claiming success',async()=>{
  const model=new MuseChatModel({decide:async()=>({message:'',tool_calls:[{name:'outside',arguments:'{}'}]})});
  await assert.rejects(model.bindTools([]).invoke('Request'),/unavailable tool/i);
  const invalid=new MuseChatModel({decide:async()=>({message:'',tool_calls:[{name:'inside',arguments:'{broken'}]})});
  await assert.rejects(invalid.bindTools([{type:'function',function:{name:'inside',description:'x',parameters:{type:'object',properties:{}}}}]).invoke('Request'),/arguments/i);
});
test('a malformed native argument string gets one bounded repair before any tool can execute',async()=>{
 let calls=0;const model=new MuseChatModel({decide:async({messages})=>{calls++;if(calls===1)return {message:'',tool_calls:[{name:'inside',arguments:'{broken'}]};assert.match(messages.at(-1).content,/no tool was executed/);return {message:'',tool_calls:[{name:'inside',arguments:'{"value":2}'}]};}});const reply=await model.bindTools([{type:'function',function:{name:'inside',description:'test',parameters:{type:'object',properties:{value:{type:'number'}}}}}]).invoke('Request');assert.deepEqual(reply.tool_calls[0].args,{value:2});assert.equal(calls,2);
});
