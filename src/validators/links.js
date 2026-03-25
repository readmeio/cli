import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export const name = 'links';

const CHECKED_DIRS = ['docs', 'reference', 'custom_pages', 'recipes'];

// Match doc:slug and ref:slug links, e.g. [text](doc:my-page) or [text](ref:my-op#anchor)
const DOC_LINK_RE = /\((?:doc|ref):([a-zA-Z0-9_-]+)(?:#[^)]*)?\)/g;

function collectSlugs(gitRoot) {
  const slugs = new Set();

  for (const dir of CHECKED_DIRS) {
    const dirPath = path.join(gitRoot, dir);
    if (!fs.existsSync(dirPath)) continue;

    const entries = fs.readdirSync(dirPath, { recursive: true });
    for (const entry of entries) {
      if (!/\.(md|mdx)$/.test(entry)) continue;
      const filename = path.basename(entry);
      if (filename === 'index.md' || filename === 'index.mdx') {
        // index.md represents the parent directory, e.g. plans-and-pricing/index.md -> slug "plans-and-pricing"
        const parentDir = path.basename(path.dirname(entry));
        if (parentDir && parentDir !== '.') slugs.add(parentDir);
      } else {
        slugs.add(filename.replace(/\.(md|mdx)$/, ''));
      }
    }
  }

  return slugs;
}

export function validateAll(files, gitRoot) {
  const validSlugs = collectSlugs(gitRoot);
  const results = [];

  for (const relPath of files) {
    const topDir = relPath.split('/')[0];
    if (!CHECKED_DIRS.includes(topDir)) continue;
    if (!/\.(md|mdx)$/.test(relPath)) continue;

    let body;
    try {
      const raw = fs.readFileSync(path.join(gitRoot, relPath), 'utf-8');
      ({ content: body } = matter(raw));
    } catch {
      continue;
    }

    for (const match of body.matchAll(DOC_LINK_RE)) {
      const prefix = match[0].slice(1, match[0].indexOf(':'));
      const slug = match[1];
      if (!validSlugs.has(slug)) {
        results.push({
          file: relPath,
          rule: name,
          severity: 'error',
          message: `Broken link: "${prefix}:${slug}" does not match any page`,
        });
      }
    }
  }

  return results.length > 0 ? results : null;
}
