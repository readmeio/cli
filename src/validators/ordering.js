import fs from 'node:fs';
import path from 'node:path';

export const name = 'ordering';

// Content directories where _order.yaml is expected.
const ORDERED_DIRS = ['docs', 'recipes', 'custom_pages'];

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

/**
 * Find all directories that contain content and check their _order.yaml.
 */
export function validateAll(files, gitRoot, { fix } = {}) {
  const results = [];

  // Group files by their immediate parent directory.
  const dirContents = new Map();
  for (const relPath of files) {
    const topDir = relPath.split('/')[0];
    if (!ORDERED_DIRS.includes(topDir)) continue;

    const dir = path.dirname(relPath);
    if (!dirContents.has(dir)) dirContents.set(dir, { files: [], subdirs: new Set() });

    const filename = path.basename(relPath);
    dirContents.get(dir).files.push(filename);

    // Track subdirectories in the parent so we know about categories/nested dirs.
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

    // Collect expected slugs: files (excluding index.md) + subdirectories.
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
        message: `Missing _order.yaml (${expectedSlugs.length} ${expectedSlugs.length === 1 ? 'entry needs' : 'entries need'} ordering)`,
        _fix: { orderPath, missing: expectedSlugs },
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
        _fix: { orderPath, missing },
      });
    }
  }

  // Apply fixes if requested.
  if (fix) {
    for (const r of results) {
      if (!r._fix) continue;
      const { orderPath, missing } = r._fix;
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
  }

  // Strip internal _fix data before returning.
  for (const r of results) delete r._fix;
  return results;
}
