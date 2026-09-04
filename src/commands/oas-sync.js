import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import matter from 'gray-matter';
import * as styles from '../utils/styles.js';
import { writeGithubActionsOutputs } from '../utils/gha-output.js';

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
 * Identity key for an operation record (or an existing page's frontmatter),
 * used everywhere operations/pages are looked up by operationId. `paths` and
 * `webhooks` are separate namespaces in an OAS document, but both can have
 * operationId omitted, so their synthetic `<method>_<name>` ids can
 * legitimately collide (e.g. `POST /orders` and webhook `POST orders` both
 * synthesize to `post_orders`) — the isWebhook flag disambiguates them so
 * neither silently overwrites the other in an operationId-only Map.
 */
export function operationKey({ operationId, isWebhook }) {
  return `${isWebhook ? 'webhook' : 'path'}:${operationId}`;
}

/**
 * Resolve a `paths`/`webhooks` entry that's a Reference Object (OAS 3.1,
 * `{ $ref: '#/components/pathItems/Name' }`) against the spec's own
 * `components.pathItems`, following chained refs (a pathItem that is itself
 * a $ref to another) until a literal Path Item is reached. Only same-document
 * refs in that exact form are supported; anything else (external files,
 * other pointer shapes, an unresolvable name, or a cycle) is left unresolved
 * and quietly skipped by the caller, same as before this existed.
 */
function resolveLocalPathItemRef(entry, spec) {
  const seen = new Set();
  let current = entry;
  // Sibling fields (e.g. an inline operation) alongside a $ref are explicitly
  // allowed in an OAS 3.1 Path Item Object — accumulate them from every hop
  // in the chain so they aren't discarded once $ref is followed. A field
  // declared at an outer/earlier hop wins over the same field found deeper
  // in the chain (OAS itself leaves this "undefined" when both define it).
  let overrides = {};
  const finish = () => ({ ...current, ...overrides });

  while (current && typeof current.$ref === 'string') {
    const { $ref, ...siblings } = current;
    overrides = { ...siblings, ...overrides };

    if (seen.has(current.$ref)) return finish();
    seen.add(current.$ref);

    const match = current.$ref.match(/^#\/components\/pathItems\/(.+)$/);
    if (!match) return finish();

    let name;
    try {
      name = decodeURIComponent(match[1]).replace(/~1/g, '/').replace(/~0/g, '~');
    } catch {
      // Malformed percent-escape — leave unresolved rather than throwing and
      // aborting the whole sync/lint run over one bad $ref.
      return finish();
    }
    const resolved = spec.components?.pathItems?.[name];
    if (!resolved) return finish();

    current = resolved;
  }

  return finish();
}

/**
 * Extract operations from an OAS spec's `paths`, plus its OAS 3.1 `webhooks`
 * (callouts the API itself makes to a client-registered URL, not endpoints the
 * API exposes — a separate top-level sibling of `paths` with the same
 * Operation Object shape). The platform pages a webhook the same way it pages
 * a path operation: a synthetic `post_<name>` operationId when none is given,
 * grouped by its own tag or, absent one, its own category keyed by its raw
 * name — never merged with `paths` operations of the same name.
 * Returns a Map keyed by `operationKey()` -> { summary, description, tag,
 * path, operationId, isWebhook }. For operations without an operationId, a
 * synthetic one is generated from the method and path (or webhook name).
 */
export function extractOperations(spec) {
  const ops = new Map();

  function collect(entries, isWebhook) {
    for (const [pathStr, rawItem] of Object.entries(entries)) {
      const methods = resolveLocalPathItemRef(rawItem, spec);

      for (const [method, operation] of Object.entries(methods)) {
        if (!HTTP_METHODS.has(method)) continue;

        const operationId = operation.operationId || generateOperationId(method, pathStr);

        ops.set(operationKey({ operationId, isWebhook }), {
          operationId,
          summary: operation.summary || null,
          description: operation.description || null,
          tag: (operation.tags && operation.tags[0]) || null,
          path: pathStr,
          isWebhook,
        });
      }
    }
  }

  collect(spec.paths || {}, false);
  collect(spec.webhooks || {}, true);

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

/**
 * Render a frontmatter-only page. `matter.stringify` always appends a blank
 * body after the closing fence (even for an empty body); the platform's own
 * generated pages end immediately after the fence with no trailing newline,
 * so trim it to match.
 */
function stringifyFrontmatter(frontmatter) {
  return matter.stringify('', frontmatter).replace(/\n+$/, '');
}

function buildPageContent({ oasFilename, operationId, isWebhook }) {
  const frontmatter = {
    api: {
      file: oasFilename,
      operationId,
      // Marks the page as a webhook (the API calling out to the client)
      // rather than a path operation (the client calling the API), matching
      // what the platform stamps on a page generated from `webhooks`.
      ...(isWebhook ? { webhook: true } : {}),
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

  return stringifyFrontmatter(frontmatter);
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

  return stringifyFrontmatter(frontmatter);
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
  if (op.tag) return { folder: safeSegment(op.tag, 'Other').toLowerCase(), title: op.tag };
  const folder = safeSegment(op.path.replace(/[/{}]/g, ''), 'operation').toLowerCase();
  return { folder, title: op.path };
}

/**
 * Collect every slug already used across the entire reference/ tree, as a
 * lowercase-slug -> owner-count map. Reference page slugs share one flat
 * namespace (docs/ is a separate namespace and is not consulted), so a
 * generated operation slug must be unique against all of them. A page's slug
 * is its filename without `.md`; a category page's slug (a folder containing
 * `index.md`) is the folder name.
 *
 * A count, not a Set, because two existing pages or folders can already share
 * a slug (hand-authored content, or content that predates this uniqueness
 * logic) — a Set would collapse them to one entry, and releasing one owner
 * (see `releaseSlug`) would incorrectly free the slug while the other owner
 * still holds it.
 */
function collectReferenceSlugs(refDir) {
  const counts = new Map();

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
        takeSlug(counts, slug);
      }
    }
  }

  walk(refDir);
  return counts;
}

function isSlugTaken(takenSlugs, slug) {
  return (takenSlugs.get(slug.toLowerCase()) || 0) > 0;
}

/** Record one more owner of `slug`. */
function takeSlug(takenSlugs, slug) {
  const key = slug.toLowerCase();
  takenSlugs.set(key, (takenSlugs.get(key) || 0) + 1);
}

/** Record one fewer owner of `slug`; only fully frees it once every owner is gone. */
function releaseSlug(takenSlugs, slug) {
  const key = slug.toLowerCase();
  const remaining = (takenSlugs.get(key) || 0) - 1;
  if (remaining > 0) takenSlugs.set(key, remaining);
  else takenSlugs.delete(key);
}

/**
 * Reserve a unique reference slug. `index` is never usable by an operation (it's
 * reserved for the tag category page), and any slug already present in the
 * reference namespace gets a numeric suffix (`-1`, `-2`, ...) until it's free.
 * The chosen slug gains an owner in `takenSlugs` so later operations see it.
 */
function reserveSlug(takenSlugs, base) {
  let chosen = base;
  if (base === 'index' || isSlugTaken(takenSlugs, base)) {
    let n = 1;
    while (isSlugTaken(takenSlugs, `${base}-${n}`)) n += 1;
    chosen = `${base}-${n}`;
  }
  takeSlug(takenSlugs, chosen);
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
    pagesByOpId.set(
      operationKey({ operationId: page.data.api.operationId, isWebhook: !!page.data.api.webhook }),
      page,
    );
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
      // A legacy operation page can be literally named index.md (predating
      // the "index is reserved for the category page" convention). Two
      // different things need two different values here: pageSlug is what a
      // pre-refactor tool would have actually written into pageDir's own
      // _order.yaml ("index", the filename) — that's what removeFromOrder
      // must remove. referenceSlug is what the reference-wide slug map
      // reserved for it (its folder name, like any index.md — see
      // collectReferenceSlugs) — that's what releaseSlug must free.
      const isIndexPage = path.basename(page.filePath) === 'index.md';
      const pageSlug = path.basename(page.filePath, '.md');
      const referenceSlug = isIndexPage ? path.basename(pageDir) : pageSlug;
      removeFromOrder(path.join(pageDir, '_order.yaml'), pageSlug);
      releaseSlug(takenSlugs, referenceSlug);

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

  // Order groups the way the platform does: a tag keeps the position it's
  // declared in the spec's own top-level `tags` array, not the order its
  // operations happen to appear in `paths`. A group with no declared position
  // (an untagged path-derived group, or a tag used by an operation but never
  // listed in `tags`) keeps its natural encounter order, appended after every
  // declared tag.
  const declaredOrder = (Array.isArray(spec.tags) ? spec.tags : [])
    .filter((t) => t && t.name)
    .map((t) => safeSegment(t.name, 'Other').toLowerCase());
  const orderedFolders = [
    ...declaredOrder.filter((folder) => groupsByFolder.has(folder)),
    ...[...groupsByFolder.keys()].filter((folder) => !declaredOrder.includes(folder)),
  ];

  for (const folder of orderedFolders) {
    const { title, description } = groupsByFolder.get(folder);
    const pageDir = path.join(refDir, infoTitle, folder);
    if (!isWithin(refDir, pageDir)) continue;

    const indexPath = path.join(pageDir, 'index.md');
    if (!fs.existsSync(indexPath)) {
      // Never overwrite an existing index.md — it may be a hand-written category.
      fs.mkdirSync(pageDir, { recursive: true });
      fs.writeFileSync(indexPath, buildTagIndexContent(title, description));
      changes.added.push(path.relative(refDir, indexPath));
      // The category page's slug is the folder name; reserve it so no operation
      // takes it. Only when just-created — an existing index.md was already
      // counted by collectReferenceSlugs's initial disk walk.
      takeSlug(takenSlugs, folder);
    }
    addToOrder(path.join(refDir, infoTitle, '_order.yaml'), folder);
    addToOrder(path.join(refDir, '_order.yaml'), infoTitle);
  }

  // Adds: operation pages with no page yet. Title/excerpt are owned by the OAS
  // spec at render time, so generated pages carry only the api reference. Slugs
  // are lowercased to match the platform's OAS-upload output.
  for (const [key, op] of specOps) {
    if (pagesByOpId.has(key)) continue;

    const { folder } = operationGroup(op);
    const pageDir = path.join(refDir, infoTitle, folder);
    // Reference slugs share one flat namespace, so uniquify against every slug
    // already in reference/ — a collision (or the reserved `index` slug) gets a
    // numeric suffix rather than being skipped.
    const slug = reserveSlug(takenSlugs, safeSegment(op.operationId, 'operation').toLowerCase());
    const pagePath = path.join(pageDir, `${slug}.md`);

    // Guard against a spec-crafted name escaping reference/, or a stale slug set
    // vs. disk. reserveSlug already prevents slug collisions.
    if (!isWithin(refDir, pagePath) || fs.existsSync(pagePath)) {
      changes.skipped.push({ path: path.relative(refDir, pagePath), operationId: op.operationId });
      continue;
    }
    fs.mkdirSync(pageDir, { recursive: true });

    const content = buildPageContent({ oasFilename, operationId: op.operationId, isWebhook: op.isWebhook });
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

/**
 * Print sync results per spec and return aggregate totals (used by the CLI
 * command). Mirrors validateOasFiles in oas-validate.js: printing and
 * summarizing is a presentation concern kept separate from syncOas's pure
 * programmatic API above.
 *
 * @param {ReturnType<typeof syncOas>} results
 * @returns {{ totalAdded: number, totalDeleted: number, totalSkipped: number,
 *   skipped: Array<{ filename: string, path: string, operationId: string }> }}
 */
export function printSyncResults(results) {
  let totalAdded = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;
  const skipped = [];

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
      skipped.push({ filename, path: file, operationId });
    }

    totalAdded += changes.added.length;
    totalDeleted += changes.deleted.length;
    totalSkipped += changes.skipped.length;
  }

  return { totalAdded, totalDeleted, totalSkipped, skipped };
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
    writeGithubActionsOutputs({ 'added-count': '0', 'deleted-count': '0', 'skipped-count': '0', skipped: [] });
    return;
  }

  const { totalAdded, totalDeleted, totalSkipped, skipped } = printSyncResults(results);

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

  writeGithubActionsOutputs({
    'added-count': String(totalAdded),
    'deleted-count': String(totalDeleted),
    'skipped-count': String(totalSkipped),
    skipped,
  });
}
