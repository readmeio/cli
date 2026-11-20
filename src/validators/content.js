import fs from 'node:fs';
import path from 'node:path';

import { parseFrontmatter } from '../utils/markdown.js';
import { DEFAULT_SECTIONS } from '../utils/sections.js';

export const name = 'content';

// Kinds of section whose pages are expected to have a body.
const CHECKED_KINDS = ['guide', 'reference', 'custom_pages'];

export function validate({ filePath, content, relativePath, sections = DEFAULT_SECTIONS }) {
  const topDir = relativePath.split('/')[0];
  if (!CHECKED_KINDS.includes(sections.kindOf(topDir))) return null;
  if (!relativePath.endsWith('.md')) return null;

  const { data, content: body } = parseFrontmatter(content);

  if (data.hidden || data.deprecated) return null;
  if (data.api) return null;
  const trimmed = body.trim();

  if (data.link?.url) {
    if (trimmed.length > 0) {
      return {
        file: relativePath,
        rule: name,
        severity: 'warning',
        message: "Redirect page has body content: pages with a link URL won't display their content",
      };
    }
    return null;
  }
  if (trimmed.length === 0) {
    // index.md files that act as parent pages (have child page siblings or nested page
    // directories) can be empty. The backend accepts .md and .mdx in any case.
    if (path.basename(filePath) === 'index.md') {
      const dir = path.dirname(filePath);
      const isPage = f => /\.mdx?$/i.test(f);
      const hasChildren = fs
        .readdirSync(dir, { withFileTypes: true })
        .some(
          e =>
            (!e.isDirectory() && isPage(e.name) && !/^index\.mdx?$/i.test(e.name)) ||
            (e.isDirectory() && fs.readdirSync(path.join(dir, e.name)).some(isPage)),
        );
      if (hasChildren) return null;
    }

    return {
      file: relativePath,
      rule: name,
      severity: 'warning',
      message: 'Empty page: non-hidden page has no content',
    };
  }

  return null;
}
