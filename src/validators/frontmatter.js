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

export function validate({ content, relativePath }) {
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
  if (allowed && data && typeof data === 'object') {
    for (const key of Object.keys(data)) {
      if (!allowed.has(key) && !key.startsWith('x-')) {
        results.push({
          file: relativePath,
          rule: name,
          severity: 'warning',
          message: `Unknown frontmatter property "${key}" (use x-${key} for custom metadata)`,
        });
      }
    }
  }

  // Step 4: Detect typos by comparing unknown properties against known ones.
  const missingRequired = results.filter(
    (r) => r.severity === 'error' && r.message.includes('must have required property'),
  );
  const unknowns = results.filter((r) => r.severity === 'warning' && r.message.startsWith('Unknown frontmatter'));

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
      const warnMatch = warn.message.match(/Unknown frontmatter property "([^"]+)"/);
      if (!warnMatch) continue;

      const score = similarity(required, warnMatch[1]);
      if (score >= TYPO_THRESHOLD && score > bestScore) {
        bestMatch = warn;
        bestScore = score;
      }
    }

    if (bestMatch) {
      const typo = bestMatch.message.match(/Unknown frontmatter property "([^"]+)"/)[1];
      consumed.add(bestMatch);
      err.message = `Invalid frontmatter: "${typo}" is not a valid property — did you mean "${required}"?`;
    }
  }

  // Second pass: match remaining unknowns to any known property (these stay as warnings).
  if (allowed) {
    for (const warn of unknowns) {
      if (consumed.has(warn)) continue;
      const warnMatch = warn.message.match(/Unknown frontmatter property "([^"]+)"/);
      if (!warnMatch) continue;
      const unknown = warnMatch[1];

      let bestProp = null;
      let bestScore = 0;
      for (const known of allowed) {
        const score = similarity(unknown, known);
        if (score >= TYPO_THRESHOLD && score > bestScore) {
          bestProp = known;
          bestScore = score;
        }
      }

      if (bestProp) {
        warn.message = `Unknown frontmatter property "${unknown}" — did you mean "${bestProp}"?`;
      }
    }
  }

  // Remove consumed warnings (they've been merged into the error).
  const final = results.filter((r) => !consumed.has(r));
  return final.length > 0 ? final : null;
}
