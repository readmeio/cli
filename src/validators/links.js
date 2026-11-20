import fs from 'node:fs';
import path from 'node:path';

import { parseFrontmatter } from '../utils/markdown.js';
import { loadSections } from '../utils/sections.js';
import { slugForEntry } from '../utils/slug-for-entry.js';

export const name = 'links';

// Match doc:slug and ref:slug links, e.g. [text](doc:my-page) or [text](ref:my-op#anchor)
const DOC_LINK_RE = /\((?:doc|ref):([a-zA-Z0-9_-]+)(?:#[^)]*)?\)/g;

function collectSlugs(gitRoot, dirs) {
  const slugs = new Set();

  for (const dir of dirs) {
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

export function validateAll(files, gitRoot, { sections = loadSections(gitRoot) } = {}) {
  const checkedDirs = sections.directories();
  const validSlugs = collectSlugs(gitRoot, checkedDirs);
  const results = [];

  for (const relPath of files) {
    const topDir = relPath.split('/')[0];
    if (!checkedDirs.includes(topDir)) continue;
    if (!/\.(md|mdx)$/.test(relPath)) continue;

    const raw = fs.readFileSync(path.join(gitRoot, relPath), 'utf-8');
    const { content: body } = parseFrontmatter(raw);

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
