import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import * as files from 'node:fs/promises';
const api=await import('../src/trello.js').catch(()=>({}));
const creds=()=>({apiKey:'ab12cd34ef56ab12cd34ef56ab12cd34',token:'to12ken34to12ken34to12ken34to12ken34to12ken34to12ken34to12ken',board:'https://trello.com/b/abc12345/demo-board'});
const crypto={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).map(byte=>byte^42),decryptString:value=>Buffer.from(value).map(byte=>byte^42).toString()};
const options={crypto};
const names=file=>[path.join(path.dirname(file),'trello.backup.json'),file];
const assertProtected=async file=>{for(const name of names(file)){const text=await readFile(name,'utf8'),saved=JSON.parse(text);assert.equal(saved.version,1);assert.equal(typeof saved.encryptedCredentials,'string');assert.equal(saved.apiKey,undefined);assert.equal(saved.token,undefined);assert.ok(!text.includes(creds().apiKey));assert.ok(!text.includes(creds().token));}for(const name of names(file))await assert.rejects(readFile(`${name}.tmp`),{code:'ENOENT'});};
test('Trello connection encrypts credentials and board, backs up changes and hides secrets',async()=>{
  assert.equal(typeof api.configureTrello,'function');
  const file=path.join(await mkdtemp(path.join(tmpdir(),'muse-trello-')),'trello.json');
  const verified={username:'demo-user',boardName:'Demo board',boardUrl:'https://trello.com/b/abc12345/demo-board',listCount:3};
  const result=await api.configureTrello(file,{...creds(),...verified},options);
  assert.equal(result.configured,true);assert.equal(result.boardName,'Demo board');assert.equal(result.listCount,3);
  assert.doesNotMatch(JSON.stringify(result),/ab12cd34|to12ken/);
  const saved=JSON.parse(await readFile(file,'utf8'));
  assert.equal(saved.board,'abc12345');assert.equal(saved.boardName,'Demo board');
  assert.deepEqual(JSON.parse(await readFile(path.join(path.dirname(file),'trello.backup.json'),'utf8')),saved);
  await assertProtected(file);
  assert.equal(api.trelloStatus(await api.readTrelloSettings(file,options)).configured,true);
  assert.equal(api.trelloStatus(null).configured,false);
  await api.configureTrello(file,{...creds(),boardName:'Second',boardUrl:'https://trello.com/b/abc12345/x',listCount:1,username:'u'},options);
  assert.equal(JSON.parse(await readFile(path.join(path.dirname(file),'trello.backup.json'),'utf8')).boardName,'Second');
  const cleared=await api.configureTrello(file,null);
  assert.equal(cleared.configured,false);assert.equal(await api.readTrelloSettings(file),null);
});
test('Trello rejects invalid credentials and board links without writing',async()=>{
  assert.equal(typeof api.configureTrello,'function');
  const file=path.join(await mkdtemp(path.join(tmpdir(),'muse-trello-invalid-')),'trello.json');
  const original=JSON.stringify({apiKey:'k'.repeat(32),token:'t'.repeat(64),board:'abc12345'});
  await writeFile(file,original);
  for(const apiKey of ['','short','has space','bad\nkey'])await assert.rejects(api.configureTrello(file,{...creds(),apiKey}));
  for(const token of ['','short','has space'])await assert.rejects(api.configureTrello(file,{...creds(),token}));
  for(const board of ['','not a link','https://trello.com/c/abc12345/card','https://example.com/b/abc12345'])await assert.rejects(api.configureTrello(file,{...creds(),board}));
  assert.equal(await readFile(file,'utf8'),original);
  await writeFile(file,'');
  await assert.rejects(api.configureTrello(file,creds()),/unreadable/i);
  assert.equal(await readFile(file,'utf8'),'');
  await api.configureTrello(file,null);
  assert.equal(await api.readTrelloSettings(file),null);
});

