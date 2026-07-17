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
 * Returns a Map of operationId -> { summary, description, tag, operationId }.
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
    hidden: false,
  };

  return matter.stringify('', frontmatter);
}

/**
 * Build the category landing page for a tag (mirrors what the ReadMe platform
 * generates on OAS upload): title from the tag name, excerpt from the tag's
 * description in the spec's top-level `tags` array.
 */
function buildTagIndexContent(tagName, description) {
  const frontmatter = { title: tagName };
  if (description) frontmatter.excerpt = description;
  frontmatter.hidden = false;

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

      changes.deleted.push(page.relativePath);
    }
  }

  // Adds: operations with no page yet. Title/excerpt are owned by the OAS spec
  // at render time, so generated pages carry only the api reference. Slugs are
  // lowercased to match the platform's OAS-upload output.
  for (const [opId, op] of specOps) {
    if (pagesByOpId.has(opId)) continue;

    const rawTag = op.tag || 'Other';
    const tag = safeSegment(rawTag, 'Other');
    const slug = safeSegment(opId, 'operation').toLowerCase();
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

    // The tag's category landing page (index.md), like the platform generates
    // on upload. Never overwrite one that already exists.
    const indexPath = path.join(pageDir, 'index.md');
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(indexPath, buildTagIndexContent(rawTag, tagDescriptions.get(rawTag)));
      changes.added.push(path.relative(refDir, indexPath));
    }

    const content = buildPageContent({ oasFilename, operationId: opId });
    fs.writeFileSync(pagePath, content);

    addToOrder(path.join(pageDir, '_order.yaml'), slug);
    addToOrder(path.join(refDir, infoTitle, '_order.yaml'), tag);
    addToOrder(path.join(refDir, '_order.yaml'), infoTitle);

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
