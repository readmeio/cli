import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import matter from 'gray-matter';
import * as styles from '../utils/styles.js';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

export const command = 'oas:sync';
export const order = 2;
export const category = 'OAS Tooling';
export const description = 'Sync reference pages with OpenAPI specs';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);


/**
 * Find OAS files at the root of reference/ (JSON or YAML).
 */
export function findOasFiles(refDir) {
  const entries = fs.readdirSync(refDir);
  const oasFiles = [];

  for (const entry of entries) {
    if (!/\.(json|yaml|yml)$/i.test(entry)) continue;
    const filePath = path.join(refDir, entry);
    if (!fs.statSync(filePath).isFile()) continue;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = entry.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);

      if (parsed && (parsed.openapi || parsed.swagger)) {
        oasFiles.push({ filename: entry, spec: parsed });
      }
    } catch {
      // Skip files that can't be parsed.
    }
  }

  return oasFiles;
}

/**
 * Generate a synthetic operationId from the HTTP method and path.
 * Matches the algorithm used by the `oas` package for specs without operationIds.
 */
function generateOperationId(method, pathStr) {
  const sanitized = pathStr
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `${method.toLowerCase()}_${sanitized}`;
}

/**
 * JSON Pointer (`#/components/pathItems/Pets`, `#/paths/~1pets`) used by
 * OAS path-item and operation `$ref`s. `~1` / `~0` are the spec's escapes
 * for `/` and `~`.
 */
function decodeJsonPointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolvePointer(root, pointer) {
  if (pointer === '#' || pointer === '') return root;
  if (typeof pointer !== 'string' || !pointer.startsWith('#/')) return undefined;
  const parts = pointer.slice(2).split('/').map(decodeJsonPointerToken);
  let current = root;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    // Own keys only — `in` would treat `__proto__` / `constructor` as hits
    // and walk off the document into Object.prototype.
    if (!Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function ownSiblings(obj) {
  const siblings = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key !== '$ref') siblings[key] = value;
  }
  return siblings;
}

/**
 * Follow an internal `#/…` `$ref` (and chains of them). External/file refs
 * (`./paths/pets.yaml`) are left as-is so callers can treat them as unresolved.
 *
 * OAS 3.1 Path Item Objects may keep sibling fields next to `$ref`; those
 * overlay the resolved target (local keys win) instead of being dropped.
 * A `$ref` that lands on an array or scalar is a failed resolve — the
 * original object is kept so siblings stay visible and `$ref` still
 * trips the unresolved-delete guard.
 */
function resolveRefObject(root, obj, seen = new Set()) {
  if (!isPlainObject(obj) || typeof obj.$ref !== 'string') return obj;
  const ref = obj.$ref;
  const siblings = ownSiblings(obj);
  const hasSiblings = Object.keys(siblings).length > 0;

  if (!ref.startsWith('#/') || seen.has(ref)) return obj;
  seen.add(ref);
  const target = resolvePointer(root, ref);
  if (!isPlainObject(target)) return obj;
  const resolved = resolveRefObject(root, target, seen);
  if (!isPlainObject(resolved)) return obj;
  if (!hasSiblings) return resolved;
  return { ...resolved, ...siblings };
}

/**
 * True when following `$ref` (including chained pointers) still lands on a
 * `$ref` — external file, cycle, broken pointer, or `#/__proto__`-style miss.
 * A single hop that lands on `{ $ref: './other.yaml' }` is unresolved.
 */
function isUnresolvedRef(root, obj) {
  if (!obj || typeof obj !== 'object' || typeof obj.$ref !== 'string') return false;
  const resolved = resolveRefObject(root, obj);
  return !!(resolved && typeof resolved === 'object' && typeof resolved.$ref === 'string');
}

/**
 * True when `paths` still has a `$ref` we could not inline. Used to skip the
 * delete pass — missing operations after a failed resolve are "we couldn't
 * see the spec", not "the operation was removed".
 */
export function hasUnresolvedOperationRefs(spec) {
  for (const rawPathItem of Object.values(spec.paths || {})) {
    if (isUnresolvedRef(spec, rawPathItem)) return true;
    const pathItem = resolveRefObject(spec, rawPathItem);
    if (!isPlainObject(pathItem)) continue;
    for (const [method, rawOp] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (isUnresolvedRef(spec, rawOp)) return true;
    }
  }
  return false;
}

