import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export function uuid7() {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6] & 15) | 0x70;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function discoverMuse(override) {
  if (override) {
    if (!path.isAbsolute(override) || !(await stat(override)).isFile() || !override.endsWith('.exe')) throw new Error('Select a Muse .exe file.');
    await access(override);
    return override;
  }
  const directory = path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'Programs', 'muse');
  const version = (await readFile(path.join(directory, '.muse-version'), 'utf8')).trim();
  if (!/^\d+\.\d+\.\d+-R\d+(\.\d+)?$/.test(version)) throw new Error('Unrecognized Muse version. Select its executable.');
  const executable = path.join(directory, `muse-bin-${version}.exe`);
  await access(executable);
  return executable;
}

export class MspClient extends EventEmitter {
  connected = false;
  child = null;
  pending = new Map();
  nextId = 0;

  async connect({ executable, workspace, args = ['serve'], timeoutMs = 20000 }) {
    await this.close();
    this.closing = false;
    this.timeoutMs = timeoutMs;
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    this.child = spawn(executable, args, { cwd: workspace, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', error => this.fail(new Error(`Muse connection closed: ${error.message}`)));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', code => this.fail(new Error(`Muse exited (${code ?? 'terminated'}). Reconnect to continue.`)));
    this.child.stdout.on('data', chunk => {
      this.buffer += this.decoder.write(chunk);
      if (this.buffer.length > 48 * 1024 * 1024) return this.fail(new Error('Muse output frame is too large.'));
      let index;
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (!line) continue;
        try { this.receive(JSON.parse(line)); }
        catch { this.fail(new Error('Invalid JSON frame from Muse. Reconnect to continue.')); break; }
      }
    });
    this.child.stderr.on('data', chunk => this.emit('diagnostic', chunk.toString('utf8')));
    this.connected = true;
    try {
      const metadata = await this.request('initialize', { clientInfo: { name: 'muse_desktop', title: 'Muse Desktop', version: '0.1.0' }, capabilities: { requestedCapabilities: ['sessionListStream'], userInputDialogs: true } });
      this.notify('initialized', {});
      return metadata;
    } catch (error) { await this.close(); throw error; }
  }

  receive(message) {
    if (message.jsonrpc !== '2.0') throw new Error('Invalid JSON-RPC frame.');
    if (typeof message.method === 'string') {
      this.emit(message.id === undefined ? 'notification' : 'serverRequest', message.method, message.params || {}, message.id);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      const error = new Error(message.error.message || 'Muse request failed.');
      error.code = message.error.code;
      error.data = message.error.data;
      pending.reject(error);
    } else pending.resolve(message.result);
  }

  request(method, params = {}) {
    if (!this.connected || !this.child?.stdin.writable) return Promise.reject(new Error('Muse is disconnected. Reconnect to continue.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Muse ${method} timed out. The command may have been admitted; reconnect before retrying.`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => {
        if (error) this.fail(new Error('Muse connection closed while writing.'));
      });
    });
  }

  notify(method, params = {}) {
    if (this.connected && this.child?.stdin.writable) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  fail(error) {
    const wasConnected = this.connected;
    this.connected = false;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (wasConnected && !this.closing) {
      this.emit('disconnected', error.message);
      if (this.child?.exitCode === null) this.child.kill();
    }
  }

  async close() {
    if (!this.child) return;
    const child = this.child;
    this.closing = true;
    this.fail(new Error('Muse connection closed.'));
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit').catch(() => {});
      child.stdin.end();
      const timer = setTimeout(() => {
        if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else child.kill('SIGKILL');
      }, 2000);
      await ended;
      clearTimeout(timer);
    }
    if (this.child === child) this.child = null;
  }
}
