export const projectPathFor = session => session.projectPath === null ? null : session.projectPath || session.workspace;
const pathKey = value => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

export function groupConversations(sessions, projects = []) {
  const groups = new Map([[null, {projectPath:null, sessions:[]}]]);
  for (const projectPath of [...projects, ...sessions.map(projectPathFor)]) {
    const key = projectPath === null ? null : pathKey(projectPath);
    if (!groups.has(key)) groups.set(key, {projectPath, sessions:[]});
  }
  for (const session of sessions) {
    const projectPath = projectPathFor(session);
    groups.get(projectPath === null ? null : pathKey(projectPath)).sessions.push(session);
  }
  return [...groups.values()];
}

export function conversationGroups(sessions, projects, {query='',archived=false}={}) {
  const needle=query.trim().toLowerCase();
  return groupConversations(sessions,projects).map(group=>({
    ...group,
    sessions:group.sessions.filter(session=>(session.archived===true)===archived && (!needle || `${session.title || 'New conversation'}\n${group.projectPath || 'General chat'}`.toLowerCase().includes(needle)))
      .sort((a,b)=>Number(b.pinned===true)-Number(a.pinned===true)),
  })).filter(group=>group.sessions.length || (!archived && (!needle || (group.projectPath || 'General chat').toLowerCase().includes(needle))));
}

export function changeConversation(state, sessionId, action, title) {
  const session=state.sessions.find(item=>item.sessionId===sessionId);
  if(!session)throw new Error('Choose a saved conversation.');
  if(state.loading)throw new Error('Wait for the conversation to finish loading.');
  if(action==='rename') {
    if(typeof title!=='string' || !title.trim() || title.trim().length>120 || /[\r\n\x00-\x1f]/.test(title))throw new Error('Use a title of 1–120 characters on one line.');
    session.title=title.trim();session.customTitle=true;
  } else if(action==='pin') session.pinned=!session.pinned;
  else if(action==='archive' || action==='restore') {
    if(action==='archive' && sessionId===state.sessionId && (state.busy || state.projectOperation || state.projectRepair || state.testerActive || state.websiteActive || ['starting','ready'].includes(state.projectWork?.run?.status)))throw new Error('Work is running. Stop it before archiving this chat.');
    session.archived=action==='archive';
  } else throw new Error('Unknown conversation action.');
  return session;
}
