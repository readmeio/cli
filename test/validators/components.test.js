import { expect, test } from 'vitest';

import { collectFiles } from '../../src/utils/lint.js';
import { validate, validateAll } from '../../src/validators/components.js';
import { makeRepo, rmRepo } from '../helpers.js';

test('unknown component is reported as a warning, not an error', () => {
  const root = makeRepo({
    'docs/page.md': '---\ntitle: Page\n---\n\n<ClosedBeta />\n',
  });
  try {
    const res = validateAll(collectFiles(root), root);
    const unknown = res.find(r => r.message.includes('Unknown component'));
    expect(unknown.severity).toBe('warning');
  } finally {
    rmRepo(root);
  }
});

test('custom_block .md filename with underscores is allowed (valid component tag)', () => {
  // <Helm_v4_error /> is a valid JS identifier, so the filename is fine.
  const res = validate({ content: 'A snippet.\n', relativePath: 'custom_blocks/Helm_v4_error.md' });
  expect(res, 'underscores should not be flagged').toBeNull();
});

test('custom_block .md filename with hyphens is flagged (invalid component tag)', () => {
  const res = validate({ content: 'A snippet.\n', relativePath: 'custom_blocks/helm-v4-error.md' });
  const warn = (res || []).find(r => r.message.includes('Bad filename'));
  expect(warn.severity).toBe('warning');
  expect(warn.message).toMatch(/HelmV4Error\.md/);
});

test('custom_block .md filename with a lowercase initial is flagged', () => {
  const res = validate({ content: 'A snippet.\n', relativePath: 'custom_blocks/myBlock.md' });
  const warn = (res || []).find(r => r.message.includes('Bad filename'));
  expect(warn.message).toMatch(/MyBlock\.md/);
});
