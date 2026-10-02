export function createState() {
  return { items: [], busy: false, finishing: false, activity: '', activeTurnId: null, stopping: false, error: '', pendingApprovals: [], pendingQuestions: [], needsRecovery: false, pendingQueue: [], queuePaused: false, draft: {text:'',images:[]}, activeRequest: null, lastOutcome: null, workUnavailable: false, historyMissing: false };
}

export function assertIdle(state) {
  if (state.testerActive||state.websiteActive) throw new Error('Stop testing before changing chats, projects or settings.');
  if (state.loading) throw new Error('A conversation is loading. Wait before switching or sending.');
  if (state.busy) throw new Error('A request is running. Stop it before switching chats or projects.');
}

export function applyEvent(state, method, params) {
  if (method === 'view/gap') state.needsRecovery = true;
  if (method === 'turn/started') { state.busy = true; state.activeTurnId = params.turnId; state.stopping = false; }
  if (method === 'stop/requested') state.stopping = true;
  if (method === 'turn/completed' && (!state.activeTurnId || params.turnId === state.activeTurnId)) { state.busy = false; state.activeTurnId = null; state.stopping = false; }
  if (method === 'host/disconnected') { state.busy = false; state.activeTurnId = null; state.stopping = false; state.error = params.message; }
  if (['item/started', 'item/updated', 'item/completed'].includes(method)) {
    const index = state.items.findIndex(item => item.itemId === params.item.itemId);
    if (index === -1) state.items.push({ ...params.item });
    else if (params.item.revision > state.items[index].revision) state.items[index] = { ...params.item };
  }
  if (method === 'item/delta') {
    const item = state.items.find(item => item.itemId === params.itemId);
    if (item?.status === 'inProgress' && item.lastDeltaCursor !== params.viewCursor) {
      if (params.field?.startsWith('summary.')) {
        const index = Number(params.field.slice(8));
        if (Number.isInteger(index) && index >= 0 && index < 100) { item.summary ||= []; item.summary[index] = (item.summary[index] || '') + params.delta; }
      } else { const field = params.field === 'output' ? 'visibleOutput' : 'text'; item[field] = (item[field] || '') + params.delta; }
      item.lastDeltaCursor = params.viewCursor;
    }
  }
  if (['approval/request', 'approval/requested', 'approval/updated'].includes(method)) {
    const approval = params.approval || params;
    state.pendingApprovals = state.pendingApprovals.filter(p => p.approvalId !== approval.approvalId);
    state.pendingApprovals.push(approval);
  }
  if (method === 'approval/resolved') state.pendingApprovals = state.pendingApprovals.filter(p => p.approvalId !== params.approvalId);
  if (['userInput/request', 'userInput/requested'].includes(method)) {
    state.pendingQuestions = state.pendingQuestions.filter(p => p.userInputId !== params.userInputId); state.pendingQuestions.push(params);
  }
  if (method === 'userInput/settled') state.pendingQuestions = state.pendingQuestions.filter(p => p.userInputId !== params.userInputId);
  return state;
}
