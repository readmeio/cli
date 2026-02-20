import fs from 'node:fs';
import path from 'node:path';
import OASNormalize from 'oas-normalize';
import { findOasFiles } from '../commands/oas-sync.js';

export const name = 'oas-schema';

export async function validateAll(files, gitRoot) {
  const refDir = path.join(gitRoot, 'reference');
  if (!fs.existsSync(refDir)) return [];

  const oasFiles = findOasFiles(refDir);
  const results = [];

  for (const { filename } of oasFiles) {
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
  }

  return results;
}
