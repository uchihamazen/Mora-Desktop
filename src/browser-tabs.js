import {browserURL} from './annotations.js';
const safeURL=value=>{try{return browserURL(value);}catch{return '';}};
export function browserTabs(value) {
  const tabs=[],seen=new Set();
  for(const item of Array.isArray(value?.tabs)?value.tabs.slice(0,8):[]) {
    if(!item || typeof item.id!=='string' || !/^[a-zA-Z0-9-]{1,64}$/.test(item.id) || seen.has(item.id))continue;seen.add(item.id);
    const all=Array.isArray(item.history?.entries)?item.history.entries:[];const index=Number.isInteger(item.history?.index)?Math.max(0,Math.min(all.length-1,item.history.index)):all.length-1;
    const start=Math.max(0,index-25),entries=[];let active=0;
    for(let i=start;i<Math.min(all.length,start+50);i++){const entry=all[i],url=safeURL(entry?.url);if(!url)continue;if(i<=index)active=entries.length;entries.push({url,title:String(entry.title || '').slice(0,256)});}
    tabs.push({id:item.id,url:safeURL(item.url),title:String(item.title || '').slice(0,256),deviceMode:item.deviceMode==='mobile'?'mobile':'desktop',history:{entries,index:active}});
  }
  if(!tabs.length)tabs.push({id:'tab-1',url:'',title:'',deviceMode:'desktop',history:{entries:[],index:0}});
  return {tabs,activeId:tabs.some(tab=>tab.id===value?.activeId)?value.activeId:tabs[0].id};
}
