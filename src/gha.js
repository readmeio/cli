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

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
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

// Mirrors every console.log/error a command makes into a buffer (while still
// printing it normally, so the raw Action log is unaffected) so it can be
// exposed as this step's `readme` output — e.g. so a later step can check
// `contains(steps.sync.outputs.readme, 'Skipped')` the way the old
// `npx ... | tee sync-output.txt` + grep pattern used to.
function captureConsoleOutput() {
  const lines = [];
  const originals = { log: console.log, error: console.error };

  for (const method of ['log', 'error']) {
    console[method] = (...args) => {
      lines.push(args.map(String).join(' '));
      originals[method](...args);
    };
  }

  return {
    text: () => lines.join('\n'),
    restore: () => Object.assign(console, originals),
  };
}

// Commands call process.exit() directly on failure, which would otherwise
// skip past any output-writing code that runs after `await entry.run(...)`
// below — so writing the output has to happen here, in a temporary
// process.exit override, rather than only after that await resolves.
function writeGithubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return; // no-op outside a real Actions runner (e.g. local testing)

  // A random delimiter (rather than a fixed one like "EOF") matters here:
  // `value` is arbitrary CLI output, which can echo back content from a
  // customer's own docs/OAS files. A fixed, guessable delimiter could let
  // that content prematurely close the heredoc and inject bogus key=value
  // pairs into the outputs file.
  const delimiter = `ghadelimiter_${randomUUID()}`;
  fs.appendFileSync(outputPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
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

  const capture = captureConsoleOutput();
  const realExit = process.exit.bind(process);
  process.exit = (code) => {
    capture.restore();
    writeGithubOutput('readme', capture.text());
    realExit(code);
  };

  try {
    await entry.run(options, null, { gitRoot });
  } finally {
    capture.restore();
    writeGithubOutput('readme', capture.text());
    process.exit = realExit;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
