import {createServer} from 'node:http';
import {websiteCoverage} from '../../../src/website-coverage.js';

export async function startAcceptanceFixture({faulty=false}={}) {
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const shell=body=>`<!doctype html><html lang="en"><head><title>Team shop</title><style>body{font:18px system-ui;color:#111;background:white;max-width:900px;margin:32px}label,output{display:block;margin:12px 0}nav{display:flex;gap:20px}button,input{font:inherit}</style></head><body><main><nav><a href="/">Shop</a><a href="/settings">Settings</a><a href="/tasks">Tasks</a></nav>${body}</main></body></html>`;
    if(req.url.startsWith('/settings'))return res.end(shell(`<h1>Settings</h1><p>Saving a nonempty Team name shows Settings saved. Updates stays checked after reloading once enabled. Reset updates clears this preference.</p>
      <form><label>Team name<input id="team" required maxlength="20"></label><button>Save settings</button></form><output aria-label="Save status" id="saved">Not saved</output><label><input type="checkbox" id="updates">Updates</label><button id="reset">Reset updates</button>
      <script>document.querySelector('form').onsubmit=e=>{e.preventDefault();document.querySelector('#saved').textContent=${JSON.stringify(faulty?'Save failed':'Settings saved')}};const u=document.querySelector('#updates');u.checked=localStorage.getItem('updates')==='yes';u.onchange=()=>{${faulty?'':'localStorage.setItem("updates",u.checked?"yes":"no");'}};document.querySelector('#reset').onclick=()=>{localStorage.removeItem('updates');u.checked=false;};</script>`));
    if(req.url.startsWith('/tasks'))return res.end(shell(`<h1>Tasks</h1><p>Signed in as Alex. Complete Sam task is disabled because Alex cannot complete another user's task. A nonempty New task followed by Add task shows Tasks: 1 in an empty list. Reset tasks empties the list. Show tools reveals a Help link; Help opens a page with heading Task help.</p>
      <button ${faulty?'':'disabled'}>Complete Sam task</button><label>New task<input id="new-task"></label><button id="add">Add task</button><output aria-label="Task count" id="count">Tasks: 0</output><button id="reset">Reset tasks</button><button id="tools">Show tools</button><div id="tools-panel"></div>
      <script>let count=0;document.querySelector('#add').onclick=()=>{if(document.querySelector('#new-task').value.trim()){count+=${faulty?0:1};document.querySelector('#count').textContent='Tasks: '+count;}};document.querySelector('#reset').onclick=()=>{count=0;document.querySelector('#new-task').value='';document.querySelector('#count').textContent='Tasks: 0';};document.querySelector('#tools').onclick=()=>document.querySelector('#tools-panel').innerHTML='<a href="/help">Help</a>';</script>`));
    if(req.url.startsWith('/help'))return res.end(shell(`<h1>${faulty?'Unavailable':'Task help'}</h1><p>Use a task name and Add task to create a task.</p>`));
    res.end(shell(`<h1>Shop</h1><p>Tea costs 10. Add Tea adds exactly one item to the empty cart, showing Cart items: 1. Quantity 2 shows Total: 20. Search Tea shows Tea. Latest search wins after Search ready appears. Tea followed immediately by Coffee should show Coffee. Reset cart empties the cart.</p>
      <button id="add">Add Tea</button><output aria-label="Cart count" id="cart">Cart items: 0</output><button id="reset">Reset cart</button><label>Quantity<input id="quantity" type="number" min="1" max="5" required value="1"></label><output aria-label="Order total" id="total">Total: 10</output>
      <label>Search<input id="search" type="search"></label><output aria-label="Search status" id="status">Search ready</output><output aria-label="Search results" id="results">No search yet</output>
      <script>let cart=0;document.querySelector('#add').onclick=()=>{cart+=${faulty?2:1};document.querySelector('#cart').textContent='Cart items: '+cart;};document.querySelector('#reset').onclick=()=>{cart=0;document.querySelector('#cart').textContent='Cart items: 0';};document.querySelector('#quantity').oninput=e=>document.querySelector('#total').textContent='Total: '+Number(e.target.value)*${faulty?11:10};let latest=0,pending=0;document.querySelector('#search').oninput=e=>{const text=e.target.value,id=++latest;pending++;document.querySelector('#status').textContent='Searching';setTimeout(()=>{if(${faulty?'true':'id===latest'})document.querySelector('#results').textContent=['Tea','Coffee','شاي'].filter(s=>s.toLowerCase().includes(text.toLowerCase())).join(', ')||'No matching results';if(--pending===0)document.querySelector('#status').textContent='Search ready';},text==='Tea'?650:20);};</script>`));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise(resolve=>server.close(resolve))};
}

