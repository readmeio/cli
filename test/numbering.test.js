import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectFiles } from '../src/utils/lint.js';
import { validateAll } from '../src/validators/numbering.js';
import { makeRepo, rmRepo } from './helpers.js';

test('renames single-digit -N file and writes bidirectional redirects', async () => {
  const root = makeRepo({
    'docs/foo-1.md': '---\ntitle: Foo\n---\n',
    'docs/_order.yaml': '- foo-1\n',
  });
  const redirectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdme-redir-'));
  try {
    await validateAll(collectFiles(root), root, { fix: true, nonInteractive: true, redirectDir });

    assert.ok(fs.existsSync(path.join(root, 'docs/foo.md')), 'renamed to foo.md');
    assert.ok(!fs.existsSync(path.join(root, 'docs/foo-1.md')), 'old file gone');
    assert.equal(fs.readFileSync(path.join(root, 'docs/_order.yaml'), 'utf-8').trim(), '- foo');

    const redirect = fs.readFileSync(
      path.join(redirectDir, `${path.basename(root)}_redirect.txt`),
      'utf-8',
    );
    assert.match(redirect, /\/docs\/foo-1 -> \/docs\/foo/);
    assert.match(redirect, /\/reference\/foo-1 -> \/reference\/foo/);
  } finally {
    rmRepo(root);
    rmRepo(redirectDir);
  }
});

test('multi-digit suffix is not treated as unnecessary', async () => {
  const root = makeRepo({ 'docs/bar-12.md': '---\ntitle: Bar\n---\n' });
  try {
    const res = await validateAll(collectFiles(root), root, {});
    assert.equal(res, null);
  } finally {
    rmRepo(root);
  }
});
