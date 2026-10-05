// Keep renderer explanations and main-process guards on the same rules.
export function idleReason(state) {
  if(state.moraAdmitting)return 'A Mora Mode message is being saved. Wait before changing chats, projects or settings.';
  if(state.moraMode?.replying || state.moraMode?.tasks?.some(task=>['pending','running'].includes(task.status)))return 'Stop Mora Mode work before changing chats, projects or settings.';
  if(state.testerActive || state.websiteActive)return 'Stop testing before changing chats, projects or settings.';
  if(state.loading)return 'A conversation is loading. Wait before switching or sending.';
  if(state.busy)return 'A request is running. Stop it before switching chats or projects.';
  return '';
}
export function moraToggleReason(state,{enabling=!state.moraMode?.enabled}={}) {
  if(!state.projectPath)return 'Open a project chat to use Mora Mode.';
  const idle=idleReason(state);if(idle)return idle;
  if(state.projectOperation || state.projectRepair || ['starting','testing','stopping'].includes(state.projectWork?.run?.status) || state.projectWork?.tests?.status==='running')return 'Stop Run and Test before switching modes.';
  if(state.pendingQueue?.length || state.activeRequest)return 'Resolve the saved request or ordinary queue before switching modes.';
  if(enabling&&state.connection!=='ready')return 'Connect to Muse before using Mora Mode.';
  return '';
}
export function taskPhase(task) {
  if(task.status==='success')return task.result?.files?.length?'Applied':'Completed';
  if(task.status==='pending')return task.dependsOn?.length?'Waiting for dependency':'Queued';
  if(task.status==='running')return /check|verif|review/i.test(task.detail||'')?'Checking':'Working';
  if(task.status==='error')return 'Blocked';
  if(task.status==='interrupted' || task.status==='cancelled')return 'Interrupted';
  return task.status||'Queued';
}
