export function websiteCoverage(report) {
  const map=report.discovery||{},features=map.features||[];
  const sameContext=(feature,context)=>{if(feature.roleId!==context?.roleId)return false;try{const a=new URL(feature.url),b=new URL(context.url);return a.origin===b.origin&&a.pathname===b.pathname;}catch{return feature.url===context?.url;}};
  const checked=(report.cases||[]).filter(c=>(c.executions||[]).some(e=>e.steps?.some(s=>s.action?.action==='assert'&&['passed','failed'].includes(s.result?.status)&&s.status!=='uncertain')));
  const assertions={passed:0,failed:0,blocked:0,uncertain:0};for(const s of report.steps||[])if(s.action?.action==='assert'){const status=s.status==='uncertain'?'uncertain':s.result?.status;if(status in assertions)assertions[status]++;}
  const cases={};for(const c of report.cases||[])cases[c.status||'not tested']=(cases[c.status||'not tested']||0)+1;
  const checkedCount=features.filter(f=>checked.some(c=>(c.featureId===f.key||c.featureId===f.id)&&sameContext(f,c.start))).length;
  return {states:map.states?.length||0,controls:features.length,exercised:features.filter(f=>(map.transitions||[]).some(t=>t.targetKey===f.key&&sameContext(f,map.states?.find(s=>s.id===t.beforeId)))).length,checked:checkedCount,unchecked:Math.max(0,features.length-checkedCount),assertions,cases};
}
