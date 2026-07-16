import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAll } from '../src/validators/duplicates.js';

test('same slug across docs and reference is allowed', () => {
  const res = validateAll(['docs/intro.md', 'reference/intro.md']);
  assert.equal(res, null);
});

test('same slug within docs (different subdirs) is flagged', () => {
  const res = validateAll(['docs/a/intro.md', 'docs/b/intro.md']);
  assert.ok(Array.isArray(res) && res.length >= 1);
  assert.match(res[0].message, /Duplicate slug: "intro"/);
  assert.equal(res[0].severity, 'error');
});
