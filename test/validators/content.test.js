import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { validate } from '../../src/validators/content.js';
import { makeRepo, rmRepo } from '../helpers.js';

function validateFile(root, relativePath) {
  const filePath = path.join(root, relativePath);
  return validate({ filePath, content: fs.readFileSync(filePath, 'utf-8'), relativePath });
}

test('empty index.md with a sibling page is not flagged', () => {
  const root = makeRepo({
    'docs/guides/index.md': '---\ntitle: Guides\n---\n',
    'docs/guides/page.md': '---\ntitle: Page\n---\nHello',
  });
  try {
    expect(validateFile(root, 'docs/guides/index.md')).toBeNull();
  } finally {
    rmRepo(root);
  }
});

test('empty index.md with a symlinked sibling page is not flagged', () => {
  const root = makeRepo({
    'docs/guides/index.md': '---\ntitle: Guides\n---\n',
    'shared/page.md': '---\ntitle: Page\n---\nHello',
  });
  try {
    fs.symlinkSync(path.join(root, 'shared/page.md'), path.join(root, 'docs/guides/page.md'));
    expect(validateFile(root, 'docs/guides/index.md')).toBeNull();
  } finally {
    rmRepo(root);
  }
});

test('empty index.md with only a nested page directory is not flagged', () => {
  const root = makeRepo({
    'docs/guides/index.md': '---\ntitle: Guides\n---\n',
    'docs/guides/nested/index.md': '---\ntitle: Nested\n---\nHello',
  });
  try {
    expect(validateFile(root, 'docs/guides/index.md')).toBeNull();
  } finally {
    rmRepo(root);
  }
});

test('empty index.md with no children is flagged', () => {
  const root = makeRepo({
    'docs/guides/index.md': '---\ntitle: Guides\n---\n',
  });
  try {
    expect(validateFile(root, 'docs/guides/index.md')?.message).toBe('Empty page: non-hidden page has no content');
  } finally {
    rmRepo(root);
  }
});
