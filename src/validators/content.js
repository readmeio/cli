import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export const name = 'content';

export function validate({ filePath, content, relativePath }) {
  const dir = relativePath.split('/')[0];
  if (!['docs', 'reference', 'custom_pages'].includes(dir)) return null;
  if (!relativePath.endsWith('.md')) return null;

  let data;
  let body;
  try {
    ({ data, content: body } = matter(content));
  } catch {
    return null;
  }

  if (data.hidden || data.deprecated) return null;
  if (data.api) return null;
  const trimmed = body.trim();

  if (data.link?.url) {
    if (trimmed.length > 0) {
      return {
        file: relativePath,
        rule: name,
        severity: 'warning',
        message: 'Redirect page has body content: pages with a link URL won\'t display their content',
      };
    }
    return null;
  }
  if (trimmed.length === 0) {
    // index.md files that act as parent pages (have child .md siblings) can be empty.
    if (path.basename(filePath) === 'index.md') {
      const siblings = fs.readdirSync(path.dirname(filePath));
      if (siblings.some((f) => f.endsWith('.md') && f !== 'index.md')) {
        return null;
      }
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
