import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { collectFiles } from '../../src/utils/lint.js';
import { validateAll } from '../../src/validators/oas-reference.js';
import { makeRepo, rmRepo } from '../helpers.js';

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
    expect(!res.some((r) => r.message.includes('Out of sync')), 'no out-of-sync results').toBe(true);
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
    expect(res.some((r) => r.message.includes('Operation not found'))).toBe(true);
  } finally {
    rmRepo(root);
  }
});

test('a page for a spec webhook is not reported as "Operation not found"', () => {
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Payments' },
    webhooks: {
      paymentCompleted: {
        post: { summary: 'Sent when a payment settles' },
      },
    },
  });
  const root = makeRepo({
    'reference/payments.json': spec,
    'reference/Payments/paymentcompleted/post_paymentcompleted.md':
      '---\napi:\n  file: payments.json\n  operationId: post_paymentcompleted\n  webhook: true\nhidden: false\n---\n',
  });
  try {
    const res = validateAll(collectFiles(root), root, {});
    expect(res.some((r) => r.message.includes('Operation not found'))).toBe(false);
  } finally {
    rmRepo(root);
  }
});

test('a path page and a webhook page sharing an operationId are both recognized, neither flagged missing', () => {
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Payments' },
    paths: {
      '/orders': { post: { operationId: 'sharedId' } },
    },
    webhooks: {
      orderCreated: { post: { operationId: 'sharedId' } },
    },
  });
  const root = makeRepo({
    'reference/payments.json': spec,
    'reference/Payments/orders/sharedid.md':
      '---\napi:\n  file: payments.json\n  operationId: sharedId\nhidden: false\n---\n',
    'reference/Payments/ordercreated/sharedid.md':
      '---\napi:\n  file: payments.json\n  operationId: sharedId\n  webhook: true\nhidden: false\n---\n',
  });
  try {
    const res = validateAll(collectFiles(root), root, {});
    expect(res.some((r) => r.message.includes('Operation not found'))).toBe(false);
    expect(res.some((r) => r.message.includes('Missing page'))).toBe(false);
  } finally {
    rmRepo(root);
  }
});

test('x-readme.internal is warned about at the root and on operations, x-internal is not', () => {
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Pets' },
    'x-readme': { internal: true },
    paths: {
      '/pets': {
        get: { operationId: 'listPets', 'x-readme': { internal: true } },
        post: { operationId: 'addPet', 'x-internal': true },
      },
    },
    webhooks: { newPet: { post: { operationId: 'newPet', 'x-readme': { internal: false } } } },
  });
  const root = makeRepo({ 'reference/pets.json': spec });
  try {
    const res = validateAll(collectFiles(root), root, {}).filter((r) =>
      r.message.includes('x-readme.internal'),
    );
    expect(res.map((r) => r.message.match(/\((.+?)\)/)[1])).toStrictEqual([
      'root',
      'GET /pets',
      'webhook POST newPet',
    ]);
    expect(res.every((r) => r.file === 'reference/pets.json' && r.severity === 'warning' && !r.fixable)).toBe(true);
  } finally {
    rmRepo(root);
  }
});

test('lint --fix leaves the reference alone when every finding is unfixable', () => {
  // The only finding is the unfixable `x-readme.internal` warning; the page
  // for the one operation already exists, so nothing is missing either.
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Pets' },
    'x-readme': { internal: true },
    paths: { '/pets': { get: { operationId: 'listPets' } } },
  });
  const page = '---\napi:\n  file: pets.json\n  operationId: listPets\nhidden: false\n---\n';
  const root = makeRepo({ 'reference/pets.json': spec, 'reference/Pets/pets/listpets.md': page });
  try {
    const res = validateAll(collectFiles(root), root, { fix: true });
    expect(res).toHaveLength(1);
    expect(res[0].fixable).toBe(false);
    expect(res[0].message.endsWith('(fixed)')).toBe(false);
    // Had the sync run, it would have backfilled the category page and the
    // _order.yaml files around the existing operation page.
    expect(fs.existsSync(path.join(root, 'reference/Pets/pets/index.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'reference/_order.yaml'))).toBe(false);
  } finally {
    rmRepo(root);
  }

  // Control: the same spec with a fixable finding (a missing page) does sync.
  const fixableRoot = makeRepo({ 'reference/pets.json': spec });
  try {
    const res = validateAll(collectFiles(fixableRoot), fixableRoot, { fix: true });
    const missing = res.find((r) => r.message.includes('Missing page'));
    expect(missing && missing.fixable).toBe(true);
    expect(missing.message.endsWith('(fixed)')).toBe(true);
    expect(fs.existsSync(path.join(fixableRoot, 'reference/Pets/pets/listpets.md'))).toBe(true);
    // The unfixable warning is still reported, but never marked fixed.
    const warning = res.find((r) => r.message.includes('x-readme.internal'));
    expect(warning && !warning.message.endsWith('(fixed)')).toBe(true);
  } finally {
    rmRepo(fixableRoot);
  }
});
