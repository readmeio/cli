import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import matter from 'gray-matter';
import Ajv from 'ajv';

const require = createRequire(import.meta.url);

export const name = 'frontmatter';

function getNestedValue(obj, instancePath) {
  const keys = instancePath.split('/').filter(Boolean);
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

// Levenshtein distance between two strings.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Returns similarity ratio between 0 and 1.
function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

const TYPO_THRESHOLD = 0.7;

// Recursively collect all known property names from a schema, following $ref and allOf.
function collectPropertyNames(schema, defs) {
  const props = new Set();

  if (schema.properties) {
    for (const k of Object.keys(schema.properties)) props.add(k);
  }

  if (schema.$ref?.startsWith('#/defs/')) {
    const refSchema = defs[schema.$ref.slice('#/defs/'.length)];
    if (refSchema) {
      for (const k of collectPropertyNames(refSchema, defs)) props.add(k);
    }
  }

  if (schema.allOf) {
    for (const sub of schema.allOf) {
      for (const k of collectPropertyNames(sub, defs)) props.add(k);
    }
  }

  return props;
}

// Map directory names to their index in the schema's oneOf array.
const DIR_SCHEMA_INDEX = {
  docs: 0,
  custom_pages: 1,
  reference: 2,
  recipes: 3,
  custom_blocks: 4,
};

// Load the schema and compile a validator for each directory type.
const schemaPath = require.resolve('@readmeio/git-format/frontmatter.schema.json');
const fullSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

const ajv = new Ajv({ allErrors: true, strict: false, logger: false, verbose: true });

const validators = {};
const knownProperties = {};
for (const [dir, index] of Object.entries(DIR_SCHEMA_INDEX)) {
  const subSchema = { defs: fullSchema.defs, ...fullSchema.oneOf[index] };
  validators[dir] = ajv.compile(subSchema);
  knownProperties[dir] = collectPropertyNames(subSchema, fullSchema.defs);
}

export function validate({ content, filePath, relativePath, fix }) {
  // Step 1: Parse the frontmatter YAML.
  let data;
  try {
    ({ data } = matter(content));
  } catch (e) {
    return {
      file: relativePath,
      rule: name,
      message: `Invalid frontmatter: ${e.reason || e.message || 'unknown error'}`,
    };
  }

  const results = [];
  const dir = relativePath.split('/')[0];

  // Step 2: Validate the parsed frontmatter against the schema.
  const validateFn = validators[dir];
  if (validateFn) {
    const valid = validateFn(data);
    if (!valid) {
      for (const err of validateFn.errors) {
        // Reference pages are OAS-backed: title/excerpt come from the spec, so a
        // missing title is not an error for pages that declare an api.file.
        if (
          dir === 'reference' &&
          data?.api?.file &&
          err.keyword === 'required' &&
          err.params?.missingProperty === 'title'
        ) {
          continue;
        }

        if (err.keyword === 'not' && err.schema?.properties) {
          const target = err.instancePath ? getNestedValue(data, err.instancePath) : data;
          if (!target || !Object.keys(err.schema.properties).some((k) => k in target)) continue;
        }

        let msg;
        if (err.keyword === 'not' && err.schema?.description) {
          msg = err.schema.description;
        } else {
          // Convert JSON pointer paths (/foo/bar) to dot notation (foo.bar).
          const loc = err.instancePath ? err.instancePath.slice(1).replace(/\//g, '.') : '';
          msg = loc ? `"${loc}" ${err.message}` : err.message;
        }

        results.push({
          file: relativePath,
          rule: name,
          severity: 'error',
          message: `Invalid frontmatter: ${msg}`,
        });
      }
    }
  }

  // Step 3: Warn about unknown properties (allow x- prefix for custom metadata).
  const allowed = knownProperties[dir];
  const unknownKeys = [];
  if (allowed && data && typeof data === 'object') {
    for (const key of Object.keys(data)) {
      if (!allowed.has(key) && !key.startsWith('x-')) {
        unknownKeys.push(key);
        results.push({
          file: relativePath,
          rule: name,
          severity: 'warning',
          fixable: true,
          _key: key,
          message: `Unknown property: "${key}" is not a known frontmatter field (use x-${key} for custom metadata)`,
        });
      }
    }
  }

  // Step 4: Detect typos by comparing unknown properties against known ones.
  const missingRequired = results.filter(
    (r) => r.severity === 'error' && r.message.includes('must have required property'),
  );
  const unknowns = results.filter((r) => r._key);

  const consumed = new Set();

  // First pass: match unknowns to missing required properties (these become errors).
  for (const err of missingRequired) {
    const match = err.message.match(/must have required property '(\w+)'/);
    if (!match) continue;
    const required = match[1];

    let bestMatch = null;
    let bestScore = 0;
    for (const warn of unknowns) {
      if (consumed.has(warn)) continue;
      const score = similarity(required, warn._key);
      if (score >= TYPO_THRESHOLD && score > bestScore) {
        bestMatch = warn;
        bestScore = score;
      }
    }

    if (bestMatch) {
      consumed.add(bestMatch);
      err.message = `Invalid frontmatter: "${bestMatch._key}" is not a valid property — did you mean "${required}"?`;
    }
  }

  // Second pass: match remaining unknowns to any known property (these stay as warnings).
  const suggestedTypos = new Set();
  if (allowed) {
    for (const warn of unknowns) {
      if (consumed.has(warn)) continue;

      let bestProp = null;
      let bestScore = 0;
      for (const known of allowed) {
        const score = similarity(warn._key, known);
        if (score >= TYPO_THRESHOLD && score > bestScore) {
          bestProp = known;
          bestScore = score;
        }
      }

      if (bestProp) {
        suggestedTypos.add(warn._key);
        warn.message = `Unknown property: "${warn._key}" — did you mean "${bestProp}"?`;
      }
    }
  }

  // Step 5: Apply fixes — rename unknown (non-typo) properties to x- prefixed.
  if (fix && filePath) {
    const typoKeys = new Set([...consumed].map((r) => r._key));
    const keysToFix = unknownKeys.filter((key) => !typoKeys.has(key) && !suggestedTypos.has(key));

    if (keysToFix.length > 0) {
      let fileContent = fs.readFileSync(filePath, 'utf-8');

      // Only replace within the frontmatter block (between the --- delimiters).
      const fmMatch = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (fmMatch) {
        let frontmatter = fmMatch[1];
        const keysToFixSet = new Set(keysToFix);
        for (const key of keysToFix) {
          const regex = new RegExp(`^(${key}:)`, 'gm');
          frontmatter = frontmatter.replace(regex, `x-${key}:`);
        }
        fileContent = fileContent.replace(fmMatch[1], frontmatter);
      }
      fs.writeFileSync(filePath, fileContent, 'utf-8');

      // Mark the corresponding warnings as fixed.
      const keysToFixSet = new Set(keysToFix);
      for (const r of results) {
        if (r._key && keysToFixSet.has(r._key)) {
          r.message += ' (fixed)';
        }
      }
    }
  }

  // Remove consumed warnings (they've been merged into the error).
  const final = results.filter((r) => !consumed.has(r));
  return final.length > 0 ? final : null;
}