test('Legacy plaintext primary, backup and interrupted temp files migrate on load',async()=>{
  const file=path.join(await mkdtemp(path.join(tmpdir(),'mora-trello-migrate-')),'trello.json');
  const original=JSON.stringify({...creds(),board:'abc12345',boardName:'Legacy'});
  for(const name of names(file))for(const suffix of ['', '.tmp'])await writeFile(name+suffix,original);
  const saved=await api.readTrelloSettings(file,options);
  assert.equal(saved.apiKey,creds().apiKey);assert.equal(saved.token,creds().token);assert.equal(saved.boardName,'Legacy');
  await assertProtected(file);
  const encrypted=await Promise.all(names(file).map(name=>readFile(name,'utf8')));
  assert.deepEqual(await api.readTrelloSettings(file,options),saved);
  assert.deepEqual(await Promise.all(names(file).map(name=>readFile(name,'utf8'))),encrypted);
});

test('Missing or unavailable OS encryption never writes or downgrades plaintext',async()=>{
  const file=path.join(await mkdtemp(path.join(tmpdir(),'mora-trello-locked-')),'trello.json');
  for(const unavailable of [{},{crypto:{isEncryptionAvailable:()=>false}},{crypto:{...crypto,getSelectedStorageBackend:()=> 'basic_text'}}]){
    await assert.rejects(api.configureTrello(file,creds(),unavailable),/encryption.*unavailable/i);
    for(const name of names(file))await assert.rejects(readFile(name),{code:'ENOENT'});
  }
  const original=JSON.stringify({...creds(),board:'abc12345'});
  for(const name of names(file))for(const suffix of ['', '.tmp'])await writeFile(name+suffix,original);
  for(const unavailable of [{},{crypto:{isEncryptionAvailable:()=>false}},{crypto:{...crypto,getSelectedStorageBackend:()=> 'basic_text'}}]){
    await assert.rejects(api.readTrelloSettings(file,unavailable),/encryption.*unavailable/i);
    await assert.rejects(api.configureTrello(file,creds(),unavailable),/encryption.*unavailable/i);
    for(const name of names(file))for(const suffix of ['', '.tmp'])assert.equal(await readFile(name+suffix,'utf8'),original);
  }
  assert.deepEqual(await api.configureTrello(file,null),{configured:false});
});

test('Encryption and decryption errors are redacted and preserve original credential files',async()=>{
  const file=path.join(await mkdtemp(path.join(tmpdir(),'mora-trello-codec-')),'trello.json');
  const original=JSON.stringify({...creds(),board:'abc12345'});
  for(const name of names(file))await writeFile(name,original);
  const broken={crypto:{...crypto,encryptString(){throw Error(creds().token);}}};
  for(const action of [()=>api.readTrelloSettings(file,broken),()=>api.configureTrello(file,creds(),broken)]){
    await assert.rejects(action(),error=>/could not be encrypted/i.test(error.message) && !error.message.includes(creds().token));
    for(const name of names(file))assert.equal(await readFile(name,'utf8'),original);
  }
  await api.readTrelloSettings(file,options);
  const encrypted=await Promise.all(names(file).map(name=>readFile(name,'utf8')));
  const locked={crypto:{...crypto,decryptString(){throw Error(creds().apiKey);}}};
  for(const action of [()=>api.readTrelloSettings(file,locked),()=>api.configureTrello(file,creds(),locked)])await assert.rejects(action(),error=>/could not be decrypted/i.test(error.message) && !error.message.includes(creds().apiKey));
  assert.deepEqual(await Promise.all(names(file).map(name=>readFile(name,'utf8'))),encrypted);
  for(const name of names(file))await assert.rejects(readFile(`${name}.tmp`),{code:'ENOENT'});
});

