import * as files from 'node:fs/promises';
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
  return {apiKey:credential(value.apiKey,'API key'),token:credential(value.token,'token'),...metadata(value)};
}
function metadata(value) {
  return {board:boardIdFromLink(value.board),boardName:value.boardName,boardUrl:value.boardUrl,listCount:value.listCount,username:value.username};
}
function storageError(message,code) {
  return Object.assign(new Error(message),{code});
}
function requireEncryption(crypto) {
  let available=false;
  try{available=crypto?.isEncryptionAvailable() && crypto.getSelectedStorageBackend?.()!=='basic_text';}catch{}
  if(!available)throw storageError('Operating-system encryption is unavailable. Trello credentials were not changed.','TRELLO_ENCRYPTION_UNAVAILABLE');
}
function decode(value,crypto) {
  if(!object(value) || !('version' in value || 'encryptedCredentials' in value))return snapshot(value);
  requireEncryption(crypto);
  try{
    if(value.version!==1 || typeof value.encryptedCredentials!=='string' || !value.encryptedCredentials || value.encryptedCredentials.length>16384)throw Error();
    const encrypted=Buffer.from(value.encryptedCredentials,'base64');
    if(encrypted.toString('base64')!==value.encryptedCredentials)throw Error();
    const credentials=JSON.parse(crypto.decryptString(encrypted));
    return snapshot({...metadata(value),apiKey:credentials.apiKey,token:credentials.token});
  }catch{throw storageError('Trello credentials could not be decrypted. Original settings were kept. Unlock operating-system storage or disconnect and connect again.','TRELLO_DECRYPTION_FAILED');}
}
function settingsNames(filename) {
  const backup=path.join(path.dirname(filename),'trello.backup.json');
  return [backup,filename,`${backup}.tmp`,`${filename}.tmp`];
}
async function loadStored(filename,{crypto,io=files}) {
  const names=settingsNames(filename);
  const originals=await Promise.all(names.map(async name=>{try{return await io.readFile(name);}catch(error){if(error.code==='ENOENT')return;throw Error('Trello settings are unreadable. Original settings were kept.');}}));
  let saved=null,damaged=false,migrate=originals.slice(2).some(value=>value!==undefined);
  for(let index=0;index<2;index++) {
    if(originals[index]===undefined)continue;
    try{
      const value=JSON.parse(originals[index].toString('utf8'));
      const decoded=decode(value,crypto);
      saved ||= decoded;
      migrate ||= value.version!==1 || 'apiKey' in value || 'token' in value;
    }catch(error){if(error.code?.startsWith('TRELLO_'))throw error;damaged=true;}
  }
  if(!saved && damaged)throw Error('Trello settings are unreadable. Disconnect and connect again.');
  return {saved,migrate,originals};
}
async function saveStored(filename,value,{crypto,io=files},originals) {
  requireEncryption(crypto);
  let data;
  try{
    const encrypted=crypto.encryptString(JSON.stringify({apiKey:value.apiKey,token:value.token}));
    if(!Buffer.isBuffer(encrypted) || !encrypted.length)throw Error();
    data=JSON.stringify({version:1,encryptedCredentials:encrypted.toString('base64'),...metadata(value)},null,2)+'\n';
  }catch{throw Error('Trello credentials could not be encrypted. Original settings were kept.');}
  const names=settingsNames(filename),changed=new Set();
  try{
    await io.mkdir(path.dirname(filename),{recursive:true});
    for(let index=0;index<2;index++){
      changed.add(index+2);
      await io.writeFile(names[index+2],data,{mode:0o600,flush:true});
    }
    // The backup is authoritative after an interrupted replacement.
    for(let index=0;index<2;index++){
      await io.rename(names[index+2],names[index]);
      changed.add(index);
    }
  }catch{
    const restored=await Promise.allSettled([...changed].map(index=>originals[index]===undefined ? io.rm(names[index],{force:true}) : io.writeFile(names[index],originals[index],{mode:0o600,flush:true})));
    if(restored.some(result=>result.status==='rejected'))throw Error('Trello settings could not be saved or fully restored. Keep the existing files and retry when storage is available.');
    throw Error('Trello settings could not be saved. Original settings were kept.');
  }
}
export async function readTrelloSettings(filename,options={}) {
  const {saved,migrate,originals}=await loadStored(filename,options);
  if(saved && migrate)await saveStored(filename,saved,options,originals);
  return saved;
}
export function trelloStatus(saved) {
  if(!saved || !saved.apiKey || !saved.token || !saved.board)return {configured:false};
  return {configured:true,boardName:saved.boardName,boardUrl:saved.boardUrl,listCount:saved.listCount,username:saved.username};
}
export async function configureTrello(filename,value,options={}) {
  const io=options.io || files;
  if(value===null) {
    const removed=await Promise.allSettled(settingsNames(filename).map(name=>io.rm(name,{force:true})));
    const failed=removed.find(result=>result.status==='rejected');if(failed)throw failed.reason;
    return {configured:false};
  }
  value=snapshot(value);
  const {originals}=await loadStored(filename,options);
  await saveStored(filename,value,options,originals);
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
