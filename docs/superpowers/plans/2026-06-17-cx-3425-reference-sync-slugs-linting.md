# CX-3425 Reference Sync, Slugs, and Linting Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five CLI issues from CX-3425 — reference pages no longer carry CLI-owned title/excerpt, `-1` slugs rename with redirect output, cross-section duplicate slugs and unknown global components stop being false errors, and stale `_order.yaml` entries get flagged.

**Architecture:** All changes are localized to the existing validators in `src/validators/` and the `src/commands/oas-sync.js` command. The linter auto-discovers validators via `src/utils/lint.js`; each validator exports `validate()` (per-file) and/or `validateAll()` (cross-file) and returns result objects `{ file, rule, message, severity?, fixable? }` (severity defaults to `error`). A new `test/` directory using Node's built-in test runner covers each change with temp-dir fixtures.

**Tech Stack:** Node.js (ESM), `node:test` runner (built-in, no new deps), `gray-matter`, `ajv`, `js-yaml`, `@readme/markdown`.

## Global Constraints

- Node `>=18` (per `package.json` `engines`).
- ESM modules (`"type": "module"`) — use `import`/`export`, not `require` (except via `createRequire` as existing code does).
- No new runtime dependencies. Tests use the built-in `node:test` runner only.
- Validator result objects: `{ file, rule, message }` plus optional `severity` (`'error'` default | `'warning'`) and `fixable` (boolean). A result with `severity !== 'warning'` counts as an error and fails CI.
- Do not strip pre-existing `title`/`excerpt` from reference Markdown — changes are non-destructive to existing files.

---

## Prerequisite (one-time, before Task 1)

- [ ] Ensure dependencies are installed:

Run: `npm install`
Expected: completes without error; `node_modules/` present.

---

### Task 1: Test harness setup

**Files:**
- Modify: `package.json` (the `scripts.test` field)
- Create: `test/helpers.js`
- Create: `test/smoke.test.js`

**Interfaces:**
- Produces: `makeRepo(filesObject) → string` (absolute temp repo root) and `rmRepo(root) → void`, imported by every later test file.

- [ ] **Step 1: Add the test script**

In `package.json`, replace the `test` script:

```json
  "scripts": {
    "start": "node bin/readme.js",
    "test": "node --test"
  },
```

- [ ] **Step 2: Create the test helper**

Create `test/helpers.js`:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Write a set of files into a fresh temp directory and return its absolute root.
 * @param {Record<string, string>} files  Map of repo-relative path -> file content.
 */
export function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdme-cli-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

