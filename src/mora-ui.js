const node=(tag,text,className)=>{const element=document.createElement(tag);element.textContent=text;if(className)element.className=className;return element;};

export function setupMoraMode(api,error){
  const toggle=document.getElementById('mora-mode-toggle'),panel=document.getElementById('mora-mode-panel'),list=document.getElementById('mora-task-list'),status=document.getElementById('mora-mode-status'),stop=document.getElementById('mora-mode-stop');let state={},signature='';
  const run=async(action,payload)=>{try{await api.moraModeCommand(action,payload);}catch(cause){error(cause);}};
  toggle.addEventListener('click',()=>run('enable',{enabled:!state.moraMode?.enabled}));stop.addEventListener('click',()=>run('stop'));
  return next=>{
    state=next;const mode=state.moraMode,tasks=mode?.tasks||[],running=tasks.some(task=>['pending','running'].includes(task.status));
    toggle.hidden=!api.moraModeCommand;toggle.disabled=!state.projectPath||state.busy||state.loading||state.connection!=='ready';toggle.setAttribute('aria-pressed',String(mode?.enabled===true));panel.hidden=!mode?.enabled;stop.hidden=!running&&!mode?.replying;
    status.textContent=mode?.replying?'Replying · you can send another message':running?`${tasks.filter(task=>task.status==='running').length} working · chat is open`:'Chat is open · up to 3 workers';
    if(mode?.skills?.missing.length)status.textContent+=' · '+(mode.skills.available.length?'Some skills unavailable':'Skills unavailable; native fallback');status.title=mode?.skills?.missing.length?'Unavailable: '+mode.skills.missing.join(', '):'';
    const value=JSON.stringify({owner:state.sessionId,tasks,requests:mode?.requests});if(signature===value)return;signature=value;const forms=new Map([...list.querySelectorAll('.mora-task[data-task-id]')].filter(row=>row.querySelector('form')).map(row=>[row.dataset.taskId,row.querySelector('form')])),focused=list.contains(document.activeElement)?document.activeElement:null;list.replaceChildren();
    for(const request of mode?.requests||[])if(['pending','running','interrupted','error'].includes(request.status)){
      const row=node('div','','mora-task'),label=node('span',request.text.slice(0,70),'mora-task-title');row.append(label,node('span',request.status==='pending'?'Saved':request.status==='running'?'Delivered':'Paused','mora-receipt'));
      if(['interrupted','error'].includes(request.status)){const resume=node('button','Retry reply','mora-task-action');resume.addEventListener('click',()=>run('resume-request',{id:request.id}));row.append(resume);}list.append(row);
    }
    for(const task of tasks.filter((task,index)=>task.status!=='success'||index>=tasks.length-12)){
      const row=node('div','','mora-task'),title=node('span',task.title,'mora-task-title'),receipt=node('span',task.receipt||task.status,'mora-receipt');title.title=`${task.files.join(', ')}${task.detail?'\n'+task.detail:''}`;row.dataset.taskId=task.id;row.append(title,receipt);
      if(['pending','running'].includes(task.status)){
        const steer=node('button','Steer','mora-task-action'),cancel=node('button','Stop','mora-task-action');cancel.setAttribute('aria-label',`Stop task ${task.title}`);cancel.addEventListener('click',()=>run('cancel',{id:task.id}));steer.setAttribute('aria-label',`Steer task ${task.title}`);
        steer.addEventListener('click',()=>{if(row.querySelector('form'))return;const form=node('form','','mora-steer'),input=node('textarea','');input.setAttribute('aria-label',`Update task ${task.title}`);input.placeholder='What should change?';input.maxLength=50000;const save=node('button','Send update','mora-task-action'),close=node('button','Cancel','mora-task-action');save.type='submit';close.type='button';close.addEventListener('click',()=>form.remove());form.addEventListener('submit',async event=>{event.preventDefault();if(!input.value.trim())return;save.disabled=true;try{await api.moraModeCommand('steer',{id:task.id,message:input.value});form.remove();}catch(cause){error(cause);save.disabled=false;}});form.append(input,save,close);row.append(form);input.focus();});row.append(steer,cancel);
      }else if(['interrupted','cancelled','error'].includes(task.status)){const resume=node('button','Resume','mora-task-action');resume.setAttribute('aria-label',`Resume task ${task.title}`);resume.addEventListener('click',()=>run('resume',{id:task.id}));row.append(resume);}
      if(forms.has(task.id))row.append(forms.get(task.id));if(task.detail&&['error','interrupted'].includes(task.status))row.append(node('small',task.detail,'mora-task-detail'));
      if(task.result){
        const details=node('details','','mora-result-detail'),summary=node('summary','Review result');details.append(summary);
        for(const file of task.result.files||[])details.append(node('p',`${file.status}: ${file.path}`));
        if(task.result.skills)details.append(node('p','Skills loaded: '+([...new Set(task.result.skills.map(skill=>skill.label))].join(', ')||'none')));
        if(task.result.missingSkills?.length)details.append(node('p','Unavailable skills: '+task.result.missingSkills.join(', ')));
        for(const check of task.result.checks||[]){details.append(node('p',`${check.passed?'Passed':'Failed'} · ${check.name}`));if(!check.passed&&check.output)details.append(node('pre',check.output));}
        details.append(node('p',`Browser: ${task.result.browser||'Not checked'}`));if(task.result.browserEvidence?.kind==='smoke')details.append(node('p','Page loading was checked. Workflow interactions were not checked.'));
        if(task.result.browserEvidence?.screenshot){const evidence=node('button','View screenshot','mora-task-action');evidence.type='button';evidence.addEventListener('click',async()=>{evidence.disabled=true;try{const result=await api.moraModeCommand('evidence',{id:task.id}),dialog=node('dialog','','mora-evidence-dialog'),title=node('h3',`Browser evidence · ${task.title}`),image=document.createElement('img'),close=node('button','Close','mora-task-action');title.id='mora-evidence-title';dialog.setAttribute('aria-labelledby',title.id);image.src=result.image;image.alt=`Browser verification for ${task.title}`;close.type='button';close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{dialog.remove();evidence.focus();},{once:true});dialog.append(title,image,close);document.body.append(dialog);dialog.showModal();}catch(cause){error(cause);}finally{evidence.disabled=false;}});details.append(evidence);}
        row.append(details);
      }
      list.append(row);
    }
    if(focused?.isConnected)focused.focus();
  };
}
