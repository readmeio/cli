import { expect, test } from 'vitest';

import { validateAll } from '../../src/validators/duplicates.js';

test('same slug across docs and reference is allowed', () => {
  const res = validateAll(['docs/intro.md', 'reference/intro.md']);
  expect(res).toBeNull();
});

test('same slug within docs (different subdirs) is flagged', () => {
  const res = validateAll(['docs/a/intro.md', 'docs/b/intro.md']);
  expect(Array.isArray(res) && res.length >= 1).toBe(true);
  expect(res[0].message).toMatch(/Duplicate slug: "intro"/);
  expect(res[0].severity).toBe('error');
});

test('index-backed parent colliding with a leaf page is flagged', () => {
  const res = validateAll(['docs/a/setup/index.md', 'docs/b/setup.md']);
  expect(Array.isArray(res) && res.length >= 1).toBe(true);
  expect(res[0].message).toMatch(/Duplicate slug: "setup"/);
  expect(res[0].severity).toBe('error');
});

test('lone index-backed parent is not flagged', () => {
  const res = validateAll(['docs/a/setup/index.md', 'docs/a/setup/install.md']);
  expect(res).toBeNull();
});

test('index.mdx parent colliding with a leaf page is flagged', () => {
  const res = validateAll(['docs/a/setup/index.mdx', 'docs/b/setup.md']);
  expect(Array.isArray(res) && res.length >= 1).toBe(true);
  expect(res[0].message).toMatch(/Duplicate slug: "setup"/);
});
