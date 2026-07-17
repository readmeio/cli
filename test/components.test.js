import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFiles } from '../src/utils/lint.js';
import { validate, validateAll } from '../src/validators/components.js';
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

test('custom_block .md filename with underscores is allowed (valid component tag)', () => {
  // <Helm_v4_error /> is a valid JS identifier, so the filename is fine.
  const res = validate({ content: 'A snippet.\n', relativePath: 'custom_blocks/Helm_v4_error.md' });
  assert.equal(res, null, 'underscores should not be flagged');
});

test('custom_block .md filename with hyphens is flagged (invalid component tag)', () => {
  const res = validate({ content: 'A snippet.\n', relativePath: 'custom_blocks/helm-v4-error.md' });
  const warn = (res || []).find((r) => r.message.includes('Bad filename'));
  assert.ok(warn, 'expected a Bad filename warning for a hyphenated name');
  assert.equal(warn.severity, 'warning');
  assert.match(warn.message, /HelmV4Error\.md/);
});

test('custom_block .md filename with a lowercase initial is flagged', () => {
  const res = validate({ content: 'A snippet.\n', relativePath: 'custom_blocks/myBlock.md' });
  const warn = (res || []).find((r) => r.message.includes('Bad filename'));
  assert.ok(warn, 'expected a Bad filename warning for a lowercase initial');
  assert.match(warn.message, /MyBlock\.md/);
});
