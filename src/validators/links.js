import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { slugForEntry } from '../utils/slug-for-entry.js';

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
      slugs.add(slugForEntry(entry));
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
