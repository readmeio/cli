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
  return { command, rest };
}

export async function run() {
  const input = process.env.INPUT_README || '';
  const { command, rest } = parseInput(input);

  const entry = COMMANDS[command];
  if (!entry) {
    console.error(
      `::error::Unknown or unsupported command "${command || '(empty)'}" for the \`readme\` input. ` +
        `Supported: ${[...new Set(Object.keys(COMMANDS).filter((k) => k !== 'validate'))].join(', ')}.`,
    );
    process.exit(1);
  }

  // Every trailing token must be exactly "--<a supported flag>" — anything
  // else (a short option like "-d", a malformed token, a misspelled flag)
  // is rejected rather than silently dropped. An earlier version of this
  // only checked tokens that already happened to start with "--", which let
  // anything shaped differently (like "-d") skip validation entirely and
  // run the command with default options with no indication anything was
  // wrong.
  const flags = new Set();
  const badTokens = [];
  for (const token of rest) {
    const flag = token.startsWith('--') ? token.slice(2) : null;
    if (flag && entry.flags.includes(flag)) {
      flags.add(flag);
    } else {
      badTokens.push(token);
    }
  }

  if (badTokens.length > 0) {
    console.error(
      `::error::Unknown option${badTokens.length > 1 ? 's' : ''} ${badTokens.map((t) => `"${t}"`).join(', ')} for "${command}". ` +
        `Supported: ${entry.flags.length > 0 ? entry.flags.map((f) => `--${f}`).join(', ') : '(none)'}.`,
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
