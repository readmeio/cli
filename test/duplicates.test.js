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

test('index-backed parent colliding with a leaf page is flagged', () => {
  const res = validateAll(['docs/a/setup/index.md', 'docs/b/setup.md']);
  assert.ok(Array.isArray(res) && res.length >= 1);
  assert.match(res[0].message, /Duplicate slug: "setup"/);
  assert.equal(res[0].severity, 'error');
});

test('lone index-backed parent is not flagged', () => {
  const res = validateAll(['docs/a/setup/index.md', 'docs/a/setup/install.md']);
  assert.equal(res, null);
});

test('index.mdx parent colliding with a leaf page is flagged', () => {
  const res = validateAll(['docs/a/setup/index.mdx', 'docs/b/setup.md']);
  assert.ok(Array.isArray(res) && res.length >= 1);
  assert.match(res[0].message, /Duplicate slug: "setup"/);
});
