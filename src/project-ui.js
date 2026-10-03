export function setupProjects(api,action) {
  const $=id=>document.getElementById(id);
  let current={};
  const brief=document.createElement('button');brief.id='project-brief';brief.textContent='Project brief';brief.hidden=!api.projectBriefCommand;$('checkpoints').after(brief);
  brief.addEventListener('click',()=>action(async()=>{
    if(document.querySelector('.brief-dialog'))return;
    const root=current.projectPath,dialog=document.createElement('dialog');dialog.className='workspace-dialog brief-dialog';dialog.setAttribute('aria-label','Project brief');
    const heading=document.createElement('h2');heading.textContent='Project brief';
    const note=document.createElement('p');note.textContent='Shared by all chats in this project. Keep the goal, decisions, run commands and things to preserve here. Saved in .mora/project-brief.md and used on each request.';
    const input=document.createElement('textarea');input.rows=12;input.maxLength=24000;input.setAttribute('aria-label','Shared project brief');input.placeholder='# Goal\n\n# Important decisions\n\n# Run and test commands\n\n# Things to preserve';
    const status=document.createElement('p');status.setAttribute('role','status');
    const save=document.createElement('button');save.textContent='Save brief';const reload=document.createElement('button');reload.textContent='Reload brief';const close=document.createElement('button');close.textContent='Close brief';
    let saved,loading=true,discard=false;
    const dirty=()=>saved && input.value!==saved.text.replace(/\r\n?/g,'\n');
    const controls=()=>{input.readOnly=loading||current.executionMode!=='full';save.disabled=loading||current.executionMode!=='full'||current.busy||current.loading||current.projectOperation||current.projectRepair||current.testerActive||current.websiteActive;reload.disabled=loading;if(!loading&&current.executionMode!=='full')status.textContent='Choose Full access to edit this brief.';};
    dialog.refresh=controls;
    async function load(){loading=true;controls();try{const value=await api.projectBriefCommand('read',{projectPath:root});if(current.projectPath!==root)throw Error('The project changed.');saved=value;input.value=value.text;status.textContent='';discard=false;}catch(error){status.textContent=error.message;}finally{loading=false;controls();}}
    save.addEventListener('click',async()=>{if(!saved)return;loading=true;controls();try{saved=await api.projectBriefCommand('save',{projectPath:root,text:input.value,revision:saved.revision});status.textContent='Brief saved. The next request will use it.';discard=false;}catch(error){status.textContent=error.message;}finally{loading=false;controls();}});
    reload.addEventListener('click',()=>{if(dirty()&&!discard){discard=true;status.textContent='Your text has not been saved. Press Reload brief again to discard it.';return;}load();});
    const closing=()=>{if(loading)return;if(dirty()&&!discard){discard=true;status.textContent='Your text has not been saved. Press Close brief again to discard it.';return;}dialog.close();};
    close.addEventListener('click',closing);dialog.addEventListener('cancel',event=>{event.preventDefault();closing();});input.addEventListener('input',()=>{discard=false;});
    dialog.append(heading,note,input,status,save,reload,close);dialog.addEventListener('close',()=>{dialog.remove();api.browserCommand?.('occlude',{hidden:!!document.querySelector('.changes-panel,.image-viewer[open]')}).catch(()=>{});brief.focus();});
    document.body.append(dialog);api.browserCommand?.('occlude',{hidden:true}).catch(()=>{});dialog.showModal();await load();input.focus();
  }));
  function create() {
    const dialog=document.createElement('dialog');dialog.className='workspace-dialog';
    const form=document.createElement('form');
    const heading=document.createElement('h2');heading.textContent='Start a project';
    const label=document.createElement('label');label.textContent='Project name';
    const input=document.createElement('input');input.name='project-name';input.maxLength=64;input.required=true;input.setAttribute('aria-label','Project name');label.append(input);
    const parent=document.createElement('button');parent.type='button';parent.textContent='Choose parent folder';
    const location=document.createElement('p');location.className='muted';location.textContent='Choose where the new folder will live.';
    const starterLabel=document.createElement('label'),starter=document.createElement('input');starter.type='checkbox';starter.checked=true;starterLabel.append(starter,document.createTextNode(' Add a working starter app'));
    const note=document.createElement('p');note.textContent='The starter needs Node.js and no additional packages. You can change it with Muse.';
    const status=document.createElement('p');status.setAttribute('role','alert');
    const submit=document.createElement('button');submit.textContent='Create project';submit.disabled=true;
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.addEventListener('click',()=>dialog.close());
    form.append(heading,label,parent,location,starterLabel,note,status,submit,cancel);dialog.append(form);
    let parentPath;
    parent.addEventListener('click',async()=>{try{parentPath=await api.chooseProjectParent();location.textContent=parentPath || 'Choose a parent folder.';submit.disabled=!parentPath;}catch(error){status.textContent=error.message;}});
    form.addEventListener('submit',async event=>{
      event.preventDefault();submit.disabled=true;status.textContent='Creating your project…';
      const result=await action(()=>api.createProject({parent:parentPath,name:input.value.trim(),starter:starter.checked}));
      if(result)dialog.close();else{status.textContent='The project could not be created. Check the message in chat.';submit.disabled=false;}
    });
    dialog.addEventListener('close',()=>{dialog.remove();api.browserCommand?.('occlude',{hidden:!!document.querySelector('.changes-panel, .image-viewer[open]')}).catch(()=>{});});
    api.browserCommand?.('occlude',{hidden:true}).catch(()=>{});document.body.append(dialog);dialog.showModal();input.focus();
  }
  for(const id of ['create-project','welcome-project']) {
    $(id).disabled=!api.createProject;
    $(id).addEventListener('click',()=>{if(api.createProject)create();});
  }
  $('open-project').addEventListener('click',()=>action(()=>api.chooseWorkspace()));
  return state=>{current=state;brief.hidden=!state.projectPath || !api.projectBriefCommand;brief.disabled=!!state.loading;document.querySelector('.brief-dialog')?.refresh?.();for(const id of ['create-project','welcome-project','open-project'])$(id).disabled=!api.createProject || state.busy || state.loading || state.projectOperation || state.projectRepair || ['starting','ready','stopping'].includes(state.projectWork?.run?.status);};
}
