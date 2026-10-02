export function setupTester(api,onError) {
  const button=document.getElementById('ai-tester');let state={},dialog,body,summary,stop,resume,solve,history,signature='',selected=new Set();
  const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const command=async(action,payload)=>{try{return await api.testerCommand(action,payload);}catch(error){onError(error);}};
  button.hidden=!api.testerCommand;
  function draw(){
    if(!dialog)return;const report=state.tester?.project===state.projectPath?state.tester:null;
    stop.hidden=!state.testerActive;resume.hidden=!report||!['paused','blocked','completed'].includes(report.status)||state.testerActive;
    resume.disabled=!report?.cases.some(c=>['not tested','blocked','suspected'].includes(c.status));
    solve.disabled=state.testerActive||!selected.size||report?.status==='stale'||state.executionMode!=='full';solve.title=state.executionMode==='full'?'Reproduce and repair selected findings':'Choose Full access in the chat controls to repair files';history.disabled=!!state.testerActive;
    summary.textContent=report?`${report.status} · ${report.actions} browser actions · ${report.message||''}`:'Run your app, then describe what should work. Checks use a separate browser and your Muse account.';
    const next=JSON.stringify(report);if(next===signature)return;signature=next;
    const opened=new Set([...body.querySelectorAll('details[open]')].map(n=>n.dataset.id));body.replaceChildren();
    if(!report)return;
    if(report.solver){body.append(el('h3','Repair result'),el('p',report.solver.message||report.solver.status));if(report.solver.checkpoint)body.append(el('p','Source recovery is saved in Checkpoints. Restoring source does not restore app data.'));}
    const counts=new Map();for(const c of report.cases)counts.set(c.status,(counts.get(c.status)||0)+1);
    body.append(el('p',[...counts].map(([status,count])=>`${count} ${status}`).join(' · ')||'Planning cases…'));
    for(const issue of report.issues){const label=el('label'),input=el('input');input.type='checkbox';input.checked=selected.has(issue.id);input.disabled=!!state.testerActive||report.status==='stale'||issue.status!=='confirmed';input.addEventListener('change',()=>{input.checked?selected.add(issue.id):selected.delete(issue.id);draw();});label.append(input,document.createTextNode(`${issue.id}: ${issue.title} (${issue.status})`));body.append(label);}
    for(const c of report.cases){
      const details=el('details');details.dataset.id=c.id;details.open=opened.has(c.id);details.append(el('summary',`${c.id} · ${c.status} · ${c.title}`),el('p',`Expected: ${c.expected}`));
      if(c.reason||c.note)details.append(el('p',[c.reason,c.note].filter(Boolean).join(' ')));
      if(c.grounding)details.append(el('p',`Expectation review: ${c.grounding.basis}`));
      const list=el('ol');for(const step of c.steps||[]){const row=el('li'),a=step.action,r=step.result;row.append(el('span',`${a.action}${a.target?' '+(typeof a.target==='string'?a.target:a.target.name):''}${a.action==='assert'?`: ${a.check} = ${a.expected}`:''} — ${r?.error|| (typeof r?.passed==='boolean'?(r.passed?'passed':'failed'):step.status)}`));
        if(r?.screenshot){const view=el('button','View evidence');view.type='button';view.addEventListener('click',async()=>{const data=await command('evidence',{id:report.id,name:r.screenshot.name});if(!data)return;const image=el('img');image.src=`data:image/png;base64,${data}`;image.alt=`Evidence for ${c.id}, ${step.id}`;row.append(image);view.remove();});row.append(view);}list.append(row);}
      details.append(list);if(c.replay)details.append(el('p',`Independent replay: ${c.replay.length} actions, ${c.status}`));body.append(details);
    }
    if(report.gaps?.length)body.append(el('h3','Coverage gaps'),el('p',report.gaps.join('\n')));
  }
  button.addEventListener('click',()=>{
    if(dialog)return;dialog=el('dialog');dialog.className='tester-dialog';dialog.setAttribute('aria-label','AI Tester');
    const heading=el('h2','AI Tester'),description=el('p','Check a local app, keep the evidence, and repair selected confirmed issues. Browser sessions reset between cases; server data can change. Use test data.');
    const form=el('form'),label=el('label','What should work?'),request=el('textarea');request.maxLength=12000;request.rows=3;request.setAttribute('aria-label','What should work?');request.placeholder='Example: a signed-in customer can add an item and keep their cart after reload.';label.append(request);
    const start=el('button','Start report');start.type='submit';form.append(label,start);form.addEventListener('submit',async event=>{event.preventDefault();start.disabled=true;selected.clear();await command('start',{request:request.value});start.disabled=!!state.testerActive;});
    const controls=el('div');controls.className='tester-controls';stop=el('button','Stop testing');stop.addEventListener('click',()=>command('stop'));
    resume=el('button','Resume unfinished cases');resume.addEventListener('click',()=>command('resume',{id:state.tester.id}));
    solve=el('button','Repair selected issues');solve.addEventListener('click',()=>command('solve',{id:state.tester.id,issues:[...selected]}));
    history=el('button','Saved reports');history.addEventListener('click',async()=>{const reports=await command('list');if(!reports)return;body.replaceChildren();signature='';for(const r of reports){const load=el('button',`${new Date(r.createdAt).toLocaleString()} · ${r.status} · ${r.cases.length} cases`);load.addEventListener('click',async()=>{selected.clear();await command('load',{id:r.id});});body.append(load);}if(!reports.length)body.append(el('p','No saved reports for this project.'));});
    const close=el('button','Close');close.addEventListener('click',()=>dialog.close());controls.append(stop,resume,solve,history,close);
    summary=el('p');summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');body=el('div');body.className='tester-report';
    dialog.append(heading,description,form,controls,summary,body);dialog.addEventListener('close',()=>{dialog.remove();dialog=null;signature='';api.browserCommand?.('occlude',{hidden:false}).catch(()=>{});button.focus();});
    api.browserCommand?.('occlude',{hidden:true}).catch(()=>{});document.body.append(dialog);draw();dialog.showModal();request.focus();
    dialog.refreshStart=()=>{start.disabled=!!state.testerActive||!!state.busy;};dialog.refreshStart();
    if(state.tester?.project===state.projectPath&&!state.testerActive)command('load',{id:state.tester.id});
  });
  return next=>{if(next.projectPath!==state.projectPath){selected.clear();signature='';dialog?.close();}state=next;button.disabled=!state.projectPath||!!state.loading;dialog?.refreshStart();draw();};
}
