export function contextMenuTemplate(params = {}, actions = {}) {
  const template = [];
  if (params.misspelledWord) {
    for (const word of (params.dictionarySuggestions || []).slice(0, 5)) {
      template.push({ label: word, click: () => actions.replace?.(word) });
    }
    if (actions.addToDictionary) template.push({ label: `Add "${params.misspelledWord}" to dictionary`, click: () => actions.addToDictionary(params.misspelledWord) });
    template.push({ type: 'separator' });
  }
  if (params.isEditable) {
    template.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
  } else if (params.selectionText?.trim()) {
    template.push({ role: 'copy' });
  }
  if (template.at(-1)?.type === 'separator') template.pop();
  return template;
}
