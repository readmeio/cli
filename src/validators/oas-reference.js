import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {
  findOasFiles,
  extractOperations,
  collectExistingPages,
  syncOas,
  operationKey,
  findIgnoredInternalExtensions,
} from '../commands/oas-sync.js';

export const name = 'oas-reference';

export function validateAll(files, gitRoot, { fix } = {}) {
  const refDir = path.join(gitRoot, 'reference');
  if (!fs.existsSync(refDir)) return [];

  const oasFiles = findOasFiles(refDir);
  const results = [];

  // Build a map of OAS filename -> spec operations for quick lookup.
  const oasMap = new Map();
  for (const { filename, spec } of oasFiles) {
    oasMap.set(filename, { spec, ops: extractOperations(spec) });

    // Check: `x-readme.internal`, which ReadMe ignores for page visibility.
    for (const location of findIgnoredInternalExtensions(spec)) {
      results.push({
        file: `reference/${filename}`,
        rule: name,
        severity: 'warning',
        message: `"x-readme.internal" is ignored by ReadMe (${location}); use "x-internal" instead to hide pages`,
        fixable: false,
      });
    }
  }

  // Collect all reference pages with api frontmatter.
  const refPages = files.filter((f) => f.startsWith('reference/') && f.endsWith('.md'));

  for (const relPath of refPages) {
    const filePath = path.join(gitRoot, relPath);
    let data;
    try {
      ({ data } = matter(fs.readFileSync(filePath, 'utf-8')));
    } catch {
      continue;
    }

    if (!data.api || !data.api.file) continue;

    const oasFilename = data.api.file;
    const operationId = data.api.operationId;
    const isWebhook = !!data.api.webhook;
    const oas = oasMap.get(oasFilename);

    // Check: OAS file doesn't exist.
    if (!oas) {
      results.push({
        file: relPath,
        rule: name,
        message: `OAS file not found: "${oasFilename}" does not exist in reference/`,
        fixable: false,
      });
      continue;
    }

    if (!operationId) continue;

    // Check: operationId doesn't exist in the spec.
    if (!oas.ops.has(operationKey({ operationId, isWebhook }))) {
      results.push({
        file: relPath,
        rule: name,
        message: `Operation not found: "${operationId}" does not exist in "${oasFilename}"`,
        fixable: true,
      });
      continue;
    }

    // Title/excerpt are owned by the OAS spec at render time — no sync check here.
  }

  // Check for missing pages: operations in the spec with no corresponding page.
  const existingPages = collectExistingPages(refDir);
  for (const [oasFilename, { ops }] of oasMap) {
    const pagesForOas = existingPages.filter((p) => p.data.api.file === oasFilename);
    const coveredOps = new Set(
      pagesForOas.map((p) =>
        operationKey({ operationId: p.data.api.operationId, isWebhook: !!p.data.api.webhook }),
      ),
    );

    for (const op of ops.values()) {
      if (!coveredOps.has(operationKey(op))) {
        results.push({
          file: `reference/${oasFilename}`,
          rule: name,
          severity: 'warning',
          message: `Missing page: no reference page found for operation "${op.operationId}"`,
          fixable: true,
        });
      }
    }
  }

  // Apply fixes by running the full sync — but only when something reported
  // is actually fixable. The sync adds, deletes, moves, hides and reorders
  // reference files, which is far too much to do on the strength of an
  // unfixable warning (`x-readme.internal`, a page pointing at a missing spec).
  if (fix && results.some((r) => r.fixable)) {
    const syncResults = syncOas(gitRoot);
    if (syncResults) {
      for (const r of results) {
        if (r.fixable) r.message += ' (fixed)';
      }
    }
  }

  return results;
}
