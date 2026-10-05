export function formatContextReference(kind,name){if(!['file','folder'].includes(kind)||typeof name!=='string'||!name||name.length>1024||/[\r\n]/.test(name))throw Error('Choose a file or folder path.');return `@${kind}(${JSON.stringify(name)})`;}
export function parseContextReferences(text){
  if(typeof text!=='string')throw Error('Write a text request.');const references=[];
  const expression=/@(file|folder)\(/g;let match;
  while((match=expression.exec(text))){
    let cursor=match.index+match[0].length,depth=1,quoted=false,escaped=false,end=-1;
    for(let index=cursor;index<text.length&&index-cursor<=2048;index++){const char=text[index];if(char==='\n'||char==='\r')break;if(escaped){escaped=false;continue;}if(quoted&&char==='\\'){escaped=true;continue;}if(char==='"'){quoted=!quoted;continue;}if(quoted)continue;if(char==='(')depth++;if(char===')'&&--depth===0){end=index;break;}}
    if(end<0)throw Error('Close the file or folder reference with a matching parenthesis.');const raw=text.slice(cursor,end).trim();let name=raw;
    if(raw.startsWith('"'))try{name=JSON.parse(raw);}catch{throw Error('Use a valid quoted context path.');}
    if(typeof name!=='string'||!name||name.length>1024)throw Error('Choose a file or folder path of up to 1,024 characters.');references.push({kind:match[1],path:name});expression.lastIndex=end+1;
  }
  return references;
}
