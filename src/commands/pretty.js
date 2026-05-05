import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { query } from '@anthropic-ai/claude-agent-sdk';
import matter from 'gray-matter';
import ora from 'ora';
import { collectFiles } from '../utils/lint.js';
import { prettifyPagePrompt, stripCodeFences } from '../prompts/index.js';
import { printHeader, isAgenticCli } from '../utils/eyes.js';
import * as styles from '../utils/styles.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

export const command = 'pretty';
export const order = 2;
export const description = 'Polish docs into ReadMe-ready MDX with Claude';
export const beta = true;

export function args(cmd) {
  cmd.option('--model <name>', 'Claude model alias: haiku, sonnet, opus', 'sonnet');
  cmd.option('--dry-run', 'Show what would change without writing files');
}

/**
 * Send one page through Claude using the prettify system prompt and parse the
 * JSON response. Returns the parsed object or throws on failure.
 */
async function prettifyPage({ source, title, relativePath, model }) {
  const { systemPrompt, userPrompt } = prettifyPagePrompt({ source, title, relativePath });

  let text = '';
  for await (const message of query({
    prompt: userPrompt,
    options: {
      systemPrompt,
      allowedTools: [],
      ...(model ? { model } : {}),
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

  const stripped = stripCodeFences(text);
  try {
    return JSON.parse(stripped);
  } catch (e) {
    throw new Error(`invalid JSON (${e.message}); first 200 chars: ${stripped.slice(0, 200)}`);
  }
}

export async function run(options, _cmd, ctx) {
  const { gitRoot } = ctx;

  if (!isAgenticCli()) {
    printHeader({ version: pkg.version, binName: styles.binName(), indent: '  ' });
    console.log();
  }

  const files = collectFiles(gitRoot);
  if (files.length === 0) {
    styles.warning('No docs files found to prettify.');
    return;
  }

  styles.info(
    `Prettifying ${styles.bold(String(files.length))} file${files.length === 1 ? '' : 's'} with ${styles.bold(options.model)}${options.dryRun ? styles.dim(' (dry run)') : ''}.`,
  );
  console.log();

  const spinner = ora({ color: 'blue' }).start();
  let updated = 0;
  let unchanged = 0;
  const failures = [];

  for (const relativePath of files) {
    spinner.text = relativePath;
    const filePath = path.join(gitRoot, relativePath);
    const original = fs.readFileSync(filePath, 'utf-8');
    const parsed = matter(original);

    try {
      const result = await prettifyPage({
        source: parsed.content,
        title: parsed.data?.title,
        relativePath,
        model: options.model,
      });

      if (typeof result?.body !== 'string') {
        throw new Error('response missing "body" field');
      }

      const newFm = { ...parsed.data };
      if (result.excerpt && !newFm.excerpt) newFm.excerpt = result.excerpt;
      const next = matter.stringify(result.body, newFm);

      if (next === original) {
        unchanged++;
      } else {
        if (!options.dryRun) fs.writeFileSync(filePath, next, 'utf-8');
        updated++;
      }
    } catch (err) {
      failures.push({ relativePath, message: err.message || String(err) });
    }
  }

  spinner.stop();

  console.log();
  const verb = options.dryRun ? 'would update' : 'updated';
  styles.ok(
    `${styles.bold(String(updated))} ${verb} · ${styles.bold(String(unchanged))} unchanged${failures.length ? ` · ${styles.bold(String(failures.length))} failed` : ''}`,
  );

  if (failures.length > 0) {
    console.log();
    for (const f of failures) {
      console.log(`  ${styles.err('●')} ${styles.bold(f.relativePath)} ${styles.dim('— ' + f.message)}`);
    }
    process.exit(1);
  }
}
