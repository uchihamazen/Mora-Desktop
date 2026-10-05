export function deliveryEstimate(zone) {
  return zone === 'Cairo' ? {fee:35,days:2} : {fee:65,days:5};
}
