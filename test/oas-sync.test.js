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

    // The page is still generated, under sanitized single-segment names. The
    // tag folder is additionally slugified (dots and hyphens collapse to one
    // hyphen, then trimmed), unlike the title folder which only has slashes
    // swapped for hyphens.
    const page = path.join(refDir, '..-..-escaped-title', 'escaped-tag', '..-escaped-op.md');
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

test('a space-separated tag folder lands on the platform\'s existing hyphenated folder, not a duplicate', () => {
  // The platform's own OAS-upload slugifies a tag like "Shipping Labels" to
  // an "shipping-labels" folder. Before this, oas:sync only lowercased tag
  // names for the folder, so a raw spec tag with spaces ("shipping labels")
  // produced a second, duplicate "shipping labels" folder alongside the
  // platform's "shipping-labels" one instead of reusing it.
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    tags: [{ name: 'Shipping Labels' }],
    paths: {
      '/a': { get: { operationId: 'getA', tags: ['Shipping Labels'] } },
    },
  });
  const root = makeRepo({
    'reference/pets.json': spec,
    // Pre-existing folder as the platform itself would have named it.
    'reference/Pets/shipping-labels/index.md': '---\ntitle: Shipping Labels\n---\n',
  });
  try {
    syncOas(root);
    const refDir = path.join(root, 'reference/Pets');

    assert.ok(fs.existsSync(path.join(refDir, 'shipping-labels/geta.md')));
    assert.equal(fs.existsSync(path.join(refDir, 'shipping labels')), false);
    assert.equal(fs.readdirSync(refDir).includes('shipping labels'), false);
  } finally {
    rmRepo(root);
  }
});

test('a pre-existing space-separated tag folder is reused as-is, not replaced by a hyphenated duplicate', () => {
  // A reference tree can already have a tag folder spelled with spaces —
  // hand-authored, or left over from before this folder-slug fix. Whatever
  // spelling is already on disk wins: a new operation under that same tag
  // must land in the existing folder, not spawn a second, hyphenated one
  // next to it.
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    tags: [{ name: 'Shipping Labels' }],
    paths: {
      '/a': { get: { operationId: 'getA', tags: ['Shipping Labels'] } },
    },
  });
  const root = makeRepo({
    'reference/pets.json': spec,
    'reference/Pets/shipping labels/index.md': '---\ntitle: Shipping Labels\n---\n',
  });
  try {
    syncOas(root);
    const refDir = path.join(root, 'reference/Pets');

    assert.ok(fs.existsSync(path.join(refDir, 'shipping labels/geta.md')));
    assert.equal(fs.existsSync(path.join(refDir, 'shipping-labels')), false);
    assert.equal(fs.readdirSync(refDir).includes('shipping-labels'), false);

    const order = fs.readFileSync(path.join(refDir, '_order.yaml'), 'utf-8');
    assert.deepEqual(order.trim().split('\n'), ['- shipping labels']);
  } finally {
    rmRepo(root);
  }
});

test('a tag folder missing its category index.md is backfilled in place, regardless of its spelling', () => {
  // The category-page backfill pass (for a reference first synced by a CLI
  // version that didn't generate index.md) must resolve the same existing
  // folder as the operation-adding pass, even when that folder predates the
  // hyphenated-slug convention.
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pets' },
    tags: [{ name: 'Shipping Labels', description: 'Shipping stuff' }],
    paths: {
      '/a': { get: { operationId: 'getA', tags: ['Shipping Labels'] } },
    },
  });
  const root = makeRepo({
    'reference/pets.json': spec,
    // Pre-existing operation page (still current in the spec) under the
    // space-separated folder, with no index.md yet.
    'reference/Pets/shipping labels/geta.md': matter.stringify('', {
      api: { file: 'pets.json', operationId: 'getA' },
    }),
  });
  try {
    syncOas(root);
    const refDir = path.join(root, 'reference/Pets');

    assert.ok(fs.existsSync(path.join(refDir, 'shipping labels/index.md')));
    assert.ok(fs.existsSync(path.join(refDir, 'shipping labels/geta.md')));
    assert.equal(fs.existsSync(path.join(refDir, 'shipping-labels')), false);
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

// --- x-internal ---------------------------------------------------------

function fm(root, rel) {
  return matter(fs.readFileSync(path.join(root, rel), 'utf-8')).data;
}

function order(root, rel) {
  return fs
    .readFileSync(path.join(root, rel), 'utf-8')
    .trim()
    .split('\n')
    .map((l) => l.replace(/^- /, ''));
}

test('x-internal: operation-level value wins over root, absent falls back to root', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Api' },
    'x-internal': true,
    tags: [{ name: 'pets' }],
    paths: {
      '/a': { get: { operationId: 'a', tags: ['pets'], 'x-internal': false } },
      '/b': { get: { operationId: 'b', tags: ['pets'] } },
    },
  });
  const root = makeRepo({ 'reference/api.json': spec });
  try {
    syncOas(root);
    assert.equal(fm(root, 'reference/Api/pets/a.md').hidden, false);
    assert.equal(fm(root, 'reference/Api/pets/b.md').hidden, true);
    // One child visible, so the tag page stays visible.
    assert.equal(fm(root, 'reference/Api/pets/index.md').hidden, false);
  } finally {
    rmRepo(root);
  }
});

