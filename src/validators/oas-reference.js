import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { findOasFiles, extractOperations, collectExistingPages, syncOas } from '../commands/oas-sync.js';

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
    if (!oas.ops.has(operationId)) {
      results.push({
        file: relPath,
        rule: name,
        message: `Operation not found: "${operationId}" does not exist in "${oasFilename}"`,
        fixable: true,
      });
      continue;
    }

    // Skip title/excerpt sync checks for ReadMeConfig (internal ReadMe pages).
    // Check both the spec title and the page's directory path.
    const isReadMeConfig = oas.spec.info?.title === 'ReadMeConfig'
      || relPath.startsWith('reference/ReadMeConfig/');
    if (isReadMeConfig) continue;

    // Check: title or excerpt out of sync.
    const op = oas.ops.get(operationId);
    const expectedTitle = op.summary || operationId;
    const expectedExcerpt = op.description || null;

    if (data.title !== expectedTitle) {
      results.push({
        file: relPath,
        rule: name,
        severity: 'warning',
        message: `Out of sync: title is "${data.title}" but spec summary is "${expectedTitle}"`,
        fixable: true,
      });
    }

    const currentExcerpt = data.excerpt || null;
    if (currentExcerpt !== expectedExcerpt) {
      results.push({
        file: relPath,
        rule: name,
        severity: 'warning',
        message: `Out of sync: excerpt does not match spec description for "${operationId}"`,
        fixable: true,
      });
    }
  }

  // Check for missing pages: operations in the spec with no corresponding page.
  const existingPages = collectExistingPages(refDir);
  for (const [oasFilename, { ops }] of oasMap) {
    const pagesForOas = existingPages.filter((p) => p.data.api.file === oasFilename);
    const coveredOps = new Set(pagesForOas.map((p) => p.data.api.operationId));

    for (const [opId] of ops) {
      if (!coveredOps.has(opId)) {
        results.push({
          file: `reference/${oasFilename}`,
          rule: name,
          severity: 'warning',
          message: `Missing page: no reference page found for operation "${opId}"`,
          fixable: true,
        });
      }
    }
  }

  // Apply fixes by running the full sync.
  if (fix && results.length > 0) {
    const syncResults = syncOas(gitRoot);
    if (syncResults) {
      for (const r of results) {
        if (r.fixable) r.message += ' (fixed)';
      }
    }
  }

  return results;
}
