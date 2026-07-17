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
    // Mirrors upload: new pages are always stamped hidden: false.
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

test('sync backfills a missing tag index.md even when all op pages already exist', () => {
  // Simulates a reference synced by an older CLI: op pages exist, no index.md.
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'API' },
    tags: [{ name: 'widgets', description: 'Widget operations' }],
    paths: {
      '/1': { get: { operationId: 'listWidgets', tags: ['widgets'] } },
      '/2': { get: { operationId: 'getWidget', tags: ['widgets'] } },
    },
  });
  const root = makeRepo({
    'reference/api.json': spec,
    'reference/API/widgets/listwidgets.md':
      '---\napi:\n  file: api.json\n  operationId: listWidgets\n---\n',
    'reference/API/widgets/getwidget.md':
      '---\napi:\n  file: api.json\n  operationId: getWidget\n---\n',
  });
  try {
    const indexPath = path.join(root, 'reference/API/widgets/index.md');
    assert.equal(fs.existsSync(indexPath), false, 'precondition: no index.md yet');

    syncOas(root);

    assert.ok(fs.existsSync(indexPath), 'expected the category index.md to be backfilled');
    const { data } = matter(fs.readFileSync(indexPath, 'utf-8'));
    assert.equal(data.title, 'widgets');
    assert.equal(data.excerpt, 'Widget operations');

    // A second run is a no-op (index now present).
    const [second] = syncOas(root);
    assert.equal(second.changes.added.length, 0);
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

test('an operation named "index" does not clobber the tag index.md', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    tags: [{ name: 'pets', description: 'Pet ops' }],
    paths: {
      // Two operations that both normalize to the reserved slug "index".
      '/a': { get: { operationId: 'index', tags: ['pets'] } },
      '/b': { get: { operationId: 'INDEX', tags: ['pets'] } },
    },
  });
  const root = makeRepo({ 'reference/pets.json': spec });
  try {
    syncOas(root);
    const dir = path.join(root, 'reference/Pets/pets');

    // index.md is the category page, never an operation.
    const indexData = matter(fs.readFileSync(path.join(dir, 'index.md'), 'utf-8')).data;
    assert.equal(indexData.title, 'pets');
    assert.equal('api' in indexData, false);

    // Each colliding operation gets a distinct numeric slug.
    assert.ok(fs.existsSync(path.join(dir, 'index-1.md')), 'expected index-1.md');
    assert.ok(fs.existsSync(path.join(dir, 'index-2.md')), 'expected index-2.md');
    const opIds = ['index-1', 'index-2'].map(
      (s) => matter(fs.readFileSync(path.join(dir, `${s}.md`), 'utf-8')).data.api.operationId,
    );
    assert.deepEqual([...opIds].sort(), ['INDEX', 'index']);

    // _order.yaml lists the operation slugs but not the reserved index page.
    const order = fs.readFileSync(path.join(dir, '_order.yaml'), 'utf-8');
    assert.match(order, /- index-1/);
    assert.match(order, /- index-2/);
    assert.equal(/^- index$/m.test(order), false);
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

test('operations whose sanitized names collide get distinct suffixed slugs', () => {
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
    // Both operations get their own page; the second collides and is suffixed.
    const opPages = first.changes.added.filter((p) => !p.endsWith('index.md'));
    assert.equal(opPages.length, 2);
    assert.equal(first.changes.skipped.length, 0);

    const base = path.join(root, 'reference/Pets/Other/foo-bar.md');
    const suffixed = path.join(root, 'reference/Pets/Other/foo-bar-1.md');
    assert.ok(fs.existsSync(base) && fs.existsSync(suffixed), 'expected foo-bar.md and foo-bar-1.md');
    const ops = [base, suffixed].map((p) => matter(fs.readFileSync(p, 'utf-8')).data.api.operationId);
    assert.deepEqual([...ops].sort(), ['foo/bar', 'foo\\bar']);

    // Re-running is stable: both pages already exist (matched by operationId).
    const [second] = syncOas(root);
    assert.equal(second.changes.added.length, 0);
    assert.equal(second.changes.skipped.length, 0);
  } finally {
    rmRepo(root);
  }
});

test('sync gives an operation a unique slug rather than overwriting a hand-written page', () => {
  const root = makeRepo({
    'reference/pets.json': SPEC,
    // A hand-written page (no api frontmatter) already occupies the slug.
    'reference/Pets/Other/listpets.md': '---\ntitle: Hand-written page\n---\n\nCustom content.\n',
  });
  try {
    syncOas(root);
    // The hand-written page is untouched...
    const hand = fs.readFileSync(path.join(root, 'reference/Pets/Other/listpets.md'), 'utf-8');
    assert.match(hand, /Hand-written page/);
    assert.match(hand, /Custom content/);
    // ...and the operation gets its own suffixed page.
    const opPage = path.join(root, 'reference/Pets/Other/listpets-1.md');
    assert.ok(fs.existsSync(opPage), 'expected listpets-1.md for the operation');
    assert.equal(matter(fs.readFileSync(opPage, 'utf-8')).data.api.operationId, 'listPets');
  } finally {
    rmRepo(root);
  }
});

test('reference slugs are unique across tags (flat namespace), not per-folder', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    paths: {
      '/a': { get: { operationId: 'thing', tags: ['alpha'] } },
      '/b': { get: { operationId: 'Thing', tags: ['beta'] } },
    },
  });
  const root = makeRepo({ 'reference/pets.json': spec });
  try {
    syncOas(root);
    // Same base slug in two different tags: the second is suffixed even though
    // it's in a different folder, because reference slugs share one namespace.
    assert.ok(fs.existsSync(path.join(root, 'reference/Pets/alpha/thing.md')));
    assert.ok(fs.existsSync(path.join(root, 'reference/Pets/beta/thing-1.md')));
    assert.equal(fs.existsSync(path.join(root, 'reference/Pets/beta/thing.md')), false);
  } finally {
    rmRepo(root);
  }
});

test('a slug taken by a category folder (folder/index.md) is not reused by an operation', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    paths: {
      '/a': { get: { operationId: 'guides', tags: ['Other'] } },
    },
  });
  const root = makeRepo({
    'reference/pets.json': spec,
    // A category folder whose slug is its folder name: "guides".
    'reference/Pets/Other/guides/index.md': '---\ntitle: Guides\n---\n\nA sub-category.\n',
  });
  try {
    syncOas(root);
    // The operation slug "guides" is taken by the folder, so it is suffixed.
    assert.ok(fs.existsSync(path.join(root, 'reference/Pets/Other/guides-1.md')));
    assert.equal(fs.existsSync(path.join(root, 'reference/Pets/Other/guides.md')), false);
    // The category folder's index.md is untouched.
    assert.match(
      fs.readFileSync(path.join(root, 'reference/Pets/Other/guides/index.md'), 'utf-8'),
      /A sub-category/,
    );
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
