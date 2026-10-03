export function restoreWindowBounds(saved,areas) {
  const defaults={width:1230,height:850};
  const valid=saved && ['x','y','width','height'].every(key=>Number.isFinite(saved[key])) && saved.width>0 && saved.height>0;
  const overlap=area=>valid?Math.max(0,Math.min(saved.x+saved.width,area.x+area.width)-Math.max(saved.x,area.x))*Math.max(0,Math.min(saved.y+saved.height,area.y+area.height)-Math.max(saved.y,area.y)):0;
  const area=areas.reduce((best,next)=>overlap(next)>overlap(best)?next:best,areas[0]);
  const width=Math.round(Math.min(area.width,Math.max(Math.min(860,area.width),valid?saved.width:defaults.width)));
  const height=Math.round(Math.min(area.height,Math.max(Math.min(620,area.height),valid?saved.height:defaults.height)));
  const x=Math.round(Math.max(area.x,Math.min(area.x+area.width-width,valid&&overlap(area)?saved.x:area.x+(area.width-width)/2)));
  const y=Math.round(Math.max(area.y,Math.min(area.y+area.height-height,valid&&overlap(area)?saved.y:area.y+(area.height-height)/2)));
  return {x,y,width,height,maximized:saved?.maximized===true};
}

export class CompletionSignals {
  constructor({foreground,playSound,save}){this.foreground=foreground;this.playSound=playSound;this.save=save;this.seen=new Set();this.reports=new Map();this.enabled=true;}
  report(state,kind,value) {
    const key=`${kind}:${value.id}`,active=['running','reproducing','solving','awaiting permission'];
    const previous=this.reports.get(key) || {generation:0,status:null};
    const generation=previous.generation+(active.includes(value.status) && !active.includes(previous.status)?1:0);
    this.reports.set(key,{generation,status:value.status});if(this.reports.size>256)this.reports.delete(this.reports.keys().next().value);
    if(value.status==='awaiting permission' && value.pending?.id)this.complete(state,{turnId:`${key}:${generation}:${value.pending.id}`,status:'attention',title:`${kind} needs permission`});
    else if(active.includes(previous.status) && ['done','completed','blocked','paused'].includes(value.status)) {
      const repair=previous.status==='solving',solver=value.solver?.status;if(repair && solver==='stopped')return;
      const status=value.status==='blocked' || repair&&solver==='blocked'?'failed':value.status==='paused' || repair&&solver!=='verified'?'attention':'finished';
      this.complete(state,{turnId:`${key}:${generation}:complete`,status,title:repair?(status==='finished'?'Project repair verified':'Project repair needs review'):`${kind} ${status==='finished'?'finished':status==='failed'?'blocked':'paused'}`});
    }
  }
  complete(state,outcome) {
    if(!outcome?.turnId || !['finished','failed','attention'].includes(outcome.status) || this.seen.has(outcome.turnId))return;
    this.seen.add(outcome.turnId);if(this.seen.size>256)this.seen.delete(this.seen.values().next().value);
    const chat=state.sessions.find(session=>session.sessionId===state.sessionId);
    if(!chat)return;
    if(!this.foreground()){chat.unread=true;this.save();}
    if(this.enabled && outcome.status==='finished')this.playSound();
  }
}
