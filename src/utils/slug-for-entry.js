import path from 'node:path';

/**
 * Canonical slug for a git-format page path. `index.md`/`index.mdx` carries
 * its parent folder's slug (e.g. `docs/a/setup/index.md` → "setup", matching
 * how gitto slugs a folder from its index page); any other file is its
 * filename minus the extension. A root-level index file falls back to "index".
 */
export function slugForEntry(relPath) {
  const filename = path.basename(relPath);
  if (filename === 'index.md' || filename === 'index.mdx') {
    const parentDir = path.basename(path.dirname(relPath));
    return parentDir && parentDir !== '.' && parentDir !== path.sep ? parentDir : 'index';
  }
  return filename.replace(/\.(md|mdx)$/, '');
}
