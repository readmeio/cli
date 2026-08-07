import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugForEntry } from '../src/utils/slug-for-entry.js';

test('plain page slug is the filename minus extension', () => {
  assert.equal(slugForEntry('docs/a/intro.md'), 'intro');
  assert.equal(slugForEntry('docs/a/intro.mdx'), 'intro');
});

test('index.md carries its parent folder slug', () => {
  assert.equal(slugForEntry('docs/a/setup/index.md'), 'setup');
});

test('index.mdx carries its parent folder slug', () => {
  assert.equal(slugForEntry('docs/a/setup/index.mdx'), 'setup');
});

test('root-level index falls back to "index"', () => {
  assert.equal(slugForEntry('index.md'), 'index');
  assert.equal(slugForEntry('index.mdx'), 'index');
});

test('non-index filenames containing dots keep only the md/mdx extension stripped', () => {
  assert.equal(slugForEntry('docs/a/v1.2-migration.md'), 'v1.2-migration');
});
