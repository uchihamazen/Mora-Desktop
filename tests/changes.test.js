import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readdir, appendFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { snapshotProject, compareProject, watchProjectChanges, saveChangeSummary, loadChangeSummaries, deleteChangeSummaries } from '../src/changes.js';

test('incremental snapshots read changed paths and final snapshots reconcile missed events', async()=>{
  const workspace=await mkdtemp(path.join(tmpdir(),'mora-incremental-'));
  try {
    for(let i=0;i<20;i++)await writeFile(path.join(workspace,`${i}.txt`),'before\n');
    const before=await snapshotProject(workspace);
    await writeFile(path.join(workspace,'3.txt'),'after\n');
    await writeFile(path.join(workspace,'7.txt'),'missed event\n');
    const after=await snapshotProject(workspace,{previous:before,dirtyPaths:new Set(['3.txt'])});
    assert.equal(after.readCount,1);
    assert.equal(after.files.get('3.txt').toString(),'after\n');
    assert.equal(after.files.get('7.txt').toString(),'before\n');
    const final=await compareProject(workspace,before);
    assert.deepEqual(final.files.map(file=>file.path),['3.txt','7.txt']);
  }finally{await rm(workspace,{recursive:true,force:true});}
});

test('live watching follows Git visibility for a new file in a normally generated directory', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'muse-watch-git-'));
  let watcher;
  try {
    await promisify(execFile)('git', ['init','--quiet',workspace], {windowsHide:true});
    await mkdir(path.join(workspace,'build'));
    const before = await snapshotProject(workspace);
    let latest;
    watcher = watchProjectChanges(workspace,before,changes=>{ latest=changes; });
    await writeFile(path.join(workspace,'build','source.txt'),'visible\n');
    const deadline=Date.now()+2500;
    while (!latest && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(latest?.files[0]?.path,'build/source.txt');
  } finally { await watcher?.close(); await rm(workspace,{recursive:true,force:true}); }
});

test('request changes compare against the starting files, including new and deleted files', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'muse-changes-test-'));
  try {
    await writeFile(path.join(workspace, 'modified.txt'), 'existing dirty line\nkeep\n');
    await writeFile(path.join(workspace, 'deleted.txt'), 'remove\n');
    await writeFile(path.join(workspace, 'unchanged.txt'), 'already dirty\n');
    await mkdir(path.join(workspace, 'node_modules'));
    await writeFile(path.join(workspace, 'node_modules', 'ignored.txt'), 'dependency\n');
    const before = await snapshotProject(workspace);
    await writeFile(path.join(workspace, 'modified.txt'), 'new line\nkeep\nextra\n');
    await writeFile(path.join(workspace, 'new عربي.txt'), 'one\ntwo\n');
    await rm(path.join(workspace, 'deleted.txt'));
    await writeFile(path.join(workspace, 'node_modules', 'ignored.txt'), 'changed dependency\n');
    const changes = await compareProject(workspace, before);
    assert.deepEqual(changes.files.map(f => f.path), ['deleted.txt', 'modified.txt', 'new عربي.txt']);
    assert.equal(changes.added, 4);
    assert.equal(changes.removed, 2);
    assert.match(changes.files.find(f => f.path === 'modified.txt').patch, /-existing dirty line\n\+new line/);
    assert.ok(changes.files.every(f => !f.patch.includes('muse-diff-')));
    assert.equal((await compareProject(workspace, await snapshotProject(workspace))).files.length, 0);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('binary files and omitted large files do not invent line counts', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'muse-changes-binary-'));
  try {
    await writeFile(path.join(workspace, 'picture.bin'), Buffer.from([0, 1, 2]));
    await writeFile(path.join(workspace, 'large.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 'a'));
    const before = await snapshotProject(workspace);
    await writeFile(path.join(workspace, 'picture.bin'), Buffer.from([0, 1, 3]));
    const changes = await compareProject(workspace, before);
    assert.equal(changes.files[0].binary, true);
    assert.equal(changes.added, 0);
    assert.equal(changes.removed, 0);
    assert.equal(changes.partial, true);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('diff preview keeps source lines that resemble headers and bounds large patches', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'muse-changes-preview-'));
  try {
    await writeFile(path.join(workspace, 'headers.txt'), '-- original\n');
    await writeFile(path.join(workspace, 'long.txt'), 'a'.repeat(600000));
    const before = await snapshotProject(workspace);
    await writeFile(path.join(workspace, 'headers.txt'), '++ replacement\n');
    await writeFile(path.join(workspace, 'long.txt'), 'b'.repeat(600000));
    const changes = await compareProject(workspace, before);
    assert.match(changes.files[0].patch, /--- original\n\+\+\+ replacement/);
    assert.equal(changes.files[1].added, 1);
    assert.equal(changes.files[1].removed, 1);
    assert.equal(changes.files[1].truncated, true);
    assert.ok(changes.files[1].patch.length < 8100);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('saved reviews retain older turns and deleting a conversation removes only its reviews', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'muse-reviews-test-'));
  try {
    for (let i = 0; i < 21; i++) await saveChangeSummary(directory, 'chat-a', { itemId: `changes-${i}`, files: [] });
    await saveChangeSummary(directory, 'chat-b', { itemId: 'keep', files: [] });
    const reviews = await loadChangeSummaries(directory, 'chat-a');
    assert.equal(reviews.length, 21); assert.equal(reviews[0].itemId, 'changes-0');
    for (const file of await readdir(path.join(directory, 'reviews'))) await appendFile(path.join(directory, 'reviews', file), '{"itemId":');
    assert.equal((await loadChangeSummaries(directory, 'chat-a')).length, 21);
    await saveChangeSummary(directory, 'chat-a', { itemId: 'after-interruption', files: [] });
    assert.equal((await loadChangeSummaries(directory, 'chat-a')).length, 22);
    await deleteChangeSummaries(directory, 'chat-a');
    assert.deepEqual(await loadChangeSummaries(directory, 'chat-a'), []);
    assert.equal((await loadChangeSummaries(directory, 'chat-b'))[0].itemId, 'keep');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('changing ignore rules never counts unchanged files as added or deleted', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'muse-changes-ignore-'));
  try {
    await promisify(execFile)('git', ['init', '--quiet', workspace], { windowsHide: true });
    await writeFile(path.join(workspace, '.gitignore'), 'unhide.txt\n');
    await writeFile(path.join(workspace, 'unhide.txt'), 'already exists\n');
    await writeFile(path.join(workspace, 'old-dirty.txt'), 'already exists\n');
    const before = await snapshotProject(workspace);
    await writeFile(path.join(workspace, '.gitignore'), 'old-dirty.txt\n');
    const changes = await compareProject(workspace, before);
    assert.deepEqual(changes.files.map(file => file.path), ['.gitignore']);
    assert.equal(changes.added, 1); assert.equal(changes.removed, 1);
    assert.equal(changes.partial, true);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('snapshot file limit never counts an omitted existing file as deleted', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'muse-changes-limit-'));
  try {
    for (let i = 0; i < 5000; i += 100) await Promise.all(Array.from({ length: 100 }, (_, j) => writeFile(path.join(workspace, `file-${String(i + j).padStart(4, '0')}.txt`), 'same\n')));
    const before = await snapshotProject(workspace);
    await writeFile(path.join(workspace, 'aaa-new.txt'), 'new\n');
    const changes = await compareProject(workspace, before);
    assert.equal(changes.partial, true);
    assert.equal(changes.files.some(file => file.status === 'deleted'), false);
    assert.equal(changes.removed, 0);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
