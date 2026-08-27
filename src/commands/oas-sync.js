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
 * Extract operations from an OAS spec.
 * Returns a Map of operationId -> { summary, description, tag, path, operationId }.
 * For operations without an operationId, a synthetic one is generated from the method and path.
 */
export function extractOperations(spec) {
  const ops = new Map();
  const paths = spec.paths || {};

  for (const [pathStr, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!HTTP_METHODS.has(method)) continue;

      const operationId = operation.operationId || generateOperationId(method, pathStr);

      ops.set(operationId, {
        operationId,
        summary: operation.summary || null,
        description: operation.description || null,
        tag: (operation.tags && operation.tags[0]) || null,
        path: pathStr,
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
    // Mirror the platform's OAS-upload behavior: a newly added endpoint is
    // always written `hidden: false`, even when its tag and siblings are
    // `hidden: true`. The backend does not infer this from a missing field, so
    // it must be written explicitly.
    //
    // @todo Honor the `x-internal` OpenAPI extension for page visibility, to
    // match gitto#2095 (RM-4616 / CX-3303): resolve `hidden` from operation-level
    // `x-internal`, falling back to root-level, else false; and hide a tag's
    // index page when all of its operations are `x-internal: true`. Deferred to
    // keep oas:sync create-only — the resync-side rules (re-applying x-internal
    // to existing pages, parent hide-ratchet) would require mutating existing
    // pages, which this command intentionally never does.
    hidden: false,
  };

  return matter.stringify('', frontmatter);
}

/**
 * Build a category landing page (mirrors what the ReadMe platform generates on
 * OAS upload): `title` is the tag name for a tagged group, or the raw path for
 * an untagged path-derived group (see `operationGroup`); `excerpt`, when given,
 * is the tag's description from the spec's top-level `tags` array.
 */
function buildTagIndexContent(title, description) {
  const frontmatter = { title };
  if (description) frontmatter.excerpt = description;
  // As with operation pages, upload always stamps hidden: false on new pages.
  frontmatter.hidden = false;

  return matter.stringify('', frontmatter);
}

/**
 * The category-folder grouping for an operation. A tagged operation groups
 * under its own tag, as before. An untagged operation groups under a folder
 * derived from its path, with the raw path as the category page's title — one
 * folder per unique path, not a single shared bucket. This mirrors the
 * platform's own OAS-upload output: untagged operations are never lumped into
 * one "Other" folder.
 */
function operationGroup(op) {
  if (op.tag) return { folder: safeSegment(op.tag, 'Other'), title: op.tag };
  const folder = safeSegment(op.path.replace(/[/{}]/g, ''), 'operation').toLowerCase();
  return { folder, title: op.path };
}

/**
 * Collect every slug already used across the entire reference/ tree. Reference
 * page slugs share one flat namespace (docs/ is a separate namespace and is not
 * consulted), so a generated operation slug must be unique against all of them.
 * A page's slug is its filename without `.md`; a category page's slug (a folder
 * containing `index.md`) is the folder name. Comparison is case-insensitive.
 */
function collectReferenceSlugs(refDir) {
  const slugs = new Set();

  function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        // A folder's index.md contributes the folder name as a slug; any other
        // page contributes its own filename.
        const slug = entry === 'index.md' ? path.basename(dir) : path.basename(entry, '.md');
        slugs.add(slug.toLowerCase());
      }
    }
  }

  walk(refDir);
  return slugs;
}

/**
 * Reserve a unique reference slug. `index` is never usable by an operation (it's
 * reserved for the tag category page), and any slug already present in the
 * reference namespace gets a numeric suffix (`-1`, `-2`, ...) until it's free.
 * The chosen slug is added to `takenSlugs` so later operations see it.
 */
function reserveSlug(takenSlugs, base) {
  let chosen = base;
  if (base === 'index' || takenSlugs.has(base)) {
    let n = 1;
    while (takenSlugs.has(`${base}-${n}`)) n += 1;
    chosen = `${base}-${n}`;
  }
  takenSlugs.add(chosen);
  return chosen;
}

/**
 * Run the sync for a single OAS file. Returns changes for that file.
 *
 * `takenSlugs` is the reference-wide set of slugs already in use; it is read and
 * mutated so slugs stay unique across every spec processed in one sync run.
 */