test('x-internal: a new tag page is hidden when every operation in it is internal', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Api' },
    paths: {
      '/a': { get: { operationId: 'a', tags: ['secret'], 'x-internal': true } },
      '/b': { get: { operationId: 'b', tags: ['secret'], 'x-internal': true } },
      '/c': { get: { operationId: 'c', tags: ['open'] } },
    },
  });
  const root = makeRepo({ 'reference/api.json': spec });
  try {
    syncOas(root);
    assert.equal(fm(root, 'reference/Api/secret/index.md').hidden, true);
    assert.equal(fm(root, 'reference/Api/open/index.md').hidden, false);
    assert.equal(fm(root, 'reference/Api/open/c.md').hidden, false);
  } finally {
    rmRepo(root);
  }
});

test('x-internal: resync applies the spec value to existing pages in both directions, keeping the body', () => {
  const spec = (value) =>
    JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Api' },
      paths: {
        '/a': { get: { operationId: 'a', tags: ['t'], 'x-internal': value } },
        '/b': { get: { operationId: 'b', tags: ['t'] } },
      },
    });
  const root = makeRepo({
    'reference/api.json': spec(true),
    'reference/Api/t/index.md': '---\ntitle: t\nhidden: false\n---\n',
    'reference/Api/t/a.md': '---\napi:\n  file: api.json\n  operationId: a\nhidden: false\n---\nCustom body\n',
    'reference/Api/t/b.md': '---\napi:\n  file: api.json\n  operationId: b\nhidden: true\n---\n',
  });
  try {
    let [result] = syncOas(root);
    assert.deepEqual(result.changes.updated, ['Api/t/a.md']);
    assert.equal(fm(root, 'reference/Api/t/a.md').hidden, true);
    assert.match(fs.readFileSync(path.join(root, 'reference/Api/t/a.md'), 'utf-8'), /Custom body/);
    // No x-internal on b: its manual hidden: true is preserved.
    assert.equal(fm(root, 'reference/Api/t/b.md').hidden, true);

    fs.writeFileSync(path.join(root, 'reference/api.json'), spec(false));
    [result] = syncOas(root);
    assert.equal(fm(root, 'reference/Api/t/a.md').hidden, false);

    // Re-running is a no-op.
    [result] = syncOas(root);
    assert.deepEqual(result.changes.updated, []);
  } finally {
    rmRepo(root);
  }
});

test('x-internal: removing the extension does not unhide an existing page', () => {
  const root = makeRepo({
    'reference/api.json': JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Api' },
      paths: { '/a': { get: { operationId: 'a', tags: ['t'] } } },
    }),
    'reference/Api/t/index.md': '---\ntitle: t\nhidden: false\n---\n',
    'reference/Api/t/a.md': '---\napi:\n  file: api.json\n  operationId: a\nhidden: true\n---\n',
  });
  try {
    syncOas(root);
    assert.equal(fm(root, 'reference/Api/t/a.md').hidden, true);
  } finally {
    rmRepo(root);
  }
});

test('x-internal: an existing tag page is hidden once all its operations are internal, and never unhidden', () => {
  const spec = (value) =>
    JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Api' },
      'x-internal': value,
      paths: { '/a': { get: { operationId: 'a', tags: ['t'] } } },
    });
  const root = makeRepo({
    'reference/api.json': spec(true),
    'reference/Api/t/index.md': '---\ntitle: t\nhidden: false\n---\n',
    'reference/Api/t/a.md': '---\napi:\n  file: api.json\n  operationId: a\nhidden: false\n---\n',
  });
  try {
    syncOas(root);
    assert.equal(fm(root, 'reference/Api/t/index.md').hidden, true);

    fs.writeFileSync(path.join(root, 'reference/api.json'), spec(false));
    syncOas(root);
    assert.equal(fm(root, 'reference/Api/t/a.md').hidden, false);
    assert.equal(fm(root, 'reference/Api/t/index.md').hidden, true);
  } finally {
    rmRepo(root);
  }
});