/**
 * Extract operations from an OAS spec.
 * Returns a Map of operationId -> { summary, description, tag, operationId }.
 * For operations without an operationId, a synthetic one is generated from the method and path.
 *
 * Path-item and operation `$ref`s that point inside the same document
 * (`#/components/pathItems/…`, `#/paths/~1pets`) are resolved first. OAS 3.1
 * `components.pathItems` is the documented way to reuse a path; walking the
 * raw `$ref` stub would report zero operations and `oas:sync` / `lint --fix`
 * would delete every matching reference page.
 */
export function extractOperations(spec) {
  const ops = new Map();
  const paths = spec.paths || {};

  for (const [pathStr, rawPathItem] of Object.entries(paths)) {
    const methods = resolveRefObject(spec, rawPathItem);
    if (!isPlainObject(methods)) continue;
    for (const [method, rawOperation] of Object.entries(methods)) {
      if (!HTTP_METHODS.has(method)) continue;

      const operation = resolveRefObject(spec, rawOperation);
      if (!isPlainObject(operation)) continue;
      // Still a $ref stub with no operationId — don't invent get_pets and
      // add a bogus empty page. The delete guard keeps existing pages.
      if (typeof operation.$ref === 'string' && !operation.operationId) continue;
      const operationId = operation.operationId || generateOperationId(method, pathStr);

      ops.set(operationId, {
        operationId,
        summary: operation.summary || null,
        description: operation.description || null,
        tag: (operation.tags && operation.tags[0]) || null,
      });
    }
  }

  return ops;
}

/**
 * Scan existing .md files under reference/ recursively and collect those
 * with api.file + api.operationId frontmatter.
 */
export function collectExistingPages(refDir) {
  const pages = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const { data } = matter(content);
          if (data.api && data.api.file && data.api.operationId) {
            pages.push({
              filePath: full,
              relativePath: path.relative(refDir, full),
              data,
              content,
            });
          }
        } catch {
          // Skip unparseable files.
        }
      }
    }
  }

  walk(refDir);
  return pages;
}

// Values that YAML interprets as non-strings and need quoting in _order.yaml.
const YAML_UNSAFE = /^(?:\d+\.?\d*|true|false|yes|no|on|off|null|~)$/i;
function yamlSafeSlug(slug) {
  return YAML_UNSAFE.test(slug) ? `"${slug}"` : slug;
}

