export class HistoryWindow {
  sessionId;
  limit=200;
  anchorId=null;
  project(state) {
    if(this.sessionId!==state.sessionId){this.sessionId=state.sessionId;this.limit=200;this.anchorId=null;}
    const all=state.items || [],live=state.busy&&all.find(item=>item.kind==='fileChanges'&&item.live&&item.files?.length);
    const history=all.filter(item=>!item.retracted&&item!==live),historyCount=history.length;
    const anchor=this.anchorId?history.findIndex(item=>item.itemId===this.anchorId):-1,end=anchor<0?history.length:anchor+1,start=Math.max(0,end-this.limit),items=history.slice(start,end);if(live)items.push(live);
    const turn=state.lastOutcome?.turnId;
    const lastOutcomeOperations=turn?all.filter(item=>item.turnId===turn&&['toolCall','userShell'].includes(item.kind)).map(({description,tool,commandText,status,exitCode})=>({description,tool,commandText,status,exitCode})):[];
    const lastOutcomeReview=turn?all.find(item=>item.turnId===turn&&item.kind==='fileChanges'):undefined;
    return {...state,items,historyCount,historyWindowBefore:start,historyWindowAfter:history.length-end,historyWindowSize:this.limit,lastOutcomeOperations,lastOutcomeReview};
  }
  jump(state,sessionId,itemId) {
    if(state.sessionId!==sessionId||state.loading)throw Error('The chat changed. Search its messages again.');
    this.project(state);this.limit=200;
    if(itemId==='latest')this.anchorId=null;
    else {const live=state.busy&&state.items.find(item=>item.kind==='fileChanges'&&item.live&&item.files?.length),history=state.items.filter(item=>!item.retracted&&item!==live),index=history.findIndex(item=>item.itemId===itemId);if(index<0)throw Error('This result is no longer in the conversation. Search again.');this.anchorId=history[Math.min(history.length-1,index+99)].itemId;}
    return this.project(state);
  }
  older(state,sessionId) {
    if(state.sessionId!==sessionId || state.loading)throw Error('The chat changed. Load its older messages again.');
    this.project(state);this.limit+=200;return this.project(state);
  }
}
