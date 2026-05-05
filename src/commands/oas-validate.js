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
 * Validate all OAS files under `<gitRoot>/reference/`. Pure programmatic API:
 * returns per-file results without printing or exiting.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.cwd]          Repo root (defaults to process.cwd()).
 * @param {boolean} [opts.dereference]  Also dereference $ref pointers (matches ReadMe server validation).
 * @returns {Promise<null | {
 *   fileCount: number,
 *   totalErrors: number,
 *   totalWarnings: number,
 *   totalValid: number,
 *   results: Array<{
 *     filename: string,
 *     title: string,
 *     version: string,
 *     opCount: number,
 *     errors: Array<{ message: string }>,
 *     warnings: Array<{ message: string }>,
 *     valid: boolean,
 *   }>,
 * }>}
 *   Returns null if there's no reference/ dir or no spec files.
 */
export async function validateOas({ cwd, dereference = false } = {}) {
  const gitRoot = cwd || process.cwd();
  const refDir = path.join(gitRoot, 'reference');
  if (!fs.existsSync(refDir)) return null;

  const oasFiles = findOasFiles(refDir);
  if (oasFiles.length === 0) return null;

  const results = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalValid = 0;

  for (const { filename, spec } of oasFiles) {
    const filePath = path.join(refDir, filename);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const title = spec.info?.title || filename;
    const version = spec.openapi || spec.swagger || 'unknown';
    const opCount = extractOperations(spec).size;

    let normalizerResult;
    try {
      const normalizer = new OASNormalize(raw, { enablePaths: false });
      normalizerResult = await normalizer.validate({
        shouldThrowIfInvalid: false,
        parser: { validate: { rules: RULES } },
      });
    } catch (err) {
      const errors = [{ message: err.message || String(err) }];
      results.push({ filename, title, version, opCount, errors, warnings: [], valid: false });
      totalErrors += 1;
      continue;
    }

    const errors = normalizerResult.valid ? [] : (normalizerResult.errors || []);
    const warnings = normalizerResult.warnings || [];

    if (dereference) {
      try {
        const normalizer = new OASNormalize(raw, { enablePaths: false });
        await normalizer.deref();
      } catch (err) {
        const msg = err.message || String(err);
        errors.push({ message: `Dereference failed: ${msg}` });
      }
    }

    // Catches malformed pointers like "#components/..." (missing slash) that
    // oas-normalize accepts.
    const badRefs = findBadRefs(spec);
    for (const { path: refPath, ref } of badRefs) {
      errors.push({ message: `Malformed $ref: "${ref}" at ${refPath} (should start with "#/")` });
    }

    totalErrors += errors.length;
    totalWarnings += warnings.length;
    const valid = errors.length === 0;
    if (valid) totalValid += 1;

    results.push({ filename, title, version, opCount, errors, warnings, valid });
  }

  return { fileCount: oasFiles.length, totalErrors, totalWarnings, totalValid, results };
}

/**
 * Validate OAS files and print results (used by the CLI command).
 * Returns the same aggregate shape `validateOas` does.
 *
 * @deprecated Prefer `validateOas` for programmatic use; this helper prints to
 * stdout. Kept exported for backward compatibility.
 */
export async function validateOasFiles(gitRoot, { dereference = false } = {}) {
  const summary = await validateOas({ cwd: gitRoot, dereference });
  if (!summary) return null;

  for (const r of summary.results) {
    const meta = `${r.filename} · ${r.version} · ${r.opCount} ${r.opCount === 1 ? 'endpoint' : 'endpoints'}`;
    const dot = r.errors.length > 0
      ? styles.err('●')
      : r.warnings.length > 0 ? styles.warn('●') : styles.success('●');

    console.log();
    console.log(`  ${dot} ${styles.bold(r.title)} ${styles.dim(`(${meta})`)}`);

    if (r.errors.length === 0 && r.warnings.length === 0) {
      console.log(`    ${styles.success('Valid')}`);
      continue;
    }
    for (const e of r.errors) console.log(`    ${styles.err('✘')} ${e.message}`);
    for (const w of r.warnings) console.log(`    ${styles.warn('⚠')} ${w.message}`);
  }

  const { totalErrors, totalWarnings, totalValid, fileCount } = summary;
  return { totalErrors, totalWarnings, totalValid, fileCount };
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
