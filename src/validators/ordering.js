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
  try {
    return fs.statSync(path.join(dir, entry)).isDirectory();
  } catch {
    return false;
  }
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
        if (entry === 'index' || entry === 'index.md' || entry === 'index.mdx') {
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
