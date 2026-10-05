export function needsIndependentReview(changes) {
  return changes.length>=3 || changes.some(change=>/(^|\/)(?:package\.json$|[^/]*(?:auth|permission|credential|security|access[-_]?control)[^/]*(?:\/|$))/i.test(change.path)) || changes.reduce((total,change)=>total+(change.before?.toString().split('\n').length||0)+(change.after?.toString().split('\n').length||0),0)>=200;
}
export function parseIndependentReview(text) {
  let value;try{value=JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, ''));}catch{throw Error('Independent review did not return a valid decision. Changes remain isolated.');}
  if(typeof value?.approved!=='boolean'||!Array.isArray(value.findings)||value.findings.length>20||value.findings.some(item=>typeof item!=='string'||!item.trim()||item.length>2000)||value.approved&&value.findings.length)throw Error('Independent review returned an inconsistent decision. Changes remain isolated.');
  if(!value.approved && !value.findings.length)throw Error('Independent review refused approval without explaining a finding. Changes remain isolated.');
  return {approved:value.approved,findings:value.findings,kind:'independent source review'};
}