// --- apply-tag-changes --------------------------------------------------

function retaggedSpec(extra = {}) {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Api' },
    ...extra,
    tags: [{ name: 'new', description: 'New tag' }],
    paths: { '/a': { get: { operationId: 'a', tags: ['new'] } } },
  });
}

const RETAG_FILES = {
  'reference/_order.yaml': '- Api\n',
  'reference/Api/_order.yaml': '- old\n',
  'reference/Api/old/index.md': '---\ntitle: old\nhidden: false\n---\n',
  'reference/Api/old/_order.yaml': '- a\n',
  'reference/Api/old/a.md': '---\napi:\n  file: api.json\n  operationId: a\nhidden: false\n---\n',
};

test('without apply-tag-changes, a retagged page stays where it is', () => {
  const root = makeRepo({ ...RETAG_FILES, 'reference/api.json': retaggedSpec() });
  try {
    const [result] = syncOas(root);
    assert.ok(fs.existsSync(path.join(root, 'reference/Api/old/a.md')));
    assert.equal(fs.existsSync(path.join(root, 'reference/Api/new/a.md')), false);
    assert.deepEqual(result.changes.moved, []);
  } finally {
    rmRepo(root);
  }
});

test('apply-tag-changes moves a retagged page to its new tag and removes the emptied generated tag folder', () => {
  const root = makeRepo({
    ...RETAG_FILES,
    'reference/api.json': retaggedSpec({ 'x-readme': { 'apply-tag-changes': true } }),
  });
  try {
    const [result] = syncOas(root);
    assert.ok(fs.existsSync(path.join(root, 'reference/Api/new/a.md')));
    assert.equal(fs.existsSync(path.join(root, 'reference/Api/old')), false);
    assert.deepEqual(result.changes.moved, [{ from: 'Api/old/a.md', to: 'Api/new/a.md' }]);
    assert.ok(result.changes.deleted.includes('Api/old/index.md'));
    assert.deepEqual(order(root, 'reference/Api/_order.yaml'), ['new']);
    assert.deepEqual(order(root, 'reference/Api/new/_order.yaml'), ['a']);
  } finally {
    rmRepo(root);
  }
});

test('apply-tag-changes deletes an emptied generated tag folder even when its page carries the old tag\'s description', () => {
  // The page was generated when the spec still declared `old` with a
  // description, which became its excerpt. That tag has since left the spec,
  // so there is nothing current to compare the excerpt against — it must
  // still be recognized as generated and removed, not flattened into a stale
  // `old.md` that keeps a sidebar entry alive.
  const root = makeRepo({
    ...RETAG_FILES,
    'reference/Api/old/index.md': '---\ntitle: old\nexcerpt: The old tag\nhidden: false\n---\n',
    'reference/api.json': retaggedSpec({ 'x-readme': { 'apply-tag-changes': true } }),
  });
  try {
    const [result] = syncOas(root);
    assert.equal(fs.existsSync(path.join(root, 'reference/Api/old')), false);
    assert.equal(fs.existsSync(path.join(root, 'reference/Api/old.md')), false);
    assert.ok(result.changes.deleted.includes('Api/old/index.md'));
    assert.deepEqual(result.changes.moved, [{ from: 'Api/old/a.md', to: 'Api/new/a.md' }]);
    assert.deepEqual(order(root, 'reference/Api/_order.yaml'), ['new']);
  } finally {
    rmRepo(root);
  }
});

test('apply-tag-changes flattens an emptied tag folder whose category page was hand-edited', () => {
  const root = makeRepo({
    ...RETAG_FILES,
    'reference/Api/old/index.md': '---\ntitle: old\nhidden: false\n---\nHand-written intro\n',
    'reference/api.json': retaggedSpec({ 'x-apply-tag-changes': true }),
  });
  try {
    syncOas(root);
    assert.equal(fs.existsSync(path.join(root, 'reference/Api/old')), false);
    assert.match(fs.readFileSync(path.join(root, 'reference/Api/old.md'), 'utf-8'), /Hand-written intro/);
    assert.deepEqual(order(root, 'reference/Api/_order.yaml'), ['old', 'new']);
  } finally {
    rmRepo(root);
  }
});