export function rmRepo(root) {
  fs.rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Step 3: Write the smoke test**

Create `test/smoke.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, rmRepo } from './helpers.js';

test('makeRepo writes files and rmRepo cleans up', () => {
  const root = makeRepo({ 'docs/a.md': 'hello' });
  assert.equal(fs.readFileSync(path.join(root, 'docs/a.md'), 'utf-8'), 'hello');
  rmRepo(root);
  assert.equal(fs.existsSync(root), false);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — `smoke.test.js` reports 1 passing test, exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json test/helpers.js test/smoke.test.js
git commit -m "test: add node:test harness and temp-repo helper"
```

---

### Task 2: Item 3 — scope duplicate slugs per section

**Files:**
- Modify: `src/validators/duplicates.js`
- Test: `test/duplicates.test.js`

**Interfaces:**
- Consumes: `validateAll(files: string[]) → results[] | null` (signature unchanged).

- [ ] **Step 1: Write the failing test**

Create `test/duplicates.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAll } from '../src/validators/duplicates.js';

test('same slug across docs and reference is allowed', () => {
  const res = validateAll(['docs/intro.md', 'reference/intro.md']);
  assert.equal(res, null);
});

test('same slug within docs (different subdirs) is flagged', () => {
  const res = validateAll(['docs/a/intro.md', 'docs/b/intro.md']);
  assert.ok(Array.isArray(res) && res.length >= 1);
  assert.match(res[0].message, /Duplicate slug: "intro"/);
  assert.equal(res[0].severity, 'error');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/duplicates.test.js`
Expected: FAIL — "same slug across docs and reference is allowed" fails because the current global slug map flags `intro` across the two dirs.

- [ ] **Step 3: Implement the change**

In `src/validators/duplicates.js`, change the grouping to key by `<topDir>:<slug>` and derive the slug back out in the report loop. Replace the body of `validateAll`:

```js
export function validateAll(files) {
  const results = [];

  // Group files by "<topDir>:<slug>" so slugs only collide within the same section.
  const slugMap = new Map();
  for (const relPath of files) {
    const topDir = relPath.split('/')[0];
    if (!CHECKED_DIRS.includes(topDir)) continue;

    const filename = path.basename(relPath);
    if (filename === 'index.md' || filename === 'index.mdx') continue;

    const slug = filename.replace(/\.(md|mdx)$/, '');
    const key = `${topDir}:${slug}`;
    if (!slugMap.has(key)) slugMap.set(key, []);
    slugMap.get(key).push(relPath);
  }

  for (const [key, paths] of slugMap) {
    if (paths.length < 2) continue;

    // TODO: figure out why ReadMeConfig causes duplicate slugs and handle properly.
    // For now, skip any duplicate set that involves a ReadMeConfig path.
    if (paths.some((p) => p.includes('ReadMeConfig/'))) continue;

    const slug = key.slice(key.indexOf(':') + 1);
    const others = paths.slice(1);
    for (const relPath of others) {
      const otherLocations = paths.filter((p) => p !== relPath).map((p) => path.dirname(p)).join(', ');
      results.push({
        file: relPath,
        rule: name,
        severity: 'error',
        message: `Duplicate slug: "${slug}" also exists in ${otherLocations}`,
      });
    }
  }

  return results.length > 0 ? results : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/duplicates.test.js`
Expected: PASS — both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/validators/duplicates.js test/duplicates.test.js
git commit -m "fix(lint): scope duplicate slug check per top-level section"
```

---

### Task 3: Item 4 — unknown components become warnings

**Files:**
- Modify: `src/validators/components.js` (the `validateAll` unknown-component push)
- Test: `test/components.test.js`

**Interfaces:**
- Consumes: `validateAll(files: string[], gitRoot: string) → results[]` (signature unchanged).

- [ ] **Step 1: Write the failing test**

Create `test/components.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFiles } from '../src/utils/lint.js';
import { validateAll } from '../src/validators/components.js';
import { makeRepo, rmRepo } from './helpers.js';