// These expectations are independent of model-generated plans and findings.
export const acceptanceOracles=[
  {id:'cart',control:'Cart count',check:'textValue',expected:'Cart items: 1',faulty:'Cart items: 2'},
  {id:'quantity',control:'Order total',check:'textValue',expected:'Total: 20',faulty:'Total: 22'},
  {id:'search',control:'Search results',check:'textValue',expected:'Coffee',faulty:'Tea'},
  {id:'settings',control:'Save status',check:'textValue',expected:'Settings saved',faulty:'Save failed'},
  {id:'persistence',control:'Updates',check:'checked',expected:true,faulty:false},
  {id:'ownership',control:'Complete Sam task',check:'disabled',expected:true,faulty:false},
  {id:'tasks',control:'Task count',check:'textValue',expected:'Tasks: 1',faulty:'Tasks: 0'},
  {id:'dynamic-navigation',control:'',check:'text',expected:'Task help',faulty:false}
];

export function scoreAcceptance(report,faulty){
 const prefixFor=step=>{for(const c of report.cases||[])for(const e of c.executions||[]){const index=e.steps.findIndex(s=>s.id===step.id);if(index>=0)return e.steps.slice(0,index).filter(s=>['ok','passed'].includes(s.result?.status));}return [];};
 const prepared=(oracle,step)=>{
  const prefix=prefixFor(step),is=(s,action,control,value)=>s?.action?.action===action&&(!control||s.control===control)&&(value===undefined||s.action.value===value),index=(action,control,value)=>prefix.findIndex(s=>is(s,action,control,value));
  if(oracle.id==='cart')return index('click','Add Tea')>=0;
  if(oracle.id==='quantity')return index('type','Quantity','2')>=0;
  if(oracle.id==='search'){const typed=prefix.findIndex((s,i)=>is(s,'type','Search','Tea')&&is(prefix[i+1],'type','Search','Coffee'));return typed>=0&&prefix.slice(typed+2).some(s=>is(s,'assert','Search status')&&s.action.expected==='Search ready'&&s.result.status==='passed');}
  if(oracle.id==='settings'||oracle.id==='tasks'){const typed=prefix.findIndex(s=>is(s,'type',oracle.id==='settings'?'Team name':'New task')&&String(s.action.value||'').trim());return typed>=0&&prefix.slice(typed+1).some(s=>is(s,'click',oracle.id==='settings'?'Save settings':'Add task'));}
  if(oracle.id==='persistence'){const enabled=index('click','Updates');return enabled>=0&&prefix.slice(enabled+1).some(s=>is(s,'reload')||is(s,'navigate')&&/\/settings(?:[?#]|$)/.test(s.action.value));}
  if(oracle.id==='dynamic-navigation'){const revealed=index('click','Show tools');return revealed>=0&&prefix.slice(revealed+1).some(s=>is(s,'click','Help'));}
  return oracle.id==='ownership';
 };
 const matches=(oracle,step)=>step.action?.action==='assert'&&(step.action.check===oracle.check||oracle.check==='textValue'&&step.action.check==='text')&&step.action.expected===oracle.expected&&(!oracle.control||step.control===oracle.control)&&prepared(oracle,step);
 const functional=report.findings.filter(f=>f.kind==='functional'),byId=new Map(report.steps.map(s=>[s.id,s]));
 const failure=(oracle,finding)=>{const step=byId.get(finding.stepId)||{};return matches(oracle,step)&&(finding.actual===oracle.faulty||step.action.check==='text'&&finding.actual===false);};
 const covered=acceptanceOracles.filter(o=>report.steps.some(s=>matches(o,s)&&['passed','failed'].includes(s.result?.status))).map(o=>o.id);
 const detected=acceptanceOracles.filter(o=>functional.some(f=>failure(o,f))).map(o=>o.id);
 const reproduced=acceptanceOracles.filter(o=>functional.some(f=>f.confidence==='reproduced'&&failure(o,f))).map(o=>o.id);
 return {covered,detected,reproduced,misses:acceptanceOracles.map(o=>o.id).filter(id=>!(faulty?reproduced:covered).includes(id)),functionalFindings:functional.length,confirmedFalseAlarms:faulty?null:functional.filter(f=>f.confidence==='reproduced').length,coverage:websiteCoverage(report),metrics:report.metrics,status:report.status,message:report.message};
}
