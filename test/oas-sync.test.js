import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { extractOperations, hasUnresolvedOperationRefs, syncOas } from '../src/commands/oas-sync.js';
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
    // Untagged operations group by path ("/pets" -> "pets"), not a shared
    // "Other" folder. Slugs are lowercased to match the platform's OAS-upload output.
    const page = path.join(root, 'reference/Pets/pets/listpets.md');
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
    // "Other" is lowercased to "other" for a tag-derived folder — matches
    // where the operation's own generated page (tag: 'Other') actually goes.
    'reference/Pets/other/index.md': '---\ntitle: Hand-written category\n---\n\nCustom intro.\n',
  });
  try {
    syncOas(root);
    const content = fs.readFileSync(path.join(root, 'reference/Pets/other/index.md'), 'utf-8');
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

    // Tag "Other" is lowercased to the folder "other".
    const base = path.join(root, 'reference/Pets/other/foo-bar.md');
    const suffixed = path.join(root, 'reference/Pets/other/foo-bar-1.md');
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
    // A hand-written page (no api frontmatter) already occupies the slug,
    // parked in an unrelated folder — slugs are reserved reference-wide.
    'reference/Pets/Other/listpets.md': '---\ntitle: Hand-written page\n---\n\nCustom content.\n',
  });
  try {
    syncOas(root);
    // The hand-written page is untouched...
    const hand = fs.readFileSync(path.join(root, 'reference/Pets/Other/listpets.md'), 'utf-8');
    assert.match(hand, /Hand-written page/);
    assert.match(hand, /Custom content/);
    // ...and the operation gets its own suffixed page, under its path-derived
    // group folder ("/pets" -> "pets"), since "listpets" is already taken.
    const opPage = path.join(root, 'reference/Pets/pets/listpets-1.md');
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
    // A category folder whose slug is its folder name: "guides". Tag "Other"
    // is lowercased to "other", matching where the operation's own page goes.
    'reference/Pets/other/guides/index.md': '---\ntitle: Guides\n---\n\nA sub-category.\n',
  });
  try {
    syncOas(root);
    // The operation slug "guides" is taken by the folder, so it is suffixed.
    assert.ok(fs.existsSync(path.join(root, 'reference/Pets/other/guides-1.md')));
    assert.equal(fs.existsSync(path.join(root, 'reference/Pets/other/guides.md')), false);
    // The category folder's index.md is untouched.
    assert.match(
      fs.readFileSync(path.join(root, 'reference/Pets/other/guides/index.md'), 'utf-8'),
      /A sub-category/,
    );
  } finally {
    rmRepo(root);
  }
});

const PATH_ITEMS_SPEC = {
  openapi: '3.1.0',
  info: { title: 'Pets', version: '1.0.0' },
  paths: {
    '/pets': { $ref: '#/components/pathItems/Pets' },
  },
  components: {
    pathItems: {
      Pets: {
        get: { operationId: 'listPets', summary: 'List pets', tags: ['pets'] },
        post: { operationId: 'createPet', summary: 'Create a pet', tags: ['pets'] },
      },
    },
  },
};

test('extractOperations resolves OAS 3.1 components.pathItems $refs', () => {
  const ops = extractOperations(PATH_ITEMS_SPEC);
  assert.deepEqual([...ops.keys()].sort(), ['path:createPet', 'path:listPets']);
  assert.equal(ops.get('path:listPets').tag, 'pets');
  assert.equal(hasUnresolvedOperationRefs(PATH_ITEMS_SPEC), false);
});

test('extractOperations resolves a path $ref to another path item', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Pets' },
    paths: {
      '/pets': {
        get: { operationId: 'listPets', summary: 'List pets' },
      },
      '/animals': { $ref: '#/paths/~1pets' },
    },
  };
  const ops = extractOperations(spec);
  // Same operationId is reused (Map last-write); the point is the $ref is visible.
  assert.equal(ops.has('path:listPets'), true);
  assert.equal(ops.size, 1);
});

