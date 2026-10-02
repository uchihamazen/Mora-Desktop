export function setupProjects(api,action) {
  const $=id=>document.getElementById(id);
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
  return state=>{for(const id of ['create-project','welcome-project','open-project'])$(id).disabled=!api.createProject || state.busy || state.loading || state.projectOperation || state.projectRepair || ['starting','ready','stopping'].includes(state.projectWork?.run?.status);};
}
