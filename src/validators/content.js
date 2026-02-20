import matter from 'gray-matter';

export const name = 'content';

export function validate({ content, relativePath }) {
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
  if (trimmed.length === 0) {
    return {
      file: relativePath,
      rule: name,
      severity: 'warning',
      message: 'Empty page: non-hidden page has no content',
    };
  }

  return null;
}
