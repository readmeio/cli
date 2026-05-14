/**
 * `readme components` — browse, install, view, and generate MDX components
 * for a ReadMe project.
 *
 * The canonical catalog lives at https://github.com/readmeio/marketplace.
 * Components aren't auto-loaded: copying one into the user's `components/`
 * folder is what makes it available in their docs (and to the slash menu in
 * the ReadMe admin). The `add` subcommand does that copy; `new` asks Claude
 * to generate a brand-new component using the marketplace entries as
 * exemplars (tailwind + arbitrary JSX is supported).
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import ora from 'ora';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as styles from '../utils/styles.js';
import {
  listMarketplaceComponents,
  fetchMarketplaceComponent,
  summarizeReadme,
  localComponentsDir,
  listLocalComponents,
} from '../utils/marketplace.js';
import { stripCodeFences } from '../prompts/index.js';

export const command = 'components [action] [name...]';
export const order = 3;
export const category = 'Other';
export const description = 'Browse, install, and generate MDX components';
export const beta = true;
export const helpHint = [
  'readme components               # list marketplace + installed',
  'readme components add <Name>    # copy a marketplace component into ./components/',
  'readme components show <Name>   # print the component\'s source',
  'readme components new "<idea>"  # ask Claude to generate a new component',
].join('\n');

export function args(cmd) {
  cmd.option('-f, --force', 'Bypass the 24h cache and refetch from GitHub');
  cmd.option('--model <name>', 'Claude model for `new`: haiku, sonnet, opus', 'sonnet');
  cmd.option('-y, --yes', 'Overwrite existing files without prompting');
}

export async function run(action, names, options, _cmd, ctx) {
  const { gitRoot } = ctx;
  const sub = (action || 'list').toLowerCase();
  const arg = (names && names.length) ? names.join(' ') : null;

  switch (sub) {
    case 'list':
    case 'ls':
      return runList(gitRoot, options);
    case 'add':
    case 'install':
      if (!arg) return missingArg('add', '<Name>');
      return runAdd(gitRoot, names, options);
    case 'show':
    case 'view':
      if (!arg) return missingArg('show', '<Name>');
      return runShow(arg, options);
    case 'new':
    case 'create':
    case 'gen':
      if (!arg) return missingArg('new', '"<description>"');
      return runNew(gitRoot, arg, options);
    default:
      // First arg wasn't an action — treat the whole thing as a name to show.
      return runShow([action, ...(names || [])].filter(Boolean).join(' '), options);
  }
}

function missingArg(sub, hint) {
  styles.error(`Missing argument for ${styles.bold(sub)}. Usage: ${styles.bold(`readme components ${sub} ${hint}`)}`);
  process.exit(1);
}

// ─── list ────────────────────────────────────────────────────────────────────

async function runList(gitRoot, options) {
  console.log();
  console.log(`  ${styles.logo()}  ${styles.dim('components')}`);
  console.log();

  const spinner = ora({ color: 'blue', text: 'Fetching marketplace…' }).start();
  let marketplace;
  try {
    marketplace = await listMarketplaceComponents({ force: !!options.force });
  } catch (err) {
    spinner.stop();
    styles.error(`Could not load marketplace: ${err.message}`);
    process.exit(1);
  }

  // Pull readmes for any components we already have cached — gives us
  // descriptions without a fetch storm on the first run.
  const summaries = new Map();
  for (const c of marketplace) {
    try {
      const { readme } = await fetchMarketplaceComponent(c.name, { force: false });
      summaries.set(c.name, summarizeReadme(readme));
    } catch {
      summaries.set(c.name, '');
    }
    spinner.text = `Loading ${c.name}…`;
  }
  spinner.stop();

  const local = new Set(listLocalComponents(gitRoot).map((c) => c.name.toLowerCase()));

  const nameWidth = Math.max(...marketplace.map((c) => c.name.length));
  for (const c of marketplace) {
    const installed = local.has(c.name.toLowerCase());
    const marker = installed ? styles.success('●') : styles.dim('○');
    const summary = summaries.get(c.name) || styles.dim('(no description)');
    console.log(`  ${marker} ${styles.bold(c.name.padEnd(nameWidth))}  ${styles.dim(summary)}`);
  }

  console.log();
  const installedCount = [...local].filter((n) => marketplace.some((c) => c.name.toLowerCase() === n)).length;
  styles.info(`${marketplace.length} components in the marketplace · ${installedCount} already installed.`);
  styles.info(`Run ${styles.bold('readme components add <Name>')} to copy one into ./components/.`);
}

// ─── add ─────────────────────────────────────────────────────────────────────

async function runAdd(gitRoot, names, options) {
  const targets = (names || []).filter(Boolean);
  if (targets.length === 0) return missingArg('add', '<Name>');

  const dest = localComponentsDir(gitRoot);
  fs.mkdirSync(dest, { recursive: true });

  for (const name of targets) {
    let comp;
    try {
      comp = await fetchMarketplaceComponent(name, { force: !!options.force });
    } catch (err) {
      styles.error(`${styles.bold(name)} — ${err.message}`);
      continue;
    }

    const file = path.join(dest, `${comp.name}.mdx`);
    if (fs.existsSync(file) && !options.yes) {
      const ok = await confirm(`${styles.bold(comp.name)}.mdx already exists. Overwrite?`);
      if (!ok) {
        styles.info(`Skipped ${styles.bold(comp.name)}.`);
        continue;
      }
    }

    fs.writeFileSync(file, comp.mdx, 'utf-8');
    styles.ok(`Installed ${styles.bold(comp.name)} → ${styles.dim(path.relative(gitRoot, file))}`);
  }

  console.log();
  styles.info('Components are available to docs in this repo. Use them like `<Name ... />` in any MDX page.');
}

// ─── show ────────────────────────────────────────────────────────────────────

async function runShow(name, options) {
  let comp;
  try {
    comp = await fetchMarketplaceComponent(name, { force: !!options.force });
  } catch (err) {
    styles.error(err.message);
    process.exit(1);
  }

  console.log();
  console.log(`  ${styles.heading(comp.name)}  ${styles.dim(comp.htmlUrl)}`);
  if (comp.readme) {
    console.log();
    console.log(comp.readme.split('\n').map((l) => '  ' + l).join('\n'));
  }
  console.log();
  console.log(`  ${styles.bold('Source')} ${styles.dim(`(${comp.name}.mdx)`)}`);
  console.log();
  console.log(comp.mdx.split('\n').map((l) => '    ' + l).join('\n'));
  console.log();
}

// ─── new (Claude-generated) ──────────────────────────────────────────────────

async function runNew(gitRoot, description, options) {
  const dest = localComponentsDir(gitRoot);
  fs.mkdirSync(dest, { recursive: true });

  styles.info(`Generating a new MDX component for: ${styles.bold(description)}`);

  // Pull a handful of marketplace components as exemplars. We pick a spread of
  // simple + complex ones so Claude sees the range of patterns.
  const exemplarNames = ['Compatibility', 'Banner', 'Terminal', 'Steps', 'KeyPress'];
  const exemplars = [];
  for (const n of exemplarNames) {
    try {
      const c = await fetchMarketplaceComponent(n);
      exemplars.push({ name: c.name, mdx: c.mdx });
    } catch { /* skip */ }
  }

  const systemPrompt = [
    'You write self-contained ReadMe MDX components.',
    '',
    'Format requirements:',
    '- A single .mdx file. Top: `import React from "react";`.',
    '- Export an arrow-function component as `export const <Name> = (props) => (...)`.',
    '- Tailwind utility classes for styling — no <style> blocks, no external CSS.',
    '- Inline SVG or FontAwesome (`<i className="fa-solid fa-..."/>`) for icons.',
    '- End the file with one example invocation `<Name ... />` showing realistic props.',
    '- No `<script>`, no event handlers requiring app state, no external imports beyond React.',
    '- Keep the component small and readable. ~30-80 lines.',
    '',
    'Output: ONLY the raw .mdx source. No JSON, no code fences, no commentary.',
  ].join('\n');

  const userPrompt = [
    `Design brief: ${description}`,
    '',
    'For style and conventions, follow these existing components (do NOT copy them — match their structure):',
    '',
    ...exemplars.map((e) => `### ${e.name}\n\`\`\`mdx\n${e.mdx}\n\`\`\``),
    '',
    'Now write the new component .mdx. Pick a good PascalCase name that matches the brief.',
  ].join('\n');

  const spinner = ora({ color: 'blue', text: 'Asking Claude…' }).start();
  let text = '';
  try {
    for await (const message of query({
      prompt: userPrompt,
      options: {
        systemPrompt,
        allowedTools: [],
        ...(options.model ? { model: options.model } : {}),
      },
    })) {
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text) text += block.text;
        }
      } else if (message.type === 'result') {
        if (message.subtype && message.subtype !== 'success') {
          throw new Error(`${message.subtype}${message.error?.message ? ' — ' + message.error.message : ''}`);
        }
        break;
      }
    }
  } catch (err) {
    spinner.stop();
    styles.error(`Generation failed: ${err.message}`);
    process.exit(1);
  }
  spinner.stop();

  const mdx = stripCodeFences(text).trim();
  const nameMatch = mdx.match(/export\s+const\s+([A-Z][A-Za-z0-9]+)\s*=/);
  if (!nameMatch) {
    styles.error('Claude\'s response did not include `export const <Name> = ...`. Try again.');
    process.exit(1);
  }

  const name = nameMatch[1];
  const file = path.join(dest, `${name}.mdx`);
  if (fs.existsSync(file) && !options.yes) {
    const ok = await confirm(`${styles.bold(name)}.mdx already exists. Overwrite?`);
    if (!ok) { styles.info('Aborted.'); return; }
  }

  fs.writeFileSync(file, mdx + '\n', 'utf-8');
  console.log();
  styles.ok(`Created ${styles.bold(name)} → ${styles.dim(path.relative(gitRoot, file))}`);
  styles.info(`Use it in any docs page as ${styles.bold(`<${name} ... />`)}.`);
}

// ─── tiny readline confirm ───────────────────────────────────────────────────

function confirm(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${styles.warn('?')} ${message} ${styles.dim('[y/N]')} `, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}
