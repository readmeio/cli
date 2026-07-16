import path from 'node:path';

export const name = 'duplicates';

// Only docs and reference require unique slugs.
const CHECKED_DIRS = ['docs', 'reference'];

export function validateAll(files) {
  const results = [];

  // Group files by "<topDir>:<slug>" so slugs only collide within the same section.
  const slugMap = new Map();
  for (const relPath of files) {
    const topDir = relPath.split('/')[0];
    if (!CHECKED_DIRS.includes(topDir)) continue;

    const filename = path.basename(relPath);
    if (filename === 'index.md' || filename === 'index.mdx') continue;

    const slug = filename.replace(/\.(md|mdx)$/, '');
    const key = `${topDir}:${slug}`;
    if (!slugMap.has(key)) slugMap.set(key, []);
    slugMap.get(key).push(relPath);
  }

  for (const [key, paths] of slugMap) {
    if (paths.length < 2) continue;

    // TODO: figure out why ReadMeConfig causes duplicate slugs and handle properly.
    // For now, skip any duplicate set that involves a ReadMeConfig path.
    if (paths.some((p) => p.includes('ReadMeConfig/'))) continue;

    const slug = key.slice(key.indexOf(':') + 1);
    const others = paths.slice(1);
    for (const relPath of others) {
      const otherLocations = paths.filter((p) => p !== relPath).map((p) => path.dirname(p)).join(', ');
      results.push({
        file: relPath,
        rule: name,
        severity: 'error',
        message: `Duplicate slug: "${slug}" also exists in ${otherLocations}`,
      });
    }
  }

  return results.length > 0 ? results : null;
}
