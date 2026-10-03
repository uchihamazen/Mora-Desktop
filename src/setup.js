import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {discoverMuse} from './msp.js';
import {projectScripts} from './project.js';
import {packageCommand} from './project-work.js';

const exec=promisify(execFile);
export async function inspectSetup({root,account,connection,executable},{run=exec,findMuse=discoverMuse,readScripts=projectScripts,packageSettings=packageCommand}={}) {
  const options={windowsHide:true,timeout:5000,maxBuffer:64000};
  const tool=async(id,title,file,detail)=>{try{const result=await run(file,['--version'],options);return {id,title,status:'ready',detail:result.stdout.trim().slice(0,200)};}catch{return {id,title,status:'missing',detail};}};
  const [muse,node,git]=await Promise.all([
    findMuse(executable).then(()=>({id:'muse',title:'Muse engine',status:connection==='ready'?'ready':'unknown',detail:connection==='ready'?'Connected to your installed Muse.':'Installed. Use engine settings to reconnect.'})).catch(()=>({id:'muse',title:'Muse engine',status:'missing',detail:'Install Muse Code or choose its executable in engine settings.'})),
    tool('node','Node.js','node','Install Node.js, then restart Mora to refresh its command environment.'),
    tool('git','Git','git','Git was not found on PATH. Source reviews may use the existing Git fallback. Install Git for normal project tooling.')
  ]);
  const ready=['ready','signedIn','apiKey'].includes(account?.status);
  const checks=[muse,{id:'account',title:'Muse account',status:ready?'ready':account?.status==='required'?'missing':'unknown',detail:account?.message || (ready?'Your account is ready.':'Check sign-in in engine settings.')},node,git];
  if(root)try{
    const scripts=await readScripts(root);let manager;
    try{const settings=await packageSettings(scripts.manager);const result=await run(settings.file,settings.args,{...options,env:settings.env,windowsVerbatimArguments:settings.windowsVerbatimArguments});manager={status:'ready',detail:result.stdout.trim().slice(0,200)};}catch{manager={status:'missing',detail:`Install ${scripts.manager}, then restart Mora. This project selects ${scripts.manager}.`};}
    checks.push({id:'manager',title:`Package manager (${scripts.manager})`,...manager},{id:'commands',title:'Project commands',status:scripts.start?'ready':'unknown',detail:`Run: ${scripts.start || 'not configured'} · Checks: ${scripts.checks.join(', ') || 'not configured'}. Add scripts in package.json or describe your app in chat.`});
  }catch(error){checks.push({id:'commands',title:'Project commands',status:'unknown',detail:error.message});}
  return checks;
}
