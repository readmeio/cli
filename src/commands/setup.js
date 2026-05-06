import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import * as styles from '../utils/styles.js';
import {
  PLATFORMS,
  detectExistingCi,
  detectPlatform,
  usesBlacksmith,
} from '../utils/git.js';
import { templateFor } from '../utils/setup-templates.js';

// Detect the user's CI platform at module load so the top-level `--help`
// can advertise the right `setup:<platform>` form (e.g. `setup:github` for
// a GitHub repo). Falls back to the generic `setup:ci`.
function quickGitRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

const _root = quickGitRoot();
const _detected = _root ? detectPlatform(_root).recommended : null;
const _hasExistingCi = _root ? detectExistingCi(_root).length > 0 : false;
const _primaryName = _detected ? `setup:${_detected}` : 'setup:ci';
const _primaryLabel = _detected ? PLATFORMS[_detected].label : 'a CI workflow';

export const command = _primaryName;
export const order = 5;
export const category = 'Linting';
export const description = `Set up ${_primaryLabel} to lint your docs on every PR`;
// Skip the hint when existing CI is detected — they've already chosen a platform.
export const helpHint = _hasExistingCi
  ? null
  : `Using something else?\nRun \`${styles.binName()} setup --help\` to see all supported CI platforms.`;

// Hidden aliases cover every other form: bare `setup` (with optional positional),
// the generic `setup:ci`, and one entry per platform. Whichever form is the
// primary above is filtered out so it isn't double-registered.
const ALL_FORMS = [
  'setup [platform]',
  'setup:ci',
  ...Object.keys(PLATFORMS).map((k) => `setup:${k}`),
];
export const aliases = ALL_FORMS.filter((a) => a.split(' ')[0] !== _primaryName);

export function args(cmd) {
  cmd.option('--blacksmith', 'Use Blacksmith runners (GitHub Actions only)');
  cmd.option('-y, --yes', 'Skip confirmation prompt');

  cmd.addHelpText('after', () => {
    const bin = styles.binName();
    const cmdStrs = Object.keys(PLATFORMS).map((k) => `${bin} setup:${k}`);
    const cmdWidth = Math.max(...cmdStrs.map((s) => s.length));
    const labelWidth = Math.max(...Object.values(PLATFORMS).map((d) => d.label.length));
    const rows = Object.entries(PLATFORMS).map(([key, def], i) => {
      const cmdStr = cmdStrs[i].padEnd(cmdWidth);
      const label = def.label.padEnd(labelWidth);
      const marker = key === _detected ? styles.success('●') : ' ';
      return `  ${marker} ${styles.orange(cmdStr)} ${styles.dim('—')} ${label}  ${styles.dim(def.workflowFile)}`;
    });
    const examples = [
      [`${bin} setup`, '# auto-detect and confirm'],
      [`${bin} setup:github --blacksmith`, '# GitHub Actions on Blacksmith runners'],
      [`${bin} setup:gitlab -y`, '# skip the confirmation prompt'],
    ];
    const exWidth = Math.max(...examples.map(([c]) => c.length));
    const exRows = examples.map(([c, note]) => `  ${styles.orange(c.padEnd(exWidth))}  ${styles.dim(note)}`);
    const detectedLine = _detected
      ? `  ${styles.dim('Detected:')} ${styles.bold(PLATFORMS[_detected].label)} ${styles.dim('— recommend')} ${styles.orange(`${bin} setup:${_detected}`)}`
      : `  ${styles.dim('Run')} ${styles.orange(`${bin} setup`)} ${styles.dim('to auto-detect from .git/config + existing CI files.')}`;
    return [
      '',
      `${styles.bold('Auto-detection:')}`,
      detectedLine,
      '',
      `${styles.bold('Platforms:')}`,
      ...rows,
      '',
      `${styles.bold('Examples:')}`,
      ...exRows,
      '',
    ].join('\n');
  });
}

