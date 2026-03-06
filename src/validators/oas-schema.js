import fs from 'node:fs';
import path from 'node:path';
import OASNormalize from 'oas-normalize';
import { findOasFiles } from '../commands/oas-sync.js';

export const name = 'oas-schema';

/**
 * Walk a parsed spec and find $ref values that are malformed.
 * Valid internal refs start with "#/"; catches things like "#components/schemas/Foo".
 */
function findBadRefs(obj, pointer = '') {
  const issues = [];
  if (obj && typeof obj === 'object') {
    if (typeof obj.$ref === 'string') {
      const ref = obj.$ref;
      if (ref.startsWith('#') && !ref.startsWith('#/')) {
        issues.push({ path: pointer, ref });
      }
    }
    for (const [key, value] of Object.entries(obj)) {
      if (key === '$ref') continue;
      issues.push(...findBadRefs(value, `${pointer}/${key}`));
    }
  }
  return issues;
}

export async function validateAll(files, gitRoot) {
  const refDir = path.join(gitRoot, 'reference');
  if (!fs.existsSync(refDir)) return [];

  const oasFiles = findOasFiles(refDir);
  const results = [];

  for (const { filename, spec } of oasFiles) {
    const filePath = path.join(refDir, filename);
    const raw = fs.readFileSync(filePath, 'utf-8');

    try {
      const normalizer = new OASNormalize(raw, { enablePaths: false });
      const result = await normalizer.validate({
        shouldThrowIfInvalid: false,
        parser: {
          validate: {
            rules: {
              openapi: {
                'array-without-items': 'warning',
                'duplicate-non-request-body-parameters': 'warning',
                'duplicate-operation-id': 'warning',
                'non-optional-path-parameters': 'warning',
                'path-parameters-not-in-parameters': 'warning',
                'path-parameters-not-in-path': 'warning',
              },
              swagger: {
                'array-without-items': 'warning',
                'duplicate-non-request-body-parameters': 'warning',
                'duplicate-operation-id': 'warning',
                'non-optional-path-parameters': 'warning',
                'path-parameters-not-in-parameters': 'warning',
                'path-parameters-not-in-path': 'warning',
                'unknown-required-schema-property': 'warning',
              },
            },
          },
        },
      });

      if (!result.valid) {
        for (const err of result.errors) {
          results.push({
            file: `reference/${filename}`,
            rule: name,
            message: err.message,
          });
        }
      }

      for (const warn of result.warnings) {
        results.push({
          file: `reference/${filename}`,
          rule: name,
          severity: 'warning',
          message: warn.message,
        });
      }
    } catch (err) {
      results.push({
        file: `reference/${filename}`,
        rule: name,
        message: err.message || String(err),
      });
    }

    // Check for malformed $ref pointers (oas-normalize doesn't catch these).
    for (const { path: refPath, ref } of findBadRefs(spec)) {
      results.push({
        file: `reference/${filename}`,
        rule: name,
        message: `Malformed $ref: "${ref}" at ${refPath} (should start with "#/")`,
      });
    }
  }

  return results;
}
