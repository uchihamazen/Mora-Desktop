import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { readFile, open, readdir, stat } from 'node:fs/promises';
import { statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { applyEvent } from './state.js';

function toolDetails(items, call, run) {
  const callId = call.call_id || call.id;
  if (!callId) return;
  let item = items.find(item => item.callId === callId || item.itemId === callId);
  if (!item) { item = { itemId: callId, callId, turnId: run, kind: 'toolCall', revision: 1, status: 'inProgress' }; items.push(item); }
  let args = call.args || call.arguments || {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { input: args }; } }
  item.tool = call.name || item.tool;
  item.args = JSON.stringify(args, null, 2);
  if (typeof args?.command === 'string') item.commandText = args.command;
  if (typeof args?.description === 'string') item.description = args.description;
  else if (typeof args?.path === 'string') item.description = `${item.tool}: ${args.path}`;
  return item;
}

function bindCall(items, item, event) {
  if (!event.idempotency_key?.startsWith('tool:')) return;
  const callId = event.idempotency_key.slice(5);
  const detail = items.find(row => row.itemId === callId);
  if (detail && detail !== item) {
    Object.assign(item, detail, { itemId: item.itemId, status: item.status, revision: item.revision });
    items.splice(items.indexOf(detail), 1);
  }
  item.callId = callId;
}

export function applyNativeRecord(state, record) {
  const p = record.payload || {}, e = p.event || {};
  if (p.kind !== 'run' || p.run_id !== state.activeTurnId) return state;
  if (e.kind === 'assistant_message_committed' && e.text) {
    const itemId = e.message_id || `reply-${p.run_id}`;
    if (!state.items.some(item => item.itemId === itemId || item.nativeMessageId === itemId)) {
      const candidates = state.items.filter(item => item.turnId === p.run_id && item.kind === 'agentMessage' && !item.nativeMessageId && item.text && e.text.startsWith(item.text));
      const streamed = candidates.find(item => item.text === e.text) || candidates.at(-1);
      if (streamed) Object.assign(streamed,{text:e.text,status:'completed',nativeMessageId:itemId,streamItemId:streamed.itemId});
      else state.items.push({itemId,turnId:p.run_id,kind:'agentMessage',revision:1,status:'completed',text:e.text,nativeMessageId:itemId});
    }
  }
  if (e.kind === 'assistant_tool_calls_committed') {
    for (const call of e.tool_calls || []) {
      const item = toolDetails(state.items, call, p.run_id);
      if (item?.status === 'inProgress') { state.finishing = false; state.activity = item.description || `Running ${item.tool}`; }
    }
  }
  if (e.kind === 'tool_result_batch_committed') {
    for (const result of e.results || []) {
      const item = state.items.find(item => item.callId === result.tool_call_id || item.itemId === result.tool_call_id);
      if (!item) continue;
      let output; try { output = JSON.parse(result.text); } catch {}
      if (typeof output?.command === 'string') item.commandText = output.command;
      if (typeof output?.description === 'string') item.description = output.description;
      item.visibleOutput = typeof output?.output === 'string' ? output.output : result.text || '';
      if (Number.isInteger(output?.exit_code)) item.exitCode = output.exit_code;
    }
  }
  return state;
}