test('extractOperations uses the resolved operationId on an operation $ref', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Pets' },
    paths: {
      '/pets': {
        get: { $ref: '#/components/x-operations/ListPets' },
      },
    },
    components: {
      'x-operations': {
        ListPets: { operationId: 'listPets', summary: 'List pets', tags: ['pets'] },
      },
    },
  };
  const ops = extractOperations(spec);
  assert.equal(ops.has('path:listPets'), true);
  assert.equal(ops.has('path:get_pets'), false);
  assert.equal(ops.get('path:listPets').summary, 'List pets');
});

test('sync does not delete pages when the spec uses path-item $refs', () => {
  const root = makeRepo({
    'reference/pets.json': JSON.stringify(PATH_ITEMS_SPEC),
    'reference/Pets/pets/listPets.md':
      '---\ntitle: Custom docs\napi:\n  file: pets.json\n  operationId: listPets\n---\n\nCUSTOM BODY\n',
    'reference/Pets/pets/_order.yaml': '- listPets\n',
    'reference/Pets/_order.yaml': '- pets\n',
  });
  try {
    const [result] = syncOas(root);
    assert.deepEqual(result.changes.deleted, []);
    const page = path.join(root, 'reference/Pets/pets/listPets.md');
    assert.ok(fs.existsSync(page), 'existing $ref-backed page must survive sync');
    assert.match(fs.readFileSync(page, 'utf-8'), /CUSTOM BODY/);
    assert.ok(
      result.changes.added.some((p) => p.endsWith('createpet.md')),
      `expected createpet.md in ${JSON.stringify(result.changes.added)}`,
    );
  } finally {
    rmRepo(root);
  }
});

test('JSON Pointer does not follow inherited prototype keys', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Pets' },
    paths: {
      '/pets': { $ref: '#/__proto__' },
    },
  };
  assert.equal(extractOperations(spec).size, 0);
  assert.equal(hasUnresolvedOperationRefs(spec), true);

  const root = makeRepo({
    'reference/pets.json': JSON.stringify(spec),
    'reference/Pets/Other/listPets.md':
      '---\napi:\n  file: pets.json\n  operationId: listPets\n---\n\nCUSTOM BODY\n',
  });
  try {
    const [result] = syncOas(root);
    assert.deepEqual(result.changes.deleted, []);
    assert.match(
      fs.readFileSync(path.join(root, 'reference/Pets/Other/listPets.md'), 'utf-8'),
      /CUSTOM BODY/,
    );
  } finally {
    rmRepo(root);
  }
});

test('chained $ref to an external file is unresolved and does not delete pages', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Pets' },
    paths: {
      '/pets': { $ref: '#/components/pathItems/Pets' },
    },
    components: {
      pathItems: {
        Pets: { $ref: './paths/pets.yaml' },
      },
    },
  };
  assert.equal(hasUnresolvedOperationRefs(spec), true);
  assert.equal(extractOperations(spec).size, 0);

  const root = makeRepo({
    'reference/pets.json': JSON.stringify(spec),
    'reference/Pets/Other/listPets.md':
      '---\napi:\n  file: pets.json\n  operationId: listPets\n---\n\nCUSTOM BODY\n',
  });
  try {
    const [result] = syncOas(root);
    assert.deepEqual(result.changes.deleted, []);
    assert.match(
      fs.readFileSync(path.join(root, 'reference/Pets/Other/listPets.md'), 'utf-8'),
      /CUSTOM BODY/,
    );
  } finally {
    rmRepo(root);
  }
});

