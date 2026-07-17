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
    const isIndex = filename === 'index.md' || filename === 'index.mdx';

    // A folder's index.md is a category page whose slug is the folder name, so
    // it competes for a slug just like a `<slug>.md` file does. Any other file's
    // slug is its own filename. Skip a section-root index (docs/index.md,
    // reference/index.md) — it has no competing leaf slug.
    let slug;
    if (isIndex) {
      const parent = path.basename(path.dirname(relPath));
      if (parent === topDir) continue;
      slug = parent;
    } else {
      slug = filename.replace(/\.(md|mdx)$/, '');
    }

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
