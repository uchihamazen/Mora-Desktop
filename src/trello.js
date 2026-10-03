import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';

export const TRELLO_API='https://api.trello.com';
const object=value=>value && typeof value==='object' && !Array.isArray(value);
function credential(value,label) {
  if(typeof value!=='string' || !/^[A-Za-z0-9]{8,256}$/.test(value.trim()))throw new Error(`Enter your Trello ${label}.`);
  return value.trim();
}
export function boardIdFromLink(board) {
  if(typeof board!=='string')throw new Error('Paste a Trello board link or board ID.');
  const value=board.trim();
  const id=/^https?:\/\/(www\.)?trello\.com\/b\/([A-Za-z0-9]{8}|[a-f0-9]{24})(?=\/|$)/.exec(value)?.[2] || value;
  if(!/^([A-Za-z0-9]{8}|[a-f0-9]{24})$/.test(id))throw new Error('Paste a Trello board link or board ID.');
  return id;
}
function snapshot(value) {
  if(!object(value) || typeof value.apiKey!=='string' || typeof value.token!=='string' || typeof value.board!=='string')throw new Error('Trello settings are unreadable. Disconnect and connect again.');
  return value;
}
export async function readTrelloSettings(filename) {
  let damaged=false;
  for(const name of [path.join(path.dirname(filename),'trello.backup.json'),filename]) {
    try{return snapshot(JSON.parse(await readFile(name,'utf8')));}
    catch(error){if(error.code!=='ENOENT')damaged=true;}
  }
  if(damaged)throw new Error('Trello settings are unreadable. Disconnect and connect again.');
  return null;
}
export function trelloStatus(saved) {
  if(!saved || !saved.apiKey || !saved.token || !saved.board)return {configured:false};
  return {configured:true,boardName:saved.boardName,boardUrl:saved.boardUrl,listCount:saved.listCount,username:saved.username};
}
export async function configureTrello(filename,value) {
  if(value===null) {
    const backup=path.join(path.dirname(filename),'trello.backup.json');
    const removed=await Promise.allSettled([filename,backup,`${filename}.tmp`,`${backup}.tmp`].map(name=>rm(name,{force:true})));
    const failed=removed.find(result=>result.status==='rejected');if(failed)throw failed.reason;
    return {configured:false};
  }
  value={apiKey:credential(value?.apiKey,'API key'),token:credential(value?.token,'token'),board:boardIdFromLink(value?.board),boardName:value.boardName,boardUrl:value.boardUrl,listCount:value.listCount,username:value.username};
  await readTrelloSettings(filename);
  await mkdir(path.dirname(filename),{recursive:true});
  const data=JSON.stringify(value,null,2)+'\n';
  for(const name of [path.join(path.dirname(filename),'trello.backup.json'),filename]) {
    const temp=`${name}.tmp`;
    await writeFile(temp,data,{mode:0o600});
    await rename(temp,name);
  }
  return trelloStatus(value);
}
async function getJSON(url,signal,fetch) {
  const response=await fetch(url,{signal,redirect:'error',headers:{Accept:'application/json'}});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new Error(response.status===401 || response.status===403 ? 'Trello rejected this API key or token. Check your credentials.' : `Trello request failed (HTTP ${response.status}). Try again later.`);}
  const text=await response.text();
  if(text.length>2*1024*1024)throw new Error('Trello returned too much data.');
  return JSON.parse(text);
}
export async function checkTrello({apiKey,token,board}={},fetch=globalThis.fetch) {
  const key=credential(apiKey,'API key'),auth=credential(token,'token'),id=boardIdFromLink(board);
  const signal=AbortSignal.timeout(30000);
  const query=`key=${encodeURIComponent(key)}&token=${encodeURIComponent(auth)}`;
  try{
    const member=await getJSON(`${TRELLO_API}/1/members/me?${query}`,signal,fetch);
    const info=await getJSON(`${TRELLO_API}/1/boards/${id}?fields=name,url&${query}`,signal,fetch);
    const lists=await getJSON(`${TRELLO_API}/1/boards/${id}/lists?fields=name&${query}`,signal,fetch);
    if(typeof member?.username!=='string' || typeof info?.name!=='string' || !Array.isArray(lists))throw new Error('Trello returned an unreadable board. Try again later.');
    return {username:member.username,boardName:info.name,boardUrl:info.url,listCount:lists.length};
  }catch(error){if(error.name==='TimeoutError' || error.name==='AbortError')throw new Error('Trello connection timed out. Try again.');if(error.message.includes(key) || error.message.includes(auth))throw new Error('Trello connection failed. Check your credentials and try again.');throw error;}
}
