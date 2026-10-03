export class HistoryWindow {
  sessionId;
  limit=200;
  project(state) {
    if(this.sessionId!==state.sessionId){this.sessionId=state.sessionId;this.limit=200;}
    const all=state.items || [],live=state.busy&&all.find(item=>item.kind==='fileChanges'&&item.live&&item.files?.length);
    const items=[];let historyCount=0;
    for(let index=all.length-1;index>=0;index--){const item=all[index];if(item.retracted || item===live)continue;historyCount++;if(items.length<this.limit)items.push(item);}
    items.reverse();if(live)items.push(live);
    const turn=state.lastOutcome?.turnId;
    const lastOutcomeOperations=turn?all.filter(item=>item.turnId===turn&&['toolCall','userShell'].includes(item.kind)).map(({description,tool,commandText,status,exitCode})=>({description,tool,commandText,status,exitCode})):[];
    const lastOutcomeReview=turn?all.find(item=>item.turnId===turn&&item.kind==='fileChanges'):undefined;
    return {...state,items,historyCount,historyWindowSize:this.limit,lastOutcomeOperations,lastOutcomeReview};
  }
  older(state,sessionId) {
    if(state.sessionId!==sessionId || state.loading)throw Error('The chat changed. Load its older messages again.');
    this.project(state);this.limit+=200;return this.project(state);
  }
}
