import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

/**
 * Writes each field as a GitHub Actions step output, so a workflow can read
 * e.g. `steps.sync.outputs.skipped-count` instead of scraping printed text.
 * A no-op anywhere else (a plain local CLI run, or CI systems other than
 * GitHub Actions), detected the same way GitHub's own `@actions/core`
 * toolkit does: the `GITHUB_ACTIONS` env var GitHub sets on every runner,
 * plus the `GITHUB_OUTPUT` file path it provides for the current step.
 *
 * @param {Record<string, string | object | Array<unknown>>} fields  Values are
 *   written as-is if already a string, JSON-stringified otherwise.
 */
export function writeGithubActionsOutputs(fields) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const lines = Object.entries(fields).map(([name, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    // A random delimiter, rather than a fixed one like "EOF", matters here:
    // `value` can echo back content from a customer's own docs/OAS files
    // (an error message quoting their spec, say), and a guessable delimiter
    // could let that content prematurely close the heredoc and inject extra
    // key=value pairs into the outputs file.
    const delimiter = `ghadelimiter_${randomUUID()}`;
    return `${name}<<${delimiter}\n${text}\n${delimiter}`;
  });

  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`);
}
