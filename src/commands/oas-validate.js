import fs from 'node:fs';
import path from 'node:path';
import OASNormalize from 'oas-normalize';
import { findOasFiles, extractOperations } from './oas-sync.js';
import * as styles from '../utils/styles.js';

export const command = 'oas:validate';
export const order = 3;
export const description = 'Validate OpenAPI spec files';

export function args(cmd) {
  cmd.option('--dereference', 'Also dereference all $ref pointers (matches ReadMe server validation)');
}

/**
 * Walk a parsed spec object and find $ref values that look malformed.
 * Valid internal refs start with "#/", valid external refs don't start with "#".
 * Catches things like "#components/schemas/Foo" (missing the slash after #).
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

const RULES = {
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
};

/**
 * Validate all OAS files in reference/ and print results.
 * Returns { totalErrors, totalWarnings, totalValid, fileCount } or null if no specs found.
 */
export async function validateOasFiles(gitRoot, { dereference = false } = {}) {
  const refDir = path.join(gitRoot, 'reference');
  if (!fs.existsSync(refDir)) return null;

  const oasFiles = findOasFiles(refDir);
  if (oasFiles.length === 0) return null;

  let totalErrors = 0;
  let totalWarnings = 0;
  let totalValid = 0;

  for (const { filename, spec } of oasFiles) {
    const filePath = path.join(refDir, filename);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const title = spec.info?.title || filename;
    const version = spec.openapi || spec.swagger || 'unknown';
    const opCount = extractOperations(spec).size;
    const meta = `${filename} · ${version} · ${opCount} ${opCount === 1 ? 'endpoint' : 'endpoints'}`;

    let result;
    try {
      const normalizer = new OASNormalize(raw, { enablePaths: false });
      result = await normalizer.validate({
        shouldThrowIfInvalid: false,
        parser: { validate: { rules: RULES } },
      });
    } catch (err) {
      totalErrors++;
      console.log();
      console.log(`  ${styles.err('●')} ${styles.bold(title)} ${styles.dim(`(${meta})`)}`);
      console.log(`    ${styles.err('✘')} ${err.message || String(err)}`);
      continue;
    }

    const errors = result.valid ? [] : (result.errors || []);
    const warnings = result.warnings || [];

    // Try dereferencing all $ref pointers (this is what ReadMe's server does).
    if (dereference) {
      try {
        const normalizer = new OASNormalize(raw, { enablePaths: false });
        await normalizer.deref();
      } catch (err) {
        const msg = err.message || String(err);
        errors.push({ message: `Dereference failed: ${msg}` });
      }
    }

    // Check for malformed $ref pointers (oas-normalize doesn't catch these).
    const badRefs = findBadRefs(spec);
    for (const { path: refPath, ref } of badRefs) {
      errors.push({ message: `Malformed $ref: "${ref}" at ${refPath} (should start with "#/")` });
    }

    totalErrors += errors.length;
    totalWarnings += warnings.length;
    if (errors.length === 0) totalValid++;

    const dot = errors.length > 0
      ? styles.err('●')
      : warnings.length > 0 ? styles.warn('●') : styles.success('●');

    console.log();
    console.log(`  ${dot} ${styles.bold(title)} ${styles.dim(`(${meta})`)}`);

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`    ${styles.success('Valid')}`);
      continue;
    }

    for (const e of errors) {
      console.log(`    ${styles.err('✘')} ${e.message}`);
    }
    for (const w of warnings) {
      console.log(`    ${styles.warn('⚠')} ${w.message}`);
    }
  }

  return { totalErrors, totalWarnings, totalValid, fileCount: oasFiles.length };
}

export async function run(options, _cmd, ctx) {
  const { gitRoot } = ctx;
  const refDir = path.join(gitRoot, 'reference');

  if (!fs.existsSync(refDir)) {
    styles.error('No reference/ directory found.');
    process.exit(1);
  }

  const result = await validateOasFiles(gitRoot, { dereference: options.dereference });

  if (!result) {
    styles.info('No OpenAPI spec files found in reference/.');
    return;
  }

  const { totalErrors, totalWarnings, totalValid, fileCount } = result;

  console.log();
  if (totalErrors > 0) {
    const parts = [`${totalErrors} ${totalErrors === 1 ? 'error' : 'errors'}`];
    if (totalWarnings > 0) parts.push(`${totalWarnings} ${totalWarnings === 1 ? 'warning' : 'warnings'}`);
    styles.error(`${parts.join(' and ')} across ${fileCount} ${fileCount === 1 ? 'spec' : 'specs'}.`);
    process.exit(1);
  } else if (totalWarnings > 0) {
    styles.warning(`${totalValid} of ${fileCount} specs valid with ${totalWarnings} ${totalWarnings === 1 ? 'warning' : 'warnings'}.`);
  } else {
    styles.ok(`${fileCount} ${fileCount === 1 ? 'spec' : 'specs'} validated — all good!`);
  }
}