function syncOneOas(refDir, oasFilename, spec, takenSlugs) {
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

  // Tag descriptions from the spec's top-level `tags` array, used for the
  // per-tag category landing page (index.md).
  const tagDescriptions = new Map(
    (Array.isArray(spec.tags) ? spec.tags : [])
      .filter((t) => t && t.name)
      .map((t) => [t.name, t.description || null]),
  );

  // Deletes: pages referencing operations that no longer exist.
  for (const [opId, page] of pagesByOpId) {
    if (!specOps.has(opId)) {
      fs.unlinkSync(page.filePath);

      const pageDir = path.dirname(page.filePath);
      const slug = path.basename(page.filePath, '.md');
      removeFromOrder(path.join(pageDir, '_order.yaml'), slug);
      takenSlugs.delete(slug.toLowerCase());

      changes.deleted.push(page.relativePath);
    }
  }

  // Ensure every group (a tag, or a path-derived bucket for untagged
  // operations) present in the spec has its category landing page (index.md)
  // and is ordered — independent of whether its operation pages are new. Doing
  // this as its own pass (rather than only when creating a new op page) backfills
  // category pages for references first synced by a CLI version that didn't
  // generate them, and recreates one that was deleted.
  const groupsByFolder = new Map();
  for (const op of specOps.values()) {
    const { folder, title } = operationGroup(op);
    if (!groupsByFolder.has(folder)) {
      groupsByFolder.set(folder, { title, description: op.tag ? tagDescriptions.get(op.tag) : null });
    }
  }
  for (const [folder, { title, description }] of groupsByFolder) {
    const pageDir = path.join(refDir, infoTitle, folder);
    if (!isWithin(refDir, pageDir)) continue;

    const indexPath = path.join(pageDir, 'index.md');
    if (!fs.existsSync(indexPath)) {
      // Never overwrite an existing index.md — it may be a hand-written category.
      fs.mkdirSync(pageDir, { recursive: true });
      fs.writeFileSync(indexPath, buildTagIndexContent(title, description));
      changes.added.push(path.relative(refDir, indexPath));
    }
    // The category page's slug is the folder name; reserve it so no operation
    // takes it. Ordering entries are idempotent, so this is a no-op when present.
    takenSlugs.add(folder.toLowerCase());
    addToOrder(path.join(refDir, infoTitle, '_order.yaml'), folder);
    addToOrder(path.join(refDir, '_order.yaml'), infoTitle);
  }

  // Adds: operation pages with no page yet. Title/excerpt are owned by the OAS
  // spec at render time, so generated pages carry only the api reference. Slugs
  // are lowercased to match the platform's OAS-upload output.
  for (const [opId, op] of specOps) {
    if (pagesByOpId.has(opId)) continue;

    const { folder } = operationGroup(op);
    const pageDir = path.join(refDir, infoTitle, folder);
    // Reference slugs share one flat namespace, so uniquify against every slug
    // already in reference/ — a collision (or the reserved `index` slug) gets a
    // numeric suffix rather than being skipped.
    const slug = reserveSlug(takenSlugs, safeSegment(opId, 'operation').toLowerCase());
    const pagePath = path.join(pageDir, `${slug}.md`);

    // Guard against a spec-crafted name escaping reference/, or a stale slug set
    // vs. disk. reserveSlug already prevents slug collisions.
    if (!isWithin(refDir, pagePath) || fs.existsSync(pagePath)) {
      changes.skipped.push({ path: path.relative(refDir, pagePath), operationId: opId });
      continue;
    }
    fs.mkdirSync(pageDir, { recursive: true });

    const content = buildPageContent({ oasFilename, operationId: opId });
    fs.writeFileSync(pagePath, content);

    addToOrder(path.join(pageDir, '_order.yaml'), slug);

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

  // Reference slugs share one flat namespace across every spec, so build the set
  // of in-use slugs once and let each spec read/extend it.
  const takenSlugs = collectReferenceSlugs(refDir);
  const allChanges = [];

  for (const { filename, spec } of oasFiles) {
    const ops = extractOperations(spec);
    const changes = syncOneOas(refDir, filename, spec, takenSlugs);
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