test('cyclic path-item $ref is unresolved and does not delete pages', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Pets' },
    paths: {
      '/pets': { $ref: '#/components/pathItems/A' },
    },
    components: {
      pathItems: {
        A: { $ref: '#/components/pathItems/B' },
        B: { $ref: '#/components/pathItems/A' },
      },
    },
  };
  assert.equal(hasUnresolvedOperationRefs(spec), true);
  assert.equal(extractOperations(spec).size, 0);

  const root = makeRepo({
    'reference/pets.json': JSON.stringify(spec),
    'reference/Pets/Other/listPets.md':
      '---\napi:\n  file: pets.json\n  operationId: listPets\n---\n\nCUSTOM BODY\n',
  });
  try {
    const [result] = syncOas(root);
    assert.deepEqual(result.changes.deleted, []);
    assert.ok(fs.existsSync(path.join(root, 'reference/Pets/Other/listPets.md')));
  } finally {
    rmRepo(root);
  }
});

test('OAS 3.1 path-item $ref keeps sibling operations', () => {
  const spec = {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {
      '/pets': {
        $ref: '#/components/pathItems/Pets',
        post: { operationId: 'createPet', tags: ['pets'] },
      },
    },
    components: {
      pathItems: {
        Pets: {
          get: { operationId: 'listPets', tags: ['pets'] },
        },
      },
    },
  };
  const ops = extractOperations(spec);
  assert.deepEqual([...ops.keys()].sort(), ['path:createPet', 'path:listPets']);
  assert.equal(hasUnresolvedOperationRefs(spec), false);

  const root = makeRepo({
    'reference/pets.json': JSON.stringify(spec),
    'reference/Pets/pets/createPet.md':
      '---\napi:\n  file: pets.json\n  operationId: createPet\n---\n\nSIBLING BODY\n',
    'reference/Pets/pets/_order.yaml': '- createPet\n',
    'reference/Pets/_order.yaml': '- pets\n',
  });
  try {
    const [result] = syncOas(root);
    assert.deepEqual(result.changes.deleted, []);
    assert.match(
      fs.readFileSync(path.join(root, 'reference/Pets/pets/createPet.md'), 'utf-8'),
      /SIBLING BODY/,
    );
    assert.ok(
      result.changes.added.some((p) => p.endsWith('listpets.md')),
      `expected listpets.md in ${JSON.stringify(result.changes.added)}`,
    );
  } finally {
    rmRepo(root);
  }
});

test('path-item $ref to a non-object keeps siblings and does not delete pages', () => {
  const spec = {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {
      '/pets': {
        $ref: '#/components/examples/notAPathItem',
        post: { operationId: 'createPet', tags: ['pets'] },
      },
    },
    components: {
      examples: {
        notAPathItem: ['not', 'an', 'object'],
      },
    },
  };
  const ops = extractOperations(spec);
  assert.deepEqual([...ops.keys()], ['path:createPet']);
  assert.equal(hasUnresolvedOperationRefs(spec), true);

  const root = makeRepo({
    'reference/pets.json': JSON.stringify(spec),
    'reference/Pets/pets/createPet.md':
      '---\napi:\n  file: pets.json\n  operationId: createPet\n---\n\nSIBLING BODY\n',
  });
  try {
    const [result] = syncOas(root);
    assert.deepEqual(result.changes.deleted, []);
    assert.match(
      fs.readFileSync(path.join(root, 'reference/Pets/pets/createPet.md'), 'utf-8'),
      /SIBLING BODY/,
    );
  } finally {
    rmRepo(root);
  }
});

test('unresolved operation $ref does not invent a synthetic operationId page', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Pets' },
    paths: {
      '/pets': {
        get: { $ref: './ops/list.yaml' },
      },
    },
  };
  const ops = extractOperations(spec);
  assert.equal(ops.size, 0);
  assert.equal(ops.has('path:get_pets'), false);
  assert.equal(hasUnresolvedOperationRefs(spec), true);

  const root = makeRepo({
    'reference/pets.json': JSON.stringify(spec),
    'reference/Pets/Other/listPets.md':
      '---\napi:\n  file: pets.json\n  operationId: listPets\n---\n\nCUSTOM BODY\n',
  });
  try {
    const [result] = syncOas(root);
    assert.deepEqual(result.changes.deleted, []);
    assert.deepEqual(result.changes.added, []);
    assert.match(
      fs.readFileSync(path.join(root, 'reference/Pets/Other/listPets.md'), 'utf-8'),
      /CUSTOM BODY/,
    );
  } finally {
    rmRepo(root);
  }
});