test('A partial save failure restores original primary and backup and removes encrypted staging files',async()=>{
  const file=path.join(await mkdtemp(path.join(tmpdir(),'mora-trello-atomic-')),'trello.json');
  const originals=names(file).map((_,index)=>JSON.stringify({...creds(),board:'abc12345',boardName:`Original ${index}`}));
  for(let index=0;index<2;index++)await writeFile(names(file)[index],originals[index]);
  let committedBackup=false,failed=false;
  const io={...files,rename:async(from,to)=>{if(to===file && !failed){assert.equal(committedBackup,true);failed=true;throw Error('Injected primary rename failure');}await files.rename(from,to);if(to===names(file)[0])committedBackup=true;}};
  await assert.rejects(api.readTrelloSettings(file,{crypto,io}),/could not be saved/i);
  assert.equal(failed,true);
  for(let index=0;index<2;index++)assert.equal(await readFile(names(file)[index],'utf8'),originals[index]);
  for(const name of names(file))await assert.rejects(readFile(`${name}.tmp`),{code:'ENOENT'});
  await api.readTrelloSettings(file,options);await assertProtected(file);
});

test('A staging failure preserves primary, backup and earlier plaintext temporary files byte for byte',async()=>{
  const file=path.join(await mkdtemp(path.join(tmpdir(),'mora-trello-stage-')),'trello.json');
  const original=JSON.stringify({...creds(),board:'abc12345'});
  for(const name of names(file))for(const suffix of ['', '.tmp'])await writeFile(name+suffix,original);
  let failed=false;
  const io={...files,writeFile:async(name,...args)=>{if(name===`${file}.tmp` && !failed){failed=true;throw Error(creds().token);}return files.writeFile(name,...args);}};
  await assert.rejects(api.readTrelloSettings(file,{crypto,io}),error=>/could not be saved/i.test(error.message) && !error.message.includes(creds().token));
  assert.equal(failed,true);
  for(const name of names(file))for(const suffix of ['', '.tmp'])assert.equal(await readFile(name+suffix,'utf8'),original);
});

test('Updating an encrypted configuration rolls back both copies if its primary replacement fails',async()=>{
  const file=path.join(await mkdtemp(path.join(tmpdir(),'mora-trello-update-')),'trello.json');
  await api.configureTrello(file,{...creds(),boardName:'Original'},options);
  const originals=await Promise.all(names(file).map(name=>readFile(name,'utf8')));
  let failed=false;
  const io={...files,rename:async(from,to)=>{if(to===file && !failed){failed=true;throw Error('Injected replacement failure');}return files.rename(from,to);}};
  await assert.rejects(api.configureTrello(file,{...creds(),boardName:'Changed'},{crypto,io}),/could not be saved/i);
  assert.equal(failed,true);
  assert.deepEqual(await Promise.all(names(file).map(name=>readFile(name,'utf8'))),originals);
  assert.equal((await api.readTrelloSettings(file,options)).boardName,'Original');await assertProtected(file);
});

test('Successful load removes stale plaintext staging data and extra plaintext fields from encrypted settings',async()=>{
  const file=path.join(await mkdtemp(path.join(tmpdir(),'mora-trello-leftovers-')),'trello.json');
  await api.configureTrello(file,{...creds(),boardName:'Encrypted'},options);
  for(const name of names(file)){
    const saved=JSON.parse(await readFile(name,'utf8'));
    await writeFile(name,JSON.stringify({...saved,apiKey:creds().apiKey,token:creds().token}));
    await writeFile(`${name}.tmp`,JSON.stringify(creds()));
  }
  const saved=await api.readTrelloSettings(file,options);
  assert.equal(saved.boardName,'Encrypted');assert.equal(saved.token,creds().token);await assertProtected(file);
});

test('An interrupted encrypted backup takes precedence and finishes migrating a stale plaintext primary',async()=>{
  const file=path.join(await mkdtemp(path.join(tmpdir(),'mora-trello-recover-')),'trello.json');
  await api.configureTrello(file,{...creds(),boardName:'Latest'},options);
  await writeFile(file,JSON.stringify({...creds(),board:'abc12345',boardName:'Earlier'}));
  const recovered=await api.readTrelloSettings(file,options);
  assert.equal(recovered.boardName,'Latest');await assertProtected(file);
});

