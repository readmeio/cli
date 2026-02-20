import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import * as styles from './styles.js';

const isRunningInClaude = !!process.env.CLAUDECODE;

let _hasClaude;
function hasClaude() {
  if (_hasClaude === undefined) {
    try {
      execSync('which claude', { stdio: 'pipe' });
      _hasClaude = true;
    } catch {
      _hasClaude = false;
    }
  }
  return _hasClaude;
}

const CATEGORY_LABELS = {
  custom_blocks: 'custom blocks',
  docs: 'docs',
  reference: 'reference',
  custom_pages: 'custom pages',
  recipes: 'recipes',
};

function categorize(files) {
  const counts = new Map();
  for (const file of files) {
    const dir = file.split('/')[0];
    const label = CATEGORY_LABELS[dir] || dir;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()];
}

function splitResults(results) {
  const errors = results.filter((r) => r.severity !== 'warning');
  const warnings = results.filter((r) => r.severity === 'warning');
  return { errors, warnings };
}

/**
 * Style a result message for human display.
 * Title (before first ":") is colored, rest is normal with bold quoted values.
 */
function styleMessage(message, color) {
  // Strip "(fixed)" suffix — handled separately.
  const isFixed = message.endsWith('(fixed)');
  const raw = isFixed ? message.slice(0, -'(fixed)'.length).trimEnd() : message;

  const colonIdx = raw.indexOf(':');
  let styled;

  if (colonIdx !== -1) {
    const title = raw.slice(0, colonIdx);
    const detail = raw.slice(colonIdx + 1).replace(/"([^"]+)"/g, (_, val) => styles.bold(`"${val}"`));
    styled = `${color(title)}:${detail}`;
  } else {
    // No colon — highlight quoted values, keep rest normal.
    styled = raw.replace(/"([^"]+)"/g, (_, val) => styles.bold(`"${val}"`));
  }

  if (isFixed) {
    styled += ` ${styles.success('✔ fixed')}`;
  }

  return styled;
}

function summaryLine(errorCount, warningCount) {
  const parts = [];
  if (errorCount > 0) parts.push(`${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`);
  if (warningCount > 0) parts.push(`${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}`);
  return parts.join(' and ');
}

/**
 * Human-readable reporter with an animated spinner.
 */
export function createHumanReporter() {
  const spinner = ora({ text: 'Running linting...', color: 'blue' }).start();

  return {
    onFile(relativePath) {
      spinner.suffixText = styles.dim(relativePath);
    },

    pause() {
      spinner.stop();
    },

    finish(total, results, files, { fix } = {}) {
      spinner.suffixText = '';

      const { errors, warnings } = splitResults(results);
      const categories = categorize(files);
      const breakdown = categories.map(([label, count]) => `${count} ${label}`).join(styles.dim(' · '));

      if (errors.length === 0 && warnings.length === 0) {
        spinner.succeed(`${total} files checked — all good!`);
        console.log(`  ${styles.dim(breakdown)}`);
        return;
      }

      if (errors.length > 0) {
        spinner.fail(`${summaryLine(errors.length, warnings.length)} in ${total} files`);
      } else {
        spinner.warn(`${summaryLine(0, warnings.length)} in ${total} files`);
      }
      console.log(`  ${styles.dim(breakdown)}`);
      console.log();

      // Group all results by file
      const grouped = new Map();
      for (const r of [...errors, ...warnings]) {
        if (!grouped.has(r.file)) grouped.set(r.file, []);
        grouped.get(r.file).push(r);
      }

      for (const [file, fileResults] of grouped) {
        console.log(`  ${styles.bold(file)}`);
        for (const r of fileResults) {
          if (r.severity === 'warning') {
            console.log(`    ${styles.warn('●')} ${styleMessage(r.message, styles.warn)}`);
          } else {
            console.log(`    ${styles.err('●')} ${styleMessage(r.message, styles.err)}`);
          }
        }
        console.log();
      }

      // Tips section.
      const fixable = !fix ? results.filter((r) => r.fixable && !r.message.endsWith('(fixed)')) : [];
      const unfixed = results.filter((r) => !r.message.endsWith('(fixed)'));
      const showTips = fixable.length > 0 || (unfixed.length > 0 && hasClaude());

      if (showTips) {
        console.log(`  ${styles.dim('─'.repeat(40))}`);
        console.log();
      }

      if (fixable.length > 0) {
        console.log(`  ${styles.dim('Run')} readme validate --fix ${styles.dim('to automatically fix some of these.')}`);
        console.log();
      }

      if (unfixed.length > 0 && !isRunningInClaude && hasClaude()) {
        console.log(`  💡 Run ${styles.orange('claude "run readme validate and fix the issues"')} to let Claude fix these for you.`);
        console.log();
      }

      // When running inside Claude, output instructions and structured issue list.
      if (isRunningInClaude && unfixed.length > 0) {
        const instructionsPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../claude-instructions.md');
        const instructions = fs.readFileSync(instructionsPath, 'utf-8');
        console.log('\n<claude-instructions>');
        console.log(instructions);
        console.log('</claude-instructions>\n');
        console.log('<issues>');
        for (const r of unfixed) {
          console.log(`- [${r.severity}] ${r.file}: ${r.message}`);
        }
        console.log('</issues>');
      }
    },
  };
}

/**
 * JSON reporter for machine consumption.
 */
export function createJsonReporter() {
  return {
    onFile() {},
    pause() {},

    finish(total, results, _files) {
      const { errors, warnings } = splitResults(results);
      const output = {
        ok: errors.length === 0,
        total,
        errors: errors.map(({ file, rule, message }) => ({ file, rule, message })),
        warnings: warnings.map(({ file, rule, message }) => ({ file, rule, message })),
      };
      console.log(JSON.stringify(output));
    },
  };
}
