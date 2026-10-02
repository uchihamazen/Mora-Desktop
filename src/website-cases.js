import {createHash,randomUUID} from 'node:crypto';
import {controlKey,stateFingerprint} from './website-discovery.js';
import {allowedNavigation,redactText,redactValue,validateWebsiteStep} from './website-policy.js';

export const caseFamilies=['normal','input','boundary','transition','combination','persistence','role','timing'];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
const htmlNumber=value=>typeof value==='string'&&/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)&&Number.isFinite(Number(value))?Number(value):null;
function findControls(target,observation){return observation.controls.filter(c=>c.id===target||(c.key||controlKey(c))===target||c.name===target);}
export function resolveWebsiteStep(planned,observation) {
  if(planned.guard&&!observation.visibleText.includes(planned.guard))throw Error('The step precondition is no longer visible.');
  const step={...planned,observationId:observation.id};delete step.guard;delete step.delayMs;
  if(planned.target){const controls=findControls(planned.target,observation);if(controls.length!==1)throw Error(controls.length?'The control is ambiguous.':'The planned control is unavailable.');step.target=controls[0].id;step.targetKey=controls[0].key||controlKey(controls[0]);}
  return step;
}
export function validateWebsiteCase(candidate,{observation,scope,request,stateId=stateFingerprint(observation),constraintRule}={}) {
  const id=randomUUID(),title=redactText(candidate?.title||'Untitled case').slice(0,180);
  try {
    if(!candidate||!Array.isArray(candidate.steps)||candidate.steps.length<1||candidate.steps.length>8||JSON.stringify(candidate).length>20000)throw Error('A case needs one to eight bounded steps.');
    if(!caseFamilies.includes(candidate.family))throw Error('Choose a supported test family.');
    const quote=String(candidate.basisQuote||'').trim(),source=candidate.basisSource;
    const supported=constraintRule||quote.length>=8&&((source==='user'&&request.includes(quote))||(source==='page'&&observation.visibleText.includes(quote)));
    if(!supported)throw Error('The expected rule needs an exact user requirement or visible website instruction.');
    const convert=step=>{
      const item={action:step.action,target:String(step.target||''),value:step.value??'',check:step.check||'text',expected:step.expected??'',basis:quote,guard:String(step.guard||''),delayMs:step.delayMs??0};
      if(!Number.isInteger(item.delayMs)||item.delayMs<0||item.delayMs>300)throw Error('Step delays must be 0–300 ms.');
      if(item.action==='type'||item.action==='select')if(typeof item.value!=='string'||item.value.length>2000||redactText(item.value)!==item.value)throw Error('Use bounded non-private test input.');
      if(item.action==='navigate'&&!allowedNavigation(scope,item.value))throw Error('The case leaves the permitted website scope.');
      if(item.target){const matches=findControls(item.target,observation);if(matches.length>1)throw Error('A planned control is ambiguous.');if(matches[0]?.sensitive)throw Error('Private fields require manual interaction.');if(matches[0])item.target=matches[0].key||controlKey(matches[0]);else if(/^e\d+$/.test(item.target))throw Error('The planned control reference was not observed.');}
      validateWebsiteStep({...item,observationId:observation.id});
      return item;
    };
    const steps=candidate.steps.map(convert),reset=(candidate.reset||[]).map(convert);
    if(reset.length>4||reset.some(s=>s.action==='assert'))throw Error('Reset needs at most four explicit setup actions.');
    if(!steps.some(s=>s.action==='assert'))throw Error('A case needs an outcome assertion; interactions alone are not a passing test.');
    const firstControl=findControls(candidate.feature||'',observation)[0],featureId=firstControl?(firstControl.key||controlKey(firstControl)):String(candidate.feature||'page').slice(0,180);
    const grounding={supported:true,kind:constraintRule?'constraint':source,quote:redactText(quote),...(constraintRule?{rule:constraintRule}:{})};
    const result={id,title,featureId,family:candidate.family,start:{stateId,url:observation.url,roleId:observation.roleId},precondition:String(candidate.precondition||'').slice(0,500),steps,reset,grounding,status:'queued',executions:[]};
    result.fingerprint=digest([result.start.url,result.start.roleId,featureId,steps,grounding]);return result;
  }catch(error){return {id,title,family:candidate?.family||'normal',status:'needs clarification',reason:error.message,executions:[],fingerprint:digest([title,error.message])};}
}
export function addWebsiteCases(report,candidates,context) {
  report.cases||=[];let added=0;
  for(const candidate of candidates.slice(0,8)){if(report.cases.length>=80)break;const record=validateWebsiteCase(candidate,context);if(!report.cases.some(c=>c.fingerprint===record.fingerprint)){report.cases.push(record);added++;}}
  return added;
}
export function nextWebsiteCase(cases,{normalOnly=false}={}) {
  const attempts=feature=>cases.filter(c=>c.featureId===feature&&c.status!=='queued').length;
  return cases.filter(c=>c.status==='queued'&&(!normalOnly||c.family==='normal')).sort((a,b)=>Number(a.family!=='normal')-Number(b.family!=='normal')||attempts(a.featureId)-attempts(b.featureId))[0];
}
export function constraintCases(context) {
  const cases=[];
  for(const control of context.observation.controls.filter(c=>!c.sensitive&&!c.disabled&&!c.inert&&c.tag==='input'&&c.constraints?.willValidate!==false).slice(0,8)) {
    const rules=control.constraints||{},values=[];
    if(rules.required)values.push({value:'',valid:false,family:'input'});
    if(control.type==='number'&&(rules.min!==''&&rules.min!=null||rules.max!==''&&rules.max!=null)) {
      const min=htmlNumber(rules.min),max=htmlNumber(rules.max),parsedStep=htmlNumber(rules.step),step=rules.step==='any'?null:parsedStep>0?parsedStep:1,base=min??htmlNumber(rules.valueAttribute)??0;
      for(const value of [...(min!==null?[min-(step||1),min]:[]),...(max!==null?[max,max+(step||1)]:[])])if(Number.isFinite(value)&&Math.abs(value)<1e9){const valid=(min===null||value>=min)&&(max===null||value<=max)&&(step===null||Math.abs((value-base)/step-Math.round((value-base)/step))<1e-8);values.push({value:String(value),valid,family:'boundary'});}
    }
    for(const item of values){const quote=`${control.name}: exposed HTML input constraints ${JSON.stringify(rules)}`;cases.push(validateWebsiteCase({title:`${control.name}: ${item.value===''?'empty':item.value}`,feature:control.id,family:item.family,basisSource:'constraint',basisQuote:quote,precondition:'',steps:[{action:'type',target:control.id,value:item.value},{action:'assert',target:control.id,check:'validity',expected:item.valid}],reset:[]},{...context,constraintRule:{controlKey:control.key||controlKey(control),constraints:rules}}));}
  }
  return cases;
}