test('apply-tag-changes keeps an old tag folder that still has other pages', () => {
  const root = makeRepo({
    ...RETAG_FILES,
    'reference/Api/old/guide.md': '---\ntitle: Guide\n---\nHi\n',
    'reference/api.json': retaggedSpec({ 'x-readme': { 'apply-tag-changes': true } }),
  });
  try {
    syncOas(root);
    assert.ok(fs.existsSync(path.join(root, 'reference/Api/old/index.md')));
    assert.ok(fs.existsSync(path.join(root, 'reference/Api/old/guide.md')));
    assert.ok(fs.existsSync(path.join(root, 'reference/Api/new/a.md')));
  } finally {
    rmRepo(root);
  }
});

test('apply-tag-changes pulls a hand-nested page back to its tag folder, but leaves one moved to another category', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Api' },
    'x-readme': { 'apply-tag-changes': true },
    paths: {
      '/a': { get: { operationId: 'a', tags: ['t'] } },
      '/b': { get: { operationId: 'b', tags: ['t'] } },
    },
  });
  const root = makeRepo({
    'reference/api.json': spec,
    'reference/Api/t/index.md': '---\ntitle: t\nhidden: false\n---\n',
    'reference/Api/t/custom/index.md': '---\ntitle: Custom\n---\nMine\n',
    'reference/Api/t/custom/a.md': '---\napi:\n  file: api.json\n  operationId: a\nhidden: false\n---\n',
    'reference/Elsewhere/b.md': '---\napi:\n  file: api.json\n  operationId: b\nhidden: false\n---\n',
  });
  try {
    syncOas(root);
    assert.ok(fs.existsSync(path.join(root, 'reference/Api/t/a.md')));
    assert.ok(fs.existsSync(path.join(root, 'reference/Elsewhere/b.md')));
    assert.equal(fs.existsSync(path.join(root, 'reference/Api/t/b.md')), false);
    // The user's custom parent was hand-edited, so it's flattened, not deleted.
    assert.match(fs.readFileSync(path.join(root, 'reference/Api/t/custom.md'), 'utf-8'), /Mine/);
  } finally {
    rmRepo(root);
  }
});

test('apply-tag-changes syncs an existing tag page\'s title and excerpt, keeping its body', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Api' },
    'x-readme': { 'apply-tag-changes': true },
    tags: [{ name: 'Pets', description: 'All about pets' }, { name: 'Plain' }],
    paths: {
      '/a': { get: { operationId: 'a', tags: ['Pets'] } },
      '/b': { get: { operationId: 'b', tags: ['Plain'] } },
    },
  });
  const root = makeRepo({
    'reference/api.json': spec,
    'reference/Api/pets/index.md': '---\ntitle: Custom title\nexcerpt: old\nhidden: false\n---\nBody\n',
    'reference/Api/plain/index.md': '---\ntitle: plain\nexcerpt: stale\nhidden: false\n---\n',
  });
  try {
    syncOas(root);
    const pets = matter(fs.readFileSync(path.join(root, 'reference/Api/pets/index.md'), 'utf-8'));
    assert.equal(pets.data.title, 'Pets');
    assert.equal(pets.data.excerpt, 'All about pets');
    assert.match(pets.content, /Body/);
    const plain = fm(root, 'reference/Api/plain/index.md');
    assert.equal(plain.title, 'Plain');
    assert.equal('excerpt' in plain, false);
  } finally {
    rmRepo(root);
  }
});

test('a tag page updated by both apply-tag-changes and x-internal is reported as updated once', () => {
  const spec = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Api' },
    'x-readme': { 'apply-tag-changes': true },
    'x-internal': true,
    tags: [{ name: 't', description: 'Fresh' }],
    paths: { '/a': { get: { operationId: 'a', tags: ['t'] } } },
  });
  const root = makeRepo({
    'reference/api.json': spec,
    'reference/Api/t/index.md': '---\ntitle: t\nexcerpt: stale\nhidden: false\n---\n',
    'reference/Api/t/a.md': '---\napi:\n  file: api.json\n  operationId: a\nhidden: false\n---\n',
  });
  try {
    const [result] = syncOas(root);
    // Both passes really did write to it: excerpt synced, then hidden.
    const index = fm(root, 'reference/Api/t/index.md');
    assert.equal(index.excerpt, 'Fresh');
    assert.equal(index.hidden, true);
    assert.deepEqual(result.changes.updated.slice().sort(), ['Api/t/a.md', 'Api/t/index.md']);
  } finally {
    rmRepo(root);
  }
});

