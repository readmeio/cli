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
 * Resolve the `x-internal` extension for an operation the way the platform
 * does on OAS upload: an operation-level value wins, falling back to the
 * spec root. `present` is false when neither sets it, in which case the
 * page's visibility is left to whoever owns it (new pages default to
 * visible, existing pages keep whatever `hidden` they already have).
 * `x-readme: { internal: true }` is deliberately not read — the platform's
 * page sync only honors the bare `x-internal` key.
 */
function resolveXInternal(operation, spec) {
  if (operation && 'x-internal' in operation) return { present: true, value: operation['x-internal'] };
  if (spec && 'x-internal' in spec) return { present: true, value: spec['x-internal'] };
  return { present: false, value: undefined };
}

/**
 * Find every `x-readme: { internal: ... }` in a spec. The `oas` package
 * documents it as an alternative spelling of `x-internal`, but the platform's
 * page sync never reads it (see `resolveXInternal`), so it silently has no
 * effect. Returns human-readable locations (`root`, `GET /pets`,
 * `webhook POST newPet`) for lint to warn about.
 */
export function findIgnoredInternalExtensions(spec) {
  const hasInternal = (obj) => {
    const xReadme = obj?.['x-readme'];
    return !!xReadme && typeof xReadme === 'object' && 'internal' in xReadme;
  };

  const locations = [];
  if (hasInternal(spec)) locations.push('root');

  for (const [entries, isWebhook] of [[spec?.paths, false], [spec?.webhooks, true]]) {
    for (const [name, rawItem] of Object.entries(entries || {})) {
      for (const [method, operation] of Object.entries(resolveLocalPathItemRef(rawItem, spec) || {})) {
        if (!HTTP_METHODS.has(method) || !hasInternal(operation)) continue;
        locations.push(`${isWebhook ? 'webhook ' : ''}${method.toUpperCase()} ${name}`);
      }
    }
  }
  return locations;
}

/**
 * Read a root-level ReadMe extension, in the same precedence as the `oas`
 * package's `getExtension()` with no operation: `x-readme.<name>`, then
 * `x-<name>`, then a bare `<name>`.
 */
