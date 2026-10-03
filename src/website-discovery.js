import {createHash} from 'node:crypto';
import {allowedNavigation,redactText} from './website-policy.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
export function stableText(value) {
  return redactText(String(value??'').replace(/(?:\b\d{4}-\d\d-\d\d|\[redacted number\])(?:T| )\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?\b/g,'[time]')
    .replace(/\b\d{1,2}:\d\d(?::\d\d)?(?:\s?[AP]M)?\b/gi,'[time]')
    .replace(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi,'[id]').replace(/\s+/g,' ').trim());
}
function stateURL(value) {
  const url=new URL(value);for(const key of [...url.searchParams.keys()])if(/^(?:timestamp|ts|nonce|cacheBust|_t)$/i.test(key))url.searchParams.delete(key);
  url.searchParams.sort();return redactText(url.href);
}
export function controlKey(control) {
  return hash([control.frameUrl||'',control.tag,control.type||'',control.role||'',stableText(control.name),control.href?stateURL(control.href):'']);
}
export function controlFamily(control) {
  if(/next|previous|page|more results/i.test(control.name))return 'pagination';
  if(control.role==='tab')return 'tabs';
  if(control.type==='search'||/search/i.test(control.name))return 'search';
  if(control.tag==='select'||/filter|sort/i.test(control.name))return 'filters';
  if(control.tag==='a')return 'navigation';
  if(['input','textarea'].includes(control.tag)||control.role==='checkbox')return 'form';
  return 'interaction';
}
export function createDiscovery({maxStates=120,maxVisitsPerPath=5}={}) {
  return {states:[],features:[],transitions:[],relations:[],frontier:[],gaps:[],maxStates,maxVisitsPerPath};
}
export function stateFingerprint(observation) {
  const controls=(observation.controls||[]).map(c=>({key:c.key||controlKey(c),value:c.sensitive?'[private]':stableText(c.value),checked:c.checked??null,disabled:!!c.disabled,expanded:c.expanded??null,selected:c.selected??null,constraints:c.constraints||{},options:c.sensitive?[]:c.options||[]}));
  return hash({url:stateURL(observation.url),role:observation.roleId,controls,text:stableText(observation.visibleText),dialogs:observation.dialogs||[],regions:(observation.regions||[]).map(r=>({name:stableText(r.name),text:stableText(r.text)}))});
}
export function observeState(map,observation) {
  const stateId=stateFingerprint(observation),existing=map.states.find(s=>s.id===stateId);
  for(const gap of observation.unsupported||[])if(!map.gaps.includes(gap))map.gaps.push(gap);
  if(existing){existing.visits++;existing.lastObservationId=observation.id;return {stateId,isNew:false};}
  if(map.states.length>=map.maxStates){if(!map.gaps.includes('Discovery state limit reached.'))map.gaps.push('Discovery state limit reached.');return {stateId,isNew:false,limited:true};}
  const url=stateURL(observation.url),page=new URL(url),pathKey=page.origin+page.pathname;
  const pageURLs=new Set(map.states.filter(s=>s.pathKey===pathKey&&s.roleId===observation.roleId).map(s=>s.url));
  if(!pageURLs.has(url)&&pageURLs.size>=map.maxVisitsPerPath){const gap=`Pagination/page limit reached at ${pathKey}.`;if(!map.gaps.includes(gap))map.gaps.push(gap);return {stateId,isNew:false,limited:true};}
  const regions=[...(observation.regions||[]),...(observation.dialogs||[]).map(name=>({name:'Dialog: '+name,text:'open'}))].map(r=>({name:stableText(r.name),text:stableText(r.text)}));
  const state={id:stateId,url,pathKey,roleId:observation.roleId,title:redactText(observation.title),summary:stableText(observation.visibleText).slice(0,800),dialogs:observation.dialogs||[],regions,visits:1,lastObservationId:observation.id,controlKeys:[]};map.states.push(state);
  for(const control of observation.controls||[]) {
    const key=control.key||controlKey(control),featureId=hash([pathKey,observation.roleId,key]),family=controlFamily(control);state.controlKeys.push(key);
    if(!map.features.some(f=>f.id===featureId))map.features.push({id:featureId,key,name:redactText(control.name),family,url,roleId:observation.roleId});
    const duplicate=observation.controls.filter(c=>(c.key||controlKey(c))===key).length>1;
    const actionable=['button','a'].includes(control.tag)||['button','tab','checkbox','radio'].includes(control.role)||control.tag==='input'&&['checkbox','radio'].includes(control.type);
    if(map.frontier.length<3000)map.frontier.push({stateId,featureId,targetKey:key,name:redactText(control.name),url,href:control.href?redactText(control.href):'',family,status:'unexplored',actionable:actionable&&!control.disabled&&!control.inert&&!control.sensitive&&!duplicate});
    else if(!map.gaps.includes('Discovery control limit reached.'))map.gaps.push('Discovery control limit reached.');
    if(duplicate&&!map.gaps.includes('Ambiguous controls require manual selection.'))map.gaps.push('Ambiguous controls require manual selection.');
    for(const region of (observation.regions||[]).slice(0,8)) {
      const id=hash([featureId,stableText(region.name)]);if(map.relations.length<500&&!map.relations.some(r=>r.id===id))map.relations.push({id,featureId,region:stableText(region.name),status:'hypothesis',evidence:[]});
    }
  }
  return {stateId,isNew:true};
}
export function recordTransition(map,beforeId,step,afterId) {
  const before=map.states.find(s=>s.id===beforeId),after=map.states.find(s=>s.id===afterId);if(!before||!after)return;
  const key=step.targetKey||'',id=hash([beforeId,step.action,key,afterId]);
  let transition=map.transitions.find(t=>t.id===id);
  if(!transition&&map.transitions.length<600){transition={id,beforeId,afterId,action:step.action,targetKey:key,stepId:step.stepId,count:0};map.transitions.push(transition);}
  if(transition){transition.count++;map.transitions.splice(map.transitions.indexOf(transition),1);map.transitions.push(transition);}
  const item=map.frontier.find(f=>f.stateId===beforeId&&f.targetKey===key);if(item)item.status='exercised';
  if(beforeId!==afterId&&item)for(const name of new Set([...before.regions,...after.regions].map(r=>r.name))){
    if(JSON.stringify(before.regions.filter(r=>r.name===name))===JSON.stringify(after.regions.filter(r=>r.name===name)))continue;
    const relationId=hash([item.featureId,name]);let relation=map.relations.find(r=>r.id===relationId);
    if(!relation&&map.relations.length<500){relation={id:relationId,featureId:item.featureId,region:name,status:'hypothesis',evidence:[]};map.relations.push(relation);}
    if(relation){relation.status='observed';if(relation.evidence.length<5)relation.evidence.push({stepId:step.stepId,beforeId,afterId});}
  }
}
export function nextDiscovery(map,scope,currentStateId,{pageOnly=false,revealedOnly=false}={}) {
  const samePage=value=>{const entry=new URL(scope.entryUrl),url=new URL(value);return entry.origin===url.origin&&entry.pathname===url.pathname;};
  const transition=map.transitions.filter(t=>t.afterId===currentStateId&&t.beforeId!==currentStateId).at(-1),before=map.states.find(s=>s.id===transition?.beforeId);
  const items=map.frontier.filter(item=>item.actionable&&item.status==='unexplored'&&allowedNavigation(scope,item.href||item.url)&&(!pageOnly||samePage(item.url)&&samePage(item.href||item.url))&&(!revealedOnly||before&&item.stateId===currentStateId&&!before.controlKeys.includes(item.targetKey)));
  const roles=new Map(map.states.map(state=>[state.id,state.roleId]));
  const unvisitedNavigation=item=>item.family==='navigation'&&item.href&&!map.states.some(state=>state.url===stateURL(item.href)&&state.roleId===roles.get(item.stateId));
  for(const item of items.sort((a,b)=>Number(b.stateId===currentStateId)-Number(a.stateId===currentStateId)||Number(!!unvisitedNavigation(b))-Number(!!unvisitedNavigation(a)))) {
    const attempts=map.transitions.filter(t=>t.targetKey===item.targetKey).reduce((sum,t)=>sum+t.count,0);
    if(attempts>=(item.family==='pagination'?map.maxVisitsPerPath:2))continue;
    const destination=new URL(item.href||item.url),visited=new Set(map.states.filter(s=>s.pathKey===destination.origin+destination.pathname).map(s=>s.url));
    if(!visited.has(stateURL(destination.href))&&visited.size>=map.maxVisitsPerPath)continue;
    return {item};
  }
  return {reason:'No eligible unexplored control remains within the current discovery limits.'};
}