test('OAS 3.1 path-item sibling overrides the referenced method', () => {
  const spec = {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {
      '/pets': {
        $ref: '#/components/pathItems/Pets',
        get: { operationId: 'listPetsV2', tags: ['pets'] },
      },
    },
    components: {
      pathItems: {
        Pets: {
          get: { operationId: 'listPets', tags: ['pets'] },
        },
      },
    },
  };
  const ops = extractOperations(spec);
  assert.equal(ops.has('path:listPetsV2'), true);
  assert.equal(ops.has('path:listPets'), false);
});

test('sync does not delete pages when a path $ref points at an external file', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    paths: {
      '/pets': { $ref: './paths/pets.yaml' },
    },
  });
  const root = makeRepo({
    'reference/pets.json': spec,
    'reference/Pets/Other/listPets.md':
      '---\napi:\n  file: pets.json\n  operationId: listPets\n---\n\nCUSTOM BODY\n',
  });
  try {
    assert.equal(hasUnresolvedOperationRefs(JSON.parse(spec)), true);
    const [result] = syncOas(root);
    assert.deepEqual(result.changes.deleted, []);
    const page = path.join(root, 'reference/Pets/Other/listPets.md');
    assert.ok(fs.existsSync(page), 'unresolved $ref must not wipe existing pages');
    assert.match(fs.readFileSync(page, 'utf-8'), /CUSTOM BODY/);
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

test('untagged operations group by path, one folder per unique path, not a shared "Other" bucket', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    paths: {
      '/pets': {
        get: { operationId: 'listPets' },
        post: { operationId: 'createPet' },
      },
      '/pets/{petId}': {
        get: { operationId: 'getPet' },
      },
      '/search': {
        get: { operationId: 'search' },
      },
    },
  });
  const root = makeRepo({ 'reference/pets.json': spec });
  try {
    syncOas(root);
    const refDir = path.join(root, 'reference/Pets');

    // No shared "Other" folder — every unique path gets its own group.
    assert.equal(fs.existsSync(path.join(refDir, 'Other')), false);

    // Operations sharing a path share a folder.
    assert.ok(fs.existsSync(path.join(refDir, 'pets/listpets.md')));
    assert.ok(fs.existsSync(path.join(refDir, 'pets/createpet.md')));
    assert.ok(fs.existsSync(path.join(refDir, 'petspetid/getpet.md')));
    // The "search" folder itself reserves the slug "search" (it's the category
    // page's slug), so the operationId "search" collides with its own folder
    // name and is suffixed — matches real platform-upload output.
    assert.ok(fs.existsSync(path.join(refDir, 'search/search-1.md')));
    assert.equal(fs.existsSync(path.join(refDir, 'search/search.md')), false);

    // The category page's title is the raw path, not the sanitized folder name.
    const petsIndex = matter(fs.readFileSync(path.join(refDir, 'pets/index.md'), 'utf-8')).data;
    assert.equal(petsIndex.title, '/pets');
    assert.equal('excerpt' in petsIndex, false);

    const petIdIndex = matter(fs.readFileSync(path.join(refDir, 'petspetid/index.md'), 'utf-8')).data;
    assert.equal(petIdIndex.title, '/pets/{petId}');
  } finally {
    rmRepo(root);
  }
});

test('an operation with a real tag still groups under that tag, not its path', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    tags: [{ name: 'pets', description: 'Pet operations' }],
    paths: {
      '/pets': { get: { operationId: 'listPets', tags: ['pets'] } },
    },
  });
  const root = makeRepo({ 'reference/pets.json': spec });
  try {
    syncOas(root);
    const refDir = path.join(root, 'reference/Pets');
    assert.ok(fs.existsSync(path.join(refDir, 'pets/listpets.md')));
    const index = matter(fs.readFileSync(path.join(refDir, 'pets/index.md'), 'utf-8')).data;
    assert.equal(index.title, 'pets');
    assert.equal(index.excerpt, 'Pet operations');
  } finally {
    rmRepo(root);
  }
});