export class NativeLogTail {
  constructor(filename, offset, onRecord) {
    this.filename = filename; this.offset = offset; this.onRecord = onRecord;
    this.decoder = new StringDecoder('utf8'); this.buffer = '';
    this.timer = setInterval(() => this.poll().catch(() => {}), 250); this.timer.unref();
  }
  async poll() {
    if (this.reading) return this.reading;
    this.reading = this.read().finally(() => { this.reading = null; });
    return this.reading;
  }
  async read() {
    let file;
    try {
      file = await open(this.filename, 'r');
      if ((await file.stat()).size < this.offset) { this.offset = 0; this.buffer = ''; this.decoder = new StringDecoder('utf8'); }
      const bytes = Buffer.alloc(65536);
      for (let total = 0; total < 1024 * 1024;) {
        const { bytesRead } = await file.read(bytes, 0, bytes.length, this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead; total += bytesRead; this.buffer += this.decoder.write(bytes.subarray(0, bytesRead));
        let index;
        while ((index = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
          try {
            const record = JSON.parse(line);
            if (record.children) { for (const child of record.children) if (child.record_json) this.onRecord(JSON.parse(child.record_json)); }
            else this.onRecord(record);
          } catch { /* An invalid historical record cannot execute or replay anything. */ }
        }
        if (this.buffer.length > 32 * 1024 * 1024) { this.buffer = ''; this.decoder = new StringDecoder('utf8'); }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { await file?.close(); }
  }
  async close() { clearInterval(this.timer); await this.reading; await this.poll(); }
}

export function applyExecRecord(state, record) {
  const p = record.payload || {};
  const run = record.causation_id || p.command_id || state.activeTurnId;
  const itemId = state.outputStream?.run === run ? state.outputStream.itemId : `reply-${run}`;
  if (p.kind === 'run_output_delta') {
    state.finishing = false; state.activity = 'Writing the reply';
    if (state.outputStream?.run !== run) state.outputStream = {run,itemId,text:'',cursor:null};
    const stream = state.outputStream, cursor = record.id || String(record.sequence);
    if (stream.cursor !== cursor) { stream.text += p.text || ''; stream.cursor = cursor; }
    const committed = state.items.find(item => item.turnId === run && item.nativeMessageId && (!item.streamItemId || item.streamItemId === itemId) && item.text.startsWith(stream.text));
    const pending = state.items.find(item => item.itemId === itemId);
    if (committed) {
      committed.streamItemId = itemId;
      if (pending && pending !== committed) state.items.splice(state.items.indexOf(pending),1);
    } else applyEvent(state,'item/updated',{item:{itemId,turnId:run,kind:'agentMessage',status:'inProgress',revision:(pending?.revision || 0)+1,text:stream.text,lastDeltaCursor:cursor}});
  }
  if (p.kind === 'run_terminal') {
    state.finishing = false; state.activity = 'Finishing the request';
    const existingReply = state.items.findLast(item => item.turnId === run && item.kind === 'agentMessage' && item.text === p.text);
    if (p.text) applyEvent(state, 'item/completed', { item: { itemId: existingReply?.itemId || itemId, turnId: run, kind: 'agentMessage', status: 'completed', revision: 1000000, text: p.text } });
    if (p.terminal !== 'completed') state.error = p.reason || `Muse ${p.terminal}.`;
  }
  if (p.kind === 'task_lifecycle') {
    const e = p.event || {}, id = p.task_id || e.task_id;
    if (e.kind === 'proposed' && e.task_kind?.startsWith('reminder.agent.') && state.items.some(item => (item.itemId === itemId || item.streamItemId === itemId) && item.text) && !state.items.some(item => item.turnId === run && item.kind === 'toolCall' && item.status === 'inProgress')) {
      state.finishing = true; state.activity = 'Reply ready · finishing final checks';
    }
    if (e.kind === 'proposed' && e.task_kind === 'model.meta.response') {
      state.finishing = false; state.activity = 'Preparing the response';
      const nextItemId = `reply-${run}-${id}`;
      if (state.outputStream?.itemId !== nextItemId) {
        const streamed = state.items.find(item => item.itemId === itemId);
        if (streamed?.kind === 'agentMessage') streamed.status = 'completed';
        state.outputStream = {run,itemId:nextItemId,text:'',cursor:null};
      }
      const stepId = `activity-${id}`;
      if (!state.items.some(item => item.itemId === stepId)) state.items.push({itemId:stepId,turnId:run,kind:'activity',text:state.activity});
    }
    const existing = state.items.find(item => item.itemId === id);
    const tool = e.operation?.startsWith('tool:') ? e.operation.slice(5) : e.task_kind?.startsWith('tool.') ? e.task_kind.slice(5) : null;
    if (!existing && !tool) return state;
    state.finishing = false;
    const item = { ...(existing || {}), itemId: id, turnId: run, kind: 'toolCall', revision: (existing?.revision || 0) + 1, status: ['completed','failed','cancelled','rejected'].includes(e.kind) ? e.kind : existing?.status || 'inProgress', tool: tool || existing?.tool };
    bindCall(state.items, item, e);
    if (e.reason) item.failureReason = e.reason;
    if (e.chunk) item.visibleOutput = (item.visibleOutput || '') + e.chunk;
    if (e.arguments || e.args) item.args = JSON.stringify(e.arguments || e.args, null, 2);
    applyEvent(state, 'item/updated', { item });
    const running = state.items.find(row => row.turnId === run && row.kind === 'toolCall' && row.status === 'inProgress');
    state.activity = running ? running.description || `Running ${running.tool}` : 'Preparing the response';
  }
  return state;
}

export class ExecRunner extends EventEmitter {
  child = null;
  async run({ executable, workspace, sessionId, promptFile, images = [], executionMode = 'readonly', modelId, reasoningEffort, providerId, museHome, prefixArgs = [], extraArgs = [], environment = {} }) {
    if (this.child) throw new Error('A request is already running. Stop it before starting another.');
    const args = [...prefixArgs, 'exec', '--json', '--no-foreign-personal-context', '--workspace', workspace, '--prompt-file', promptFile];
    if(sessionId) args.push('--session-id',sessionId);
    if (modelId) args.push('--model', modelId);
    if (reasoningEffort) args.push('--reasoning-effort', reasoningEffort);
    if (providerId) args.push('--provider', providerId);
    if (executionMode === 'full') args.push('--yolo');
    else args.push('--disable-shell', '--disable-write', ...(executionMode==='scoped'?[]:['--approval-mode', 'on-request']));
    for (const image of images) args.push('--image', image);
    args.push(...extraArgs);
    // Muse 1.4.1's Meta exec future overflows Windows' default Rust thread stack.
    let nativePath, offset = 0;
    if (museHome && sessionId) { nativePath = resolveSessionLogPath(sessionId, museHome, new Date()); try { offset = statSync(nativePath).size; } catch {} }
    const child = spawn(executable, args, { cwd: workspace, windowsHide: true, env: { ...process.env, ...environment, RUST_MIN_STACK: '33554432' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const tail = nativePath ? new NativeLogTail(nativePath, offset, record => this.emit('history-record', record)) : null;
    this.child = child;
    this.stopped = false;
    let buffer = '', stderr = '', terminal = null, parseError = null;
    const decoder = new StringDecoder('utf8');
    child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (!line) continue;
        try { const record = JSON.parse(line); if (record.payload?.kind === 'run_terminal') terminal = record.payload; this.emit('record', record); }
        catch { parseError = 'Invalid event from Muse.'; }
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); this.emit('diagnostic', chunk.toString()); });
    try {
      const [code, signal] = await once(child, 'close');
      return { code, signal, terminal, stderr, stopped: this.stopped, error: parseError };
    } finally { try { await tail?.close(); } catch {} if (this.child === child) this.child = null; }
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    this.stopped = true;
    const ended = once(child, 'close').catch(() => {});
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => child.kill());
    } else child.kill('SIGTERM');
    await ended;
  }
}

export function historyItems(records) {
  const items = [];
  const seen = new Set();
  for (const record of records) {
    if (record.id && seen.has(record.id)) continue;
    if (record.id) seen.add(record.id);
    const payload = record.payload || {};
    const event = payload.event || {};
    if (payload.kind === 'task') {
      const id = payload.task_id || event.task_id;
      const existing = items.find(item => item.itemId === id);
      const tool = event.operation?.startsWith('tool:') ? event.operation.slice(5) : event.task_kind?.startsWith('tool.') ? event.task_kind.slice(5) : null;
      if (!existing && !tool) continue;
      const item = existing || { itemId: id, turnId: payload.run_id, kind: 'toolCall', tool, revision: 1, status: 'inProgress' };
      if (!existing) items.push(item);
      bindCall(items, item, event);
      if (event.chunk) item.visibleOutput = (item.visibleOutput || '') + event.chunk;
      if (['completed','failed','cancelled','rejected'].includes(event.kind)) item.status = event.kind;
      if (event.reason) item.failureReason = event.reason;
      continue;
    }
    if (payload.kind !== 'run') continue;
    if (['assistant_tool_calls_committed','tool_result_batch_committed'].includes(event.kind)) applyNativeRecord({ items, activeTurnId: payload.run_id }, record);
    if (event.kind === 'started') items.push({ itemId: `user-${payload.run_id}`, turnId: payload.run_id, kind: 'userMessage', revision: 1, status: 'completed', text: event.prompt || '' });
    if (event.kind === 'assistant_message_committed') items.push({ itemId: event.message_id || `reply-${payload.run_id}`, turnId: payload.run_id, kind: 'agentMessage', revision: 1, status: 'completed', text: event.text || '' });
    if (event.kind === 'tool_call_proposed') items.push({ itemId: event.task_id || event.call_id, turnId: payload.run_id, kind: 'toolCall', revision: 1, status: 'completed', tool: event.tool_name || event.name, args: JSON.stringify(event.arguments || event.args || {}) });
  }
  return items;
}

export function sessionLogPath(sessionId, museHome = path.join(homedir(), '.local', 'share', 'muse'), date) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error('Invalid session ID.');
  date ||= new Date(parseInt(sessionId.replaceAll('-', '').slice(0, 12), 16));
  // The native engine partitions logs by its local calendar day, not UTC.
  return path.join(museHome, 'sessions', String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'), sessionId, 'session.jsonl');
}

export function resolveSessionLogPath(sessionId, museHome = path.join(homedir(), '.local', 'share', 'muse'), fallbackDate) {
  const expected = sessionLogPath(sessionId, museHome);
  const date = new Date(parseInt(sessionId.replaceAll('-', '').slice(0, 12), 16));
  const root = path.join(museHome, 'sessions');
  const utc = path.join(root, String(date.getUTCFullYear()), String(date.getUTCMonth()+1).padStart(2,'0'), String(date.getUTCDate()).padStart(2,'0'), sessionId, 'session.jsonl');
  const exists = filename => { try { return statSync(filename).isFile(); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; } };
  for (const filename of new Set([expected, utc, sessionLogPath(sessionId, museHome, new Date())])) if (exists(filename)) return filename;
  const folders = (directory, pattern) => { try { return readdirSync(directory, {withFileTypes:true}).filter(entry => entry.isDirectory() && pattern.test(entry.name)).map(entry => path.join(directory,entry.name)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
  // A chat ID can predate its first send, or retain its folder after a timezone change.
  for (const year of folders(root,/^\d{4}$/)) for (const month of folders(year,/^\d{2}$/)) for (const day of folders(month,/^\d{2}$/)) {
    const filename = path.join(day,sessionId,'session.jsonl');
    if (exists(filename)) return filename;
  }
  return fallbackDate ? sessionLogPath(sessionId,museHome,fallbackDate) : expected;
}

export async function readHistory(sessionId, museHome) {
  const text = await readFile(resolveSessionLogPath(sessionId, museHome), 'utf8');
  const records = [];
  for (const line of text.split('\n').filter(Boolean)) {
    try {
      const record = JSON.parse(line);
      if (record.children) for (const child of record.children) { if (child.record_json) records.push(JSON.parse(child.record_json)); }
      else records.push(record);
    } catch { /* A partial final append is retried on the next history read. */ }
  }
  return historyItems(records);
}

// View journals retain length-prefixed MSP notifications even if the source log is lost.
// Recover display text only; these notifications cannot reconstruct engine context.
export async function readCachedHistory(sessionId, museHome = path.join(homedir(), '.local', 'share', 'muse')) {
  sessionLogPath(sessionId, museHome); // Validate before using an ID as a directory name.
  const directory = path.join(museHome, 'sessions', '.msp-view-v1', sessionId);
  const names = (await readdir(directory)).filter(name => /^journal-\d{8}\.bin$/.test(name)).sort();
  const recovered = { items: [] }, marker = Buffer.from('{"');
  let total = 0;
  for (const name of names) {
    const filename = path.join(directory, name);
    total += (await stat(filename)).size;
    if (total > 64 * 1024 * 1024) throw new Error('Cached history exceeds the recovery limit; saved files were preserved.');
    const bytes = await readFile(filename);
    for (let offset = 0; (offset = bytes.indexOf(marker, offset)) !== -1;) {
      const start = offset++;
      if (start < 4) continue;
      const length = bytes.readUInt32LE(start - 4);
      if (!length || length > 2 * 1024 * 1024 || start + length > bytes.length) continue;
      try {
        const event = JSON.parse(bytes.subarray(start, start + length).toString('utf8'));
        if (event.params?.sessionId !== sessionId) continue;
        if (['item/started', 'item/updated', 'item/completed'].includes(event.method) && ['userMessage', 'agentMessage'].includes(event.params.item?.kind)) applyEvent(recovered, event.method, event.params);
        offset = start + length;
      } catch { /* Ignore unrelated binary records or an incomplete append. */ }
    }
  }
  return recovered.items;
}
