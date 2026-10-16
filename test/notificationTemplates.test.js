import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_TEMPLATES,
  loadTemplates,
  saveTemplate,
  deleteTemplate,
} from '../src/lib/notificationTemplates.js';

function installLocalStorage() {
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  return values;
}

test('professional built-in templates are always available without local setup', () => {
  installLocalStorage();
  assert.equal(loadTemplates().length, 6);
  assert.deepEqual(loadTemplates().map(({ id }) => id), BUILT_IN_TEMPLATES.map(({ id }) => id));
});

test('saving and deleting custom templates preserves built-ins', () => {
  installLocalStorage();
  const saved = saveTemplate('قالب خاص', 'عنوان مختصر', 'نص الإشعار');
  assert.equal(saved.length, BUILT_IN_TEMPLATES.length + 1);
  assert.equal(loadTemplates().length, BUILT_IN_TEMPLATES.length + 1);
  const custom = saved.find(({ id }) => !id.startsWith('builtin-'));
  assert.equal(deleteTemplate(custom.id).length, BUILT_IN_TEMPLATES.length);
  assert.equal(deleteTemplate(BUILT_IN_TEMPLATES[0].id).length, BUILT_IN_TEMPLATES.length);
});
