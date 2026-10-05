import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, lstat, readFile, writeFile, mkdtemp, rm, mkdir, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { watch } from 'node:fs';

const exec = promisify(execFile);
const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'artifacts', '.next', '.venv', 'venv', '__pycache__', 'coverage']);
const options = { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 };
let gitCommand;
async function git(args, settings = {}) {
  gitCommand ||= (async () => {
    for (const command of ['git', path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe'), path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/cmd/git.exe')]) {
      try { await exec(command, ['--version'], options); return command; } catch {}
    }
    throw new Error('Git is required for file change previews.');
  })();
  return exec(await gitCommand, args, { ...options, ...settings });
}

export async function snapshotProject(workspace, {previous,dirtyPaths,filter,refuseLinks=false,maxFileBytes=2*1024*1024,maxBytes=32*1024*1024} = {}) {
  const files = new Map(), skipped = new Set();
  let names, partial = false, bytes = 0, excluded = [], gitVisible = false, readCount = 0;
  try {
    const { stdout } = await git(['-C', workspace, 'ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    names = stdout.split('\0').filter(Boolean);
    excluded = (await git(['-C', workspace, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'])).stdout.split('\0').filter(Boolean);
    gitVisible = true;
  } catch {
    names = [];
    async function walk(folder = '') {
      for (const entry of await readdir(path.join(workspace, folder), { withFileTypes: true })) {
        if (names.length >= 5000) { partial = true; return; }
        const name = path.join(folder, entry.name);
        if (filter && !filter(name.replaceAll('\\', '/'))) continue;
        if (entry.isDirectory() && !ignored.has(entry.name)) await walk(name);
        else if (entry.isFile() || (refuseLinks && entry.isSymbolicLink())) names.push(name);
      }
    }
    try { await walk(); } catch { partial = true; }
  }
  if (filter) names = names.filter(name=>filter(name.replaceAll('\\', '/')));
  if (names.length > 5000) partial = true;
  const sorted = [...new Set(names)].sort();
  for (const name of sorted.slice(5000)) skipped.add(name.replaceAll('\\', '/'));
  for (const original of sorted.slice(0, 5000)) {
    const name = original.replaceAll('\\', '/');
    const filename = path.resolve(workspace, name);
    const relative = path.relative(path.resolve(workspace), filename);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    try {
      const info = await lstat(filename);
      if (refuseLinks && info.isSymbolicLink()) { skipped.add(name); partial = true; continue; }
      if (!info.isFile()) continue; // Do not follow symlinks outside the project.
      const fileLimit=typeof maxFileBytes==='function'?maxFileBytes(name):maxFileBytes;
      if (info.size > fileLimit || bytes + info.size > maxBytes) { skipped.add(name); partial = true; continue; }
      const reusable = previous && !previous.partial && dirtyPaths && ![...dirtyPaths].some(changed=>name===changed || name.startsWith(`${changed}/`)) && previous.files.has(name);
      const content = reusable ? previous.files.get(name) : await readFile(filename);
      if(!reusable)readCount++;
      if(content.length>fileLimit || bytes+content.length>maxBytes){skipped.add(name);partial=true;continue;}
      bytes += content.length;
      files.set(name, content);
    } catch (error) { if (error.code !== 'ENOENT') { skipped.add(name); partial = true; } }
  }
  return { files, skipped, partial, excluded, gitVisible, readCount };
}

export async function compareProject(workspace, before, {after,cache} = {}) {
  after ||= await snapshotProject(workspace);
  const result = { files: [], added: 0, removed: 0, partial: before.partial || after.partial };
  const temp = await mkdtemp(path.join(tmpdir(), 'muse-diff-'));
  try {
    for (const name of [...new Set([...before.files.keys(), ...after.files.keys()])].sort()) {
      if (before.skipped.has(name) || after.skipped.has(name)) continue;
      const left = before.files.get(name), right = after.files.get(name);
      if ((!left && before.partial) || (!right && after.partial)) continue; // Omitted files are not evidence of additions/deletions.
      if (!left && before.excluded.some(excluded => name === excluded || (excluded.endsWith('/') && name.startsWith(excluded)))) { result.partial = true; continue; }
      if (!right) {
        try { await lstat(path.resolve(workspace, name)); result.partial = true; continue; }
        catch (error) { if (error.code !== 'ENOENT') { result.partial = true; continue; } }
      }
      if (left && right && left.equals(right)) continue;
      const retained=cache?.get(name);
      if(retained && retained.left===left && retained.right===right){result.files.push(retained.item);result.added+=retained.item.added;result.removed+=retained.item.removed;continue;}
      const item = { path: name, status: !left ? 'added' : !right ? 'deleted' : 'modified', added: 0, removed: 0, patch: '' };
      if (left?.includes(0) || right?.includes(0)) { item.binary = true; item.patch = 'Binary file changed.'; }
      else {
        const leftFile = path.join(temp, 'before'), rightFile = path.join(temp, 'after');
        await writeFile(leftFile, left || ''); await writeFile(rightFile, right || '');
        let output;
        try { output = (await git(['diff', '--no-index', '--no-ext-diff', '--no-color', '--no-renames', '--numstat', '--patch', '--', leftFile, rightFile], { maxBuffer: 12 * 1024 * 1024 })).stdout; }
        catch (error) { if (error.code !== 1) throw error; output = error.stdout; }
        const counts = /^(\d+)\t(\d+)\t/m.exec(output);
        if (counts) { item.added = Number(counts[1]); item.removed = Number(counts[2]); }
        const hunk = output.indexOf('\n@@ ');
        const patch = hunk === -1 ? '' : output.slice(hunk + 1);
        item.patch = patch.length > 8000 ? `${patch.slice(0, 8000)}\n… Preview truncated.` : patch;
        item.truncated = patch.length > 8000;
      }
      cache?.set(name,{left,right,item});
      result.files.push(item); result.added += item.added; result.removed += item.removed;
    }
    return result;
  } finally {
    // The absolute directory comes directly from mkdtemp under the OS temp root.
    if (path.dirname(temp) === path.resolve(tmpdir()) && path.basename(temp).startsWith('muse-diff-')) await rm(temp, { recursive: true, force: true });
  }
}

export function watchProjectChanges(workspace, before, onUpdate) {
  let timer, running, dirty = false, closed = false, watcher;
  let previous=before, fullScan=false;const dirtyPaths=new Set(),cache=new Map();
  const schedule = () => {
    if (closed) return;
    dirty = true; clearTimeout(timer);
    timer = setTimeout(scan, 350);
  };
  async function scan() {
    if (closed || running) return;
    dirty = false;
    const paths=new Set(dirtyPaths),forceFull=fullScan;dirtyPaths.clear();fullScan=false;
    running = snapshotProject(workspace,forceFull?{}:{previous,dirtyPaths:paths}).then(async after=>{
      const changes=await compareProject(workspace,before,{after,cache});previous=after;if(!closed)onUpdate(changes);
    }).catch(() => {
      fullScan=true;
      // A transient write/read race must not interrupt the engine; final review retries.
    }).finally(() => { running = null; if (dirty && !closed) schedule(); });
    await running;
  }
  try {
    watcher = watch(workspace, { recursive: true }, (_event, filename) => {
      const name = String(filename || '').replaceAll('\\', '/');
      if(!name || name.split('/').at(-1)==='.gitignore' || name==='.git/info/exclude'){fullScan=true;schedule();return;}
      if (name.split('/').includes('.git')) return;
      if (before.excluded.some(excluded => name === excluded || (excluded.endsWith('/') && name.startsWith(excluded)))) return;
      // Git decides visibility in repositories; ordinary folders skip generated directories.
      if (!before.gitVisible && name.split('/').some(part => ignored.has(part))) return;
      dirtyPaths.add(name);schedule();
    });
    watcher.on('error', () => { fullScan=true;watcher.close();schedule(); });
  } catch { /* Unsupported/unavailable watchers still get the final authoritative review. */ }
  return { async close() { closed = true; clearTimeout(timer); watcher?.close(); await running; } };
}

function reviewPath(directory, sessionId) {
  const key = createHash('sha256').update(sessionId).digest('hex');
  return path.join(directory, 'reviews', `${key}.jsonl`);
}
export async function saveChangeSummary(directory, sessionId, item) {
  const filename = reviewPath(directory, sessionId);
  await mkdir(path.dirname(filename), { recursive: true });
  await appendFile(filename, `\n${JSON.stringify(item)}\n`);
}
export async function loadChangeSummaries(directory, sessionId) {
  try { return (await readFile(reviewPath(directory, sessionId), 'utf8')).split('\n').filter(Boolean).flatMap(line => {
    try { const item = JSON.parse(line); return item && typeof item.itemId === 'string' && Array.isArray(item.files) ? [item] : []; }
    catch { return []; } // Preserve complete records if an interrupted append left a partial final line.
  }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
export async function deleteChangeSummaries(directory, sessionId) {
  await rm(reviewPath(directory, sessionId), { force: true });
}
