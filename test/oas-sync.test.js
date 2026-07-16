import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { syncOas } from '../src/commands/oas-sync.js';
import { makeRepo, rmRepo } from './helpers.js';

const SPEC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Pets' },
  paths: {
    '/pets': {
      get: { operationId: 'listPets', summary: 'List pets', description: 'Returns pets' },
    },
  },
});

test('generated reference page has only api frontmatter (no title/excerpt)', () => {
  const root = makeRepo({ 'reference/pets.json': SPEC });
  try {
    syncOas(root);
    const page = path.join(root, 'reference/Pets/Other/listPets.md');
    assert.ok(fs.existsSync(page), 'expected generated page');
    const { data } = matter(fs.readFileSync(page, 'utf-8'));
    assert.equal(data.api.file, 'pets.json');
    assert.equal(data.api.operationId, 'listPets');
    assert.equal('title' in data, false);
    assert.equal('excerpt' in data, false);
  } finally {
    rmRepo(root);
  }
});

test('spec-derived names cannot escape the reference directory', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: '../../escaped-title' },
    paths: {
      '/pets': {
        get: { operationId: '../escaped-op', tags: ['../../escaped-tag'] },
      },
    },
  });
  const root = makeRepo({ 'reference/evil.json': spec });
  try {
    syncOas(root);

    const refDir = path.join(root, 'reference');
    assert.equal(fs.existsSync(path.join(root, '..', 'escaped-title')), false);
    assert.equal(fs.existsSync(path.join(root, 'escaped-title')), false);

    // The page is still generated, under sanitized single-segment names.
    const page = path.join(refDir, '..-..-escaped-title', '..-..-escaped-tag', '..-escaped-op.md');
    assert.ok(fs.existsSync(page), 'expected sanitized page inside reference/');
    const { data } = matter(fs.readFileSync(page, 'utf-8'));
    assert.equal(data.api.operationId, '../escaped-op', 'frontmatter keeps the raw operationId');
  } finally {
    rmRepo(root);
  }
});

test('existing reference page title is not overwritten by sync', () => {
  const root = makeRepo({
    'reference/pets.json': SPEC,
    'reference/Pets/Other/listPets.md':
      '---\ntitle: My custom title\napi:\n  file: pets.json\n  operationId: listPets\n---\n',
    'reference/Pets/Other/_order.yaml': '- listPets\n',
    'reference/Pets/_order.yaml': '- Other\n',
  });
  try {
    syncOas(root);
    const { data } = matter(
      fs.readFileSync(path.join(root, 'reference/Pets/Other/listPets.md'), 'utf-8'),
    );
    assert.equal(data.title, 'My custom title');
    assert.equal(data.api.file, 'pets.json');
    assert.equal(data.api.operationId, 'listPets');
  } finally {
    rmRepo(root);
  }
});
