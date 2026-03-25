import { createRequire } from 'node:module';
import { collectFiles, runValidators } from '../utils/lint.js';
import { createHumanReporter, createJsonReporter, createGithubReporter } from '../utils/reporter.js';
import { printHeader } from '../utils/eyes.js';
import * as styles from '../utils/styles.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

export const command = 'lint';
export const order = 1;
export const aliases = ['validate'];
export const description = 'Lint and validate your ReadMe docs';

export function args(cmd) {
  cmd.option('--json', 'Output results as JSON (for CI and automation)');
  cmd.option('--github', 'Output a GitHub PR comment body as markdown');
  cmd.option('--fix', 'Automatically fix issues where possible');
}

export async function run(options, _cmd, ctx) {
  const { gitRoot } = ctx;

  if (!options.json && !options.github) {
    printHeader({ version: pkg.version, binName: styles.binName(), indent: '  ' });
    console.log();
  }
  const files = collectFiles(gitRoot);

  const reporter = options.github
    ? createGithubReporter()
    : options.json
      ? createJsonReporter()
      : createHumanReporter();

  const results = await runValidators(files, gitRoot, {
    onFile: (f) => reporter.onFile(f),
    onBeforeCrossFile: () => reporter.pause(),
    fix: options.fix,
  });

  reporter.finish(files.length, results, files, { fix: options.fix, gitRoot });

  const hasErrors = results.some((r) => r.severity !== 'warning');
  if (hasErrors) {
    // Wait for stdout to flush (important when piped to a file), then exit
    await new Promise((resolve) => process.stdout.write('', resolve));
    process.exit(1);
  }
}
