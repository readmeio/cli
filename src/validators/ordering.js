import fs from 'node:fs';
import path from 'node:path';

export const name = 'ordering';

// Top-level content directories that use _order.yaml.
const CONTENT_DIRS = ['docs', 'reference', 'recipes', 'custom_pages'];

// Of those, the dirs that must list every page/folder. reference ordering is
// OAS-managed, so we never flag pages "missing from" a reference _order.yaml —
// but stale entries are flagged everywhere.
const REQUIRE_ORDER = new Set(['docs', 'recipes', 'custom_pages']);

// Values that YAML interprets as non-strings and need quoting in _order.yaml.
const YAML_UNSAFE = /^(?:\d+\.?\d*|true|false|yes|no|on|off|null|~)$/i;
function yamlSafeSlug(slug) {
  return YAML_UNSAFE.test(slug) ? `"${slug}"` : slug;
}

// Returns the slug a "- entry" line refers to, or null for any other line.
function parseOrderEntry(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('- ')) return null;
  return trimmed.slice(2).trim().replace(/^(['"])(.*)\1$/, '$2');
}

function parseOrderYaml(content) {
  return content
    .split('\n')
    .map(parseOrderEntry)
    .filter((entry) => entry !== null);
}

function isIndex(name) {
  return name === 'index' || name === 'index.md' || name === 'index.mdx';
}

/**
 * Walk a content directory tree once. For every directory, capture the on-disk
 * slug set (child pages + child folders) and its _order.yaml entries (or null
 * when absent), so the caller can diff the two in a single pass.
 */
function collectDirs(gitRoot, topDir) {
  const base = path.join(gitRoot, topDir);
  if (!fs.existsSync(base)) return [];

  const dirs = [];
  const stack = [base];
  while (stack.length) {
    const cur = stack.pop();
    const onDisk = new Set();
    let orderEntries = null;

    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        onDisk.add(entry.name);
        stack.push(path.join(cur, entry.name));
      } else if (entry.name === '_order.yaml') {
        orderEntries = parseOrderYaml(fs.readFileSync(path.join(cur, entry.name), 'utf-8'));
      } else if (/\.(md|mdx)$/.test(entry.name) && !isIndex(entry.name)) {
        onDisk.add(entry.name.replace(/\.(md|mdx)$/, ''));
      }
    }

    dirs.push({ dir: cur, onDisk, orderEntries });
  }
  return dirs;
}

/**
 * Validate every _order.yaml against the files and folders next to it:
 *   - on disk but missing from _order.yaml  → "Missing from _order.yaml" (required dirs only)
 *   - in _order.yaml but missing on disk     → "Stale entry"
 *   - an index entry that shouldn't be listed → "Invalid entry"
 */
export function validateAll(files, gitRoot, { fix } = {}) {
  const results = [];

  for (const topDir of CONTENT_DIRS) {
    const requireOrder = REQUIRE_ORDER.has(topDir);

    for (const { dir, onDisk, orderEntries } of collectDirs(gitRoot, topDir)) {
      const orderPath = path.join(dir, '_order.yaml');
      const relOrder = path.relative(gitRoot, orderPath);

      // No _order.yaml at all: only required dirs need one.
      if (orderEntries === null) {
        if (requireOrder && onDisk.size > 0) {
          const missing = [...onDisk].sort();
          results.push({
            file: relOrder,
            rule: name,
            severity: 'warning',
            fixable: true,
            message: `Missing order: _order.yaml not found (${missing.length} ${missing.length === 1 ? 'entry needs' : 'entries need'} ordering)`,
            _fixAdd: { orderPath, missing },
          });
        }
        continue;
      }

      const ordered = new Set(orderEntries);

      // On disk but not ordered.
      if (requireOrder) {
        const missing = [...onDisk].filter((slug) => !ordered.has(slug)).sort();
        if (missing.length > 0) {
          results.push({
            file: relOrder,
            rule: name,
            severity: 'warning',
            fixable: true,
            message: `Missing from _order.yaml: ${missing.join(', ')}`,
            _fixAdd: { orderPath, missing },
          });
        }
      }

      // Ordered but not on disk (or an index entry that shouldn't be listed).
      for (const entry of orderEntries) {
        if (isIndex(entry)) {
          results.push({
            file: relOrder,
            rule: name,
            severity: 'warning',
            fixable: true,
            message: `Invalid entry: "${entry}" should not be listed in _order.yaml`,
            _fixRemove: { orderPath, entry },
          });
        } else if (!onDisk.has(entry)) {
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

  if (!fix) return strip(results);

  // Additions: append missing slugs to the _order.yaml.
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
    // Drop only the targeted entry lines, keeping comments, blank lines, and
    // untouched entries exactly as written.
    const kept = fs
      .readFileSync(orderPath, 'utf-8')
      .split('\n')
      .filter((line) => {
        const entry = parseOrderEntry(line);
        return entry === null || !toRemove.has(entry);
      });
    if (kept.some((line) => parseOrderEntry(line) !== null)) {
      fs.writeFileSync(orderPath, kept.join('\n'));
    } else {
      fs.unlinkSync(orderPath);
    }
  }
  for (const r of results) {
    if (r._fixRemove) r.message += ' (fixed)';
  }

  return strip(results);
}

// Remove internal fix descriptors before returning results to the reporter.
function strip(results) {
  for (const r of results) {
    delete r._fixAdd;
    delete r._fixRemove;
  }
  return results;
}
