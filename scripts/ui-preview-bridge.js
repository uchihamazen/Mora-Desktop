(() => {
  const listeners=new Set(),project='C:\\Sample projects\\Counter app';
  let state={sessionId:'preview-chat',projectPath:project,workspace:project,projects:[project],sessions:[{sessionId:'preview-chat',title:'Make the counter easier to use',projectPath:project}],items:[{itemId:'sample-user',kind:'userMessage',text:'Make the counter easier to read on smaller screens.'},{itemId:'sample-answer',kind:'agentMessage',status:'completed',text:'This is sample content for reviewing Mora’s interface. Use browser annotations to point out changes you want.'}],models:[{modelId:'preview-model',displayLabel:'Sample model',variants:['low','medium','high']}],modelId:'preview-model',reasoningEffort:'medium',executionMode:'readonly',connection:'ready',engineVersion:'Sample data',busy:false,pendingQueue:[],draft:{text:'',images:[]}};
  let preview={open:true,url:location.origin+'/demo',title:'Counter app · sample',deviceMode:'desktop',deviceReady:true,tabs:[{id:'sample-tab',url:location.origin+'/demo',title:'Counter app · sample'}],activeTabId:'sample-tab',history:{entries:[]}};
  state.account={status:'ready',message:'UI preview uses sample data. No engine account is connected.'};
  const labelEngine=()=>{document.getElementById('engine-label').textContent='UI preview';document.getElementById('engine-detail').textContent='Sample data · engine disconnected';document.getElementById('connection-badge').textContent='Sample data';};
  const emit=(type,value)=>{for(const listener of listeners)listener({type,state:value});if(type==='state')labelEngine();};
  const update=next=>{state={...state,...next};emit('state',state);return state;};
  const unavailable=async()=>{throw Error('UI preview only. Use Mora Desktop for engine, project files, Run and Test.');};
  const frame=document.createElement('iframe');frame.title='Sample counter preview';frame.src='/demo';frame.style.cssText='width:100%;height:100%;border:0';document.getElementById('browser-viewport').replaceChildren(frame);
  window.muse={
    getState:async()=>{setTimeout(labelEngine,0);return state;},onEvent:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    setOptions:async options=>update(options),saveDraft:async draft=>{state.draft={text:draft.text,images:draft.images};},
    copyText:text=>navigator.clipboard.writeText(text),completionSoundOptions:async enabled=>update({completionSound:enabled}),
    newChat:async(projectPath=null)=>{const sessionId=crypto.randomUUID();return update({sessionId,projectPath,items:[],draft:{text:'',images:[]},sessions:[...state.sessions,{sessionId,projectPath,title:'New sample chat'}]});},
    resumeChat:async id=>{const chat=state.sessions.find(chat=>chat.sessionId===id);return update({sessionId:id,projectPath:chat?.projectPath||null,items:[],draft:{text:'',images:[]}});},
    chatMetadata:async(id,action,title)=>{const chat=state.sessions.find(chat=>chat.sessionId===id);if(!chat)throw Error('Choose a sample chat.');if(action==='rename')chat.title=title;if(action==='pin')chat.pinned=!chat.pinned;if(action==='archive'||action==='restore')chat.archived=action==='archive';return update({sessions:[...state.sessions]});},
    deleteChat:async id=>update({sessions:state.sessions.filter(chat=>chat.sessionId!==id)}),
    removeProject:async projectPath=>update({projects:state.projects.filter(project=>project!==projectPath),sessions:state.sessions.filter(chat=>chat.projectPath!==projectPath),...(state.projectPath===projectPath?{sessionId:null,projectPath:null,workspace:'',items:[],draft:{text:'',images:[]}}:{})}),
    trelloCommand:async action=>action==='state'?{configured:false}:unavailable(),
    sendMessage:async message=>{update({items:[...state.items,{itemId:crypto.randomUUID(),kind:'userMessage',text:message.text,images:message.images},{itemId:crypto.randomUUID(),kind:'agentMessage',status:'completed',text:'Sample response only. To change Mora, send your browser annotations to Codex.'}]});return {accepted:true};},
    stopTurn:async()=>state,queueCommand:async()=>state,connect:async()=>state,pickImages:async()=>[],
    chooseWorkspace:unavailable,chooseMuse:unavailable,projectCommand:unavailable,createProject:unavailable,chooseProjectParent:unavailable,accountCommand:unavailable,exportProject:unavailable,revealProjectExport:unavailable,checkpointCommand:unavailable,
    inspectSetup:async()=>[{id:'preview',title:'Local UI preview',status:'ready',detail:'Sample data. Real engine and project operations are available in Mora Desktop.'}],
    projectBriefCommand:async action=>{if(action!=='read')return unavailable();return {text:'Sample project brief: a simple counter app.',revision:'sample'};},
    browserCommand:async(action,payload={})=>{
      if(['annotate','capture','compare-before','compare-after','note-edit','notes-send'].includes(action))throw Error('Page annotations require Mora Desktop. Annotate this UI using Codex’s browser.');
      if(action==='open'||action==='close')preview={...preview,open:action==='open'};
      if(action==='device')preview={...preview,deviceMode:payload.mode};
      if(action==='navigate'){if(new URL(payload.url,location.origin).href!==location.origin+'/demo')throw Error('This UI preview contains only the sample counter page.');frame.src='/demo';}
      if(action==='reload')frame.src='/demo';
      if(action==='tab-new'||action==='tab-close'||action==='tab-select')throw Error('Additional browser tabs are available in Mora Desktop.');
      if(action==='occlude')frame.style.visibility=payload.hidden?'hidden':'visible';
      emit('browser',preview);return preview;
    },
  };
})();
