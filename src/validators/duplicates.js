import path from 'node:path';

export const name = 'duplicates';

// Only docs and reference require unique slugs.
const CHECKED_DIRS = ['docs', 'reference'];

export function validateAll(files) {
  const results = [];

  // Group files by slug.
  const slugMap = new Map();
  for (const relPath of files) {
    const topDir = relPath.split('/')[0];
    if (!CHECKED_DIRS.includes(topDir)) continue;

    const filename = path.basename(relPath);
    if (filename === 'index.md' || filename === 'index.mdx') continue;

    const slug = filename.replace(/\.(md|mdx)$/, '');
    if (!slugMap.has(slug)) slugMap.set(slug, []);
    slugMap.get(slug).push(relPath);
  }

  for (const [slug, paths] of slugMap) {
    if (paths.length < 2) continue;

    // Report the duplicate on every file except the first occurrence.
    const others = paths.slice(1);
    for (const relPath of others) {
      const otherLocations = paths.filter((p) => p !== relPath).map((p) => path.dirname(p)).join(', ');
      results.push({
        file: relPath,
        rule: name,
        severity: 'error',
        message: `Duplicate slug "${slug}" — also exists in ${otherLocations}`,
      });
    }
  }

  return results.length > 0 ? results : null;
}
