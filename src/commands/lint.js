import { createRequire } from 'node:module';
import { collectFiles, runValidators } from '../utils/lint.js';
import { createHumanReporter, createJsonReporter, createGithubReporter } from '../utils/reporter.js';
import { printHeader, isAgenticCli } from '../utils/eyes.js';
import * as styles from '../utils/styles.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

export const command = 'lint';
export const order = 1;
export const aliases = ['validate'];
export const category = 'Linting';
export const description = 'Lint and validate your ReadMe docs';

export function args(cmd) {
  cmd.option('--json', 'Output results as JSON (for CI and automation)');
  cmd.option('--github', 'Output a GitHub PR comment body as markdown');
  cmd.option('--fix', 'Automatically fix issues where possible');
}

/**
 * Run the linter programmatically. Returns the collected files and validator
 * results with no console output and no process.exit — callers can format and
 * exit on their own terms.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.cwd]   Repo root to lint (defaults to process.cwd()).
 * @param {boolean} [opts.fix]   Apply autofixes where validators support it.
 * @param {(file: string) => void} [opts.onFile]            Called per file before validation.
 * @param {() => void}             [opts.onBeforeCrossFile] Called once before cross-file checks run.
 * @returns {Promise<{ gitRoot: string, files: string[], results: object[], hasErrors: boolean }>}
 */
export async function lint({ cwd, fix = false, onFile, onBeforeCrossFile } = {}) {
  const gitRoot = cwd || process.cwd();
  const files = collectFiles(gitRoot);
  const results = await runValidators(files, gitRoot, { onFile, onBeforeCrossFile, fix });
  const hasErrors = results.some((r) => r.severity !== 'warning');
  return { gitRoot, files, results, hasErrors };
}

export async function run(options, _cmd, ctx) {
  const { gitRoot } = ctx;

  if (!options.json && !options.github && !isAgenticCli()) {
    printHeader({ version: pkg.version, binName: styles.binName(), indent: '  ' });
    console.log();
  }

  const reporter = options.github
    ? createGithubReporter()
    : options.json
      ? createJsonReporter()
      : createHumanReporter();

  const { files, results, hasErrors } = await lint({
    cwd: gitRoot,
    fix: options.fix,
    onFile: (f) => reporter.onFile(f),
    onBeforeCrossFile: () => reporter.pause(),
  });

  reporter.finish(files.length, results, files, { fix: options.fix, gitRoot });

  if (hasErrors) {
    // Wait for stdout to flush (important when piped to a file), then exit
    await new Promise((resolve) => process.stdout.write('', resolve));
    process.exit(1);
  }
}