test('generated pages end at the closing fence with no trailing blank line', () => {
  const root = makeRepo({ 'reference/pets.json': SPEC });
  try {
    syncOas(root);
    // Matches platform-generated pages, which end immediately after "---"
    // with no trailing newline.
    const opContent = fs.readFileSync(path.join(root, 'reference/Pets/pets/listpets.md'), 'utf-8');
    assert.ok(opContent.endsWith('---'), `expected no trailing newline, got: ${JSON.stringify(opContent.slice(-5))}`);

    const indexContent = fs.readFileSync(path.join(root, 'reference/Pets/pets/index.md'), 'utf-8');
    assert.ok(indexContent.endsWith('---'), `expected no trailing newline, got: ${JSON.stringify(indexContent.slice(-5))}`);
  } finally {
    rmRepo(root);
  }
});

test('tag order follows the spec\'s own `tags` array, not the order operations appear in `paths`', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    // Declared in "beta, alpha" order...
    tags: [{ name: 'beta' }, { name: 'alpha' }],
    paths: {
      // ...even though "alpha"'s operation is declared first in paths.
      '/a': { get: { operationId: 'aOp', tags: ['alpha'] } },
      '/b': { get: { operationId: 'bOp', tags: ['beta'] } },
    },
  });
  const root = makeRepo({ 'reference/pets.json': spec });
  try {
    syncOas(root);
    const order = fs.readFileSync(path.join(root, 'reference/Pets/_order.yaml'), 'utf-8');
    assert.deepEqual(order.trim().split('\n'), ['- beta', '- alpha']);
  } finally {
    rmRepo(root);
  }
});

test('a tag used by an operation but not declared in `tags` is ordered after every declared tag', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    tags: [{ name: 'alpha' }],
    paths: {
      // "undeclared" is never listed in the spec's top-level tags array, and
      // its operation appears before alpha's in paths.
      '/a': { get: { operationId: 'aOp', tags: ['undeclared'] } },
      '/b': { get: { operationId: 'bOp', tags: ['alpha'] } },
    },
  });
  const root = makeRepo({ 'reference/pets.json': spec });
  try {
    syncOas(root);
    const order = fs.readFileSync(path.join(root, 'reference/Pets/_order.yaml'), 'utf-8');
    assert.deepEqual(order.trim().split('\n'), ['- alpha', '- undeclared']);
  } finally {
    rmRepo(root);
  }
});

test('deleting one of two existing owners of a shared slug does not free it for reuse', () => {
  // "shared" is already claimed by two pre-existing things: a leaf page
  // backing an operation that's about to be removed from the spec, and an
  // unrelated hand-authored category folder that survives. Deleting the
  // former must not make the slug look free again.
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    paths: {
      // "goneOp" (which used to back reference/Pets/a/shared.md) no longer
      // exists in the spec. "newOp" is a new operation that would also want
      // the base slug "shared".
      '/new': { get: { operationId: 'shared', tags: ['a'] } },
    },
  });
  const root = makeRepo({
    'reference/pets.json': spec,
    'reference/Pets/a/shared.md': '---\napi:\n  file: pets.json\n  operationId: goneOp\n---\n',
    'reference/Pets/b/shared/index.md': '---\ntitle: Shared Category\n---\n\nHand-authored, unrelated to any operation.\n',
  });
  try {
    syncOas(root);

    // The orphaned page is gone...
    assert.equal(fs.existsSync(path.join(root, 'reference/Pets/a/shared.md')), false);
    // ...but the still-existing category folder still owns "shared", so the
    // new operation is suffixed rather than colliding with it.
    assert.ok(fs.existsSync(path.join(root, 'reference/Pets/a/shared-1.md')));
    const opId = matter(
      fs.readFileSync(path.join(root, 'reference/Pets/a/shared-1.md'), 'utf-8'),
    ).data.api.operationId;
    assert.equal(opId, 'shared');

    // The hand-authored survivor is untouched.
    assert.match(
      fs.readFileSync(path.join(root, 'reference/Pets/b/shared/index.md'), 'utf-8'),
      /Hand-authored/,
    );
  } finally {
    rmRepo(root);
  }
});

