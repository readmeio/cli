// Entrypoint for the readmeio/cli GitHub Action. Deliberately does NOT go
// through src/cli.js — that bootstraps the full CLI by scanning src/commands/
// on disk at runtime (fs.readdirSync + dynamic import), which a bundler can't
// follow statically. This file instead imports just the three commands the
// Action exposes directly, so `ncc build` can produce one dependency-free
// file with no runtime install step (see package.json's build:gha script).
//
// Takes one input, `readme` (env var INPUT_README per GitHub Actions'
// convention), a plain command string such as "lint" or
// "oas:validate --dereference". Split into a command name and flags; there's
// no need for a full argument parser since each of these three commands only
// ever takes simple boolean flags.
//
// Each command's own run() already writes its structured results (has-errors,
// skipped-count, etc.) to GITHUB_OUTPUT itself, via utils/gha-output.js's
// GITHUB_ACTIONS-detecting helper — so this file just needs to call run() and
// let it do what it already does, exit code included.

import * as lint from './commands/lint.js';
import * as oasValidate from './commands/oas-validate.js';
import * as oasSync from './commands/oas-sync.js';

// Each command's run(options, cmd, ctx) only ever reads specific boolean
// flags off `options` (confirmed by reading all three) and never uses `cmd`
// (the commander Command instance normal CLI invocation would pass) — so a
// plain options object and a null cmd are enough here.
const COMMANDS = {
  'lint': { run: lint.run, flags: ['json', 'github', 'fix'] },
  'validate': { run: lint.run, flags: ['json', 'github', 'fix'] }, // alias, matches src/commands/lint.js
  'oas:validate': { run: oasValidate.run, flags: ['dereference'] },
  'oas:sync': { run: oasSync.run, flags: [] },
};

function parseInput(input) {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const [command, ...rest] = tokens;
  const flags = new Set(
    rest.filter((t) => t.startsWith('--')).map((t) => t.slice(2)),
  );
  return { command, flags };
}

export async function run() {
  const input = process.env.INPUT_README || '';
  const { command, flags } = parseInput(input);

  const entry = COMMANDS[command];
  if (!entry) {
    console.error(
      `::error::Unknown or unsupported command "${command || '(empty)'}" for the \`readme\` input. ` +
        `Supported: ${[...new Set(Object.keys(COMMANDS).filter((k) => k !== 'validate'))].join(', ')}.`,
    );
    process.exit(1);
  }

  const options = {};
  for (const flag of entry.flags) options[flag] = flags.has(flag);

  // The customer's repo, checked out by their own workflow before this
  // action runs — not this action's own (separately checked-out) source.
  const gitRoot = process.env.GITHUB_WORKSPACE || process.cwd();

  await entry.run(options, null, { gitRoot });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
