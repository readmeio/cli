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

test('a page slug colliding with a category folder (folder/index.md) is flagged', () => {
  const res = validateAll([
    'reference/API/Other/guides.md',
    'reference/API/Other/guides/index.md',
  ]);
  assert.ok(Array.isArray(res) && res.length >= 1, 'expected a duplicate-slug error');
  assert.match(res[0].message, /Duplicate slug: "guides"/);
});

test('category-folder slug collisions are section-wide, not per-folder', () => {
  // A page in one subdir and a category folder in another, same section.
  const res = validateAll([
    'reference/A/guides.md',
    'reference/B/guides/index.md',
  ]);
  assert.ok(Array.isArray(res) && res.length >= 1);
  assert.match(res[0].message, /Duplicate slug: "guides"/);
});

test('a section-root index page is not treated as a competing slug', () => {
  // reference/index.md is the section landing; it must not collide with anything.
  const res = validateAll(['reference/index.md', 'reference/foo.md']);
  assert.equal(res, null);
});

test('a category folder slug in reference does not collide with the same slug in docs', () => {
  const res = validateAll([
    'docs/guides.md',
    'reference/API/Other/guides/index.md',
  ]);
  assert.equal(res, null, 'docs and reference are separate namespaces');
});
