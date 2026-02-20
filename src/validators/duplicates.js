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

    // Never flag ReadMeConfig files for renaming — they have special names.
    // Sort so ReadMeConfig paths come first (treated as the canonical occurrence).
    const sorted = [...paths].sort((a, b) => {
      const aConfig = a.includes('ReadMeConfig/') ? 0 : 1;
      const bConfig = b.includes('ReadMeConfig/') ? 0 : 1;
      return aConfig - bConfig;
    });

    const others = sorted.slice(1);
    for (const relPath of others) {
      const otherLocations = sorted.filter((p) => p !== relPath).map((p) => path.dirname(p)).join(', ');
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
