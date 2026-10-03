export function setupReadiness(api,onError,openSettings) {
  const $=id=>document.getElementById(id),node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
  const settings=node('button','Check setup');settings.id='check-setup';const welcome=node('button','Check setup');welcome.id='welcome-setup';
  $('settings-panel').prepend(settings);document.querySelector('.welcome-project-actions').append(welcome);
  let current={};
  async function open() {
    if(document.querySelector('.setup-dialog'))return;
    const dialog=node('dialog','');dialog.className='workspace-dialog setup-dialog';dialog.setAttribute('aria-label','Setup readiness');
    const body=node('div','');body.className='setup-checks';const status=node('p','Checking local tools…');status.setAttribute('role','status');
    const again=node('button','Check again'),engine=node('button','Open engine settings'),close=node('button','Close setup');
    const links=node('div','');
    for(const [label,url] of [['Get Node.js','https://nodejs.org/en/download'],['Get Git','https://git-scm.com/downloads']]){const button=node('button',label);button.addEventListener('click',()=>api.openLink(url).catch(onError));links.append(button);}
    async function check(){again.disabled=true;status.textContent='Checking local tools…';try{const checks=await api.inspectSetup();if(!dialog.isConnected)return;body.replaceChildren();for(const item of checks){const row=node('div','');row.append(node('strong',`${item.title}: ${item.status}`),node('p',item.detail));body.append(row);}status.textContent='These checks do not install tools or change your account. Open a project, describe your app, then use Run my app and Test my app.';}catch(error){status.textContent=error.message;}finally{again.disabled=false;}}
    again.addEventListener('click',check);close.addEventListener('click',()=>dialog.close());engine.addEventListener('click',()=>{dialog.close();openSettings();});
    dialog.append(node('h2','Ready to build?'),node('p','Check your installed engine, account and local project tools.'),body,status,again,engine,links,close);
    dialog.addEventListener('close',()=>{dialog.remove();api.browserCommand?.('occlude',{hidden:!!document.querySelector('.changes-panel,dialog[open]')}).catch(()=>{});if(document.activeElement!==document.body&&!dialog.contains(document.activeElement))return;(current.items?.length?settings:welcome).focus();});
    document.body.append(dialog);api.browserCommand?.('occlude',{hidden:true}).catch(()=>{});dialog.showModal();close.focus();await check();
  }
  for(const button of [settings,welcome]){button.hidden=!api.inspectSetup;button.addEventListener('click',open);}
  return state=>{current=state;for(const button of [settings,welcome])button.disabled=!!(state.busy||state.loading||state.projectOperation||state.projectRepair||state.testerActive||state.websiteActive||state.connection==='connecting');};
}
