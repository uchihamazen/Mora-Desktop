import {createHash,randomUUID} from 'node:crypto';
import {redactText,redactValue} from './website-policy.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
const definition=record=>{const s=record.planned||record.action;return [s.check,s.targetKey||s.target||'',s.value||'',s.expected,s.basis];};
export function classifyWebsiteCase(record,replay) {
  if(!record.grounding?.supported)return {status:'needs clarification',reason:'The expected business rule is not supported by supplied evidence.'};
  const execution=record.executions[0],steps=execution?.steps||[];
  if(steps.some(s=>['blocked','pending','uncertain'].includes(s.result?.status)||s.status==='uncertain'))return {status:'blocked',reason:'Automation, permission or interruption prevented a verified outcome.'};
  const failures=steps.filter(s=>s.action.action==='assert'&&s.result?.status==='failed');
  if(failures.length){
    const sameStart=replay?.startStateId===execution.startStateId&&execution.startStateId===record.start.stateId;
    const repeated=sameStart&&!replay.steps.some(s=>['blocked','uncertain'].includes(s.result?.status))&&failures.every(f=>replay.steps.some(s=>s.result?.status==='failed'&&JSON.stringify(definition(s))===JSON.stringify(definition(f))));
    return {status:repeated?'reproduced finding':'observed failure',reason:repeated?'The original expectation failed again from the same observed starting state.':'The outcome failed once; exact reproduction has not been established.'};
  }
  const expected=record.steps.filter(s=>s.action==='assert').length,checked=steps.filter(s=>s.action.action==='assert'&&s.result?.status==='passed').length;
  return expected>0&&checked===expected?{status:'passed',reason:'Every planned outcome assertion passed.'}:{status:'not tested',reason:'Not every planned assertion was executed.'};
}
export function recordWebsiteFinding(report,record,replay) {
  const classification=classifyWebsiteCase(record,replay);record.status=classification.status;record.reason=classification.reason;
  if(!['observed failure','reproduced finding'].includes(classification.status))return;
  const failed=record.executions[0].steps.find(s=>s.action.action==='assert'&&s.result?.status==='failed'),assertion=failed.planned||failed.action;
  const fingerprint=hash([record.start.url,record.start.roleId,definition(failed)]),existing=report.findings.find(f=>f.fingerprint===fingerprint);
  const finding={id:existing?.id||randomUUID(),fingerprint,kind:'functional',title:record.title,status:classification.status,confidence:classification.status==='reproduced finding'?'reproduced':'observed',severity:'unrated',impact:'Review the effect on the affected workflow.',url:record.start.url,roleId:record.start.roleId,at:new Date().toISOString(),caseId:record.id,stepId:failed.id,expected:redactValue(assertion.expected),actual:failed.result.actual,basis:redactText(assertion.basis),replay:replay?{status:classification.status,startStateId:replay.startStateId,stepIds:replay.steps.map(s=>s.id)}:null,occurrences:(existing?.occurrences||0)+1};
  if(existing){if(existing.confidence==='reproduced'&&finding.confidence!=='reproduced'){existing.occurrences++;return existing;}Object.assign(existing,finding);}else report.findings.push(finding);return finding;
}
export function summarizeAccessibility(scan) {
  const simplify=items=>(items||[]).slice(0,100).map(rule=>({id:rule.id,impact:rule.impact||'unrated',help:redactText(rule.help),helpUrl:rule.helpUrl,nodes:(rule.nodes||[]).slice(0,30).map(node=>({target:redactValue(node.target),summary:redactText(node.summary||node.failureSummary||'Manual review required.')}))}));
  return {violations:simplify(scan.violations),incomplete:simplify(scan.incomplete),passedRules:scan.passedRules??(scan.passes||[]).length};
}
export function recordAccessibility(report,scan,context) {
  report.accessibility||=[];
  const entry={id:randomUUID(),at:new Date().toISOString(),...context,...summarizeAccessibility(scan)};report.accessibility.push(entry);
  for(const rule of entry.violations)for(const node of rule.nodes){const fingerprint=hash(['axe',context.url,context.roleId,rule.id,node.target]),existing=report.findings.find(f=>f.fingerprint===fingerprint);if(existing){existing.occurrences++;continue;}report.findings.push({id:randomUUID(),fingerprint,kind:'accessibility',title:rule.help,status:'automated accessibility finding',confidence:'automated rule',severity:rule.impact,url:context.url,roleId:context.roleId,ruleId:rule.id,target:node.target,impact:node.summary,helpUrl:rule.helpUrl,scanId:entry.id,occurrences:1});}
  return entry;
}