function getRootExtension(spec, name) {
  const xReadme = spec?.['x-readme'];
  if (xReadme && typeof xReadme === 'object' && name in xReadme) return xReadme[name];
  if (spec && `x-${name}` in spec) return spec[`x-${name}`];
  return spec?.[name];
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
          // The platform groups by the first *non-empty* tag.
          tag: (Array.isArray(operation.tags) && operation.tags.find((t) => t)) || null,
          path: pathStr,
          isWebhook,
          xInternal: resolveXInternal(operation, spec),
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

function buildPageContent({ oasFilename, operationId, isWebhook, hidden = false }) {
  const frontmatter = {
    api: {
      file: oasFilename,
      operationId,
      // Marks the page as a webhook (the API calling out to the client)
      // rather than a path operation (the client calling the API), matching
      // what the platform stamps on a page generated from `webhooks`.
      ...(isWebhook ? { webhook: true } : {}),
    },
    // The backend does not infer visibility from a missing field, so it's
    // always written explicitly: `x-internal` when the spec sets it (see
    // `resolveXInternal`), otherwise `false` — mirroring the platform's
    // OAS-upload, which writes a new endpoint visible even when its tag and
    // siblings are hidden.
    hidden,
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
 * Kebab-case a folder segment: lowercase, with any run of whitespace or other
 * non-alphanumeric characters (a space, an underscore, ...) collapsed to a
 * single hyphen. Two roles: (1) as an equivalence key, so "Shipping Labels",
 * "shipping labels" and "shipping-labels" are recognized as the same
 * folder no matter which spelling is already on disk (see
 * `existingFoldersBySlug`); and (2) as the spelling used when *creating* a
 * folder that doesn't exist under any spelling yet, matching what a fresh
 * platform OAS-upload would produce. Neither spelling is the one "true"
 * form — this just needs one fixed spelling to create with and to compare
 * against.
 */
function slugifyFolder(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  if (op.tag) return { folder: slugifyFolder(safeSegment(op.tag, 'Other')) || 'other', title: op.tag };
  const folder = slugifyFolder(safeSegment(op.path.replace(/[/{}]/g, ''), 'operation')) || 'operation';
  return { folder, title: op.path };
}

/**
 * Map every existing directory directly under `apiDir` to its slugified
 * name (`slug -> actual on-disk name`), with a single directory read. Used
 * to resolve a group's folder: whatever spelling is already on disk
 * (hyphenated, space-separated, hand-authored, ...) is authoritative and
 * must be reused rather than spawning a second, differently-spelled folder
 * next to it. A slug with no entry here has nothing on disk yet, so the
 * caller falls back to creating it under its hyphenated slug — the spelling
 * a fresh platform OAS-upload would produce.
 */
function existingFoldersBySlug(apiDir) {
  const bySlug = new Map();
  let entries;
  try {
    entries = fs.readdirSync(apiDir, { withFileTypes: true });
  } catch {
    return bySlug; // apiDir doesn't exist yet — nothing to reuse.
  }
  for (const entry of entries) {
    if (entry.isDirectory()) bySlug.set(slugifyFolder(entry.name), entry.name);
  }
  return bySlug;
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
 * Rewrite a page's frontmatter in place, keeping its body. `mutate` receives
 * a copy of the parsed frontmatter and edits it. Returns true if the file
 * changed. A copy matters: gray-matter caches parse results by input string,
 * so mutating the returned `data` would poison later parses of that content.
 */
function updateFrontmatter(filePath, mutate) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = matter(content);
  const data = structuredClone(parsed.data);
  mutate(data);
  const next = parsed.content.trim()
    ? matter.stringify(parsed.content, data)
    : stringifyFrontmatter(data);
  if (next === content || JSON.stringify(data) === JSON.stringify(parsed.data)) return false;
  fs.writeFileSync(filePath, next);
  return true;
}

/**
 * Merge an OAS-derived slug order into an existing `_order.yaml` list, the
 * way the platform does (gitto's `applyOASOrder`): only the slots already
 * held by one of `orderedSlugs` are refilled, left to right, in OAS order;
 * every other entry (hand-authored pages, other APIs) keeps its position.
 * Slugs not yet listed are inserted right after the last refilled slot, or
 * appended when none of them are listed yet.
 */
export function applyOASOrder(currentOrder, orderedSlugs) {
  const desired = [...new Set(orderedSlugs)];
  const desiredSet = new Set(desired);
  // A hand-edited _order.yaml can list the same slug more than once. Collapse
  // duplicates up front so each slot corresponds to exactly one distinct slug;
  // otherwise there are more slots than slugs to refill them with, and the
  // surplus slots would be filled with `undefined`.
  const order = [...new Set(currentOrder)];
  if (!order.length) return desired;

  const slots = order.map((s, i) => (desiredSet.has(s) ? i : -1)).filter((i) => i > -1);
  if (!slots.length) return [...order, ...desired];

  const remaining = [...desired];
  for (const index of slots) order[index] = remaining.shift();
  if (remaining.length) order.splice(slots.at(-1) + 1, 0, ...remaining);
  return order;
}

const INDEX_FILES = ['index.md', 'index.mdx', 'index.html'];

/**
 * Whether a tag folder's category page looks untouched since it was
 * generated (mirrors gitto's `isAutoGeneratedParentPage`): no body, no
 * frontmatter beyond title/hidden/excerpt, a title that slugifies to the
 * folder name (allowing a `-N` uniqueness suffix), and an excerpt, if any,
 * that is text the spec supplies.
 *
 * The excerpt needs care. The platform never writes one, but this CLI stamps
 * the tag's description as `excerpt` on the pages it generates (see
 * `buildTagIndexContent`), so its presence alone can't mean "hand-edited".
 * Nothing records what a page was generated from, and by the time a folder
 * is being cleaned up its tag has often left the spec, so the excerpt can't
 * be checked against "its" tag either. What can be checked is whether the
 * current spec still supplies that exact text under *any* tag
 * (`specDescriptions`): a generated excerpt is always lifted from
 * `tags[].description`, and a retag that renames a tag usually keeps its
 * description, so this recognizes generated pages across the common rename.
 * An excerpt the spec no longer supplies could be a description that left
 * the spec, or a person's edit; with no way to tell them apart, the page is
 * reported as hand-edited and `cleanupTagFolder` flattens it rather than
 * deleting it. A stale page can be removed by hand; a deleted edit is gone.
 */
function isGeneratedTagIndex(indexPath, specDescriptions) {
  let parsed;
  try {
    parsed = matter(fs.readFileSync(indexPath, 'utf-8'));
  } catch {
    return false;
  }
  const { data, content } = parsed;
  if (content.trim()) return false;
  if (typeof data.title !== 'string' || !('hidden' in data)) return false;
  if (Object.keys(data).some((k) => !['title', 'hidden', 'excerpt'].includes(k))) return false;
  if ('excerpt' in data && !specDescriptions.has(data.excerpt)) return false;

  const dirSlug = slugifyFolder(path.basename(path.dirname(indexPath)));
  const titleSlug = slugifyFolder(data.title);
  return dirSlug === titleSlug || new RegExp(`^${titleSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(dirSlug);
}

/**
 * After `apply-tag-changes` moves pages out of a tag folder, clean up the
 * folder if it's now empty (gitto's `cleanupParentDirectory`). A generated
 * category page is deleted along with its folder; a hand-edited one is kept
 * by flattening `tag/index.md` into a sibling `tag.md` (same slug, so the
 * parent `_order.yaml` entry still applies).
 */
function cleanupTagFolder(dir, { refDir, specDescriptions, takenSlugs, changes }) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const others = entries.filter((e) => !INDEX_FILES.includes(e) && e !== '_order.yaml');
  if (others.length) return;

  const parentDir = path.dirname(dir);
  const slug = path.basename(dir);
  const indexFile = entries.find((e) => INDEX_FILES.includes(e));

  if (!indexFile || isGeneratedTagIndex(path.join(dir, indexFile), specDescriptions)) {
    fs.rmSync(dir, { recursive: true, force: true });
    removeFromOrder(path.join(parentDir, '_order.yaml'), slug);
    if (indexFile) {
      releaseSlug(takenSlugs, slug);
      changes.deleted.push(path.relative(refDir, path.join(dir, indexFile)));
    }
    return;
  }

  const from = path.join(dir, indexFile);
  const to = path.join(parentDir, `${slug}${path.extname(indexFile)}`);
  if (fs.existsSync(to)) return;
  fs.renameSync(from, to);
  fs.rmSync(dir, { recursive: true, force: true });
  changes.moved.push({ from: path.relative(refDir, from), to: path.relative(refDir, to) });
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

  // Hyphen vs. space in a group's folder name is not a meaningful difference
  // — "shipping-labels" and "shipping labels" are the same folder to a
  // human and to the platform, just spelled differently. One directory read
  // up front (existingFoldersBySlug) is enough to resolve every group's
  // folder for this API as an O(1) lookup, rather than walking apiDir again
  // for each distinct tag/group.
  const apiDir = path.join(refDir, infoTitle);
  const foldersBySlug = existingFoldersBySlug(apiDir);

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

  const changes = { added: [], deleted: [], moved: [], updated: [], skipped: [] };

  // Root-only opt-ins; only an explicit `true` counts, so a missing or
  // malformed value leaves existing placement and order alone.
  const applyTagChanges = getRootExtension(spec, 'apply-tag-changes') === true;
  const applyEndpointOrder = getRootExtension(spec, 'apply-endpoint-order') === true;

  // Tag descriptions from the spec's top-level `tags` array, used for the
  // per-tag category landing page (index.md).
  const tagDescriptions = new Map(
    (Array.isArray(spec.tags) ? spec.tags : [])
      .filter((t) => t && t.name)
      .map((t) => [t.name, t.description || null]),
  );
  // Every description the spec supplies, regardless of which tag: what an
  // emptied tag folder's excerpt is checked against (see `isGeneratedTagIndex`).
  const specDescriptions = new Set([...tagDescriptions.values()].filter(Boolean));

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
    .map((t) => slugifyFolder(safeSegment(t.name, 'Other')) || 'other');
  const orderedFolders = [
    ...declaredOrder.filter((folder) => groupsByFolder.has(folder)),
    ...[...groupsByFolder.keys()].filter((folder) => !declaredOrder.includes(folder)),
  ];

  const groupDirs = new Map();
  const createdIndexes = new Set();
  for (const folder of orderedFolders) {
    const { title, description } = groupsByFolder.get(folder);
    const actualFolder = foldersBySlug.get(folder) || folder;
    const pageDir = path.join(refDir, infoTitle, actualFolder);
    if (!isWithin(refDir, pageDir)) continue;
    groupDirs.set(folder, pageDir);

    const indexPath = path.join(pageDir, 'index.md');
    if (!fs.existsSync(indexPath)) {
      // Never overwrite an existing index.md — it may be a hand-written category.
      fs.mkdirSync(pageDir, { recursive: true });
      fs.writeFileSync(indexPath, buildTagIndexContent(title, description));
      changes.added.push(path.relative(refDir, indexPath));
      createdIndexes.add(indexPath);
      // The category page's slug is the folder name; reserve it so no operation
      // takes it. Only when just-created — an existing index.md was already
      // counted by collectReferenceSlugs's initial disk walk.
      takeSlug(takenSlugs, actualFolder);
    } else if (applyTagChanges) {
      // With `apply-tag-changes`, the spec owns the category page's title and
      // excerpt too (a tag with no description clears the excerpt). Its body
      // and any other frontmatter are the user's and are kept.
      const updated = updateFrontmatter(indexPath, (data) => {
        data.title = title;
        if (description) data.excerpt = description;
        else delete data.excerpt;
      });
      if (updated) changes.updated.push(path.relative(refDir, indexPath));
    }
    addToOrder(path.join(refDir, infoTitle, '_order.yaml'), actualFolder);
    addToOrder(path.join(refDir, '_order.yaml'), infoTitle);
  }

  // Where each of this spec's operations ends up this run, by operationKey.
  const opPaths = new Map();
  const vacatedDirs = new Set();

  // Existing pages: by default they stay wherever they are. Two opt-ins can
  // touch them: `x-internal` (visibility) and `apply-tag-changes` (placement).
  for (const [key, op] of specOps) {
    const page = pagesByOpId.get(key);
    if (!page) continue;
    let filePath = page.filePath;

    // `apply-tag-changes`: a page still inside this API's category follows
    // its tag's folder, even if it was hand-moved or nested elsewhere in the
    // category. A page moved to another category is the user's call and is
    // never touched. Legacy pages literally named index.md are left alone —
    // moving one would turn it into the destination folder's category page.
    const targetDir = groupDirs.get(operationGroup(op).folder);
    if (
      applyTagChanges &&
      targetDir &&
      isWithin(apiDir, filePath) &&
      path.basename(filePath) !== 'index.md' &&
      path.dirname(filePath) !== targetDir
    ) {
      const target = path.join(targetDir, path.basename(filePath));
      if (fs.existsSync(target)) {
        changes.skipped.push({ path: path.relative(refDir, target), operationId: op.operationId });
      } else {
        const fromDir = path.dirname(filePath);
        const slug = path.basename(filePath, '.md');
        fs.mkdirSync(targetDir, { recursive: true });
        fs.renameSync(filePath, target);
        removeFromOrder(path.join(fromDir, '_order.yaml'), slug);
        addToOrder(path.join(targetDir, '_order.yaml'), slug);
        vacatedDirs.add(fromDir);
        changes.moved.push({ from: page.relativePath, to: path.relative(refDir, target) });
        filePath = target;
      }
    }

    // `x-internal`, when the spec sets it (operation or root), decides the
    // page's visibility in both directions. When it's absent the page keeps
    // its own `hidden` — removing the extension never unhides a page.
    if (op.xInternal.present) {
      const hidden = Boolean(op.xInternal.value);
      const updated = updateFrontmatter(filePath, (data) => {
        data.hidden = hidden;
      });
      if (updated) changes.updated.push(path.relative(refDir, filePath));
    }

    opPaths.set(key, filePath);
  }

  // Adds: operation pages with no page yet. Title/excerpt are owned by the OAS
  // spec at render time, so generated pages carry only the api reference. Slugs
  // are lowercased to match the platform's OAS-upload output.
  for (const [key, op] of specOps) {
    if (pagesByOpId.has(key)) continue;

    const { folder } = operationGroup(op);
    const pageDir = path.join(refDir, infoTitle, foldersBySlug.get(folder) || folder);
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

    const content = buildPageContent({
      oasFilename,
      operationId: op.operationId,
      isWebhook: op.isWebhook,
      hidden: op.xInternal.present ? Boolean(op.xInternal.value) : false,
    });
    fs.writeFileSync(pagePath, content);

    addToOrder(path.join(pageDir, '_order.yaml'), slug);

    changes.added.push(path.relative(refDir, pagePath));
    opPaths.set(key, pagePath);
  }

  // `x-internal` on category pages: a folder whose operations are *all*
  // internal gets its category page hidden too. This only ever hides — a
  // category page is never unhidden by sync, so a manual `hidden: true`
  // survives. Mirroring the platform, a category page created this run
  // counts any truthy `x-internal`; an existing one needs an explicit `true`.
  const childrenByDir = new Map();
  for (const [key, filePath] of opPaths) {
    const dir = path.dirname(filePath);
    if (!childrenByDir.has(dir)) childrenByDir.set(dir, []);
    childrenByDir.get(dir).push(specOps.get(key).xInternal);
  }
  for (const [dir, children] of childrenByDir) {
    const indexPath = path.join(dir, 'index.md');
    if (!fs.existsSync(indexPath)) continue;
    const isNew = createdIndexes.has(indexPath);
    const allHidden = children.every((x) => x.present && (isNew ? Boolean(x.value) : x.value === true));
    if (!allHidden) continue;
    const updated = updateFrontmatter(indexPath, (data) => {
      data.hidden = true;
    });
    if (updated && !isNew) changes.updated.push(path.relative(refDir, indexPath));
  }

  // Tag folders emptied by `apply-tag-changes` moves. Never the API's own
  // category folder, and never a folder an operation still lives in.
  for (const dir of vacatedDirs) {
    if (!isWithin(apiDir, dir) || childrenByDir.has(dir)) continue;
    cleanupTagFolder(dir, { refDir, specDescriptions, takenSlugs, changes });
  }

  // `apply-endpoint-order`: reorder each folder's operation pages to match
  // the order they're declared in the spec (paths, then webhooks). Only this
  // API's pages are reordered, and only among the `_order.yaml` slots they
  // already hold — other entries keep their place. Files never move.
  if (applyEndpointOrder) {
    const orderByDir = new Map();
    for (const key of specOps.keys()) {
      const filePath = opPaths.get(key);
      if (!filePath || !isWithin(apiDir, filePath)) continue;
      // A legacy page named index.md is ordered in its parent, by folder name.
      const isIndex = path.basename(filePath) === 'index.md';
      const dir = isIndex ? path.dirname(path.dirname(filePath)) : path.dirname(filePath);
      const slug = isIndex ? path.basename(path.dirname(filePath)) : path.basename(filePath, '.md');
      if (!orderByDir.has(dir)) orderByDir.set(dir, []);
      orderByDir.get(dir).push(slug);
    }
    for (const [dir, slugs] of orderByDir) {
      const orderPath = path.join(dir, '_order.yaml');
      const current = fs.existsSync(orderPath) ? parseOrderYaml(fs.readFileSync(orderPath, 'utf-8')) : [];
      const next = applyOASOrder(current, slugs);
      if (next.join('\n') === current.join('\n')) continue;
      writeOrderYaml(orderPath, next);
      changes.updated.push(path.relative(refDir, orderPath));
    }
  }

  // Two passes can each touch the same tag page in one run (`apply-tag-changes`
  // syncing its title/excerpt, then `x-internal` hiding it once every operation
  // in it is internal). Report each file once so the printed list and the
  // `updated-count` output reflect files, not writes.
  changes.updated = [...new Set(changes.updated)];

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
 *   changes: { added: string[], deleted: string[], moved: { from, to }[],
 *   updated: string[], skipped: { path, operationId }[] } }>}
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
 * @returns {{ totalAdded: number, totalDeleted: number, totalMoved: number,
 *   totalUpdated: number, totalSkipped: number,
 *   skipped: Array<{ filename: string, path: string, operationId: string }> }}
 */
export function printSyncResults(results) {
  let totalAdded = 0;
  let totalDeleted = 0;
  let totalMoved = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  const skipped = [];

  for (const { filename, spec, opCount, changes } of results) {
    const title = spec.info?.title || filename;
    const hasChanges =
      changes.added.length +
        changes.deleted.length +
        changes.moved.length +
        changes.updated.length +
        changes.skipped.length >
      0;

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
    for (const { from, to } of changes.moved) {
      console.log(`    ${styles.warn('→')} Moved ${from} to ${to}`);
    }
    for (const file of changes.updated) {
      console.log(`    ${styles.warn('~')} Updated ${file}`);
    }
    for (const { path: file, operationId } of changes.skipped) {
      console.log(
        `    ${styles.warn('!')} Skipped ${file} for "${operationId}" (destination already exists)`,
      );
      skipped.push({ filename, path: file, operationId });
    }

    totalAdded += changes.added.length;
    totalDeleted += changes.deleted.length;
    totalMoved += changes.moved.length;
    totalUpdated += changes.updated.length;
    totalSkipped += changes.skipped.length;
  }

  return { totalAdded, totalDeleted, totalMoved, totalUpdated, totalSkipped, skipped };
}

export async function run(_options, _cmd, ctx) {
  const { gitRoot } = ctx;
  const refDir = path.join(gitRoot, 'reference');

  if (!fs.existsSync(refDir)) {
    styles.error('No reference/ directory found.');
    writeGithubActionsOutputs({
      'added-count': '0',
      'deleted-count': '0',
      'moved-count': '0',
      'updated-count': '0',
      'skipped-count': '0',
      skipped: [],
      'has-errors': 'true',
    });
    process.exit(1);
  }

  const results = syncOas(gitRoot);

  if (!results) {
    styles.info('No OpenAPI spec files found in reference/.');
    writeGithubActionsOutputs({
      'added-count': '0',
      'deleted-count': '0',
      'moved-count': '0',
      'updated-count': '0',
      'skipped-count': '0',
      skipped: [],
      'has-errors': 'false',
    });
    return;
  }

  const { totalAdded, totalDeleted, totalMoved, totalUpdated, totalSkipped, skipped } =
    printSyncResults(results);

  console.log();
  const total = totalAdded + totalDeleted + totalMoved + totalUpdated;
  const extra = [
    totalMoved > 0 ? `${totalMoved} moved` : null,
    totalUpdated > 0 ? `${totalUpdated} updated` : null,
  ].filter(Boolean);
  const extraNote = extra.length ? `, ${extra.join(', ')}` : '';
  // A skip means a page couldn't be written where it should've gone — either
  // a spec-crafted path trying to escape reference/, or the destination
  // already existing in a way sync's own bookkeeping didn't expect. Neither
  // is something to quietly succeed past, so this fails the same way lint
  // and oas:validate already fail on a real problem, rather than leaving it
  // to whoever wraps this command in CI to notice and fail on it themselves.
  if (totalSkipped > 0) {
    const syncedNote = total > 0 ? ` (${totalAdded} added, ${totalDeleted} deleted${extraNote})` : '';
    styles.error(`${totalSkipped} ${totalSkipped === 1 ? 'page' : 'pages'} skipped${syncedNote} — see above for which, and why.`);
  } else if (total === 0) {
    styles.ok('Reference pages are already in sync.');
  } else {
    styles.ok(`Synced: ${totalAdded} added, ${totalDeleted} deleted${extraNote}.`);
  }

  writeGithubActionsOutputs({
    'added-count': String(totalAdded),
    'deleted-count': String(totalDeleted),
    'moved-count': String(totalMoved),
    'updated-count': String(totalUpdated),
    'skipped-count': String(totalSkipped),
    skipped,
    'has-errors': String(totalSkipped > 0),
  });

  if (totalSkipped > 0) {
    process.exit(1);
  }
}
