import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { collectFiles } from '../../src/utils/lint.js';
import { validateAll } from '../../src/validators/ordering.js';
import { makeRepo, rmRepo } from '../helpers.js';

test('stale and index entries in _order.yaml are flagged', () => {
  const root = makeRepo({
    'docs/foo.md': '---\ntitle: Foo\n---\n',
    'docs/_order.yaml': '- foo\n- ghost\n- index\n',
  });
  try {
    const res = validateAll(collectFiles(root), root, {});
    expect(res.some((r) => r.message.includes('Stale entry: "ghost"')), 'flags ghost').toBe(true);
    expect(res.some((r) => r.message.includes('Invalid entry: "index"')), 'flags index').toBe(true);
    expect(!res.some((r) => r.message.includes('foo')), 'does not flag valid foo').toBe(true);
  } finally {
    rmRepo(root);
  }
});

test('--fix removes stale and index entries', () => {
  const root = makeRepo({
    'docs/foo.md': '---\ntitle: Foo\n---\n',
    'docs/_order.yaml': '- foo\n- ghost\n- index\n',
  });
  try {
    validateAll(collectFiles(root), root, { fix: true });
    const after = fs.readFileSync(path.join(root, 'docs/_order.yaml'), 'utf-8').trim();
    expect(after).toBe('- foo');
  } finally {
    rmRepo(root);
  }
});

test('--fix removals preserve comments and blank lines', () => {
  const root = makeRepo({
    'docs/foo.md': '---\ntitle: Foo\n---\n',
    'docs/_order.yaml': '# getting started\n- foo\n\n# stale below\n- ghost\n',
  });
  try {
    validateAll(collectFiles(root), root, { fix: true });
    const after = fs.readFileSync(path.join(root, 'docs/_order.yaml'), 'utf-8');
    expect(after).toBe('# getting started\n- foo\n\n# stale below\n');
  } finally {
    rmRepo(root);
  }
});

test('entries with inline comments are matched and preserved', () => {
  const root = makeRepo({
    'docs/overview.md': '---\ntitle: Overview\n---\n',
    'docs/_order.yaml': '- overview # keep this first\n- ghost # stale\n',
  });
  try {
    const res = validateAll(collectFiles(root), root, {});
    expect(
      !res.some((r) => r.message.includes('Stale entry: "overview"')),
      'commented entry is not stale',
    ).toBe(true);
    expect(res.some((r) => r.message.includes('Stale entry: "ghost"')), 'ghost still flagged').toBe(true);

    validateAll(collectFiles(root), root, { fix: true });
    const after = fs.readFileSync(path.join(root, 'docs/_order.yaml'), 'utf-8');
    expect(after).toBe('- overview # keep this first\n');
  } finally {
    rmRepo(root);
  }
});

test('--fix adds missing entries in sorted order', () => {
  const root = makeRepo({
    'docs/b.md': '---\ntitle: B\n---\n',
    'docs/a.md': '---\ntitle: A\n---\n',
    'docs/c.md': '---\ntitle: C\n---\n',
    'docs/_order.yaml': '- c\n',
  });
  try {
    validateAll(collectFiles(root), root, { fix: true });
    const after = fs.readFileSync(path.join(root, 'docs/_order.yaml'), 'utf-8');
    expect(after).toBe('- c\n- a\n- b\n');
  } finally {
    rmRepo(root);
  }
});

test('stale entries are caught in reference too', () => {
  const root = makeRepo({
    'reference/Pets/Other/listPets.md':
      '---\napi:\n  file: pets.json\n  operationId: listPets\n---\n',
    'reference/Pets/Other/_order.yaml': '- listPets\n- deleted-op\n',
  });
  try {
    const res = validateAll(collectFiles(root), root, {});
    expect(res.some((r) => r.message.includes('Stale entry: "deleted-op"'))).toBe(true);
  } finally {
    rmRepo(root);
  }
});

test('--fix adds a file missing from _order.yaml', () => {
  const root = makeRepo({
    'docs/foo.md': '---\ntitle: Foo\n---\n',
    'docs/bar.md': '---\ntitle: Bar\n---\n',
    'docs/_order.yaml': '- foo\n',
  });
  try {
    validateAll(collectFiles(root), root, { fix: true });
    const after = fs.readFileSync(path.join(root, 'docs/_order.yaml'), 'utf-8');
    expect(after).toMatch(/- bar/);
    expect(after).toMatch(/- foo/);
  } finally {
    rmRepo(root);
  }
});

test('a folder entry with no markdown children is not flagged stale', () => {
  const root = makeRepo({
    'docs/cat/sub/.gitkeep': '',
    'docs/cat/_order.yaml': '- sub\n',
  });
  try {
    const res = validateAll(collectFiles(root), root, {});
    expect(
      !res.some((r) => /Stale entry: "sub"/.test(r.message)),
      'a subfolder with no .md children still counts as on-disk',
    ).toBe(true);
  } finally {
    rmRepo(root);
  }
});
