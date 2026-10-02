import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadWork, saveWork, deleteWork} from '../src/work.js';

test('drafts, queued images and active receipts survive independently per conversation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mora-work-'));
  try {
    const image = {mediaType:'image/png',base64Data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',contextText:'Selected HTML',note:'Make this blue',sourceUrl:'http://localhost:3000'};
    await saveWork(directory, '../first', {draft:{text:'Unsent',images:[image]},pendingQueue:[{queueId:'q',text:'Later',images:[image]}],activeRequest:{text:'Admitted',images:[],phase:'admitted',turnId:'r'}});
    await saveWork(directory, 'second', {draft:{text:'Other',images:[]},pendingQueue:[]});
    const restored = await loadWork(directory, '../first');
    assert.equal(restored.draft.images[0].note, 'Make this blue');
    assert.equal(restored.pendingQueue[0].images[0].base64Data, image.base64Data);
    assert.equal(restored.queuePaused, true);
    assert.equal(restored.activeRequest.phase, 'admitted');
    assert.equal((await loadWork(directory, 'second')).draft.text, 'Other');
    const files = await readdir(path.join(directory,'work'));
    const backup = files.find(name=>name.endsWith('.backup.json') && name.includes(files[0].split('.')[0]));
    const primary = path.join(directory,'work',backup.replace('.backup',''));
    const complete = await readFile(path.join(directory,'work',backup),'utf8');
    await writeFile(primary,'{broken');
    assert.equal((await loadWork(directory, JSON.parse(complete).sessionId)).draft.text, JSON.parse(complete).draft.text);
    await deleteWork(directory, '../first');
    assert.equal((await loadWork(directory, '../first')).pendingQueue.length,0);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('damaged pending work is preserved and cannot be replaced with an empty queue', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mora-work-'));
  try {
    await saveWork(directory,'s',{pendingQueue:[],draft:{text:'keep',images:[]}});
    for(const name of await readdir(path.join(directory,'work'))) await writeFile(path.join(directory,'work',name),'{broken');
    await assert.rejects(loadWork(directory,'s'),/saved work.*preserved/i);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