test('a mixed-case tag gets a lowercased folder, but keeps its original case as the category title', () => {
  // Confirmed against a real platform upload: a tag declared "MixedCaseTag"
  // in the spec produces an on-disk folder "mixedcasetag", but the category
  // page's title frontmatter keeps the original casing.
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    tags: [{ name: 'MixedCaseTag', description: 'Ops under a mixed-case tag' }],
    paths: {
      '/a': { get: { operationId: 'getA', tags: ['MixedCaseTag'] } },
    },
  });
  const root = makeRepo({ 'reference/pets.json': spec });
  try {
    syncOas(root);
    const refDir = path.join(root, 'reference/Pets');
    assert.ok(fs.existsSync(path.join(refDir, 'mixedcasetag/geta.md')));
    // Check the actual on-disk directory name (not just existsSync, which
    // some filesystems like macOS's default APFS resolve case-insensitively).
    assert.ok(fs.readdirSync(refDir).includes('mixedcasetag'));

    const index = matter(fs.readFileSync(path.join(refDir, 'mixedcasetag/index.md'), 'utf-8')).data;
    assert.equal(index.title, 'MixedCaseTag');

    const order = fs.readFileSync(path.join(refDir, '_order.yaml'), 'utf-8');
    assert.deepEqual(order.trim().split('\n'), ['- mixedcasetag']);
  } finally {
    rmRepo(root);
  }
});

test('deleting a legacy operation page literally named index.md releases its folder-name slug, not "index"', () => {
  // A legacy operation stored as index.md (predating the "index is reserved
  // for the category page" convention) claims its folder's name as its slug,
  // same as any index.md. The spec no longer has this operation, so it's
  // deleted; a completely unrelated new operation elsewhere in the same sync
  // run wants that exact same slug and must get it cleanly, not a suffix.
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    paths: {
      // Unrelated new operation whose desired slug is "sometag" — the same
      // string as the deleted legacy page's folder name.
      '/new': { get: { operationId: 'sometag', tags: ['other-tag'] } },
    },
  });
  const root = makeRepo({
    'reference/pets.json': spec,
    'reference/Pets/sometag/index.md':
      '---\napi:\n  file: pets.json\n  operationId: legacyOp\n---\n',
    // A pre-refactor tool would have written the literal filename "index"
    // into this directory's own order file — not the folder name.
    'reference/Pets/sometag/_order.yaml': '- index\n',
  });
  try {
    const [result] = syncOas(root);
    assert.ok(result.changes.deleted.some((p) => p.endsWith('sometag/index.md')));

    // The base slug is free again — no unnecessary numeric suffix.
    assert.ok(fs.existsSync(path.join(root, 'reference/Pets/other-tag/sometag.md')));
    assert.equal(fs.existsSync(path.join(root, 'reference/Pets/other-tag/sometag-1.md')), false);

    // The dangling "- index" entry is removed from the folder's own order
    // file (not the folder name — that was never what was listed there).
    const orderPath = path.join(root, 'reference/Pets/sometag/_order.yaml');
    assert.equal(fs.existsSync(orderPath), false, 'expected the now-empty _order.yaml to be removed');
  } finally {
    rmRepo(root);
  }
});