test('unknown component is reported as a warning, not an error', () => {
  const root = makeRepo({
    'docs/page.md': '---\ntitle: Page\n---\n\n<ClosedBeta />\n',
  });
  try {
    const res = validateAll(collectFiles(root), root);
    const unknown = res.find((r) => r.message.includes('Unknown component'));
    assert.ok(unknown, 'expected an unknown-component result');
    assert.equal(unknown.severity, 'warning');
  } finally {
    rmRepo(root);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/components.test.js`
Expected: FAIL — `unknown.severity` is `undefined` (defaults to error), not `'warning'`.

- [ ] **Step 3: Implement the change**

In `src/validators/components.js`, inside `validateAll`, add `severity: 'warning'` to the unknown-component result:

```js
      if (!available.has(comp)) {
        results.push({
          file: relPath,
          rule: name,
          severity: 'warning',
          message: `Unknown component: <${comp}> is not a built-in or custom block`,
        });
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/components.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/validators/components.js test/components.test.js
git commit -m "fix(lint): downgrade unknown component to warning for global blocks"
```

---

### Task 4: Item 1a — `oas:sync` stops writing/updating title & excerpt

**Files:**
- Modify: `src/commands/oas-sync.js` (`buildPageContent`, `syncOneOas`, remove `isReadMeConfig`)
- Test: `test/oas-sync.test.js`

**Interfaces:**
- Consumes: `syncOas(gitRoot: string) → changes[] | null` (signature unchanged).
- Produces: generated reference `.md` files whose frontmatter contains only `api.file` + `api.operationId`.

- [ ] **Step 1: Write the failing test**

Create `test/oas-sync.test.js`:

```js
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
  } finally {
    rmRepo(root);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/oas-sync.test.js`
Expected: FAIL — first test fails (`title`/`excerpt` are written); second fails (sync overwrites title to "List pets").

- [ ] **Step 3: Simplify `buildPageContent`**

In `src/commands/oas-sync.js`, replace `buildPageContent`:

```js
function buildPageContent({ oasFilename, operationId }) {
  const frontmatter = {
    api: {
      file: oasFilename,
      operationId,
    },
  };

  return matter.stringify('', frontmatter);
}
```

- [ ] **Step 4: Remove the update branch and the `skipUpdates`/`isReadMeConfig` plumbing**

In `src/commands/oas-sync.js`, delete the `isReadMeConfig` function (lines defining it near the top) and rewrite `syncOneOas` so it only adds and deletes (no updates):

```js
function syncOneOas(refDir, oasFilename, spec) {
  const specOps = extractOperations(spec);
  const infoTitle = spec.info?.title || path.basename(oasFilename, path.extname(oasFilename));

  const existingPages = collectExistingPages(refDir).filter(
    (p) => p.data.api.file === oasFilename,
  );

  const pagesByOpId = new Map();
  for (const page of existingPages) {
    pagesByOpId.set(page.data.api.operationId, page);
  }

  const changes = { added: [], deleted: [], updated: [] };

  // Deletes: pages referencing operations that no longer exist.
  for (const [opId, page] of pagesByOpId) {
    if (!specOps.has(opId)) {
      fs.unlinkSync(page.filePath);

      const pageDir = path.dirname(page.filePath);
      const slug = path.basename(page.filePath, '.md');
      removeFromOrder(path.join(pageDir, '_order.yaml'), slug);

      changes.deleted.push(page.relativePath);
    }
  }

  // Adds: operations with no page yet. Title/excerpt are owned by the OAS spec
  // at render time, so generated pages carry only the api reference.
  for (const [opId, op] of specOps) {
    if (pagesByOpId.has(opId)) continue;

    const tag = op.tag || 'Other';
    const pageDir = path.join(refDir, infoTitle, tag);
    fs.mkdirSync(pageDir, { recursive: true });

    const pagePath = path.join(pageDir, `${opId}.md`);
    const content = buildPageContent({ oasFilename, operationId: opId });
    fs.writeFileSync(pagePath, content);

    addToOrder(path.join(pageDir, '_order.yaml'), opId);
    addToOrder(path.join(refDir, infoTitle, '_order.yaml'), tag);

    changes.added.push(path.relative(refDir, pagePath));
  }

  return changes;
}
```

> Note: `changes.updated` stays in the object (always empty now) so the `run()` summary code in this file is untouched.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/oas-sync.test.js`
Expected: PASS — both tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/commands/oas-sync.js test/oas-sync.test.js
git commit -m "fix(oas): stop writing/updating title & excerpt on reference pages"
```

---

### Task 5: Item 1b — frontmatter no longer requires `title` on api-backed reference pages

**Files:**
- Modify: `src/validators/frontmatter.js` (the schema-error loop in `validate`)
- Test: `test/frontmatter.test.js`

**Interfaces:**
- Consumes: `validate({ content, filePath, relativePath, fix }) → result | result[] | null` (signature unchanged).

- [ ] **Step 1: Write the failing test**

Create `test/frontmatter.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/validators/frontmatter.js';

function messages(result) {
  if (!result) return [];
  return (Array.isArray(result) ? result : [result]).map((r) => r.message);
}

test('reference page with api but no title is not flagged for missing title', () => {
  const content = '---\napi:\n  file: pets.json\n  operationId: listPets\n---\n';
  const result = validate({
    content,
    relativePath: 'reference/Pets/Other/listPets.md',
    filePath: '/tmp/listPets.md',
  });
  assert.ok(
    !messages(result).some((m) => m.includes("must have required property 'title'")),
    'missing-title error should be suppressed for api-backed reference pages',
  );
});

test('reference page WITHOUT api still requires title', () => {
  const content = '---\nexcerpt: just an excerpt\n---\n';
  const result = validate({
    content,
    relativePath: 'reference/loose.md',
    filePath: '/tmp/loose.md',
  });
  assert.ok(
    messages(result).some((m) => m.includes("must have required property 'title'")),
    'non-api reference pages should still require a title',
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/frontmatter.test.js`
Expected: FAIL — first test fails because the missing-title error is currently emitted for the api-backed page.

- [ ] **Step 3: Implement the suppression**

In `src/validators/frontmatter.js`, inside `validate`, add a guard at the top of the `for (const err of validateFn.errors)` loop (before the existing `if (err.keyword === 'not' ...)` block):

```js
      for (const err of validateFn.errors) {
        // Reference pages are OAS-backed: title/excerpt come from the spec, so a
        // missing title is not an error for pages that declare an api.file.
        if (
          dir === 'reference' &&
          data?.api?.file &&
          err.keyword === 'required' &&
          err.params?.missingProperty === 'title'
        ) {
          continue;
        }

        if (err.keyword === 'not' && err.schema?.properties) {
```

(The rest of the loop body is unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/frontmatter.test.js`
Expected: PASS — both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/validators/frontmatter.js test/frontmatter.test.js
git commit -m "fix(lint): don't require title on api-backed reference pages"
```

---

### Task 6: Item 1c — drop title/excerpt out-of-sync checks

**Files:**
- Modify: `src/validators/oas-reference.js` (remove the sync checks)
- Test: `test/oas-reference.test.js`

**Interfaces:**
- Consumes: `validateAll(files: string[], gitRoot: string, { fix }) → results[]` (signature unchanged).

- [ ] **Step 1: Write the failing test**

Create `test/oas-reference.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/oas-reference.test.js`
Expected: FAIL — first test fails because the title/excerpt out-of-sync warnings are still emitted.

- [ ] **Step 3: Remove the sync checks**

In `src/validators/oas-reference.js`, replace the per-page loop body so that after the operation-existence check it does nothing further. The full loop becomes:

```js
  for (const relPath of refPages) {
    const filePath = path.join(gitRoot, relPath);
    let data;
    try {
      ({ data } = matter(fs.readFileSync(filePath, 'utf-8')));
    } catch {
      continue;
    }

    if (!data.api || !data.api.file) continue;

    const oasFilename = data.api.file;
    const operationId = data.api.operationId;
    const oas = oasMap.get(oasFilename);

    // Check: OAS file doesn't exist.
    if (!oas) {
      results.push({
        file: relPath,
        rule: name,
        message: `OAS file not found: "${oasFilename}" does not exist in reference/`,
        fixable: false,
      });
      continue;
    }

    if (!operationId) continue;

    // Check: operationId doesn't exist in the spec.
    if (!oas.ops.has(operationId)) {
      results.push({
        file: relPath,
        rule: name,
        message: `Operation not found: "${operationId}" does not exist in "${oasFilename}"`,
        fixable: true,
      });
      continue;
    }

    // Title/excerpt are owned by the OAS spec at render time — no sync check here.
  }
```

(The `extractOperations`/`collectExistingPages` imports, the missing-page loop below, and the `fix` block are unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/oas-reference.test.js`
Expected: PASS — both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/validators/oas-reference.js test/oas-reference.test.js
git commit -m "fix(lint): drop title/excerpt out-of-sync checks for reference"
```

---

### Task 7: Item 5 — flag stale `_order.yaml` entries

**Files:**
- Modify: `src/validators/ordering.js` (full rewrite of `validateAll` plus two helpers)
- Test: `test/ordering.test.js`

**Interfaces:**
- Consumes: `validateAll(files: string[], gitRoot: string, { fix }) → results[]` (signature unchanged).

- [ ] **Step 1: Write the failing test**

Create `test/ordering.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collectFiles } from '../src/utils/lint.js';
import { validateAll } from '../src/validators/ordering.js';
import { makeRepo, rmRepo } from './helpers.js';

test('stale and index entries in _order.yaml are flagged', () => {
  const root = makeRepo({
    'docs/foo.md': '---\ntitle: Foo\n---\n',
    'docs/_order.yaml': '- foo\n- ghost\n- index\n',
  });
  try {
    const res = validateAll(collectFiles(root), root, {});
    assert.ok(res.some((r) => r.message.includes('Stale entry: "ghost"')), 'flags ghost');
    assert.ok(res.some((r) => r.message.includes('Invalid entry: "index"')), 'flags index');
    assert.ok(!res.some((r) => r.message.includes('foo')), 'does not flag valid foo');
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
    assert.equal(after, '- foo');
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
    assert.ok(res.some((r) => r.message.includes('Stale entry: "deleted-op"')));
  } finally {
    rmRepo(root);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/ordering.test.js`
Expected: FAIL — no "Stale entry"/"Invalid entry" results are produced today.

- [ ] **Step 3: Rewrite `ordering.js`**

Replace the entire contents of `src/validators/ordering.js`:

```js
import fs from 'node:fs';
import path from 'node:path';

export const name = 'ordering';

// Content directories where _order.yaml is expected (for the "missing from order" check).
const ORDERED_DIRS = ['docs', 'recipes', 'custom_pages'];

// Content directories scanned for stale _order.yaml entries.
const STALE_SCAN_DIRS = ['docs', 'reference', 'recipes', 'custom_pages'];

// Values that YAML interprets as non-strings and need quoting in _order.yaml.
const YAML_UNSAFE = /^(?:\d+\.?\d*|true|false|yes|no|on|off|null|~)$/i;
function yamlSafeSlug(slug) {
  return YAML_UNSAFE.test(slug) ? `"${slug}"` : slug;
}

function slugFromFile(filename) {
  return filename.replace(/\.(md|mdx)$/, '');
}

function parseOrderYaml(content) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim().replace(/^(['"])(.*)\1$/, '$2'));
}

// Recursively find every _order.yaml under a top-level content dir.
function findOrderFiles(gitRoot, dir) {
  const base = path.join(gitRoot, dir);
  if (!fs.existsSync(base)) return [];
  const found = [];
  const stack = [base];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === '_order.yaml') found.push(full);
    }
  }
  return found;
}

// True if `<dir>/<entry>` resolves to a page file or a subdirectory.
function entryExists(dir, entry) {
  if (fs.existsSync(path.join(dir, `${entry}.md`))) return true;
  if (fs.existsSync(path.join(dir, `${entry}.mdx`))) return true;
  const folder = path.join(dir, entry);
  return fs.existsSync(folder) && fs.statSync(folder).isDirectory();
}

export function validateAll(files, gitRoot, { fix } = {}) {
  const results = [];

  // ---- Check 1: files/subdirs missing FROM _order.yaml ----
  const dirContents = new Map();
  for (const relPath of files) {
    const topDir = relPath.split('/')[0];
    if (!ORDERED_DIRS.includes(topDir)) continue;

    const dir = path.dirname(relPath);
    if (!dirContents.has(dir)) dirContents.set(dir, { files: [], subdirs: new Set() });

    const filename = path.basename(relPath);
    dirContents.get(dir).files.push(filename);

    const parts = relPath.split('/');
    if (parts.length > 2) {
      const parentDir = parts.slice(0, -2).join('/');
      const subdir = parts[parts.length - 2];
      if (!dirContents.has(parentDir)) dirContents.set(parentDir, { files: [], subdirs: new Set() });
      dirContents.get(parentDir).subdirs.add(subdir);
    }
  }

  for (const [dir, { files: dirFiles, subdirs }] of dirContents) {
    const orderPath = path.join(gitRoot, dir, '_order.yaml');

    const expectedSlugs = [];
    for (const f of dirFiles) {
      if (f === 'index.md' || f === 'index.mdx') continue;
      expectedSlugs.push(slugFromFile(f));
    }
    for (const sub of subdirs) {
      expectedSlugs.push(sub);
    }

    if (!fs.existsSync(orderPath)) {
      if (expectedSlugs.length === 0) continue;

      results.push({
        file: path.join(dir, '_order.yaml'),
        rule: name,
        severity: 'warning',
        fixable: true,
        message: `Missing order: _order.yaml not found (${expectedSlugs.length} ${expectedSlugs.length === 1 ? 'entry needs' : 'entries need'} ordering)`,
        _fixAdd: { orderPath, missing: expectedSlugs },
      });
      continue;
    }

    const content = fs.readFileSync(orderPath, 'utf-8');
    const ordered = new Set(parseOrderYaml(content));
    const missing = expectedSlugs.filter((slug) => !ordered.has(slug));

    if (missing.length > 0) {
      results.push({
        file: path.join(dir, '_order.yaml'),
        rule: name,
        severity: 'warning',
        fixable: true,
        message: `Missing from _order.yaml: ${missing.join(', ')}`,
        _fixAdd: { orderPath, missing },
      });
    }
  }

  // ---- Check 2: entries present IN _order.yaml but absent on disk ----
  const seenOrderFiles = new Set();
  for (const dir of STALE_SCAN_DIRS) {
    for (const orderPath of findOrderFiles(gitRoot, dir)) {
      if (seenOrderFiles.has(orderPath)) continue;
      seenOrderFiles.add(orderPath);

      const orderDir = path.dirname(orderPath);
      const relOrder = path.relative(gitRoot, orderPath);
      const entries = parseOrderYaml(fs.readFileSync(orderPath, 'utf-8'));

      for (const entry of entries) {
        if (entry === 'index' || entry === 'index.md') {
          results.push({
            file: relOrder,
            rule: name,
            severity: 'warning',
            fixable: true,
            message: `Invalid entry: "${entry}" should not be listed in _order.yaml`,
            _fixRemove: { orderPath, entry },
          });
          continue;
        }
        if (!entryExists(orderDir, entry)) {
          results.push({
            file: relOrder,
            rule: name,
            severity: 'warning',
            fixable: true,
            message: `Stale entry: "${entry}" in _order.yaml has no matching file or folder`,
            _fixRemove: { orderPath, entry },
          });
        }
      }
    }
  }

  // ---- Apply fixes ----
  if (fix) {
    // Additions first.
    for (const r of results) {
      if (!r._fixAdd) continue;
      const { orderPath, missing } = r._fixAdd;
      const newEntries = missing.map((slug) => `- ${yamlSafeSlug(slug)}`).join('\n');

      if (fs.existsSync(orderPath)) {
        const existing = fs.readFileSync(orderPath, 'utf-8');
        const sep = existing.endsWith('\n') ? '' : '\n';
        fs.writeFileSync(orderPath, `${existing}${sep}${newEntries}\n`);
      } else {
        fs.mkdirSync(path.dirname(orderPath), { recursive: true });
        fs.writeFileSync(orderPath, `${newEntries}\n`);
      }
      r.message += ' (fixed)';
    }

    // Removals: group stale/index entries by order file, then rewrite each once.
    const removalsByPath = new Map();
    for (const r of results) {
      if (!r._fixRemove) continue;
      const { orderPath, entry } = r._fixRemove;
      if (!removalsByPath.has(orderPath)) removalsByPath.set(orderPath, new Set());
      removalsByPath.get(orderPath).add(entry);
    }
    for (const [orderPath, toRemove] of removalsByPath) {
      if (!fs.existsSync(orderPath)) continue;
      const kept = parseOrderYaml(fs.readFileSync(orderPath, 'utf-8')).filter((e) => !toRemove.has(e));
      if (kept.length > 0) {
        fs.writeFileSync(orderPath, kept.map((s) => `- ${yamlSafeSlug(s)}`).join('\n') + '\n');
      } else {
        fs.unlinkSync(orderPath);
      }
    }
    for (const r of results) {
      if (r._fixRemove) r.message += ' (fixed)';
    }
  }

  // Strip internal fix data before returning.
  for (const r of results) {
    delete r._fixAdd;
    delete r._fixRemove;
  }
  return results;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/ordering.test.js`
Expected: PASS — all three tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/validators/ordering.js test/ordering.test.js
git commit -m "feat(lint): flag stale and index entries in _order.yaml"
```

---

### Task 8: Item 2 — single-digit `-N` renames with redirect output

**Files:**
- Modify: `src/validators/numbering.js` (suffix regex, redirect generation, new option)
- Test: `test/numbering.test.js`

**Interfaces:**
- Consumes: `validateAll(files: string[], gitRoot: string, { fix, nonInteractive, redirectDir }) → results[] | null`.
- New option `redirectDir` (string, optional): directory for the redirect file. Defaults to `~/Desktop`. Used so tests don't write to the real Desktop.

- [ ] **Step 1: Write the failing test**

Create `test/numbering.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectFiles } from '../src/utils/lint.js';
import { validateAll } from '../src/validators/numbering.js';
import { makeRepo, rmRepo } from './helpers.js';

test('renames single-digit -N file and writes bidirectional redirects', async () => {
  const root = makeRepo({
    'docs/foo-1.md': '---\ntitle: Foo\n---\n',
    'docs/_order.yaml': '- foo-1\n',
  });
  const redirectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdme-redir-'));
  try {
    await validateAll(collectFiles(root), root, { fix: true, nonInteractive: true, redirectDir });

    assert.ok(fs.existsSync(path.join(root, 'docs/foo.md')), 'renamed to foo.md');
    assert.ok(!fs.existsSync(path.join(root, 'docs/foo-1.md')), 'old file gone');
    assert.equal(fs.readFileSync(path.join(root, 'docs/_order.yaml'), 'utf-8').trim(), '- foo');

    const redirect = fs.readFileSync(
      path.join(redirectDir, `${path.basename(root)}_redirect.txt`),
      'utf-8',
    );
    assert.match(redirect, /\/docs\/foo-1 -> \/docs\/foo/);
    assert.match(redirect, /\/reference\/foo-1 -> \/reference\/foo/);
  } finally {
    rmRepo(root);
    rmRepo(redirectDir);
  }
});

test('multi-digit suffix is not treated as unnecessary', async () => {
  const root = makeRepo({ 'docs/bar-12.md': '---\ntitle: Bar\n---\n' });
  try {
    const res = await validateAll(collectFiles(root), root, {});
    assert.equal(res, null);
  } finally {
    rmRepo(root);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/numbering.test.js`
Expected: FAIL — no redirect file is written today (and `bar-12` would currently be flagged, failing the second test).

- [ ] **Step 3: Update the suffix regex and `os` import**

In `src/validators/numbering.js`, add the `os` import and narrow the suffix regex:

```js
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import * as styles from '../utils/styles.js'

export const name = 'numbering'

// ReadMe auto-dedupes slugs with a single-digit suffix (foo, foo-1, foo-2…).
// Only those single-digit suffixes are treated as unnecessary.
const SUFFIX_RE = /-(\d)$/
```

- [ ] **Step 4: Update the signature and the rename/redirect block**

In `src/validators/numbering.js`, change the `validateAll` signature to accept `redirectDir`:

```js
export async function validateAll(files, gitRoot, { fix, nonInteractive, redirectDir } = {}) {
```

Then replace the interactive-rename block (the `if (fix && renames.length > 0) { ... }` section) with:

```js
  // Interactive rename when --fix is passed.
  if (fix && renames.length > 0) {
    console.log()
    console.log(`  The following will be renamed:`)
    for (const r of renames) {
      console.log(`    ${styles.dim(r.label)}`)
    }
    console.log()
    console.log(`  ${styles.warn('Note:')} Renaming changes slugs, which could break existing URLs.`)
    console.log()

    // assume yes if non-interactive, otherwise prompt for confirmation
    const answer = nonInteractive ? 'yes' : await prompt(`  Rename ${renames.length} ${renames.length === 1 ? 'path' : 'paths'}? (y/N) `)

    if (answer === 'y' || answer === 'yes') {
      // Sort longest path first so nested dirs get renamed before parents.
      renames.sort((a, b) => b.from.length - a.from.length)

      const redirectLines = []
      for (const r of renames) {
        fs.renameSync(r.from, r.to)
        updateOrderYaml(r.from, r.to)

        // Emit bidirectional redirects (docs + reference) for each renamed slug,
        // matching the bidi_remove_-1.js behavior from CX-3425.
        const oldSlug = path.basename(r.from).replace(/\.(md|mdx)$/, '')
        const newSlug = path.basename(r.to).replace(/\.(md|mdx)$/, '')
        redirectLines.push(`/docs/${oldSlug} -> /docs/${newSlug}`)
        redirectLines.push(`/reference/${oldSlug} -> /reference/${newSlug}`)
      }
      for (const r of results) {
        r.message += ' (fixed)'
      }

      if (redirectLines.length > 0) {
        const outDir = redirectDir || path.join(os.homedir(), 'Desktop')
        const redirectFile = path.join(outDir, `${path.basename(gitRoot)}_redirect.txt`)
        fs.mkdirSync(outDir, { recursive: true })
        fs.writeFileSync(redirectFile, redirectLines.join('\n') + '\n')
        console.log(`  ${styles.success('✔')} Redirects written to ${styles.dim(redirectFile)}`)
      }
    }
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/numbering.test.js`
Expected: PASS — both tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/validators/numbering.js test/numbering.test.js
git commit -m "feat(lint): single-digit -N renames emit bidirectional redirects"
```

---

### Task 9: Full suite, version bump, and end-to-end verification

**Files:**
- Modify: `package.json` (version)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — all test files pass, exit 0.

- [ ] **Step 2: Verify against the example repo**

Run (in a scratch directory):

```bash
git clone https://github.com/readme-internal-sync/production-lightcast-api-7a9ba2da223798f9c29a.git /tmp/cx3425-verify || echo "clone failed — verify manually with any reference-heavy repo"
cd /tmp/cx3425-verify 2>/dev/null && git checkout v1.0 2>/dev/null; node /Users/jyowell/cli/bin/readme.js lint
```

Expected: the previously-reported errors are gone — no `Invalid frontmatter: must have required property 'title'` and no `Out of sync: title…/excerpt…` for `reference/` Markdown; duplicate slugs shared across docs/reference are not flagged; `<ClosedBeta>`-style components appear as warnings, not errors; stale `_order.yaml` entries appear as warnings.

> If the repo is inaccessible (private/internal), verify against any reference-heavy ReadMe repo and note the limitation in the PR description.

- [ ] **Step 3: Bump the version**

In `package.json`, bump the version so a release can ship:

```json
  "version": "0.0.29",
```

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 0.0.29 for CX-3425 fixes"
```

---

## Self-Review

**Spec coverage:**
- Item 1 (reference OAS-owned): Task 4 (oas-sync stops writing/updating), Task 5 (frontmatter title not required), Task 6 (oas-reference sync checks removed). ✓
- Item 2 (`-1` renames + redirects): Task 8. ✓
- Item 3 (cross-section duplicates): Task 2. ✓
- Item 4 (unknown components → warning): Task 3. ✓
- Item 5 (stale `_order.yaml`, including index entries): Task 7. ✓
- Tests (`node:test`, `test/`): Task 1 + per-task tests. ✓
- E2E verification + version bump: Task 9. ✓

**Type/name consistency:** Result objects use `{ file, rule, message, severity?, fixable? }` throughout. `redirectDir` option added in Task 8 only. Internal `_fixAdd`/`_fixRemove` names are confined to Task 7's `ordering.js`. `makeRepo`/`rmRepo`/`collectFiles` used consistently across test files.

**Known limitations (documented, out of scope):** conflict-case redirects (base slug already exists) are not generated; `_order.yaml` removal rewrites re-stringify the file (normalizes quoting of untouched entries).
