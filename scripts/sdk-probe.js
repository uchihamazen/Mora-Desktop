// Optional handshake probe. Install the pinned SDK in a separate directory;
// this script neither upgrades Muse nor changes the application's transport.
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {discoverMuse} from '../src/msp.js';

const version='1.4.2',directory=process.argv[2];
if(!directory || !path.isAbsolute(directory))throw new Error('Pass the absolute SDK package directory from an isolated @muse-code/sdk@1.4.2 installation.');
const pkg=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));
if(pkg.name!=='@muse-code/sdk' || pkg.version!==version)throw new Error(`This probe requires @muse-code/sdk@${version}.`);
const {MuseClient,EXPECTED_SCHEMA_FINGERPRINT}=await import(pathToFileURL(path.join(directory,pkg.main)));
const workspace=await mkdtemp(path.join(tmpdir(),'mora-sdk-probe-'));
let client;
const timeout=setTimeout(()=>{process.stderr.write('SDK handshake timed out. The application still uses exec.\n');process.exit(2);},25000);
try {
  client=await MuseClient.spawn({museBin:await discoverMuse(),args:['serve','--no-session-log'],cwd:workspace,env:{...process.env,RUST_MIN_STACK:'33554432'},clientInfo:{name:'mora_compatibility_probe',version:'0.1.2'},shutdownTimeoutMs:1000});
  const metadata=client.initializeResult;
  console.log(JSON.stringify({sdkVersion:version,engineVersion:metadata.serverInfo?.version,handshake:'passed',schemaMatches:metadata.schema?.fingerprint===EXPECTED_SCHEMA_FINGERPRINT,durability:client.durability.kind,migrationReady:false,requiredWorkflowChecks:['live events','cancellation','durable resume','interactive approvals']},null,2));
} finally {
  clearTimeout(timeout);await client?.close();
  if(path.dirname(workspace)===path.resolve(tmpdir()) && path.basename(workspace).startsWith('mora-sdk-probe-'))await rm(workspace,{recursive:true,force:true});
}
