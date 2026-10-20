import { expect, it, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, rmRepo } from './helpers.js';

test('makeRepo writes files and rmRepo cleans up', () => {
  const root = makeRepo({ 'docs/a.md': 'hello' });
  expect(fs.readFileSync(path.join(root, 'docs/a.md'), 'utf-8')).toBe('hello');
  rmRepo(root);
  expect(fs.existsSync(root)).toBe(false);
});
