import {createHash} from 'node:crypto';

export function websiteURL(value) {
  let url;try{url=new URL(value);}catch{throw Error('Enter a complete HTTP or HTTPS website URL.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Use an HTTP or HTTPS URL without embedded credentials.');
  return url;
}
const list=value=>Array.isArray(value)?value:typeof value==='string'?value.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean):[];
function cleanPath(value){if(typeof value!=='string'||!value.startsWith('/')||/[?#\\]/.test(value)||/%(?:2f|5c|25)/i.test(value))throw Error('Use website paths starting with /, without encoded separators.');const decoded=decodeURIComponent(value);if(decoded.split('/').some(s=>s==='.'||s==='..'))throw Error('Use a direct website path.');return decoded.replace(/\/$/,'')||'/';}
export function normalizeWebsiteScope(input={}) {
  const entry=websiteURL(input.url||input.entryUrl),roleId=String(input.roleId||'guest').trim();
  if([...entry.searchParams.keys()].some(key=>/token|password|secret|api.?key|session|auth|^code$/i.test(key))||/token|password|secret|access_token/i.test(entry.hash))throw Error('Use a website URL without sign-in tokens or secrets. Sign in manually in the browser.');
  if(!/^[\p{L}\p{N} _-]{1,60}$/u.test(roleId))throw Error('Use a short account label without private details.');
  const navigationOrigins=[...new Set([entry.origin,...list(input.navigationOrigins).map(s=>websiteURL(s).origin)])];
  const resourceOrigins=[...new Set([...navigationOrigins,...list(input.resourceOrigins).map(s=>websiteURL(s).origin)])];
  const scope={entryUrl:entry.href,navigationOrigins,resourceOrigins,includePaths:list(input.includePaths).map(cleanPath),excludePaths:list(input.excludePaths).map(cleanPath),roleId,viewport:input.viewport==='mobile'?'mobile':'desktop'};
  if(!allowedNavigation(scope,entry.href))throw Error('The starting page is outside the selected paths.');
  return scope;
}
export function allowedNavigation(scope,value) {
  try {const url=websiteURL(value),pathname=cleanPath(url.pathname),matches=p=>p==='/'||pathname===p||pathname.startsWith(p+'/');return scope.navigationOrigins.includes(url.origin)&&!scope.excludePaths.some(matches)&&(!scope.includePaths.length||scope.includePaths.some(matches));}catch{return false;}
}
export function allowedResource(scope,value) {
  try{const url=websiteURL(value);return scope.resourceOrigins.includes(url.origin);}catch{return false;}
}
export function redactText(value) {
  return String(value??'').replace(/\bBearer\s+[\w.\-+/=]+/gi,'Bearer [redacted]').replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi,'[redacted email]').replace(/(?:\+?\d[\d ()-]{8,}\d)/g,'[redacted number]').replace(/([?&](?:token|key|api_key|access_token|code|secret|password|session|auth)[^=&#]*=)[^&#\s]*/gi,'$1[redacted]');
}
export function redactObservation(observation) {
  return {...observation,url:redactText(observation.url),title:redactText(observation.title),visibleText:redactText(observation.visibleText),dialogs:redactValue(observation.dialogs),regions:redactValue(observation.regions),unsupported:redactValue(observation.unsupported),controls:(observation.controls||[]).map(c=>({...c,name:redactText(c.name),value:c.sensitive?'[redacted]':redactText(c.value),href:c.href?redactText(c.href):undefined,frameUrl:redactText(c.frameUrl),formAction:c.formAction?redactText(c.formAction):undefined,options:c.sensitive?undefined:redactValue(c.options)}))};
}
export function redactValue(value){if(typeof value==='string')return redactText(value);if(Array.isArray(value))return value.map(redactValue);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redactValue(v)]));return value;}
export function validateWebsiteStep(step) {
  if(!step||!['click','type','press','select','navigate','reload','scroll','assert','screenshot'].includes(step.action))throw Error('This website action is unavailable.');
  if(typeof step.observationId!=='string')throw Error('Use the current page observation.');
  if(JSON.stringify(step).length>12000)throw Error('Website action is too large.');
  if(['click','type','select'].includes(step.action)&&typeof step.target!=='string')throw Error('Choose a visible control.');
  if(step.action==='press'&&!['Tab','Shift+Tab','Enter','Space','Escape','Backspace','ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(step.value))throw Error('Unsupported browser key.');
  if(step.action==='assert') {
    if(typeof step.basis!=='string'||!step.basis.trim())throw Error('Record the expected rule before checking it.');
    if(!['text','textValue','value','visible','checked','disabled','validity','count','url'].includes(step.check))throw Error('Unsupported check.');
    if(['visible','checked','disabled','validity'].includes(step.check)&&typeof step.expected!=='boolean')throw Error('This check requires a Boolean expected result.');
    if(step.check==='count'&&(!Number.isInteger(step.expected)||step.expected<0))throw Error('Count requires a nonnegative integer.');
    if(['text','textValue','value','url'].includes(step.check)&&(typeof step.expected!=='string'||(!step.expected&&!['value','textValue'].includes(step.check))))throw Error('Record a nonempty expected result.');
  }
}
export function stepFingerprint(step,observation,version) {
  return createHash('sha256').update(JSON.stringify({step,observationId:observation.id,url:observation.url,version})).digest('hex');
}
export function authorizeStep(step,observation,policy) {
  try{validateWebsiteStep(step);}catch(error){return {decision:'deny',reason:error.message};}
  if(step.observationId!==observation.id)return {decision:'deny',reason:'The page changed. Observe it again before acting.'};
  if(!allowedNavigation(policy.scope,observation.url))return {decision:'deny',reason:'The current page is outside the selected website scope.'};
  const control=observation.controls.find(c=>c.id===step.target);
  if(['click','type','select'].includes(step.action)&&!control)return {decision:'deny',reason:'That control is no longer available.'};
  if(step.action==='assert'&&['value','textValue','visible','checked','disabled','validity'].includes(step.check)&&!control)return {decision:'deny',reason:'This check needs a current observed control.'};
  if(control?.sensitive&&step.action!=='click')return {decision:'deny',reason:'Use Take over to interact with private fields.'};
  if(step.action==='navigate'&&!allowedNavigation(policy.scope,step.value))return {decision:'deny',reason:'That page is outside the selected website scope.'};
  if(step.action==='assert'&&control?.sensitive)return {decision:'deny',reason:'Private field values are not available to automated checks.'};
  if(['assert','screenshot','scroll'].includes(step.action))return {decision:'allow'};
  const fingerprint=stepFingerprint(step,observation,policy.version);
  if(policy.grants.includes(fingerprint))return {decision:'allow',fingerprint};
  // Even links and text input can change live server data. The host never
  // treats a label, HTTP method or model claim as permission to perform it.
  return {decision:'pending',fingerprint,reason:`Review ${step.action}${control?' on '+control.name:''}. This interaction can change live website data.`};
}
