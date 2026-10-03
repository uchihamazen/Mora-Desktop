import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../src/context-menu.js').catch(() => ({}));

const template = (...args) => {
  assert.equal(typeof api.contextMenuTemplate, 'function');
  return api.contextMenuTemplate(...args);
};

test('misspelledWordListsCorrectionsFirstWithAddToDictionary', () => {
  const calls = [];
  const items = template({ misspelledWord: 'confidnetials', dictionarySuggestions: ['confidentials', 'confidential', 'confidents'] }, { replace: word => calls.push(['replace', word]), addToDictionary: word => calls.push(['dictionary', word]) });
  assert.deepEqual(items.map(item => item.label || item.type), ['confidentials', 'confidential', 'confidents', 'Add "confidnetials" to dictionary']);
  items[0].click();
  items[3].click();
  assert.deepEqual(calls, [['replace', 'confidentials'], ['dictionary', 'confidnetials']]);
});

test('correctionListIsCappedAtFive', () => {
  const items = template({ misspelledWord: 'teh', dictionarySuggestions: ['the', 'tea', 'ten', 'tech', 'teal', 'teach', 'team'] }, { addToDictionary: () => {} });
  assert.deepEqual(items.map(item => item.label || item.type).slice(0, 5), ['the', 'tea', 'ten', 'tech', 'teal']);
  assert.equal(items.filter(item => !item.type).length, 6);
});

test('editableFieldOffersStandardEditRoles', () => {
  const items = template({ isEditable: true }, {});
  assert.deepEqual(items.map(item => item.role || item.type), ['cut', 'copy', 'paste', 'separator', 'selectAll']);
});

test('misspelledWordInEditableFieldCombinesCorrectionsAndEditRoles', () => {
  const items = template({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the'] }, {});
  assert.deepEqual(items.map(item => item.label || item.role || item.type), ['the', 'separator', 'cut', 'copy', 'paste', 'separator', 'selectAll']);
});

test('readOnlySelectionOffersCopyOnly', () => {
  const items = template({ isEditable: false, selectionText: 'some answer' }, {});
  assert.deepEqual(items.map(item => item.role || item.type), ['copy']);
});

test('plainClickWithNothingToOfferShowsNoMenu', () => {
  assert.deepEqual(template({ isEditable: false, selectionText: '' }, {}), []);
  assert.deepEqual(template({}, {}), []);
});