test('apply-tag-changes must be exactly true and set at the root', () => {
  const root = makeRepo({
    ...RETAG_FILES,
    'reference/api.json': retaggedSpec({ 'x-readme': { 'apply-tag-changes': 'true' } }),
  });
  try {
    syncOas(root);
    assert.ok(fs.existsSync(path.join(root, 'reference/Api/old/a.md')));
  } finally {
    rmRepo(root);
  }
});

// --- apply-endpoint-order -----------------------------------------------

function orderedSpec(extra = {}) {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Api' },
    ...extra,
    paths: {
      '/c': { get: { operationId: 'c', tags: ['t'] } },
      '/a': { get: { operationId: 'a', tags: ['t'] } },
      '/b': { get: { operationId: 'b', tags: ['t'] } },
    },
  });
}

const ORDER_FILES = {
  'reference/Api/t/index.md': '---\ntitle: t\nhidden: false\n---\n',
  'reference/Api/t/_order.yaml': '- a\n- guide\n- b\n',
  'reference/Api/t/a.md': '---\napi:\n  file: api.json\n  operationId: a\nhidden: false\n---\n',
  'reference/Api/t/b.md': '---\napi:\n  file: api.json\n  operationId: b\nhidden: false\n---\n',
  'reference/Api/t/guide.md': '---\ntitle: Guide\n---\nHi\n',
};

test('without apply-endpoint-order, new endpoints are appended and existing order is kept', () => {
  const root = makeRepo({ ...ORDER_FILES, 'reference/api.json': orderedSpec() });
  try {
    syncOas(root);
    assert.deepEqual(order(root, 'reference/Api/t/_order.yaml'), ['a', 'guide', 'b', 'c']);
  } finally {
    rmRepo(root);
  }
});

test('apply-endpoint-order reorders endpoints to spec order, leaving other pages in their slots', () => {
  const root = makeRepo({
    ...ORDER_FILES,
    'reference/api.json': orderedSpec({ 'x-readme': { 'apply-endpoint-order': true } }),
  });
  try {
    const [result] = syncOas(root);
    assert.deepEqual(order(root, 'reference/Api/t/_order.yaml'), ['c', 'guide', 'a', 'b']);
    assert.ok(result.changes.updated.includes('Api/t/_order.yaml'));

    const [again] = syncOas(root);
    assert.deepEqual(again.changes.updated, []);
  } finally {
    rmRepo(root);
  }
});

test('apply-endpoint-order collapses a duplicated slug in _order.yaml instead of writing "undefined"', () => {
  const root = makeRepo({
    ...ORDER_FILES,
    'reference/Api/t/_order.yaml': '- a\n- guide\n- a\n- b\n',
    'reference/api.json': orderedSpec({ 'x-readme': { 'apply-endpoint-order': true } }),
  });
  try {
    syncOas(root);
    const raw = fs.readFileSync(path.join(root, 'reference/Api/t/_order.yaml'), 'utf-8');
    assert.equal(raw.includes('undefined'), false);
    assert.deepEqual(order(root, 'reference/Api/t/_order.yaml'), ['c', 'guide', 'a', 'b']);
  } finally {
    rmRepo(root);
  }
});

test('applyOASOrder refills only API slots and inserts new slugs after the last one', async () => {
  const { applyOASOrder } = await import('../src/commands/oas-sync.js');
  assert.deepEqual(applyOASOrder([], ['b', 'a']), ['b', 'a']);
  assert.deepEqual(applyOASOrder(['x', 'y'], ['a']), ['x', 'y', 'a']);
  assert.deepEqual(applyOASOrder(['a', 'x', 'b', 'y'], ['b', 'c', 'a']), ['b', 'x', 'c', 'a', 'y']);
});

test('applyOASOrder never emits undefined when the current order repeats a slug', async () => {
  const { applyOASOrder } = await import('../src/commands/oas-sync.js');
  // More slots than distinct slugs to fill them with.
  assert.deepEqual(applyOASOrder(['a', 'a', 'b'], ['b', 'a']), ['b', 'a']);
  assert.deepEqual(applyOASOrder(['a', 'x', 'a'], ['a']), ['a', 'x']);
  assert.deepEqual(applyOASOrder(['b', 'x', 'b', 'a'], ['a', 'b']), ['a', 'x', 'b']);
  // Duplicates in the requested order are collapsed too.
  assert.deepEqual(applyOASOrder(['a', 'b'], ['b', 'b', 'a']), ['b', 'a']);
  for (const result of [
    applyOASOrder(['a', 'a', 'b'], ['b', 'a']),
    applyOASOrder(['a', 'x', 'a'], ['a']),
  ]) {
    assert.ok(result.every((s) => typeof s === 'string'));
  }
});
