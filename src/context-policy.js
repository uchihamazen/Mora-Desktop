import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export function contextPerformanceArgs(help) {
  const has=flag=>new RegExp('(?:^|\\s)'+flag+'(?=\\s|$)').test(help),args=[];
  if(has('--context-compaction-soft-threshold')&&has('--context-compaction-hard-threshold'))args.push('--context-compaction-soft-threshold','0.75','--context-compaction-hard-threshold','0.90');
  if(has('--max-tool-output-bytes'))args.push('--max-tool-output-bytes','65536');
  return args;
}
export async function discoverContextPerformanceArgs(executable,{run=exec}={}) {
  try{const {stdout}=await run(executable,['exec','--help'],{windowsHide:true,timeout:5000,maxBuffer:65536});return contextPerformanceArgs(stdout);}
  catch{return [];}
}