test('sync generates a page for a webhook, marked with api.webhook: true', () => {
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Payments' },
    webhooks: {
      paymentCompleted: {
        post: { summary: 'Sent when a payment settles' },
      },
    },
  });
  const root = makeRepo({ 'reference/payments.json': spec });
  try {
    syncOas(root);
    const page = path.join(root, 'reference/Payments/paymentcompleted/post_paymentcompleted.md');
    assert.ok(fs.existsSync(page), 'expected a generated webhook page');
    const { data } = matter(fs.readFileSync(page, 'utf-8'));
    assert.equal(data.api.file, 'payments.json');
    assert.equal(data.api.operationId, 'post_paymentcompleted');
    assert.equal(data.api.webhook, true);

    // The category page's title is the webhook's own name, not the folder.
    const index = matter(
      fs.readFileSync(path.join(root, 'reference/Payments/paymentcompleted/index.md'), 'utf-8'),
    ).data;
    assert.equal(index.title, 'paymentCompleted');
  } finally {
    rmRepo(root);
  }
});

test('a path operation is not stamped api.webhook', () => {
  const root = makeRepo({ 'reference/pets.json': SPEC });
  try {
    syncOas(root);
    const { data } = matter(
      fs.readFileSync(path.join(root, 'reference/Pets/pets/listpets.md'), 'utf-8'),
    );
    assert.equal('webhook' in data.api, false);
  } finally {
    rmRepo(root);
  }
});

test('sync no longer deletes an existing webhook page on every run', () => {
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
    const [result] = syncOas(root);
    assert.deepEqual(result.changes.deleted, []);
    assert.ok(
      fs.existsSync(path.join(root, 'reference/Payments/paymentcompleted/post_paymentcompleted.md')),
    );
  } finally {
    rmRepo(root);
  }
});

test('an untagged webhook and an untagged path operation with the same sanitized name both get pages', () => {
  // "/orders" and webhook "orders" sanitize to the same untagged group
  // ("orders"), same as two untagged paths would; each still gets its own
  // distinct operation page (they have different operationIds).
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Payments' },
    paths: {
      '/orders': { get: { operationId: 'listOrders' } },
    },
    webhooks: {
      orders: {
        post: { summary: 'Sent when an order changes' },
      },
    },
  });
  const root = makeRepo({ 'reference/payments.json': spec });
  try {
    syncOas(root);
    const refDir = path.join(root, 'reference/Payments');
    assert.ok(fs.existsSync(path.join(refDir, 'orders/listorders.md')));
    assert.ok(fs.existsSync(path.join(refDir, 'orders/post_orders.md')));
  } finally {
    rmRepo(root);
  }
});

test('a path and a webhook whose synthesized operationIds collide both still get pages', () => {
  // Neither declares an operationId, both are POST, and both sanitize to
  // the same synthetic id: post_orders.
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Payments' },
    paths: {
      '/orders': { post: { summary: 'Create an order' } },
    },
    webhooks: {
      orders: { post: { summary: 'Sent when an order changes' } },
    },
  });
  const root = makeRepo({ 'reference/payments.json': spec });
  try {
    const [result] = syncOas(root);
    // Both pages generated — neither silently dropped by an internal Map
    // collision keyed only on the (identical) synthesized operationId.
    const added = result.changes.added.filter((p) => !p.endsWith('index.md'));
    assert.equal(added.length, 2, `expected 2 pages, got: ${JSON.stringify(added)}`);

    const refDir = path.join(root, 'reference/Payments/orders');
    const pathPage = matter(fs.readFileSync(path.join(refDir, 'post_orders.md'), 'utf-8')).data;
    const webhookPage = matter(
      fs.readFileSync(path.join(refDir, 'post_orders-1.md'), 'utf-8'),
    ).data;
    assert.equal('webhook' in pathPage.api, false);
    assert.equal(webhookPage.api.webhook, true);
  } finally {
    rmRepo(root);
  }
});

test('a webhook that is a $ref to components.pathItems is resolved', () => {
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Payments' },
    webhooks: {
      paymentCompleted: { $ref: '#/components/pathItems/PaymentCompleted' },
    },
    components: {
      pathItems: {
        PaymentCompleted: {
          post: { operationId: 'onPaymentCompleted', summary: 'Sent when a payment settles' },
        },
      },
    },
  });
  const root = makeRepo({ 'reference/payments.json': spec });
  try {
    syncOas(root);
    const page = path.join(root, 'reference/Payments/paymentcompleted/onpaymentcompleted.md');
    assert.ok(fs.existsSync(page), 'expected the $ref-resolved webhook to generate a page');
    const { data } = matter(fs.readFileSync(page, 'utf-8'));
    assert.equal(data.api.operationId, 'onPaymentCompleted');
    assert.equal(data.api.webhook, true);
  } finally {
    rmRepo(root);
  }
});

