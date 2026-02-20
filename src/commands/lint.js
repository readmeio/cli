import { collectFiles, runValidators } from '../utils/lint.js';
import { createHumanReporter, createJsonReporter, createGithubReporter } from '../utils/reporter.js';

export const command = 'lint';
export const aliases = ['validate'];
export const description = 'Lint and validate your ReadMe docs';

export function args(cmd) {
  cmd.option('--json', 'Output results as JSON (for CI and automation)');
  cmd.option('--github', 'Output a GitHub PR comment body as markdown');
  cmd.option('--fix', 'Automatically fix issues where possible');
}

export async function run(options, _cmd, ctx) {
  const { gitRoot } = ctx;
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
