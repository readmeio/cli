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
    // Slugs are lowercased to match the platform's OAS-upload output.
    const page = path.join(root, 'reference/Pets/Other/listpets.md');
    assert.ok(fs.existsSync(page), 'expected generated page');
    const { data } = matter(fs.readFileSync(page, 'utf-8'));
    assert.equal(data.api.file, 'pets.json');
    assert.equal(data.api.operationId, 'listPets');
    assert.equal(data.hidden, false);
    assert.equal('title' in data, false);
    assert.equal('excerpt' in data, false);
  } finally {
    rmRepo(root);
  }
});

test('sync generates a tag index.md with the tag description from the spec', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Sample API' },
    tags: [{ name: 'users', description: 'User management operations' }],
    paths: {
      '/users': { get: { operationId: 'listUsers', tags: ['users'] } },
    },
  });
  const root = makeRepo({ 'reference/sample.json': spec });
  try {
    syncOas(root);
    const indexPath = path.join(root, 'reference/Sample API/users/index.md');
    assert.ok(fs.existsSync(indexPath), 'expected tag index.md');
    const { data } = matter(fs.readFileSync(indexPath, 'utf-8'));
    assert.equal(data.title, 'users');
    assert.equal(data.excerpt, 'User management operations');
    assert.equal(data.hidden, false);

    // index must not be listed in the tag's _order.yaml.
    const order = fs.readFileSync(path.join(root, 'reference/Sample API/users/_order.yaml'), 'utf-8');
    assert.equal(order.includes('index'), false);
    assert.match(order, /- listusers/);
  } finally {
    rmRepo(root);
  }
});

test('sync maintains the root reference/_order.yaml', () => {
  const root = makeRepo({ 'reference/pets.json': SPEC });
  try {
    syncOas(root);
    const rootOrder = path.join(root, 'reference/_order.yaml');
    assert.ok(fs.existsSync(rootOrder), 'expected root _order.yaml');
    assert.match(fs.readFileSync(rootOrder, 'utf-8'), /- Pets/);
  } finally {
    rmRepo(root);
  }
});

test('sync does not overwrite an existing tag index.md', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    tags: [{ name: 'Other', description: 'From the spec' }],
    paths: {
      '/pets': { get: { operationId: 'listPets', tags: ['Other'] } },
    },
  });
  const root = makeRepo({
    'reference/pets.json': spec,
    'reference/Pets/Other/index.md': '---\ntitle: Hand-written category\n---\n\nCustom intro.\n',
  });
  try {
    syncOas(root);
    const content = fs.readFileSync(path.join(root, 'reference/Pets/Other/index.md'), 'utf-8');
    assert.match(content, /Hand-written category/);
    assert.match(content, /Custom intro/);
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

test('operations whose sanitized names collide do not overwrite each other', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    paths: {
      '/a': { get: { operationId: 'foo/bar', tags: ['Other'] } },
      '/b': { get: { operationId: 'foo\\bar', tags: ['Other'] } },
    },
  });
  const root = makeRepo({ 'reference/pets.json': spec });
  try {
    const [first] = syncOas(root);
    // added = the op page plus the tag's generated index.md.
    const addedPages = first.changes.added.filter((p) => !p.endsWith('index.md'));
    assert.equal(addedPages.length, 1);
    assert.equal(first.changes.skipped.length, 1);

    const page = path.join(root, 'reference/Pets/Other/foo-bar.md');
    const opIdOnDisk = matter(fs.readFileSync(page, 'utf-8')).data.api.operationId;

    // Re-running must not flip the page to the other colliding operation.
    const [second] = syncOas(root);
    assert.equal(second.changes.added.length, 0);
    assert.equal(second.changes.skipped.length, 1);
    assert.equal(matter(fs.readFileSync(page, 'utf-8')).data.api.operationId, opIdOnDisk);
  } finally {
    rmRepo(root);
  }
});

test('sync does not overwrite an existing page from another spec or author', () => {
  const root = makeRepo({
    'reference/pets.json': SPEC,
    // The sync targets the lowercased slug.
    'reference/Pets/Other/listpets.md': '---\ntitle: Hand-written page\n---\n\nCustom content.\n',
  });
  try {
    const [result] = syncOas(root);
    assert.equal(result.changes.added.length, 0);
    assert.equal(result.changes.skipped.length, 1);
    const content = fs.readFileSync(path.join(root, 'reference/Pets/Other/listpets.md'), 'utf-8');
    assert.match(content, /Hand-written page/);
    assert.match(content, /Custom content/);
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
