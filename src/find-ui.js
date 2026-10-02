export function setupConversationFind() {
  const $=id=>document.getElementById(id),panel=$('conversation-find'),input=$('find-text');let matches=[],current=0,returnFocus,sessionId;
  function showMatch(scroll=false) {
    CSS.highlights.set('conversation-matches',new Highlight(...matches));CSS.highlights.set('conversation-current',new Highlight(...(matches[current]?[matches[current]]:[])));
    $('find-count').textContent=input.value?(matches.length?`${current+1} of ${matches.length}`:'No matches'):'Enter text';
    $('find-previous').disabled=$('find-next').disabled=!matches.length;
    if(scroll && matches[current]){const area=$('scroll-area'),rect=matches[current].getBoundingClientRect();area.scrollTop+=rect.top-area.getBoundingClientRect().top-area.clientHeight/2;}
  }
  function refresh(scroll=false) {
    if(panel.hidden)return;const query=input.value;matches=[];
    if(query) {
      const walker=document.createTreeWalker($('messages'),NodeFilter.SHOW_TEXT);const blocks=new Map();let text;
      while((text=walker.nextNode())) {
        const parent=text.parentElement;if(!text.data || !parent.checkVisibility() || parent.closest('button,textarea,input,[hidden]'))continue;
        const block=parent.closest('p,pre,li,blockquote,td,th,h1,h2,h3,h4,h5,h6,summary,.message-label,.activity-step') || parent;
        if(!blocks.has(block))blocks.set(block,[]);blocks.get(block).push(text);
      }
      for(const nodes of blocks.values()) {
        const content=nodes.map(node=>node.data).join('');const escaped=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        for(const match of content.matchAll(new RegExp(escaped,'gi'))) {
          let offset=0,start,end;for(const node of nodes){if(!start && match.index<offset+node.length)start=[node,match.index-offset];if(match.index+match[0].length<=offset+node.length){end=[node,match.index+match[0].length-offset];break;}offset+=node.length;}
          if(start && end){const range=document.createRange();range.setStart(...start);range.setEnd(...end);if(range.getClientRects().length)matches.push(range);}
        }
      }
    }
    current=Math.min(current,Math.max(0,matches.length-1));showMatch(scroll);
  }
  function open(){if(panel.hidden)returnFocus=document.activeElement;panel.hidden=false;refresh();input.focus();input.select();}
  function close(){panel.hidden=true;CSS.highlights.delete('conversation-matches');CSS.highlights.delete('conversation-current');(returnFocus?.isConnected && returnFocus.checkVisibility()?returnFocus:$('prompt')).focus();}
  function move(delta){if(matches.length){current=(current+delta+matches.length)%matches.length;showMatch(true);}}
  input.addEventListener('input',()=>{current=0;refresh(true);});input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();move(event.shiftKey?-1:1);}});
  $('find-next').addEventListener('click',()=>move(1));$('find-previous').addEventListener('click',()=>move(-1));$('find-close').addEventListener('click',close);
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && !panel.hidden && !document.querySelector('dialog[open]')){event.preventDefault();close();}});
  new MutationObserver(()=>refresh()).observe($('messages'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['open','hidden']});
  return {open,update:id=>{if(sessionId!==id){sessionId=id;current=0;input.value='';}refresh();},isOpen:()=>!panel.hidden};
}
