import {readFile, writeFile, mkdir, rename, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {validateImages} from './images.js';

export function validateDraft(value = {}) {
  if (typeof value.text !== 'string' || value.text.length > 200000) throw new Error('Message is too long.');
  const images = validateImages(value.images || []).map((image,index) => {
    const source = value.images[index];
    for (const [key,limit] of [['name',200],['contextText',50000],['note',10000],['sourceUrl',4000]]) {
      if (source[key] !== undefined) {
        if (typeof source[key] !== 'string' || source[key].length > limit) throw new Error('Invalid annotation.');
        image[key] = source[key];
      }
    }
    if(source.annotationRef!==undefined) {
      const ref=source.annotationRef;
      if(!ref || !['id','tabId','documentId'].every(key=>typeof ref[key]==='string' && /^[\w-]{1,100}$/.test(ref[key])) || !['element','region'].includes(ref.mode) || !ref.rect || !ref.viewport || ![ref.rect.x,ref.rect.y,ref.rect.width,ref.rect.height,ref.viewport.width,ref.viewport.height].every(number=>Number.isFinite(number)&&Math.abs(number)<=10000000) || ref.rect.width<=0 || ref.rect.height<=0 || ref.viewport.width<=0 || ref.viewport.height<=0)throw Error('Invalid annotation reference.');
      image.annotationRef={id:ref.id,tabId:ref.tabId,documentId:ref.documentId,mode:ref.mode,rect:{x:ref.rect.x,y:ref.rect.y,width:ref.rect.width,height:ref.rect.height},viewport:{width:ref.viewport.width,height:ref.viewport.height}};
    }
    return image;
  });
  return {text:value.text,images};
}
function validateWork(value) {
  if (!value || !Array.isArray(value.pendingQueue) || value.pendingQueue.length > 10) throw new Error('Invalid saved queue.');
  const pendingQueue = value.pendingQueue.map(entry => {
    if (typeof entry.queueId !== 'string' || !entry.queueId) throw new Error('Invalid queued request.');
    return {...validateDraft(entry),queueId:entry.queueId,queuedAt:entry.queuedAt};
  });
  const activeRequest = value.activeRequest ? {...validateDraft(value.activeRequest),phase:value.activeRequest.phase,turnId:value.activeRequest.turnId} : null;
  if (activeRequest && !['preparing','admitted'].includes(activeRequest.phase)) throw new Error('Invalid active request.');
  return {draft:validateDraft(value.draft || {text:'',images:[]}),pendingQueue,queuePaused:!!value.queuePaused,activeRequest,lastOutcome:value.lastOutcome || null};
}
function workPath(directory, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('Choose a conversation.');
  return path.join(directory,'work',`${createHash('sha256').update(sessionId).digest('hex')}.json`);
}
export async function loadWork(directory, sessionId) {
  const filename = workPath(directory,sessionId); let damaged = false;
  for(const candidate of [filename.replace(/\.json$/,'.backup.json'),filename]) {
    try {
      const saved = JSON.parse(await readFile(candidate,'utf8'));
      if(saved.sessionId !== sessionId) throw new Error('Wrong conversation.');
      const work = validateWork(saved);
      // Never replay a request or automatically drain work recovered after a restart.
      work.queuePaused = !!(work.pendingQueue.length || work.activeRequest);
      return work;
    } catch(error) { if(error.code !== 'ENOENT') damaged = true; }
  }
  if(damaged) throw new Error('Saved work could not be read. Its files were preserved; restore a backup before sending.');
  return validateWork({pendingQueue:[]});
}
const writes = new Map();
export function saveWork(directory, sessionId, value) {
  const filename = workPath(directory,sessionId);
  const snapshot = JSON.stringify({sessionId,...validateWork(value)});
  const operation = (writes.get(filename) || Promise.resolve()).catch(()=>{}).then(async()=>{
    await mkdir(path.dirname(filename),{recursive:true});
    for(const candidate of [filename.replace(/\.json$/,'.backup.json'),filename]) {
      await writeFile(`${candidate}.tmp`,snapshot,{flush:true}); await rename(`${candidate}.tmp`,candidate);
    }
  });
  writes.set(filename,operation);
  operation.finally(()=>{if(writes.get(filename)===operation)writes.delete(filename);}).catch(()=>{});
  return operation;
}
export async function deleteWork(directory, sessionId) {
  const filename = workPath(directory,sessionId);
  await writes.get(filename)?.catch(()=>{});
  for(const candidate of [filename,filename.replace(/\.json$/,'.backup.json'),`${filename}.tmp`,filename.replace(/\.json$/,'.backup.json.tmp')]) await rm(candidate,{force:true});
}
