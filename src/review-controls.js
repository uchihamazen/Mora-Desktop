import {compareProject} from './changes.js';

const lines=buffer=>buffer?.toString('utf8').match(/[^\n]*\n|[^\n]+$/g)||[];
export async function sourceHunks(root,name,before,after) {
  for(const value of [before,after])if(value && (value.includes(0)||!Buffer.from(value.toString('utf8')).equals(value)))return [];
  const snapshot=value=>({files:new Map(value===undefined?[]:[[name,value]]),skipped:new Set(),partial:false,excluded:[]});
  const diff=await compareProject(root,snapshot(before),{after:snapshot(after)}),file=diff.files[0];
  if(!file || file.binary || file.truncated)return [];
  const matches=[...file.patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*/gm)];
  const oldLines=lines(before),newLines=lines(after);
  return matches.map((match,index)=>{
    const oldCount=Number(match[2]??1),newCount=Number(match[4]??1),oldStart=Number(match[1])-(oldCount?1:0),newStart=Number(match[3])-(newCount?1:0);
    return {id:index,label:`Change ${index+1} · lines ${newStart+1}–${newStart+Math.max(1,newCount)}`,oldStart,oldCount,newStart,newCount,
      patch:file.patch.slice(match.index,matches[index+1]?.index),before:oldLines.slice(oldStart,oldStart+oldCount).join(''),after:newLines.slice(newStart,newStart+newCount).join('')};
  });
}
export function rejectHunk(current,hunk) {
  const content=lines(current),selected=content.slice(hunk.newStart,hunk.newStart+hunk.newCount).join('');
  if(selected!==hunk.after)throw Error('The selected lines changed. Review them again.');
  content.splice(hunk.newStart,hunk.newCount,hunk.before);
  return Buffer.from(content.join(''));
}
