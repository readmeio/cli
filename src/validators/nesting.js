import path from 'node:path';

export const name = 'nesting';

// Max folder nesting per top-level content dir. Anything deeper still syncs
// but won't appear in the sidebar.
//
// For `docs` and `reference` the category is the first folder and each page
// level below it adds one, so this is the number of page levels the sidebar
// renders under a category. It mirrors our publicly documented sidebar levels.
// Keep in sync with src/dev/lib/docs.js.
const MAX_DEPTH = {
  docs: 5,
  reference: 5,
  recipes: 0,
  custom_pages: 0,
  custom_blocks: 0,
};

export function validateAll(files) {
  const results = [];
  const seen = new Set();

  for (const relPath of files) {
    const parts = relPath.split('/');
    const topDir = parts[0];
    const max = MAX_DEPTH[topDir];
    if (max === undefined) continue;

    // Depth = number of folders between the top dir and the file.
    // docs/a/b/c/d/e/page.md → parts.length 7 → depth 5
    // docs/a/b/c/d/e/f/page.md → parts.length 8 → depth 6
    const depth = parts.length - 2;
    if (depth <= max) continue;

    // Warn once per offending folder to avoid spamming every file inside it.
    const folderPath = parts.slice(0, -1).join('/');
    if (seen.has(folderPath)) continue;
    seen.add(folderPath);

    const message =
      max === 0
        ? `Folders not supported: "${folderPath}" — "${topDir}" files must live in the root directory`
        : `Too deeply nested: "${folderPath}" is ${depth} levels deep (only ${max} will render in the sidebar)`;

    results.push({
      file: folderPath,
      rule: name,
      severity: 'warning',
      message,
    });
  }

  return results.length > 0 ? results : null;
}