test('a $ref to a pathItem that is itself a $ref is followed to the literal Path Item', () => {
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Payments' },
    webhooks: {
      // Chained: paymentCompleted -> Alias -> the literal Path Item.
      paymentCompleted: { $ref: '#/components/pathItems/Alias' },
    },
    components: {
      pathItems: {
        Alias: { $ref: '#/components/pathItems/PaymentCompleted' },
        PaymentCompleted: {
          post: { operationId: 'onPaymentCompleted', summary: 'Sent when a payment settles' },
        },
      },
    },
  });
  const root = makeRepo({ 'reference/payments.json': spec });
  try {
    syncOas(root);
    const page = path.join(root, 'reference/Payments/paymentcompleted/onpaymentcompleted.md');
    assert.ok(fs.existsSync(page), 'expected the chained $ref to be followed to the literal Path Item');
    assert.equal(matter(fs.readFileSync(page, 'utf-8')).data.api.operationId, 'onPaymentCompleted');
  } finally {
    rmRepo(root);
  }
});

test('a circular pathItem $ref is left unresolved rather than looping forever', () => {
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Payments' },
    webhooks: {
      paymentCompleted: { $ref: '#/components/pathItems/A' },
    },
    components: {
      pathItems: {
        A: { $ref: '#/components/pathItems/B' },
        B: { $ref: '#/components/pathItems/A' },
      },
    },
  });
  const root = makeRepo({ 'reference/payments.json': spec });
  try {
    // Must return (not hang) and simply generate nothing for the cycle.
    const [result] = syncOas(root);
    assert.equal(result.changes.added.filter((p) => !p.endsWith('index.md')).length, 0);
  } finally {
    rmRepo(root);
  }
});

test('a pathItem $ref with a malformed percent-escape is left unresolved rather than throwing', () => {
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Payments' },
    webhooks: {
      // "%zz" is not a valid percent-escape — decodeURIComponent throws on it.
      paymentCompleted: { $ref: '#/components/pathItems/%zz' },
    },
    components: { pathItems: {} },
  });
  const root = makeRepo({ 'reference/payments.json': spec });
  try {
    // Must not throw; the malformed ref is simply left unresolved.
    const [result] = syncOas(root);
    assert.equal(result.changes.added.filter((p) => !p.endsWith('index.md')).length, 0);
  } finally {
    rmRepo(root);
  }
});

test('an inline operation alongside a $ref sibling is not discarded', () => {
  // OAS 3.1 explicitly permits sibling fields (like an inline operation)
  // alongside $ref in a Path Item Object.
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Payments' },
    webhooks: {
      paymentCompleted: {
        $ref: '#/components/pathItems/Base',
        // Inline sibling operation, alongside the $ref.
        put: { operationId: 'inlineUpdate', summary: 'Inline sibling op' },
      },
    },
    components: {
      pathItems: {
        Base: { post: { operationId: 'onPaymentCompleted', summary: 'From the referenced pathItem' } },
      },
    },
  });
  const root = makeRepo({ 'reference/payments.json': spec });
  try {
    syncOas(root);
    const refDir = path.join(root, 'reference/Payments/paymentcompleted');
    // Both the referenced pathItem's operation and the inline sibling exist.
    assert.ok(fs.existsSync(path.join(refDir, 'onpaymentcompleted.md')), 'expected the referenced operation');
    assert.ok(fs.existsSync(path.join(refDir, 'inlineupdate.md')), 'expected the inline sibling operation');
  } finally {
    rmRepo(root);
  }
});
