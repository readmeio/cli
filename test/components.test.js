import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFiles } from '../src/utils/lint.js';
import { validateAll } from '../src/validators/components.js';
import { makeRepo, rmRepo } from './helpers.js';

test('unknown component is reported as a warning, not an error', () => {
  const root = makeRepo({
    'docs/page.md': '---\ntitle: Page\n---\n\n<ClosedBeta />\n',
  });
  try {
    const res = validateAll(collectFiles(root), root);
    const unknown = res.find((r) => r.message.includes('Unknown component'));
    assert.ok(unknown, 'expected an unknown-component result');
    assert.equal(unknown.severity, 'warning');
  } finally {
    rmRepo(root);
  }
});
