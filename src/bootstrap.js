import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import updateNotifier from 'update-notifier';
import * as styles from './utils/styles.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

/**
 * Run all bootstrap checks and return context about the repo.
 * Exits with a friendly error if anything is wrong.
 */
export default async function bootstrap({ skipValidation = false } = {}) {
  // 1. Check for CLI updates (runs at most once every 24 h)
  checkForUpdates();

  // 2. Make sure we're inside a git repo and find the root
  const gitRoot = findGitRoot();

  // 3. Make sure this is a ReadMe project repo
  if (!skipValidation) {
    validateReadMeRepo(gitRoot);
  }

  return { gitRoot };
}

// ── update check ────────────────────────────────────────────

function checkForUpdates() {
  const notifier = updateNotifier({ pkg, updateCheckInterval: 1000 * 60 * 60 * 24 });
  notifier.notify({ isGlobal: true });
}

// ── git helpers ─────────────────────────────────────────────

function findGitRoot() {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return root;
  } catch {
    styles.error('This doesn\'t appear to be a git repository.');
    styles.info('Run this command from inside a git repo to get started.');
    process.exit(1);
  }
}

function validateReadMeRepo(gitRoot) {
  // Check for a branch matching ^v[0-9] (e.g. v1, v2.0, etc.)
  let branches;
  try {
    branches = execSync('git branch -a --format="%(refname:short)"', {
      cwd: gitRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    branches = '';
  }

  const hasVersionBranch = branches
    .split('\n')
    .some((b) => /^(origin\/)?v[0-9]/.test(b.trim()));

  // Check for /docs or /reference at the repo root
  const hasDocs = fs.existsSync(path.join(gitRoot, 'docs'));
  const hasReference = fs.existsSync(path.join(gitRoot, 'reference'));

  if (!hasVersionBranch || (!hasDocs && !hasReference)) {
    styles.error('This doesn\'t look like a ReadMe docs repo.');

    if (!hasVersionBranch) {
      styles.info(
        `We couldn't find a version branch (e.g. ${styles.bold('v1')}, ${styles.bold('v2')}).`
      );
    }
    if (!hasDocs && !hasReference) {
      styles.info(
        `We couldn't find a ${styles.bold('/docs')} or ${styles.bold('/reference')} folder.`
      );
    }

    console.log();
    styles.info('Make sure you\'re running this inside a ReadMe docs project.');
    styles.info(`You can skip this check with ${styles.bold(`${styles.binName()} --no-check`)}.`);
    process.exit(1);
  }
}