function parseOrderYaml(content) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim().replace(/^["'](.+)["']$/, '$1'));
}

function writeOrderYaml(filePath, slugs) {
  const content = slugs.map((s) => `- ${yamlSafeSlug(s)}`).join('\n') + '\n';
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function addToOrder(orderPath, slug) {
  if (fs.existsSync(orderPath)) {
    const content = fs.readFileSync(orderPath, 'utf-8');
    const slugs = parseOrderYaml(content);
    if (!slugs.includes(slug)) {
      slugs.push(slug);
      writeOrderYaml(orderPath, slugs);
    }
  } else {
    writeOrderYaml(orderPath, [slug]);
  }
}

function removeFromOrder(orderPath, slug) {
  if (!fs.existsSync(orderPath)) return;
  const content = fs.readFileSync(orderPath, 'utf-8');
  const slugs = parseOrderYaml(content).filter((s) => s !== slug);
  if (slugs.length > 0) {
    writeOrderYaml(orderPath, slugs);
  } else {
    fs.unlinkSync(orderPath);
  }
}

/**
 * Spec-derived values (info.title, tags, operationIds) become directory and
 * file names. Collapse path separators and dot-only names into a single safe
 * segment so a crafted spec can't write outside reference/.
 */
function safeSegment(value, fallback) {
  const segment = String(value).replace(/[/\\]/g, '-').trim();
  return !segment || segment === '.' || segment === '..' ? fallback : segment;
}

function isWithin(baseDir, target) {
  const rel = path.relative(baseDir, target);
  return (
    rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
  );
}

function buildPageContent({ oasFilename, operationId }) {
  const frontmatter = {
    api: {
      file: oasFilename,
      operationId,
    },
  };

  return matter.stringify('', frontmatter);
}

/**
 * Run the sync for a single OAS file. Returns changes for that file.
 */
function syncOneOas(refDir, oasFilename, spec) {
  const specOps = extractOperations(spec);
  const infoTitle = safeSegment(
    spec.info?.title || path.basename(oasFilename, path.extname(oasFilename)),
    'api',
  );

  const existingPages = collectExistingPages(refDir).filter(
    (p) => p.data.api.file === oasFilename,
  );

  const pagesByOpId = new Map();
  for (const page of existingPages) {
    pagesByOpId.set(page.data.api.operationId, page);
  }

  const changes = { added: [], deleted: [], skipped: [] };
  // File $refs (and broken internal pointers) mean we cannot see the real
  // operation set. Deleting "missing" pages would wipe valid reference docs.
  const skipDeletes = hasUnresolvedOperationRefs(spec);

  // Deletes: pages referencing operations that no longer exist.
  for (const [opId, page] of pagesByOpId) {
    if (!specOps.has(opId)) {
      if (skipDeletes) continue;
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

    const tag = safeSegment(op.tag || 'Other', 'Other');
    const slug = safeSegment(opId, 'operation');
    const pageDir = path.join(refDir, infoTitle, tag);
    const pagePath = path.join(pageDir, `${slug}.md`);

    // Never overwrite an existing file: it belongs to a manual page, another
    // spec, or a different operation whose sanitized name collides with this
    // one. Skipping (rather than clobbering) keeps repeated syncs stable.
    if (!isWithin(refDir, pagePath) || fs.existsSync(pagePath)) {
      changes.skipped.push({ path: path.relative(refDir, pagePath), operationId: opId });
      continue;
    }
    fs.mkdirSync(pageDir, { recursive: true });

    const content = buildPageContent({ oasFilename, operationId: opId });
    fs.writeFileSync(pagePath, content);

    addToOrder(path.join(pageDir, '_order.yaml'), slug);
    addToOrder(path.join(refDir, infoTitle, '_order.yaml'), tag);

    changes.added.push(path.relative(refDir, pagePath));
  }

  return changes;
}

/**
 * Sync reference pages with the OpenAPI spec(s) under `<gitRoot>/reference/`.
 *
 * Pure programmatic API: returns per-file change descriptors and prints
 * nothing. Used by the CLI command, the lint --fix flow, and external
 * callers.
 *
 * @param {string | { cwd?: string }} input  Repo root path, or `{ cwd }` object.
 * @returns {null | Array<{ filename: string, spec: object, opCount: number,
 *   changes: { added: string[], deleted: string[] } }>}
 *   Returns null if there's no reference/ dir or no specs.
 */
export function syncOas(input) {
  const gitRoot = typeof input === 'string' ? input : (input?.cwd || process.cwd());
  const refDir = path.join(gitRoot, 'reference');
  if (!fs.existsSync(refDir)) return null;

  const oasFiles = findOasFiles(refDir);
  if (oasFiles.length === 0) return null;

  const allChanges = [];

  for (const { filename, spec } of oasFiles) {
    const ops = extractOperations(spec);
    const changes = syncOneOas(refDir, filename, spec);
    allChanges.push({ filename, spec, opCount: ops.size, changes });
  }

  return allChanges;
}

export async function run(_options, _cmd, ctx) {
  const { gitRoot } = ctx;
  const refDir = path.join(gitRoot, 'reference');

  if (!fs.existsSync(refDir)) {
    styles.error('No reference/ directory found.');
    process.exit(1);
  }

  const results = syncOas(gitRoot);

  if (!results) {
    styles.info('No OpenAPI spec files found in reference/.');
    return;
  }

  let totalAdded = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;

  for (const { filename, spec, opCount, changes } of results) {
    const title = spec.info?.title || filename;
    const hasChanges =
      changes.added.length + changes.deleted.length + changes.skipped.length > 0;

    const dot = hasChanges ? styles.warn('●') : styles.success('●');
    console.log();
    console.log(`  ${dot} ${styles.bold(title)} ${styles.dim(`(${filename} · ${opCount} ${opCount === 1 ? 'endpoint' : 'endpoints'})`)}`);

    if (!hasChanges) {
      continue;
    }

    for (const file of changes.added) {
      console.log(`    ${styles.success('+')} Added ${file}`);
    }
    for (const file of changes.deleted) {
      console.log(`    ${styles.err('−')} Deleted ${file}`);
    }
    for (const { path: file, operationId } of changes.skipped) {
      console.log(
        `    ${styles.warn('!')} Skipped ${file} for "${operationId}" (destination already exists)`,
      );
    }

    totalAdded += changes.added.length;
    totalDeleted += changes.deleted.length;
    totalSkipped += changes.skipped.length;
  }

  console.log();
  const total = totalAdded + totalDeleted;
  const skippedNote = totalSkipped > 0 ? `, ${totalSkipped} skipped` : '';
  if (total === 0 && totalSkipped === 0) {
    styles.ok('Reference pages are already in sync.');
  } else if (total === 0) {
    styles.warning(`No pages synced; ${totalSkipped} skipped (destination already exists).`);
  } else {
    styles.ok(`Synced: ${totalAdded} added, ${totalDeleted} deleted${skippedNote}.`);
  }
}
