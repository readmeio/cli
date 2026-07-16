import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFiles } from '../src/utils/lint.js';
import { validateAll } from '../src/validators/oas-reference.js';
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

test('mismatched title/excerpt no longer reported as out of sync', () => {
  const root = makeRepo({
    'reference/pets.json': SPEC,
    'reference/Pets/Other/listPets.md':
      '---\ntitle: Totally different\nexcerpt: nope\napi:\n  file: pets.json\n  operationId: listPets\n---\n',
  });
  try {
    const res = validateAll(collectFiles(root), root, {});
    assert.ok(!res.some((r) => r.message.includes('Out of sync')), 'no out-of-sync results');
  } finally {
    rmRepo(root);
  }
});

test('operation not found is still reported', () => {
  const root = makeRepo({
    'reference/pets.json': SPEC,
    'reference/Pets/Other/ghost.md':
      '---\napi:\n  file: pets.json\n  operationId: ghostOp\n---\n',
  });
  try {
    const res = validateAll(collectFiles(root), root, {});
    assert.ok(res.some((r) => r.message.includes('Operation not found')));
  } finally {
    rmRepo(root);
  }
});
