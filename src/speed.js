export function initialEffort(preferences) {
  const stored=typeof preferences.reasoningEffort==='string';
  return {reasoningEffort:stored?preferences.reasoningEffort:'medium',speedPreset:['quick','balanced','thorough'].includes(preferences.speedPreset)?preferences.speedPreset:stored?'custom':'balanced'};
}
export function effortForPreset(model, preset) {
  const choices={quick:['low','minimal','medium','high','xhigh','max'],balanced:['medium','high','low','xhigh','minimal','max'],thorough:['max','xhigh','high','medium','low','minimal']}[preset];
  if(!choices || !Array.isArray(model?.variants) || !model.variants.length)throw new Error('This model has no supported effort for that preset.');
  return choices.find(value=>model.variants.includes(value)) || model.variants[0];
}
