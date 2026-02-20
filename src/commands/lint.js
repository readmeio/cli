import { collectFiles, runValidators } from '../utils/lint.js';
import { createHumanReporter, createJsonReporter } from '../utils/reporter.js';

export const command = 'lint';
export const aliases = ['validate'];
export const description = 'Lint and validate your ReadMe docs';

export function args(cmd) {
  cmd.option('--json', 'Output results as JSON (for CI and automation)');
  cmd.option('--fix', 'Automatically fix issues where possible');
}

export async function run(options, _cmd, ctx) {
  const { gitRoot } = ctx;
  const files = collectFiles(gitRoot);

  const reporter = options.json ? createJsonReporter() : createHumanReporter();

  const results = await runValidators(files, gitRoot, {
    onFile: (f) => reporter.onFile(f),
    onBeforeCrossFile: () => reporter.pause(),
    fix: options.fix,
  });

  reporter.finish(files.length, results, files, { fix: options.fix });

  const hasErrors = results.some((r) => r.severity !== 'warning');
  if (hasErrors) {
    process.exit(1);
  }
}
