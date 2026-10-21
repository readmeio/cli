import { expect, test } from 'vitest';

import { slugForEntry } from '../../src/utils/slug-for-entry.js';

test('plain page slug is the filename minus extension', () => {
  expect(slugForEntry('docs/a/intro.md')).toBe('intro');
  expect(slugForEntry('docs/a/intro.mdx')).toBe('intro');
});

test('index.md carries its parent folder slug', () => {
  expect(slugForEntry('docs/a/setup/index.md')).toBe('setup');
});

test('index.mdx carries its parent folder slug', () => {
  expect(slugForEntry('docs/a/setup/index.mdx')).toBe('setup');
});

test('root-level index falls back to "index"', () => {
  expect(slugForEntry('index.md')).toBe('index');
  expect(slugForEntry('index.mdx')).toBe('index');
});

test('non-index filenames containing dots keep only the md/mdx extension stripped', () => {
  expect(slugForEntry('docs/a/v1.2-migration.md')).toBe('v1.2-migration');
});
