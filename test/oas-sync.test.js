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
    assert.equal(first.changes.added.length, 1);
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
    'reference/Pets/Other/listPets.md': '---\ntitle: Hand-written page\n---\n\nCustom content.\n',
  });
  try {
    const [result] = syncOas(root);
    assert.equal(result.changes.added.length, 0);
    assert.equal(result.changes.skipped.length, 1);
    const content = fs.readFileSync(path.join(root, 'reference/Pets/Other/listPets.md'), 'utf-8');
    assert.match(content, /Hand-written page/);
    assert.match(content, /Custom content/);
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
  assert.deepEqual([...ops.keys()].sort(), ['createPet', 'listPets']);
  assert.equal(ops.get('listPets').tag, 'pets');
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
  assert.equal(ops.has('listPets'), true);
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
  assert.equal(ops.has('listPets'), true);
  assert.equal(ops.has('get_pets'), false);
  assert.equal(ops.get('listPets').summary, 'List pets');
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
    assert.equal(result.changes.added.includes('Pets/pets/createPet.md'), true);
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
  assert.deepEqual([...ops.keys()].sort(), ['createPet', 'listPets']);
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
    assert.equal(result.changes.added.includes('Pets/pets/listPets.md'), true);
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
  assert.deepEqual([...ops.keys()], ['createPet']);
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
  assert.equal(ops.has('get_pets'), false);
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
  assert.equal(ops.has('listPetsV2'), true);
  assert.equal(ops.has('listPets'), false);
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