export async function run(...callArgs) {
  // Action signature varies by which form was invoked:
  //   `setup:github`        → (opts, cmd, ctx)
  //   `setup [platform]`    → (platformPositional, opts, cmd, ctx)
  // ctx is always last (added by cli.js bootstrap).
  const ctx = callArgs.pop();
  const cmd = callArgs.pop();
  const opts = callArgs.pop();
  const positional = callArgs[0];

  // Pull platform from the matched command name, or fall back to the positional.
  const cmdName = cmd.name();
  let platformArg = null;
  if (cmdName.startsWith('setup:') && cmdName !== 'setup:ci') {
    platformArg = cmdName.slice('setup:'.length);
  } else if (positional) {
    platformArg = positional;
  }

  const { gitRoot } = ctx;

  // 1. Resolve which platform we're setting up.
  let platform = normalizePlatform(platformArg);
  let detection = null;

  if (!platform) {
    detection = detectPlatform(gitRoot);
    platform = detection.recommended;

    if (!platform) {
      printDetectionFailure();
      process.exit(1);
    }
  } else if (!PLATFORMS[platform]) {
    styles.error(`Unknown platform: ${styles.bold(platformArg)}`);
    styles.info(`Available: ${Object.keys(PLATFORMS).join(', ')}`);
    process.exit(1);
  }

  // 2. Validate platform-specific options.
  if (opts.blacksmith && platform !== 'github') {
    styles.error('--blacksmith is only valid with GitHub Actions.');
    process.exit(1);
  }

  let useBlacksmith = !!opts.blacksmith;
  if (platform === 'github' && !opts.blacksmith && usesBlacksmith(gitRoot)) {
    useBlacksmith = true;
  }

  const def = PLATFORMS[platform];
  const workflowPath = path.join(gitRoot, def.workflowFile);
  const isOverwrite = fs.existsSync(workflowPath);

  // 3. Show what will happen.
  console.log();
  console.log(`  ${styles.heading(`${def.label} Setup`)}`);
  console.log();

  if (detection) printDetectionSummary(detection, platform);

  console.log(`  This will create a workflow that runs on every pull request:`);
  console.log();
  console.log(`    ${styles.success('✔')} ${styles.bold('Lint docs')} — runs ${styles.orange(`${styles.binName()} lint`)} and posts results as a PR comment`);
  if (platform === 'github') {
    console.log(`    ${styles.success('✔')} ${styles.bold('OAS change detection')} — flags modified OpenAPI spec files and suggests syncing`);
    console.log(`    ${styles.success('✔')} ${styles.bold('Auto-fix base branch')} — redirects PRs from ${styles.orange('main')} to the correct version branch`);
    if (useBlacksmith) {
      console.log(`    ${styles.success('✔')} ${styles.bold('Blacksmith runner')} — uses ${styles.orange('blacksmith-2vcpu-ubuntu-2404')} instead of ${styles.orange('ubuntu-latest')}`);
    }
  }
  console.log();
  console.log(`  ${styles.dim('Creates:')} ${path.relative(gitRoot, workflowPath)}`);

  printPostSetupNotes(platform);
  console.log();

  // 4. Confirm.
  if (!opts.yes) {
    const prompt = isOverwrite
      ? 'This will overwrite the existing workflow. Continue?'
      : 'Set up this workflow?';
    const confirmed = await confirm(prompt);
    if (!confirmed) {
      styles.info('Setup cancelled.');
      return;
    }
  }

  // 5. Write.
  fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
  fs.writeFileSync(workflowPath, templateFor(platform, { blacksmith: useBlacksmith }));

  console.log();
  styles.ok(`Created ${def.label} workflow!`);
  console.log();
  styles.info('Commit and push this file to start linting PRs automatically.');
}

function normalizePlatform(input) {
  if (!input) return null;
  const key = input.toLowerCase();
  if (key === 'gh') return 'github';
  if (key === 'gl') return 'gitlab';
  if (key === 'bb' || key === 'bitbucket-pipelines') return 'bitbucket';
  if (key === 'circle' || key === 'circle-ci') return 'circleci';
  if (key === 'mint') return 'rwx';
  return key;
}

function printDetectionSummary(detection, chosen) {
  const lines = [];
  if (detection.existing.length > 0) {
    const labels = detection.existing.map((k) => PLATFORMS[k].label).join(', ');
    lines.push(`${styles.dim('Detected existing CI:')} ${labels}`);
  }
  if (detection.remote) {
    lines.push(`${styles.dim('Detected git remote:')} ${PLATFORMS[detection.remote].label}`);
  }
  lines.push(`${styles.dim('Setting up:')} ${styles.bold(PLATFORMS[chosen].label)}`);
  for (const l of lines) console.log(`  ${l}`);
  console.log();
}

function printDetectionFailure() {
  console.log();
  styles.error("Couldn't detect a CI platform for this repo.");
  console.log();
  console.log(`  ${styles.dim('No matching git remote and no existing CI config found.')}`);
  console.log();
  console.log(`  Specify a platform explicitly:`);
  for (const [key, def] of Object.entries(PLATFORMS)) {
    console.log(`    ${styles.orange(`${styles.binName()} setup:${key}`)} ${styles.dim('—')} ${def.label}`);
  }
  console.log();
}

function printPostSetupNotes(platform) {
  const notes = {
    gitlab: `  ${styles.dim('Required:')} CI/CD variable ${styles.bold('GITLAB_TOKEN')} with ${styles.bold('api')} scope`,
    bitbucket: `  ${styles.dim('Required:')} repository variables ${styles.bold('BITBUCKET_USERNAME')} and ${styles.bold('BITBUCKET_TOKEN')} (app password with ${styles.bold('pullrequest:write')})`,
    circleci: `  ${styles.dim('Required:')} project env var ${styles.bold('CIRCLE_PROJECT_GITHUB_TOKEN')} with PR comment permission`,
    rwx: `  ${styles.dim('Required:')} vault secret ${styles.bold('GITHUB_TOKEN')} with PR comment permission`,
  };
  if (notes[platform]) {
    console.log();
    console.log(notes[platform]);
  }
}

function confirm(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${styles.brand('?')} ${message} ${styles.dim('(Y/n)')} `, (answer) => {
      rl.close();
      const val = answer.trim().toLowerCase();
      resolve(val === '' || val === 'y' || val === 'yes');
    });
  });
}