test('An unreadable encrypted backup does not fall back to plaintext or overwrite the originals',async()=>{
  const file=path.join(await mkdtemp(path.join(tmpdir(),'mora-trello-corrupt-')),'trello.json');
  await api.configureTrello(file,creds(),options);
  const malformed=JSON.stringify({version:1,encryptedCredentials:'invalid!',board:'abc12345'});
  await writeFile(names(file)[0],malformed);
  const plain=JSON.stringify({...creds(),board:'abc12345'});await writeFile(file,plain);
  await assert.rejects(api.readTrelloSettings(file,options),/could not be decrypted/i);
  assert.equal(await readFile(names(file)[0],'utf8'),malformed);assert.equal(await readFile(file,'utf8'),plain);
});
test('Disconnect clears unreadable primary and backup settings',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'mora-trello-damaged-')),file=path.join(directory,'trello.json');
  await writeFile(file,'{');await writeFile(path.join(directory,'trello.backup.json'),'{');
  await assert.rejects(api.readTrelloSettings(file),/unreadable/i);
  assert.deepEqual(await api.configureTrello(file,null),{configured:false});
  assert.equal(await api.readTrelloSettings(file),null);
});
test('Disconnect also removes credential temp files left by interrupted Connect',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'mora-trello-temp-')),file=path.join(directory,'trello.json');
  for(const name of ['trello.json.tmp','trello.backup.json.tmp'])await writeFile(path.join(directory,name),JSON.stringify(creds()));
  await api.configureTrello(file,null);
  for(const name of ['trello.json.tmp','trello.backup.json.tmp'])await assert.rejects(readFile(path.join(directory,name)),{code:'ENOENT'});
});
test('Disconnect reports removal failures instead of claiming credentials were cleared',async()=>{
  const {mkdir,rmdir}=await import('node:fs/promises');
  const directory=await mkdtemp(path.join(tmpdir(),'mora-trello-remove-')),file=path.join(directory,'trello.json');
  await mkdir(file);
  await writeFile(path.join(directory,'trello.backup.json'),JSON.stringify({...creds(),board:'abc12345'}));
  try{await assert.rejects(api.configureTrello(file,null));}
  finally{await rmdir(file);}
});
test('Trello parses board links and bare IDs',()=>{
  assert.equal(typeof api.boardIdFromLink,'function');
  assert.equal(api.boardIdFromLink('https://trello.com/b/abc12345/demo-board'),'abc12345');
  assert.equal(api.boardIdFromLink('https://trello.com/b/abc12345/'),'abc12345');
  assert.equal(api.boardIdFromLink('abc12345'),'abc12345');
  assert.equal(api.boardIdFromLink('5f6a7b8c9d0e1f2a3b4c5d6e'),'5f6a7b8c9d0e1f2a3b4c5d6e');
  for(const board of ['','  ','https://trello.com/c/abc12345/card','https://example.com/b/abc12345','not a link','toolongboardid123'])assert.throws(()=>api.boardIdFromLink(board));
});
test('Trello verifies member, board and lists before connecting, redacting secrets',async()=>{
  assert.equal(typeof api.checkTrello,'function');
  const requests=[];
  const fetch=async url=>{requests.push(url);
    if(url.includes('/members/me'))return new Response(JSON.stringify({username:'demo-user'}));
    if(url.includes('/lists'))return new Response(JSON.stringify([{name:'Todo'},{name:'Doing'},{name:'Done'}]));
    return new Response(JSON.stringify({name:'Demo board',url:'https://trello.com/b/abc12345/demo-board'}));};
  const result=await api.checkTrello(creds(),fetch);
  assert.equal(result.username,'demo-user');assert.equal(result.boardName,'Demo board');assert.equal(result.listCount,3);
  assert.doesNotMatch(JSON.stringify(result),/ab12cd34|to12ken/);
  assert.equal(requests.length,3);
  assert.ok(requests.every(url=>url.includes('key=ab12cd34') && url.includes('token=to12ken')));
  assert.ok(requests.some(url=>url.includes('/boards/abc12345?')));
  await assert.rejects(api.checkTrello(creds(),async()=>new Response('invalid key ab12cd34',{status:401})),error=>/key or token/i.test(error.message) && !error.message.includes('ab12cd34'));
  await assert.rejects(api.checkTrello(creds(),async()=>{throw new DOMException('timed out','AbortError');}),/timed out/i);
});
