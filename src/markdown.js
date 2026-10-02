export function safeLink(value) {
  try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
// Tokens become DOM text nodes; raw HTML is never parsed or inserted as HTML.
export function inlineParts(text) {
  const parts = []; let cursor = 0;
  const pattern = /<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>])(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^'">])*(?:>|$)|`([^`\n]*)`|(!?)\[([^\]\n]*)\]\(([^\s()]+(?:\([^\n()]*\)[^\s()]*)*)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|https?:\/\/[^\s<>"`]+/g;
  for(const match of String(text).matchAll(pattern)) {
    if(match.index>cursor)parts.push({type:'text',text:text.slice(cursor,match.index)});
    const url = safeLink(match[4] || (/^https?:/.test(match[0]) ? match[0].replace(/[.,;!]+$/,'') : ''));
    if(match[1] !== undefined)parts.push({type:'code',text:match[1]});
    else if(match[3] !== undefined && match[2])parts.push({type:'image',text:match[0],url,alt:match[3]});
    else if(url)parts.push({type:'link',text:match[3] ?? match[0],url});
    else if(match[5])parts.push({type:'strong',text:match[5]});
    else if(match[6])parts.push({type:'em',text:match[6]});
    else parts.push({type:match[0].startsWith('<')?'literal':'text',text:match[0]});
    cursor=match.index+match[0].length;
  }
  if(cursor<text.length)parts.push({type:'text',text:text.slice(cursor)});
  return parts;
}
const cells = line => line.trim().replace(/^\||\|$/g,'').split('|').map(value=>value.trim());
export function markdownBlocks(value) {
  const lines = String(value || '').replaceAll('\r\n','\n').split('\n'), blocks = [];
  for(let i=0;i<lines.length;) {
    if(!lines[i].trim()){i++;continue;}
    const fence=/^\s*```([^`]*)$/.exec(lines[i]);
    if(fence) {
      const start=++i;while(i<lines.length && !/^\s*```\s*$/.test(lines[i]))i++;
      blocks.push({type:'code',language:fence[1].trim(),text:lines.slice(start,i).join('\n')+(i<lines.length && i>start?'\n':'')});if(i<lines.length)i++;continue;
    }
    const heading=/^(#{1,6})\s+(.+)$/.exec(lines[i]);
    if(heading){blocks.push({type:'heading',level:heading[1].length,text:heading[2].replace(/\s+#+$/,'')});i++;continue;}
    if(lines[i].includes('|') && i+1<lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i+1])) {
      const header=cells(lines[i]);i+=2;const rows=[];
      while(i<lines.length && lines[i].trim() && lines[i].includes('|'))rows.push(cells(lines[i++]));
      blocks.push({type:'table',header,rows});continue;
    }
    const list=/^\s*(?:([-+*])|\d+[.)])\s+(.+)$/.exec(lines[i]);
    if(list){const ordered=!list[1],items=[];while(i<lines.length){const next=/^\s*(?:([-+*])|\d+[.)])\s+(.+)$/.exec(lines[i]);if(!next || !next[1]!==ordered)break;items.push(next[2]);i++;}blocks.push({type:'list',ordered,items});continue;}
    if(/^>\s?/.test(lines[i])){const text=[];while(i<lines.length && /^>\s?/.test(lines[i]))text.push(lines[i++].replace(/^>\s?/,''));blocks.push({type:'quote',text:text.join('\n')});continue;}
    const text=[lines[i++]];
    while(i<lines.length && lines[i].trim() && !/^(?:#{1,6}\s|\s*```|>\s?|\s*[-+*]\s|\s*\d+[.)]\s)/.test(lines[i]) && !(i+1<lines.length && lines[i].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i+1])))text.push(lines[i++]);
    blocks.push({type:'paragraph',text:text.join('\n')});
  }
  return blocks;
}
