import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { bundle } from '@readme/openapi-parser';
import * as styles from '../utils/styles.js';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

export const command = 'oas:bundle';
export const order = 4;
export const category = 'OAS Tooling';
export const description = 'Bundle a multi-file OpenAPI spec into a single file';
// The input spec usually lives outside a ReadMe docs repo (e.g. the API's
// source repo in CI), so don't require a version branch or docs/ dir.
export const skipBootstrap = true;

export function args(cmd) {
  cmd
    .argument('<spec>', 'Path to the root OpenAPI spec file (JSON or YAML)')
    .option('-o, --out <path>', 'Write the bundled spec to this file instead of stdout');
}

/** Resolve external $refs into one document with only internal (#/...) pointers. */
export async function bundleOas({ file, cwd } = {}) {
  const specPath = path.resolve(cwd || process.cwd(), file);
  if (!fs.existsSync(specPath)) {
    throw new Error(`Spec file not found: ${specPath}`);
  }
  // Pass the path, not contents: openapi-parser then resolves relative $refs
  // against the file's directory. oas-normalize reads first and loses that.
  return bundle(specPath);
}

export function formatForPath(outPath) {
  return /\.ya?ml$/i.test(outPath) ? 'yaml' : 'json';
}

export function serializeSpec(spec, format) {
  if (format === 'yaml') return yaml.dump(spec, { noRefs: true, lineWidth: -1 });
  return `${JSON.stringify(spec, null, 2)}\n`;
}

/** Bundle `file` and write it to `out` (format follows the extension). */
export async function writeBundle({ file, out, cwd } = {}) {
  const root = cwd || process.cwd();
  const spec = await bundleOas({ file, cwd: root });
  const outPath = path.resolve(root, out);
  const format = formatForPath(outPath);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, serializeSpec(spec, format));

  return { spec, outPath, format };
}

export async function run(specArg, options) {
  try {
    if (options.out) {
      const { spec, outPath } = await writeBundle({ file: specArg, out: options.out });
      const opCount = countOperations(spec);
      const rel = path.relative(process.cwd(), outPath);
      const shown = rel && !rel.startsWith('..') ? rel : outPath;
      styles.ok(`Bundled ${styles.bold(spec.info?.title || specArg)} (${opCount} ${opCount === 1 ? 'endpoint' : 'endpoints'}) → ${shown}`);
      return;
    }

    const spec = await bundleOas({ file: specArg });
    process.stdout.write(serializeSpec(spec, formatForPath(specArg)));
  } catch (err) {
    styles.error(`Bundle failed: ${err.message || String(err)}`);
    process.exit(1);
  }
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

function countOperations(spec) {
  let n = 0;
  for (const item of Object.values(spec.paths || {})) {
    if (!item || typeof item !== 'object') continue;
    for (const key of Object.keys(item)) if (HTTP_METHODS.has(key)) n += 1;
  }
  return n;
}
