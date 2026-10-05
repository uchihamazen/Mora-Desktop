import test from 'node:test';
import assert from 'node:assert/strict';
const {HistoryWindow}=await import('../src/history-window.js').catch(()=>({}));
test('a live review row cannot become an invisible jump anchor',()=>{const items=Array.from({length:1001},(_,index)=>({itemId:'item-'+index,kind:'userMessage'}));items[99]={itemId:'live',kind:'fileChanges',live:true,files:[{}]};const result=new HistoryWindow().jump({sessionId:'chat',items,busy:true},'chat','item-0');assert.ok(result.items.some(item=>item.itemId==='item-0'));assert.equal(result.items.at(-1).itemId,'live');});
test('search jumps keep a bounded DOM window and preserve draft, live tail and ownership',()=>{
  const view=new HistoryWindow(),items=Array.from({length:5000},(_,index)=>({itemId:'message-'+index,kind:'userMessage',text:'message '+index})),state={sessionId:'chat',items,draft:{text:'preserve'}};
  const found=view.jump(state,'chat','message-1000');assert.equal(found.items.length,200);assert.ok(found.items.some(item=>item.itemId==='message-1000'));assert.equal(found.historyWindowBefore,900);assert.equal(found.historyWindowAfter,3900);assert.equal(found.draft,state.draft);
  const expanded=view.older(state,'chat');assert.equal(expanded.items.length,400);assert.equal(expanded.historyWindowBefore,700);assert.equal(view.jump(state,'chat','latest').items[0].itemId,'message-4800');assert.throws(()=>view.jump(state,'other','message-1'),/chat changed/);assert.throws(()=>view.jump(state,'chat','gone'),/no longer/);
});
test('live snapshots bound old transcript bytes while preserving state and complete operation outcomes',()=>{
  assert.equal(typeof HistoryWindow,'function');
  const view=new HistoryWindow(),items=Array.from({length:5000},(_,i)=>({itemId:'item-'+i,turnId:'turn',kind:'toolCall',description:'Operation '+i,status:'completed',visibleOutput:'x'.repeat(1000)}));
  const state={sessionId:'chat',items,lastOutcome:{turnId:'turn'},draft:{text:'Keep draft'},pendingQueue:[{queueId:'pending'}]};
  const snapshot=view.project(state);
  assert.equal(snapshot.items.length,200);assert.equal(snapshot.items[0].itemId,'item-4800');assert.equal(snapshot.historyCount,5000);
  assert.equal(snapshot.lastOutcomeOperations.length,5000);assert.equal(snapshot.lastOutcomeOperations[0].description,'Operation 0');assert.equal(snapshot.lastOutcomeOperations[0].visibleOutput,undefined);
  assert.equal(snapshot.draft,state.draft);assert.equal(snapshot.pendingQueue,state.pendingQueue);assert.equal(state.items.length,5000);
  assert.ok(JSON.stringify(snapshot).length<JSON.stringify(state).length/5);
});
test('older history expands on request, resets per chat and rejects a stale owner',()=>{
  assert.equal(typeof HistoryWindow,'function');
  const view=new HistoryWindow(),state={sessionId:'one',items:Array.from({length:600},(_,i)=>({itemId:String(i),kind:'userMessage',text:String(i)}))};
  assert.equal(view.project(state).items.length,200);
  assert.equal(view.older(state,'one').items.length,400);assert.equal(view.project(state).historyWindowSize,400);
  assert.equal(view.older(state,'one').items.length,600);
  const switched={...state,sessionId:'two'};assert.equal(view.project(switched).items.length,200);assert.throws(()=>view.older(switched,'one'),/chat changed/i);
});
test('live reviews and outcome reviews stay available outside the window; retractions remain hidden',()=>{
  assert.equal(typeof HistoryWindow,'function');
  const live={itemId:'live',kind:'fileChanges',live:true,files:[{path:'app.js'}]},review={itemId:'review',turnId:'finished',kind:'fileChanges',files:[{path:'old.js'}]};
  const state={sessionId:'chat',busy:true,lastOutcome:{turnId:'finished'},items:[live,review,...Array.from({length:300},(_,i)=>({itemId:String(i),kind:'userMessage'})),{itemId:'retracted',retracted:true}]};
  const snapshot=new HistoryWindow().project(state);
  assert.equal(snapshot.items.length,201);assert.equal(snapshot.items.at(-1),live);assert.equal(snapshot.historyCount,301);assert.equal(snapshot.lastOutcomeReview,review);assert.equal(snapshot.items.some(item=>item.retracted),false);
  assert.deepEqual(new HistoryWindow().project({sessionId:null,items:[]}).items,[]);
});
