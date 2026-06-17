import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, rmRepo } from './helpers.js';

test('makeRepo writes files and rmRepo cleans up', () => {
  const root = makeRepo({ 'docs/a.md': 'hello' });
  assert.equal(fs.readFileSync(path.join(root, 'docs/a.md'), 'utf-8'), 'hello');
  rmRepo(root);
  assert.equal(fs.existsSync(root), false);
});
