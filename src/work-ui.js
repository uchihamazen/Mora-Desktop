export function setupProjectWork(api,action) {
  const $=id=>document.getElementById(id),node=(tag,text)=>{const value=document.createElement(tag);value.textContent=text;return value;};
  let current,signature;
  for(const [id,name] of [['run-project','run'],['restart-project','restart'],['stop-project','stop'],['test-project','test'],['stop-tests','stop-tests'],['fix-tests','fix']])$(id).addEventListener('click',()=>action(()=>api.projectCommand(name),{flush:!name.startsWith('stop')}));
  $('project-output').addEventListener('click',()=>{const hidden=$('project-results').hidden;$('project-results').hidden=!hidden;$('project-output').textContent=hidden?'Hide results':'Show results';$('project-output').setAttribute('aria-expanded',String(hidden));});
  $('checkpoints').addEventListener('click',async()=>{
    const root=current.projectPath,dialog=node('dialog','');dialog.className='workspace-dialog checkpoint-dialog';
    const title=node('h2','Project checkpoints'),intro=node('p','Source files are saved locally. Secrets and generated files are excluded.'),body=node('div',''),status=node('p','');status.setAttribute('role','alert');
    const create=node('button','Save checkpoint'),close=node('button','Close');close.addEventListener('click',()=>dialog.close());
    dialog.append(title,intro,body,status,create,close);
    const invoke=async(fn)=>{try{status.textContent='';if(current.projectPath!==root || current.busy || current.projectOperation || ['starting','ready','stopping'].includes(current.projectWork?.run?.status))throw new Error('Stop project work before changing checkpoints.');return await fn();}catch(error){status.textContent=error.message;}};
    async function list(){const checkpoints=await api.checkpointCommand('list');body.replaceChildren();if(!checkpoints.length)body.append(node('p','No checkpoints yet. Full access requests and project commands save one automatically.'));
      for(const item of checkpoints){const row=node('div','');row.className='checkpoint-row';row.append(node('strong',item.label),node('small',`${new Date(item.createdAt).toLocaleString()} · ${item.fileCount} files`));
        const preview=node('button','Review restore');preview.addEventListener('click',()=>invoke(async()=>show(await api.checkpointCommand('preview',{id:item.id}))));
        const remove=node('button','Delete');remove.addEventListener('click',()=>invoke(async()=>{if(!remove.dataset.confirm){remove.dataset.confirm='1';remove.textContent='Confirm delete';return;}await api.checkpointCommand('delete',{id:item.id});await list();}));row.append(preview,remove);body.append(row);}
    }
    function show(preview){body.replaceChildren(node('h3',preview.checkpoint.label),node('p','Select the files to restore. A recovery checkpoint will be saved first.'));
      const selections=[];for(const item of preview.changes){const label=node('label',''),check=document.createElement('input');check.type='checkbox';check.checked=!item.conflict && !preview.checkpoint.manual;selections.push({path:item.path,check});label.append(check,document.createTextNode(`${item.path} · ${item.status}${item.conflict?' · newer edits':''}`));body.append(label);}
      const warning=node('label',''),ack=document.createElement('input');ack.type='checkbox';warning.append(ack,document.createTextNode(' I understand selected newer edits will be replaced.'));warning.hidden=!preview.changes.some(item=>item.conflict);body.append(warning);
      const restore=node('button','Restore selected files');restore.disabled=!preview.changes.length;restore.addEventListener('click',()=>invoke(async()=>{restore.disabled=true;try{const result=await api.checkpointCommand('restore',{token:preview.token,paths:selections.filter(item=>item.check.checked).map(item=>item.path),allowConflicts:ack.checked});await list();status.textContent=`Restored ${result.restored} files. Recovery checkpoint saved.`;}finally{restore.disabled=false;}}));
      const back=node('button','Back to checkpoints');back.addEventListener('click',()=>invoke(list));body.append(restore,back);if(!preview.changes.length)body.append(node('p','No files need restoring.'));
    }
    create.addEventListener('click',()=>invoke(async()=>{create.disabled=true;try{await api.checkpointCommand('create',{label:'Saved checkpoint'});await list();}finally{create.disabled=false;}}));
    dialog.addEventListener('close',()=>{dialog.remove();api.browserCommand?.('occlude',{hidden:!!document.querySelector('.changes-panel,.image-viewer[open]')}).catch(()=>{});});document.body.append(dialog);api.browserCommand?.('occlude',{hidden:true}).catch(()=>{});dialog.showModal();close.focus();await invoke(list);
  });
  return state=>{
    current=state;const work=state.projectWork?.root===state.projectPath?state.projectWork:null,run=work?.run || {status:'stopped'},tests=work?.tests || {status:'not checked'};
    $('project-toolbar').hidden=!state.projectPath || !api.projectCommand;
    const busy=state.testerActive || state.busy || state.loading || state.projectOperation || state.projectRepair;
    $('run-project').hidden=['starting','ready','stopping'].includes(run.status);$('run-project').disabled=busy;
    $('restart-project').hidden=!['starting','ready','stopping'].includes(run.status);$('restart-project').disabled=busy;
    $('stop-project').hidden=!['starting','ready','stopping'].includes(run.status);$('stop-project').disabled=state.testerActive || run.status==='stopping';
    $('test-project').disabled=busy;$('stop-tests').hidden=tests.status!=='running' && !state.projectOperation;
    $('fix-tests').hidden=tests.status!=='failed';$('fix-tests').disabled=busy || state.executionMode!=='full' || state.connection!=='ready';$('fix-tests').title=state.executionMode==='full'?'Ask Muse to repair, then test once':'Choose Full access to repair project files';
    $('checkpoints').disabled=busy || ['starting','ready','stopping'].includes(run.status);
    $('project-work-status').textContent=state.projectRepair?'Muse is fixing failures…':state.projectOperation && tests.status!=='running'?'Saving checkpoint…':tests.status==='running'?'Running checks…':run.status==='ready'?'App running':tests.message || run.message || '';
    const next=JSON.stringify([state.projectPath,work]);if(next===signature)return;signature=next;const results=$('project-results');results.replaceChildren();
    const section=(heading,text,output)=>{const group=node('div','');group.append(node('strong',heading),node('p',text));if(output){const detail=node('details',''),summary=node('summary','Output'),pre=node('pre',output);detail.append(summary,pre);group.append(detail);}results.append(group);};
    section('Run',run.message || 'App has not been run.',run.output);
    for(const item of tests.results || [])section(`${item.script}: ${item.status}`,item.message || 'Running…',item.output);
    section('Page load',tests.preview?.message || 'Not checked. Run the app first.');section('Interactions','Not checked by Mora. Configure project tests for the behaviors that matter.');
  };
}
