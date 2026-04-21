import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Option } from 'commander';
import { query } from '@anthropic-ai/claude-agent-sdk';
import matter from 'gray-matter';
import * as styles from '../utils/styles.js';
import { syncOas, extractOperations } from './oas-sync.js';
import OASNormalize from 'oas-normalize';

export const command = 'import';
export const order = 7;
export const description = 'Import content from a URL and package it as a ReadMe zip';
export const hidden = true;
export const skipBootstrap = true;

export function args(cmd) {
  cmd.requiredOption('--source <url-or-file>', 'URL to import from, or path to a local OpenAPI spec (.json/.yaml/.yml)');
  cmd.option('-o, --output <path>', 'Output zip path (defaults to <basename>-readme.zip in cwd)');
  cmd.option('--model <name>', 'Claude model alias: haiku, sonnet, opus', 'haiku');
  cmd.option('--firecrawl-key <key>', 'Firecrawl API key (or set FIRECRAWL_API_KEY env var) — enables JS-rendered sidebar scraping');
  // Internal dev-only flag: skip the zip, keep staging, and boot the dev server
  // against it for quick visual previews. Hidden from --help.
  cmd.addOption(new Option('--test').hideHelp());
}

export async function run(options) {
  const startedAt = Date.now();
  const phases = [];
  const timePhase = async (label, fn) => {
    const t = Date.now();
    const result = await fn();
    phases.push({ label, ms: Date.now() - t });
    return result;
  };

  // Dispatch: http(s) URL → docs-site scrape flow; anything else → local OAS.
  if (!/^https?:\/\//i.test(options.source)) {
    return runOasImport(options.source, options, startedAt, phases, timePhase);
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(options.source);
  } catch {
    styles.error(`Invalid --source URL: ${styles.bold(options.source)}`);
    process.exit(1);
  }

  const outputZip = path.resolve(
    options.output || path.join(process.cwd(), `${sourceUrl.hostname}-readme.zip`),
  );

  console.log();
  styles.info(`Importing from ${styles.bold(sourceUrl.toString())}`);
  if (!options.test) styles.info(`Output: ${styles.bold(outputZip)}`);
  console.log();

  // Build the list of llms.txt URLs to probe, walking up the supplied path
  // from most-specific to root. For `https://mintlify.com/docs/quickstart`
  // we try `/docs/quickstart/llms.txt`, then `/docs/llms.txt`, then root.
  // This catches sites that scope llms.txt to a docs subpath.
  const llmsCandidates = buildLlmsCandidates(sourceUrl);
  styles.info(`Checking for llms.txt (${llmsCandidates.length} candidate${llmsCandidates.length === 1 ? '' : 's'})...`);

  const { llms, llmsUrl } = await timePhase('fetch llms.txt', async () => {
    for (const candidate of llmsCandidates) {
      const res = await fetchLlmsTxt(candidate);
      if (res.ok) return { llms: res, llmsUrl: candidate };
      styles.info(styles.dim(`  ${candidate} → ${res.status ? `HTTP ${res.status}` : res.error || 'failed'}`));
    }
    return { llms: null, llmsUrl: null };
  });
  console.log();

  if (!llms) {
    styles.warning(`No llms.txt found at any probed path — falling back to sidebar discovery via scrape.`);
  } else {
    styles.info(styles.dim(`Using ${llmsUrl}.`));
  }

  let knownUrls = [];
  if (llms) {
    const totalItems = llms.parsed.sections.reduce((n, s) => n + s.items.length, 0);
    styles.ok(
      `Found llms.txt — ${styles.bold(String(totalItems))} page${totalItems === 1 ? '' : 's'} across ${styles.bold(String(llms.parsed.sections.length))} section${llms.parsed.sections.length === 1 ? '' : 's'}${llms.parsed.title ? ` (${llms.parsed.title})` : ''}.`,
    );

    const rawKnownUrls = llms.parsed.sections.flatMap((s) =>
      s.items.map((i) => ({ title: i.text, url: i.url, description: i.description })),
    );

    // Dedupe llms.txt entries by pathname. Some sites (zod.dev, fumadocs) list
    // every in-page anchor as its own llms.txt row (`/v4?id=wrapping-up`,
    // `/v4?id=metadata`, …) even though they all live on one rendered page.
    // We prefer the "cleanest" URL per path — the shortest one, which is
    // usually the one without a query string or hash.
    const byKnownPath = new Map();
    for (const p of rawKnownUrls) {
      const key = normalizePath(p.url);
      const prev = byKnownPath.get(key);
      if (!prev || p.url.length < prev.url.length) byKnownPath.set(key, p);
    }
    knownUrls = Array.from(byKnownPath.values());
    const dropped = rawKnownUrls.length - knownUrls.length;
    if (dropped > 0) {
      styles.info(
        `${styles.dim(`Collapsed ${dropped} anchor/query duplicates → ${knownUrls.length} unique pages.`)}`,
      );
    }
  }

  console.log();
  const firecrawlKey = options.firecrawlKey || process.env.FIRECRAWL_API_KEY || null;
  styles.info(
    `Scraping sidebar nav from ${styles.bold(sourceUrl.toString())}${firecrawlKey ? ' ' + styles.dim('(via Firecrawl)') : ''}...`,
  );
  const scrapeStart = Date.now();
  const scraped = await timePhase('scrape nav', () => scrapeNavFromSite(sourceUrl.toString(), knownUrls, firecrawlKey));
  if (scraped) {
    const directMatches = scraped.categories.reduce((n, c) => n + c.pages.length, 0);
    if (knownUrls.length > 0) {
      const slotted = slotOrphansByPath(scraped, knownUrls);
      const totalMatched = scraped.categories.reduce((n, c) => n + c.pages.length, 0);
      styles.ok(
        `Scraped nav in ${styles.bold(formatDuration(Date.now() - scrapeStart))} — ${styles.bold(String(scraped.categories.length))} categor${scraped.categories.length === 1 ? 'y' : 'ies'}, ${styles.bold(String(directMatches))} direct matches + ${styles.bold(String(totalMatched - directMatches))} slotted by path = ${styles.bold(String(totalMatched))}/${knownUrls.length}.`,
      );
      if (slotted.length > 0) {
        const buckets = bucketOrphansByPathType(slotted, scraped);
        for (const b of buckets) scraped.categories.push(b);
        const summary = buckets
          .map((b) => `${styles.bold(String(b.pages.length))} in ${styles.bold(b.title)}`)
          .join(', ');
        styles.info(`${styles.bold(String(slotted.length))} orphan page${slotted.length === 1 ? '' : 's'} bucketed by URL type: ${summary}.`);
      }
    } else {
      // Discovery mode — scraped pages ARE our known pages. No orphans.
      // If everything landed in a single flat category (the sidebar had no
      // <h*>/<p> headers to split on), try to re-cluster by URL path
      // structure: pages that share a common prefix often live under the
      // same section in the site's real hierarchy.
      if (scraped.categories.length === 1) {
        const reclustered = clusterByUrlPath(scraped.categories[0].pages);
        if (reclustered) {
          scraped.categories = reclustered;
          styles.ok(
            `Scraped nav in ${styles.bold(formatDuration(Date.now() - scrapeStart))} — re-clustered by URL path into ${styles.bold(String(scraped.categories.length))} categor${scraped.categories.length === 1 ? 'y' : 'ies'}, ${styles.bold(String(directMatches))} pages discovered (no llms.txt).`,
          );
        } else {
          styles.ok(
            `Scraped nav in ${styles.bold(formatDuration(Date.now() - scrapeStart))} — ${styles.bold(String(scraped.categories.length))} categor${scraped.categories.length === 1 ? 'y' : 'ies'}, ${styles.bold(String(directMatches))} pages discovered (no llms.txt).`,
          );
        }
      } else {
        styles.ok(
          `Scraped nav in ${styles.bold(formatDuration(Date.now() - scrapeStart))} — ${styles.bold(String(scraped.categories.length))} categor${scraped.categories.length === 1 ? 'y' : 'ies'}, ${styles.bold(String(directMatches))} pages discovered (no llms.txt).`,
        );
      }
    }
  } else if (!llms) {
    styles.error(
      `No llms.txt and the sidebar scrape found no usable structure — can't import ${styles.bold(sourceUrl.toString())}.`,
    );
    process.exit(1);
  } else {
    styles.warning(`Couldn't extract a useful nav — falling back to llms.txt-based organization.`);
  }
  console.log();

  let organized;
  const organizeStart = Date.now();
  if (scraped) {
    // No Claude call — icons deferred. Use a neutral placeholder so the tree
    // view still prints cleanly.
    organized = {
      title: (llms && llms.parsed.title) || null,
      categories: scraped.categories.map((c) => ({ title: c.title, icon: null, pages: c.pages })),
    };
  } else {
    const fastPath = sectionsLookUsable(llms.parsed.sections);
    styles.info(
      `Organizing with Claude (${styles.bold(options.model)}, ${fastPath ? 'fast path: icons only' : 'full reorg'})...`,
    );
    organized = await timePhase('claude organize', () => organizeWithClaude(llms.parsed, options.model));
  }
  styles.ok(`Organized in ${styles.bold(formatDuration(Date.now() - organizeStart))}.`);
  console.log();

  console.log(`  ${styles.bold(organized.title || '(untitled)')}`);
  for (const cat of organized.categories || []) {
    console.log();
    const iconLabel = cat.icon ? `${styles.brand(`[${cat.icon}]`)} ` : '';
    console.log(`  ${iconLabel}${styles.bold(cat.title)}`);
    printPagesTree(cat.pages || [], 2);
  }

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-import-'));

  try {
    styles.info(`Staging frontmatter stubs in ${styles.bold(stagingDir)}...`);
    const stageStart = Date.now();
    const staged = await timePhase('stage stubs', async () => stageOrganized(organized, stagingDir));
    ensureDocsLandingPage(stagingDir, organized.title || sourceUrl.hostname);
    styles.ok(`Staged ${styles.bold(String(staged.fileCount))} stub${staged.fileCount === 1 ? '' : 's'} across ${styles.bold(String(staged.dirCount))} director${staged.dirCount === 1 ? 'y' : 'ies'} in ${styles.bold(formatDuration(Date.now() - stageStart))}.`);
    console.log();

    if (options.test) {
      styles.ok(`Done in ${styles.bold(formatDuration(Date.now() - startedAt))}! Staged ${styles.bold(String(staged.fileCount))} files at ${styles.bold(stagingDir)}`);
      console.log();
      styles.info('Starting the dev server for preview...');
      console.log();
      await runDevPreview(stagingDir);
      return;
    }

    if (staged.fileCount === 0) {
      styles.warning('Staging directory is empty — skipping zip.');
      return;
    }

    styles.info(`Packaging ${styles.bold(String(staged.fileCount))} files into ${styles.bold(outputZip)}...`);
    await timePhase('zip', () => createZip(stagingDir, outputZip));

    console.log();
    styles.ok(`Done in ${styles.bold(formatDuration(Date.now() - startedAt))}! Your ReadMe import is ready at ${styles.bold(outputZip)}`);
    console.log(styles.dim(`  ⏱  ${phases.map((p) => `${p.label} ${formatDuration(p.ms)}`).join(' · ')}`));
  } finally {
    if (!options.test) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  // Node won't exit on its own — the Claude SDK and fetch keep-alive both
  // hold open handles that idle for 20-30s before timing out. We're truly
  // done by this point, so force-exit to match wall time with the "Done in"
  // message.
  // Node won't exit on its own — the Claude SDK and fetch keep-alive hold
  // open handles that idle for 20-30s before timing out. Force-exit to match
  // wall time with the "Done in" message.
  process.exit(0);
}

/**
 * Import path for local OpenAPI spec files. The spec is copied verbatim into
 * `reference/` — the git-format build pipeline auto-generates endpoint pages
 * from the spec at render time, so we don't need to stub anything here.
 */
async function runOasImport(sourcePath, options, startedAt, phases, timePhase) {
  const absPath = path.resolve(sourcePath);
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    styles.error(`File not found: ${styles.bold(absPath)}`);
    process.exit(1);
  }
  const ext = path.extname(absPath).toLowerCase();
  if (!['.json', '.yaml', '.yml'].includes(ext)) {
    styles.error(`Unsupported file type ${styles.bold(ext || '(none)')} — expected .json, .yaml, or .yml.`);
    process.exit(1);
  }

  const basename = path.basename(absPath, ext);
  const outputZip = path.resolve(
    options.output || path.join(process.cwd(), `${basename}-readme.zip`),
  );

  console.log();
  styles.info(`Importing OpenAPI spec from ${styles.bold(absPath)}`);
  if (!options.test) styles.info(`Output: ${styles.bold(outputZip)}`);
  console.log();

  // Parse + sanity-check it's actually an OAS before we stage anything.
  // We do this in two stages: a cheap parse + looks-like-OAS check (fail
  // fast on clearly wrong inputs), then a normalize step that will repair
  // fixable issues (Swagger 2 → OpenAPI 3 conversion, bundling $refs, etc.).
  const { spec, opCount, wasFixed, fixReason } = await timePhase('parse spec', async () => {
    const raw = fs.readFileSync(absPath, 'utf-8');
    let parsed;
    try {
      parsed = ext === '.json' ? JSON.parse(raw) : yamlRequire().load(raw);
    } catch (e) {
      styles.error(`Couldn't parse ${styles.bold(absPath)} as ${ext === '.json' ? 'JSON' : 'YAML'}: ${e.message}`);
      process.exit(1);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      styles.error(`File isn't a usable object: ${styles.bold(absPath)}`);
      process.exit(1);
    }
    if (!looksLikeOas(parsed)) {
      styles.error(
        `Not an OpenAPI/Swagger spec — no top-level ${styles.bold('openapi')} / ${styles.bold('swagger')} field and no ${styles.bold('paths')} section.`,
      );
      process.exit(1);
    }

    // Normalize via oas-normalize. `bundle()` handles the common fix-ups:
    // Swagger 2 → OpenAPI 3, Postman collection → OpenAPI, inline $ref
    // resolution. We try it first (even on apparently-valid specs) so Postman
    // collections actually get converted. If bundle errors we fall back to
    // the original spec when it passes validate, else fail hard.
    const normalizer = new OASNormalize(parsed);
    try {
      const bundled = await normalizer.bundle();
      const changed = JSON.stringify(bundled) !== JSON.stringify(parsed);
      return {
        spec: bundled,
        opCount: countOperations(bundled),
        wasFixed: changed,
        fixReason: changed ? 'normalized (Swagger 2 → OpenAPI 3, Postman conversion, or $ref inlining)' : null,
      };
    } catch (bundleErr) {
      try {
        await normalizer.validate();
        return { spec: parsed, opCount: countOperations(parsed), wasFixed: false };
      } catch (validateErr) {
        styles.error(`Spec is invalid and couldn't be auto-fixed.`);
        styles.info(styles.dim(`  Validation error: ${validateErr.message.split('\n')[0]}`));
        styles.info(styles.dim(`  Fix attempt error: ${bundleErr.message.split('\n')[0]}`));
        process.exit(1);
      }
    }
  });

  if (wasFixed) {
    styles.warning(`Spec had issues — auto-fixed (${fixReason}).`);
  }

  const title = spec.info?.title || basename;
  const version = spec.info?.version || null;
  styles.ok(
    `Parsed OpenAPI ${version ? 'v' + version + ' ' : ''}spec — ${styles.bold(title)} (${styles.bold(String(opCount))} operation${opCount === 1 ? '' : 's'}).`,
  );
  console.log();

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-import-'));
  try {
    const { stagedName } = await timePhase('stage spec', async () => {
      // If we auto-fixed the spec, serialize the fixed version as JSON (always
      // writable, avoids YAML-ambiguity regressions). Otherwise copy the
      // original file verbatim so formatting/comments are preserved.
      const rawName = path.basename(absPath);
      let targetName;
      let targetContent;
      if (wasFixed) {
        targetName = rawName.replace(/\.(ya?ml|json)$/i, '.json');
        targetContent = JSON.stringify(spec, null, 2);
      } else {
        targetName = rawName;
        targetContent = null; // signal to copy
      }
      const targetPath = path.join(stagingDir, 'reference', targetName);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      if (targetContent === null) {
        fs.copyFileSync(absPath, targetPath);
      } else {
        fs.writeFileSync(targetPath, targetContent);
      }

      // syncOas walks reference/ and generates one <operationId>.md per
      // operation, grouped by tag. We pass stagingDir as the "git root" so
      // its refDir lookup lands on stagingDir/reference/.
      syncOas(stagingDir);
      return { stagedName: targetName };
    });

    // Ensure there's always at least a landing page — OAS-only imports leave
    // docs/ empty, which makes `--test` dev server show "no pages" at /.
    ensureDocsLandingPage(stagingDir, title, opCount);

    // OAS operation pages don't need an x-import URL — their content is
    // intrinsic to the spec (summary/description live in the OpenAPI doc,
    // and the page's `api:` frontmatter already points back to it).
    const pageCount = countReferencePages(stagingDir, stagedName);

    styles.ok(
      `Staged ${styles.bold(stagedName)} and generated ${styles.bold(String(pageCount))} operation page${pageCount === 1 ? '' : 's'} under ${styles.bold('reference/')}.`,
    );
    console.log();

    if (options.test) {
      styles.ok(`Done in ${styles.bold(formatDuration(Date.now() - startedAt))}! Staged at ${styles.bold(stagingDir)}`);
      console.log();
      styles.info('Starting the dev server for preview...');
      console.log();
      await runDevPreview(stagingDir);
      return;
    }

    await timePhase('zip', () => createZip(stagingDir, outputZip));

    console.log();
    styles.ok(`Done in ${styles.bold(formatDuration(Date.now() - startedAt))}! Your ReadMe import is ready at ${styles.bold(outputZip)}`);
    console.log(styles.dim(`  ⏱  ${phases.map((p) => `${p.label} ${formatDuration(p.ms)}`).join(' · ')}`));
  } finally {
    if (!options.test) fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  process.exit(0);
}

// js-yaml is installed transitively (via oas-sync.js) but not in our direct
// deps. Load it lazily on first use so the JSON-only path doesn't pay for it.
let _yaml = null;
function yamlRequire() {
  if (!_yaml) {
    const require = createRequire(import.meta.url);
    _yaml = require('js-yaml');
  }
  return _yaml;
}

/**
 * Cheap first-pass "does this look like an OpenAPI/Swagger spec?" check.
 * Accepts anything with a version field OR a paths section — some specs in
 * the wild drop the version; the follow-up oas-normalize pass will still
 * catch malformed inputs that slip through here.
 */
function looksLikeOas(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof obj.openapi === 'string' || typeof obj.swagger === 'string') return true;
  if (obj.paths && typeof obj.paths === 'object') return true;
  // Postman collections — oas-normalize auto-converts these to OpenAPI.
  if (obj.info && typeof obj.info.schema === 'string' && /getpostman\.com/i.test(obj.info.schema)) return true;
  return false;
}

function countOperations(spec) {
  let n = 0;
  for (const p of Object.values(spec.paths || {})) {
    for (const k of Object.keys(p || {})) {
      if (/^(get|post|put|patch|delete|options|head|trace)$/i.test(k)) n++;
    }
  }
  return n;
}

/**
 * Count operation pages syncOas just generated under reference/ for the
 * given spec file. Used only for the "generated N pages" success message.
 */
function countReferencePages(stagingDir, specFilename) {
  const refDir = path.join(stagingDir, 'reference');
  if (!fs.existsSync(refDir)) return 0;

  let count = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.md')) continue;

      const parsed = matter(fs.readFileSync(full, 'utf-8'));
      const fm = parsed.data || {};
      if (fm.api && fm.api.file === specFilename) count++;
    }
  };
  walk(refDir);
  return count;
}

/**
 * Write a `docs/Getting Started/getting-started.md` when there's no other
 * docs content (typical after an OAS-only import). Body includes a pointer
 * to the Reference tab so users know where the operations are — the dev
 * server only shows one sidebar section at a time, so a blank landing on
 * `/docs/...` makes it look like nothing imported.
 */
function ensureDocsLandingPage(stagingDir, siteTitle, opCount = 0) {
  const docsDir = path.join(stagingDir, 'docs');
  if (fs.existsSync(docsDir) && fs.readdirSync(docsDir).length > 0) return;

  const categoryDir = path.join(docsDir, 'Getting Started');
  fs.mkdirSync(categoryDir, { recursive: true });

  const name = siteTitle || 'your API';
  const title = siteTitle ? `Welcome to ${siteTitle}` : 'Getting Started';
  const body = opCount > 0
    ? `This import brought in **${opCount} API operation${opCount === 1 ? '' : 's'}** from ${name}.\n\n👉 [Browse the API Reference →](/reference)\n\nThis page is a placeholder landing. Replace or expand it with onboarding content specific to your API.\n`
    : `This is a placeholder landing page. Replace it with your docs.\n`;
  fs.writeFileSync(
    path.join(categoryDir, 'getting-started.md'),
    matter.stringify(body, { title, icon: 'rocket' }),
  );
  fs.writeFileSync(path.join(categoryDir, '_order.yaml'), '- getting-started\n');
  fs.writeFileSync(path.join(docsDir, '_order.yaml'), '- Getting Started\n');
}

/**
 * Run a Claude agent in the staging directory. Streams tool calls + assistant
 * text to the terminal. Writes are scoped to the staging dir.
 */
export async function runAgent({ userPrompt, systemPrompt, cwd, model }) {
  for await (const message of query({
    prompt: userPrompt,
    options: {
      cwd,
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
      permissionMode: 'acceptEdits',
      canUseTool: makeStagingGuard(cwd),
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(model ? { model } : {}),
    },
  })) {
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text?.trim()) {
          console.log(styles.dim(block.text.trim()));
        } else if (block.type === 'tool_use') {
          console.log(`${styles.brand('›')} ${styles.bold(block.name)}`);
        }
      }
    } else if (message.type === 'result') {
      if (message.subtype && message.subtype !== 'success') {
        const err = new Error(
          `Agent result subtype=${message.subtype}${message.error?.message ? ': ' + message.error.message : ''}`,
        );
        err.subtype = message.subtype;
        err.result = message;
        throw err;
      }
      return;
    }
  }
}

function makeStagingGuard(stagingDir) {
  const absStaging = path.resolve(stagingDir);
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit']);

  return async (toolName, input) => {
    if (!WRITE_TOOLS.has(toolName)) return { behavior: 'allow' };
    const fp = input?.file_path;
    if (typeof fp !== 'string' || !fp) {
      return { behavior: 'deny', message: `${toolName}: missing file_path` };
    }
    const abs = path.isAbsolute(fp) ? path.resolve(fp) : path.resolve(absStaging, fp);
    const rel = path.relative(absStaging, abs);
    const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (!inside) {
      styles.warning(`Blocked ${toolName} outside staging: ${fp}`);
      return {
        behavior: 'deny',
        message: `Writes must stay inside the staging directory ${absStaging}. Refused: ${fp}`,
      };
    }
    return { behavior: 'allow' };
  };
}

/**
 * Hand off to the dev command so the user can preview the staged docs. Runs
 * `npx @readme/cli-beta dev --no-check` in the staging directory. Stdout is
 * piped so we can forward it to the terminal AND detect the server's URL —
 * once seen, we open it in the user's default browser.
 */
function runDevPreview(stagingDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['--yes', '@readme/cli-beta', 'dev', '--no-check'], {
      cwd: stagingDir,
      stdio: ['inherit', 'pipe', 'inherit'],
    });

    let opened = false;
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      if (opened) return;
      const match = chunk.toString().match(/https?:\/\/localhost:\d+/);
      if (match) {
        opened = true;
        openUrl(match[0]);
      }
    });

    child.on('close', () => resolve());
    child.on('error', reject);
  });
}

function openUrl(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
    : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Best-effort — the URL is still in the terminal output for the user.
  }
}

function listFiles(dir, prefix = '') {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listFiles(path.join(dir, entry.name), rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

function createZip(sourceDir, outputZip) {
  fs.mkdirSync(path.dirname(outputZip), { recursive: true });
  if (fs.existsSync(outputZip)) fs.rmSync(outputZip);

  return new Promise((resolve, reject) => {
    const child = spawn('zip', ['-r', '-q', outputZip, '.'], {
      cwd: sourceDir,
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`zip exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

/**
 * Ask Claude to fold a parsed llms.txt into a category/hierarchy JSON object.
 * Returns { title, categories: [{ title, icon, pages: [{ title, url, description }] }] }.
 *
 * If the input already has sections, Claude is told to use them as starting
 * points and refine. If sections are missing or obviously generic ("Resources",
 * "English"), it invents better ones. Every category gets a FontAwesome icon.
 */
/**
 * Fetch the source URL, find the `<nav>` or `<aside>` that contains the most
 * links matching our known llms.txt URLs, and extract its heading/link
 * structure into { title, categories: [{ title, pages: [...] }] }.
 *
 * Generic approach — no site-specific selectors. Works on any docs site that
 * renders its sidebar server-side as <nav>/<aside> with <h*> section headers.
 * Returns null if coverage is too low to be useful.
 */
async function scrapeNavFromSite(sourceUrl, knownPages, firecrawlKey) {
  // Index known pages by normalized pathname so we can match nav hrefs against them.
  const byPath = new Map();
  for (const p of knownPages) byPath.set(normalizePath(p.url), p);

  const fetchHtml = firecrawlKey ? makeFirecrawlFetcher(firecrawlKey) : fetchHtmlDirect;

  const visited = new Set();
  const matched = new Map(); // normalizedPath → page
  const placed = new Set(); // URLs already placed into some category (prevents cross-category duplication when round-1 visits reshape the tree)
  const categoryByTitle = new Map();
  const categoryOrder = [];

  // Fetch one URL, pick its best nav block, and merge anything new into our
  // running tree. Each page on a typical docs site renders the full sidebar
  // with its own branch expanded, so repeated visits into different branches
  // accumulate coverage.
  async function visit(url) {
    const vkey = normalizePath(url);
    if (visited.has(vkey)) return 0;
    visited.add(vkey);

    const html = await fetchHtml(url);
    if (!html) return 0;

    const base = new URL(url);
    const blockRegex = /<(nav|aside)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let best = { count: 0, tree: null };
    let m;
    while ((m = blockRegex.exec(html)) !== null) {
      const tree = parseNavBlock(m[2], base, byPath);
      const count = tree.categories.reduce((n, c) => n + c.pages.length, 0);
      if (count > best.count) best = { count, tree };
    }

    // Fallback: some sites (Mintlify, custom stacks) don't wrap the sidebar
    // in <nav>/<aside> — it's just <h5 id="sidebar-title"> + <ul>/<li> in a
    // plain <div>. Parse the whole document, then filter out noise: drop
    // thin categories (<2 pages) and dedupe any URL that ends up in multiple
    // categories (first occurrence wins — the sidebar is usually near the top).
    if (best.count < 10) {
      const wholeTree = parseNavBlock(html, base, byPath);
      const seen = new Set();
      const filtered = [];
      for (const cat of wholeTree.categories) {
        const keptPages = filterDedupePages(cat.pages, seen);
        if (keptPages.length >= 2) filtered.push({ ...cat, pages: keptPages });
      }
      const filteredCount = filtered.reduce((n, c) => n + c.pages.length, 0);
      if (filteredCount > best.count) {
        best = { count: filteredCount, tree: { title: null, categories: filtered } };
      }
    }

    if (!best.tree) return 0;

    let added = 0;
    for (const cat of best.tree.categories) {
      let existing = categoryByTitle.get(cat.title);
      if (!existing) {
        existing = { title: cat.title, pages: [] };
        categoryByTitle.set(cat.title, existing);
        categoryOrder.push(existing);
      }
      added += mergePages(cat.pages, existing, matched);
    }
    return added;
  }

  /**
   * Merge `incoming` page tree into `target.pages`, recursing into sub-pages.
   * If a page already exists under `target`, we recurse into it to add any
   * newly-discovered children. If a page is globally `placed` under a
   * different category, we skip it — round-1 visits often reshape the tree
   * and we don't want the same URL to appear in multiple categories.
   * Returns the number of newly-added unique pages across the entire sub-tree.
   */
  function mergePages(incoming, target, matched) {
    let added = 0;
    for (const page of incoming) {
      const norm = normalizePath(page.url);
      let existing = target.pages.find((p) => p.url === page.url)
        || target.pages.find((p) => normalizePath(p.url) === norm);
      if (!existing) {
        // Already lives in a different category — don't add here.
        if (placed.has(norm)) {
          if (page.pages && page.pages.length > 0) {
            // Still merge its children into wherever the canonical page lives.
            const canonical = matched.get(norm);
            if (canonical) added += mergePages(page.pages, canonical, matched);
          }
          continue;
        }
        existing = {
          title: page.title,
          url: page.url,
          ...(page.description ? { description: page.description } : {}),
          pages: [],
        };
        target.pages.push(existing);
        placed.add(norm);
        if (!matched.has(norm)) { matched.set(norm, existing); added++; }
      }
      if (page.pages && page.pages.length > 0) {
        added += mergePages(page.pages, existing, matched);
      }
    }
    return added;
  }

  // Round 0: the source URL itself — reveals top-level + the source page's branch.
  const r0Start = Date.now();
  await visit(sourceUrl);
  const r0Ms = Date.now() - r0Start;
  if (categoryOrder.length === 0) return null;

  // Round 1 (parallel): visit pages so each branch has a chance to expose
  // its sub-items. Sidebars on most docs sites auto-expand the current
  // page's own branch on render, so visiting a rep per branch is what
  // surfaces those hidden children.
  //
  // With llms.txt (full mode) we already have a trusted page list and the
  // scrape has real category headers — one rep per scraped category is
  // enough. Without llms.txt (discovery mode) everything may have collapsed
  // into a single flat category and we don't yet know which of those pages
  // is a parent; visit all of them up to a cap.
  const isDiscovery = knownPages.length === 0;
  const MAX_DISCOVERY_FETCHES = 20;
  const r1Urls = isDiscovery
    ? flattenTree(categoryOrder).slice(0, MAX_DISCOVERY_FETCHES)
    : categoryOrder.map((c) => c.pages[0]).filter(Boolean).map((p) => toBrowsableUrl(p.url));
  const r1Start = Date.now();
  // Firecrawl standard-plan concurrency is 10; 5 leaves headroom for retries.
  // Native HTTP can run hotter since we're hitting our own loopback.
  await visitAllInParallel(r1Urls, visit, firecrawlKey ? 5 : 10);
  const r1Ms = Date.now() - r1Start;
  console.log(styles.dim(`  ⏱  scrape breakdown: round0=${formatDuration(r0Ms)} round1=${formatDuration(r1Ms)} (${r1Urls.length} ${isDiscovery ? 'discovery' : 'category rep'} fetches)`));

  // Accept thresholds — looser in discovery mode (no llms.txt) where even a
  // single flat "Overview" bucket is better than nothing, stricter when we
  // have llms.txt to compare against.
  const categories = categoryOrder.filter((c) => c.pages.length > 0);
  if (isDiscovery) {
    if (categories.length < 1 || matched.size < 5) return null;
  } else {
    if (categories.length < 2 || matched.size < 10) return null;
  }
  return { title: null, categories };
}

/**
 * Walk a nav block in document order, splitting links into categories at each
 * <h*> heading. Links whose hrefs resolve to a known page land in the current
 * category (or a leading "Overview" bucket if they appear before any heading).
 */
function parseNavBlock(blockHtml, base, byPath) {
  // Five alternatives, carefully ordered for regex semantics:
  //  1. <h*>…</h*>       — classic heading
  //  2. <a href="…">…</a> — link (matched greedily as a unit, so inner <p>
  //     tags inside link text are consumed and NOT treated as headings)
  //  3. <p>…</p>          — bare paragraph used as section heading by
  //     fumadocs (zod.dev) and similar frameworks
  //  4. <ul …>            — start of nested list → subsequent <a>s are
  //     children of the most recently emitted <a> at the outer level
  //  5. </ul>             — close of nested list → pop parent stack
  const tokenRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>|<p\b[^>]*>([\s\S]*?)<\/p>|<ul\b[^>]*>|<\/ul>/gi;

  const categories = [];
  let current = null;
  let leading = null;
  // Stack of parent page objects. When inside a nested <ul>, new links attach
  // to the top of the stack (= the <a> that preceded the opening <ul>).
  const parentStack = [];
  // The most recent link we emitted, at the current depth. Becomes the parent
  // if a <ul> opens next.
  let lastLinkAtDepth = null;

  const resetCategoryState = () => {
    parentStack.length = 0;
    lastLinkAtDepth = null;
  };

  let m;
  while ((m = tokenRegex.exec(blockHtml)) !== null) {
    const token = m[0];

    if (/^<\/ul\b/i.test(token)) {
      parentStack.pop();
      lastLinkAtDepth = null;
      continue;
    }
    if (/^<ul\b/i.test(token)) {
      // A <ul> opening right after a link means that link becomes a parent.
      if (lastLinkAtDepth) parentStack.push(lastLinkAtDepth);
      lastLinkAtDepth = null;
      continue;
    }

    if (m[1]) {
      const title = stripTags(m[2]).trim();
      if (!title) continue;
      current = { title, pages: [] };
      categories.push(current);
      resetCategoryState();
      continue;
    }
    if (m[5] !== undefined) {
      const title = stripTags(m[5]).trim();
      if (!title || title.length > 60 || /[.!?]\s*$/.test(title)) continue;
      current = { title, pages: [] };
      categories.push(current);
      resetCategoryState();
      continue;
    }

    // Link.
    const href = m[3];
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) continue;
    let abs;
    try { abs = new URL(href, base).toString(); } catch { continue; }

    // byPath is populated from llms.txt. When it's empty we're in discovery
    // mode — fall back to synthesizing a page entry from the link itself,
    // filtered to same-origin non-asset URLs so we don't slurp every footer,
    // social, or static file link on the page.
    let page = byPath.size > 0 ? byPath.get(normalizePath(abs)) : null;
    if (!page && byPath.size === 0) {
      if (!isDiscoverableLink(abs, base)) continue;
      const text = stripTags(m[4] || '').trim();
      if (!text || text.length > 150) continue;
      page = { title: text, url: abs };
    }
    if (!page) continue;

    const parent = parentStack.length > 0
      ? parentStack[parentStack.length - 1]
      : (current || (leading || (leading = { title: 'Overview', pages: [] })));
    if (leading && parent === leading && categories[0] !== leading) categories.unshift(leading);

    const existing = parent.pages.find((p) => p.url === page.url);
    if (existing) {
      lastLinkAtDepth = existing;
    } else {
      const newPage = {
        title: page.title,
        url: page.url,
        ...(page.description ? { description: page.description } : {}),
        pages: [],
      };
      parent.pages.push(newPage);
      lastLinkAtDepth = newPage;
    }
  }

  return { title: null, categories: categories.filter((c) => c.pages.length > 0) };
}

/**
 * Group orphans by the second-to-last URL path segment (the "type" segment,
 * e.g. `/main/docs/about` → "docs", `/main/reference/xyz` → "reference"). This
 * separates API reference, changelog, and general docs into their own top-
 * level categories instead of dumping them into one big "Other".
 *
 * Uses distinctive titles — just "Docs" or "Reference" — rather than the raw
 * segment name. Falls back to "Other" when the path has no usable type.
 */
function bucketOrphansByPathType(orphans, scraped) {
  const TYPE_TITLES = {
    reference: 'API Reference',
    api: 'API Reference',
    changelog: 'Changelog',
    release: 'Release Notes',
    releases: 'Release Notes',
    recipes: 'Recipes',
    recipe: 'Recipes',
    guides: 'Guides',
    docs: 'Other Docs',
    doc: 'Other Docs',
  };
  // Segments that look like version/locale prefixes, not category types.
  // Walked from the end until we find a real category-type segment.
  const VERSION_LOCALE = /^(v?\d+(\.\d+)*|main|master|latest|stable|next|current|ent|enterprise|en|en-us|en_us|fr|de|es|ja|zh|ko|pt)$/i;
  const existingTitles = new Set(scraped.categories.map((c) => c.title));
  const byType = new Map();

  for (const p of orphans) {
    let type = null;
    try {
      const segs = new URL(p.url).pathname.split('/').filter(Boolean);
      // Walk from the segment-before-slug backwards; skip version/locale segments.
      for (let i = segs.length - 2; i >= 0; i--) {
        if (!VERSION_LOCALE.test(segs[i])) { type = segs[i].toLowerCase(); break; }
      }
    } catch {}

    const rawTitle = type ? (TYPE_TITLES[type] || titleCase(type)) : 'Other';
    // Avoid a clash with an already-scraped category title.
    const title = existingTitles.has(rawTitle) ? `${rawTitle} (orphans)` : rawTitle;

    if (!byType.has(title)) byType.set(title, { title, pages: [] });
    byType.get(title).pages.push({
      title: p.title,
      url: p.url,
      ...(p.description ? { description: p.description } : {}),
    });
  }

  return Array.from(byType.values()).sort((a, b) => b.pages.length - a.pages.length);
}

function titleCase(s) {
  return String(s)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The scraped nav only contains top-level items; subcategory pages sit behind
 * `>` chevrons and don't render on a cold fetch. For each llms.txt URL not
 * already in the scrape, find the scraped page whose URL path is the longest
 * ancestor of it, and drop the orphan into that page's category. Returns any
 * orphans that still have no ancestor match.
 */
function slotOrphansByPath(scraped, knownPages) {
  const matched = new Set();
  const pathToCategory = new Map(); // normalizedPath → category
  for (const cat of scraped.categories) {
    for (const p of cat.pages) {
      const norm = normalizePath(p.url);
      matched.add(norm);
      pathToCategory.set(norm, cat);
    }
  }

  const orphans = [];
  for (const p of knownPages) {
    const norm = normalizePath(p.url);
    if (matched.has(norm)) continue;

    let bestCat = null;
    let bestLen = -1;
    for (const [navPath, cat] of pathToCategory) {
      if (navPath && (norm === navPath || norm.startsWith(navPath + '/'))) {
        if (navPath.length > bestLen) { bestCat = cat; bestLen = navPath.length; }
      }
    }

    if (bestCat) {
      bestCat.pages.push({
        title: p.title,
        url: p.url,
        ...(p.description ? { description: p.description } : {}),
      });
      matched.add(norm);
    } else {
      orphans.push(p);
    }
  }
  return orphans;
}

/**
 * Flatten a tree of categories → pages → sub-pages into a linear list of URLs
 * (depth-first, in-order). Used to enumerate every URL we want to re-visit
 * during round 1 of scraping.
 */
/**
 * Walk a tree of pages+sub-pages and drop any whose URL is already in `seen`.
 * First occurrence wins — this is used by the whole-body fallback to keep the
 * sidebar's first appearance of each page and drop duplicates that end up
 * under landing-page headings.
 */
function filterDedupePages(pages, seen) {
  const out = [];
  for (const p of pages) {
    const norm = normalizePath(p.url);
    if (seen.has(norm)) continue;
    seen.add(norm);
    const childPages = p.pages ? filterDedupePages(p.pages, seen) : [];
    out.push({ ...p, pages: childPages });
  }
  return out;
}

function flattenTree(categories) {
  const out = [];
  function walk(pages) {
    for (const p of pages || []) {
      out.push(toBrowsableUrl(p.url));
      if (p.pages && p.pages.length > 0) walk(p.pages);
    }
  }
  for (const c of categories || []) walk(c.pages);
  return out;
}

/**
 * llms.txt often lists URLs with a `.md` extension — those are raw markdown
 * endpoints, not the rendered HTML page that has the sidebar. Strip the
 * extension so we fetch the human-facing page instead.
 */
function toBrowsableUrl(url) {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\.(md|mdx)$/i, '');
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Native-fetch HTML loader. Returns the body string or empty string on failure.
 */
async function fetchHtmlDirect(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'readme-cli-import' },
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * Firecrawl-backed HTML loader. Firecrawl runs a real browser, waits for
 * hydration, and returns the rendered DOM — which is what we need for sites
 * that render their sidebar nav client-side (zod.dev, most Next.js docs).
 *
 * Returns a function with the same (url) → html string contract as fetchHtmlDirect
 * so scrapeNavFromSite doesn't need to care which backend is in use.
 */
function makeFirecrawlFetcher(apiKey) {
  return async function fetchHtmlViaFirecrawl(url) {
    try {
      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['rawHtml'],
          // Wait a bit for client-side frameworks to hydrate the sidebar.
          waitFor: 2000,
          // Block common ad/tracking domains so we don't burn time on them.
          blockAds: true,
        }),
      });
      if (!res.ok) {
        styles.warning(`Firecrawl HTTP ${res.status} for ${url}`);
        return '';
      }
      const body = await res.json();
      if (!body.success) {
        styles.warning(`Firecrawl error for ${url}: ${body.error || 'unknown'}`);
        return '';
      }
      return body.data?.rawHtml || body.data?.html || '';
    } catch (e) {
      styles.warning(`Firecrawl fetch failed for ${url}: ${e.message}`);
      return '';
    }
  };
}

/**
 * Run `visit(url)` across `urls` with at most `concurrency` in flight at once.
 * Order of completion doesn't matter — visit() merges into shared state.
 */
async function visitAllInParallel(urls, visit, concurrency) {
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      await visit(urls[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
}

/**
 * Namespace = origin + first meaningful path segment (skipping version/locale
 * prefixes like /main, /en, /v1). Pages in different namespaces live under
 * different sidebars on typical multi-product docs sites, so cross-namespace
 * follow-up fetches don't help coverage.
 */
function urlNamespace(url) {
  const NS_SKIP = /^(v?\d+(\.\d+)*|main|master|latest|stable|next|current|ent|enterprise|en|en-us|en_us|fr|de|es|ja|zh|ko|pt)$/i;
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    let ns = '';
    for (const s of segs) {
      if (!NS_SKIP.test(s)) { ns = s.toLowerCase(); break; }
    }
    return `${u.origin}/${ns}`;
  } catch {
    return '';
  }
}

/**
 * Re-cluster a flat page list by URL path structure. When the sidebar scrape
 * found links but no <h*>/<p> headers to split on, everything ends up in one
 * big bucket. URLs often encode the site's real hierarchy, though — if many
 * pages share `/foo/bar/<slug>.html` and a few others share `/foo/baz/<slug>`,
 * "bar" and "baz" are almost certainly section names.
 *
 * Algorithm:
 *  1. Find the longest path prefix ALL pages share (the "base").
 *  2. Take the segment immediately after the base — this is the category key.
 *  3. Group pages by that key; the key value (title-cased) is the category.
 *  4. Only accept the result if it produces >=2 categories AND at least one
 *     category has >=2 pages. Otherwise the clustering is too sparse — every
 *     page lives in its own category and we'd just be renaming "Overview".
 */
function clusterByUrlPath(pages) {
  if (!pages || pages.length < 3) return null;

  const parts = pages.map((p) => {
    try { return new URL(p.url).pathname.split('/').filter(Boolean); } catch { return []; }
  });
  if (parts.some((pp) => pp.length === 0)) return null;

  // Longest common prefix depth.
  let commonDepth = 0;
  while (commonDepth < parts[0].length) {
    const seg = parts[0][commonDepth];
    if (!parts.every((pp) => pp[commonDepth] === seg)) break;
    commonDepth++;
  }

  // The segment right after the common base is the category key.
  const keyIdx = commonDepth;
  const byKey = new Map();
  for (let i = 0; i < pages.length; i++) {
    const key = parts[i][keyIdx];
    // Skip pages that have no segment at the cluster index (they're AT the
    // common base — those would become their own "index"-like category).
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(pages[i]);
  }

  // Reject weak clusterings: need at least 2 groups AND at least one group
  // with multiple pages (otherwise every "category" is a single page, which
  // is just Overview renamed).
  if (byKey.size < 2) return null;
  if (![...byKey.values()].some((arr) => arr.length >= 2)) return null;

  // Preserve first-appearance order so the sidebar reflects source order.
  const firstSeen = new Map();
  pages.forEach((p, i) => {
    const key = parts[i][keyIdx];
    if (key && !firstSeen.has(key)) firstSeen.set(key, i);
  });
  const orderedKeys = [...byKey.keys()].sort((a, b) => firstSeen.get(a) - firstSeen.get(b));

  const rawClusters = orderedKeys.map((key) => ({
    title: titleCase(key),
    pages: byKey.get(key),
  }));

  // A cluster with exactly one top-level page is NOT a real category — it's
  // a parent page with children wrapped in a pseudo-category label. Categories
  // are grouping labels with no content of their own; parent pages have
  // content AND children. Collect those singletons into a shared
  // "Documentation" bucket so they're siblings at the top level, each with
  // their own sub-tree intact.
  const multipageClusters = rawClusters.filter((c) => c.pages.length >= 2);
  const singletonPages = rawClusters
    .filter((c) => c.pages.length === 1)
    .flatMap((c) => c.pages);

  const out = [];
  if (singletonPages.length > 0) {
    out.push({ title: 'Documentation', pages: singletonPages });
  }
  out.push(...multipageClusters);

  // If we didn't actually produce any multi-page cluster, clustering added no
  // value — every page was a singleton and we'd just have renamed Overview.
  // Tell the caller to stick with the original flat shape.
  if (multipageClusters.length === 0) return null;
  return out;
}

/**
 * Used by discovery-mode scraping (no llms.txt) to decide whether a nav
 * link is worth importing as a doc page. Filters out cross-origin links,
 * asset file types, build artifacts, and anchors-on-same-page.
 */
function isDiscoverableLink(abs, base) {
  let u;
  try { u = new URL(abs); } catch { return false; }
  if (u.origin !== base.origin) return false;
  const p = u.pathname.toLowerCase();
  if (!p || p === '/') return false;
  if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|pdf|zip|tar|gz|woff2?|ttf|mp4|mp3)$/i.test(p)) return false;
  if (p.startsWith('/_next/') || p.startsWith('/__/') || p.includes('/static/') || p.includes('/assets/')) return false;
  return true;
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, ''));
}

/**
 * Decode the common HTML entities that show up inside <a>/<p>/<h*> tag text.
 * The sidebar/nav scrapers feed their output straight into frontmatter titles
 * and on-page headings, so leaving `&amp;` raw produces titles like
 * "New Features &amp; Upgrade Changes". This covers the named entities we
 * see in practice plus numeric and hex forms.
 */
function decodeEntities(s) {
  if (!s || s.indexOf('&') === -1) return s;
  return s
    .replace(/&(?:#x([0-9a-f]+)|#(\d+));/gi, (_, hex, dec) => {
      const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”');
}

/**
 * Reduce a URL to a comparable pathname: lowercase host, strip trailing slash
 * and common suffixes (.md, .html) so `/foo/bar.md` and `/foo/bar` match.
 */
function normalizePath(url) {
  try {
    const u = new URL(url);
    let p = u.pathname.replace(/\/$/, '').toLowerCase();
    p = p.replace(/\.(md|mdx|html?)$/i, '');
    return p;
  } catch {
    return String(url).toLowerCase();
  }
}

/**
 * Given a set of scraped categories + orphan pages that didn't match the nav
 * or any path ancestor, ask Claude to slot each orphan into an existing
 * category by index. Output is a compact array of indices (or -1 for none),
 * so token count stays low. Mutates `scraped.categories[*].pages`.
 * Returns the orphans Claude couldn't slot.
 */
async function slotOrphansWithClaude(scraped, orphans, model) {
  const systemPrompt = [
    'You assign orphan documentation pages to existing categories.',
    'Output ONLY a valid JSON array of integers — one per orphan page, in order.',
    'Each integer is the category index (0-based) the orphan belongs in, or -1 if none fit.',
    '',
    'Example output: [0, 2, 0, 1, -1, 3]',
    '',
    'Guidance:',
    '- Choose the best semantic fit based on the orphan\'s title and URL path.',
    '- Only use -1 when no existing category is plausible.',
  ].join('\n');

  const catList = scraped.categories.map((c, i) => {
    const sample = c.pages.slice(0, 3).map((p) => p.title).join(', ');
    return `${i}. ${c.title}${sample ? ` (e.g. ${sample})` : ''}`;
  });

  const orphanList = orphans.map((p, i) => {
    let relPath = p.url;
    try { relPath = new URL(p.url).pathname; } catch {}
    return `${i}. ${p.title} — ${relPath}`;
  });

  const userPrompt = [
    'Categories:',
    ...catList,
    '',
    `${orphans.length} orphan pages to slot:`,
    ...orphanList,
    '',
    `Output a JSON array of ${orphans.length} integers, one per orphan in order (category index 0..${scraped.categories.length - 1}, or -1 for none).`,
  ].join('\n');

  const raw = await runJsonQuery({ systemPrompt, userPrompt, model });
  if (!Array.isArray(raw)) {
    // If the model didn't cooperate, return all orphans unassigned.
    return orphans;
  }

  const leftover = [];
  orphans.forEach((p, i) => {
    const idx = Number.isInteger(raw[i]) ? raw[i] : -1;
    if (idx >= 0 && idx < scraped.categories.length) {
      scraped.categories[idx].pages.push({
        title: p.title,
        url: p.url,
        ...(p.description ? { description: p.description } : {}),
      });
    } else {
      leftover.push(p);
    }
  });
  return leftover;
}

/**
 * We already have the category structure from the scraped nav; we just need
 * one FontAwesome icon per category. Tiny Claude call, fast.
 */
async function iconizeScrapedNav(scraped, _unused, model, siteTitle) {
  const systemPrompt = [
    'You assign one FontAwesome Free Solid icon to each documentation category.',
    'Output ONLY a valid JSON array of icon name strings, one per input category, in order.',
    'Use the icon name only (no "fa-" prefix, no object wrapper).',
    '',
    'Example output: ["rocket", "book", "code", "gear"]',
  ].join('\n');

  const userPrompt = [
    `${scraped.categories.length} categories:`,
    '',
    ...scraped.categories.map((c, i) => `${i}. ${c.title}`),
    '',
    'Return a JSON array of FontAwesome icon names, one per category, in order.',
  ].join('\n');

  const icons = await runJsonQuery({ systemPrompt, userPrompt, model });
  const iconArr = Array.isArray(icons) ? icons : [];
  return {
    title: siteTitle || null,
    categories: scraped.categories.map((c, i) => ({
      title: c.title,
      icon: iconArr[i] || 'folder',
      pages: c.pages,
    })),
  };
}

/**
 * Sections are "usable" when the llms.txt already did the hard grouping work
 * for us — meaningful titles, not too many/few, each populated. When usable we
 * take a fast path that only asks Claude for icons + title polish instead of
 * re-bucketing every page, which is the slow part of a full reorg.
 */
function sectionsLookUsable(sections) {
  if (!sections || sections.length < 3 || sections.length > 40) return false;
  const GENERIC = /^(resources?|english|root url|pages?|docs?|documentation|content|available languages.*|site|sitemap|index|home)$/i;
  for (const s of sections) {
    if (!s.title || GENERIC.test(s.title.trim())) return false;
    if (!s.items || s.items.length === 0 || s.items.length > 200) return false;
  }
  return true;
}

async function organizeWithClaude(parsed, model) {
  if (sectionsLookUsable(parsed.sections)) {
    return organizeFromSections(parsed, model);
  }
  return organizeFromScratch(parsed, model);
}

/**
 * Fast path: llms.txt sections look good, so keep them 1:1 and ask Claude only
 * for a FontAwesome icon (and optional Title-Case cleanup) per section. Output
 * is O(sections), not O(pages), so this is usually ~5-15s vs. a full reorg.
 */
async function organizeFromSections(parsed, model) {
  const systemPrompt = [
    'You assign a FontAwesome Free Solid icon to each documentation section, and lightly polish the section title.',
    'Output ONLY a valid JSON array — no prose, no markdown, no code fences.',
    '',
    'Schema:',
    '[',
    '  { "title": "<lightly polished Title Case, 1-4 words>", "icon": "<fontawesome icon name, no fa- prefix>" },',
    '  ...',
    ']',
    '',
    'Rules:',
    '- Return exactly one entry per input section, in the same order.',
    '- Keep the original title unless it clearly benefits from Title Case fixes; do not rename for topic/tone.',
    '- Pick an icon that semantically fits the section (e.g. rocket for Getting Started, code for API, plug for Integrations).',
  ].join('\n');

  const userPrompt = [
    `Site title: ${parsed.title || '(unknown)'}`,
    `${parsed.sections.length} sections:`,
    '',
    ...parsed.sections.map((s, i) => `${i}. ${s.title} (${s.items.length} pages)`),
    '',
    'Output the JSON array now.',
  ].join('\n');

  const raw = await runJsonQuery({ systemPrompt, userPrompt, model });
  if (!Array.isArray(raw)) {
    throw new Error('Fast-path expected a JSON array of {title, icon} entries.');
  }

  const categories = parsed.sections.map((s, i) => {
    const meta = raw[i] || {};
    return {
      title: meta.title || s.title,
      icon: meta.icon || 'folder',
      pages: s.items.map((it) => ({
        title: it.text,
        url: it.url,
        ...(it.description ? { description: it.description } : {}),
      })),
    };
  });

  return { title: parsed.title || null, categories };
}

async function organizeFromScratch(parsed, model) {
  const systemPrompt = [
    'You organize documentation pages into a category hierarchy for a ReadMe-style docs site.',
    'Output ONLY a valid JSON object that matches the schema below — no prose, no markdown, no code fences.',
    '',
    'Schema:',
    '{',
    '  "title": "<short site or doc title>",',
    '  "categories": [',
    '    {',
    '      "title": "<Title Case, 1-4 words>",',
    '      "icon": "<FontAwesome solid icon name, e.g. rocket, book, code, gear, plug, key, chart-line>",',
    '      "pageIds": [<integer id from the input list>, ...]',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Refer to pages by their integer `id` only — do NOT echo back titles, urls, or descriptions. The caller reconstructs full page data from the ids.',
    '- If the input sections look meaningful, use them as category starting points; merge or rename ones that are redundant, too-broad, or generic (e.g. "Resources", "English", "Root URL").',
    '- If the input sections are not useful, invent good categories from page titles and URLs.',
    '- Every category MUST include a FontAwesome Free Solid icon name that semantically fits the category theme. Use the icon name only (no "fa-" prefix).',
    '- Every input page id MUST appear in exactly one category. Do not drop or duplicate ids.',
    '- Keep category titles human-readable, Title Case, 1-4 words.',
  ].join('\n');

  const items = parsed.sections.flatMap((s) =>
    s.items.map((i) => ({
      section: s.title,
      title: i.text,
      url: i.url,
      description: i.description || undefined,
    })),
  );

  // Compress the input Claude sees: id + title + relative path is enough to
  // categorize. Full URLs repeat the origin every row; descriptions rarely
  // change category assignment. The full item data is re-joined on our side
  // using `items[id]` once Claude returns pageIds.
  const compactLines = items.map((it, idx) => {
    let relPath = it.url;
    try { relPath = new URL(it.url).pathname + new URL(it.url).search; } catch {}
    return `${idx}\t${it.title}\t${relPath}`;
  });

  const userPrompt = [
    `Site title: ${parsed.title || '(unknown)'}`,
    `Origin: ${(() => { try { return new URL(items[0].url).origin; } catch { return '(unknown)'; } })()}`,
    `${items.length} pages to organize. Each line below is: \`id\\ttitle\\tpath\`.`,
    '',
    ...compactLines,
    '',
    `Output the organized JSON object now. Reference pages by \`pageIds\` (integers 0..${items.length - 1}) — do not echo page data back.`,
  ].join('\n');

  const raw = await runJsonQuery({ systemPrompt, userPrompt, model });

  // Rehydrate pages from the id references Claude returned.
  const expandedCategories = [];
  const usedIds = new Set();
  for (const cat of raw.categories || []) {
    const pages = [];
    for (const id of cat.pageIds || []) {
      const item = items[id];
      if (!item) continue; // ignore out-of-range ids
      if (usedIds.has(id)) continue; // ignore dupes
      usedIds.add(id);
      pages.push({
        title: item.title,
        url: item.url,
        ...(item.description ? { description: item.description } : {}),
      });
    }
    expandedCategories.push({ title: cat.title, icon: cat.icon, pages });
  }

  // Safety net: if Claude dropped any ids, park them under a leftover category
  // so we never silently lose pages.
  const missing = items
    .map((it, idx) => (usedIds.has(idx) ? null : { id: idx, ...it }))
    .filter(Boolean);
  if (missing.length > 0) {
    expandedCategories.push({
      title: 'Uncategorized',
      icon: 'folder',
      pages: missing.map((it) => ({
        title: it.title,
        url: it.url,
        ...(it.description ? { description: it.description } : {}),
      })),
    });
    styles.warning(`Claude missed ${missing.length} page${missing.length === 1 ? '' : 's'} — parked under "Uncategorized".`);
  }

  return { title: raw.title, categories: expandedCategories };
}

/**
 * Shared Claude call for "send a prompt, parse JSON back". Logs the prompts so
 * we can see what went in, runs a heartbeat so silent model latency doesn't
 * look like a hang, and strips stray code fences if the model adds them.
 */
async function runJsonQuery({ systemPrompt, userPrompt, model }) {
  console.log();
  console.log(styles.dim('─ system prompt ─'));
  console.log(styles.dim(systemPrompt));
  console.log(styles.dim('─ user prompt (first 80 lines) ─'));
  console.log(styles.dim(userPrompt.split('\n').slice(0, 80).join('\n')));
  const userLineCount = userPrompt.split('\n').length;
  if (userLineCount > 80) {
    console.log(styles.dim(`… (${userLineCount - 80} more lines)`));
  }
  console.log(styles.dim('─'.repeat(40)));
  console.log();

  const heartbeat = setInterval(() => process.stdout.write(styles.dim('.')), 1000);
  let text = '';
  try {
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
          throw new Error(
            `Claude failed: ${message.subtype}${message.error?.message ? ' — ' + message.error.message : ''}`,
          );
        }
        break;
      }
    }
  } finally {
    clearInterval(heartbeat);
    process.stdout.write('\n');
  }

  const stripped = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch (e) {
    throw new Error(
      `Claude returned invalid JSON: ${e.message}\n` +
      `Output length: ${stripped.length} chars. Likely hit the model's output limit — try --model sonnet.\n\n` +
      `First 500 chars:\n${stripped.slice(0, 500)}\n\n` +
      `Last 500 chars:\n${stripped.slice(-500)}`,
    );
  }
}

/**
 * Produce the ordered list of llms.txt URLs to probe for a given source URL.
 * Starts at the deepest path the user supplied and walks up one segment at a
 * time, ending at the origin root. Each level gets `<path>/llms.txt` appended.
 *
 * For https://mintlify.com/docs/quickstart:
 *   → https://mintlify.com/docs/quickstart/llms.txt
 *   → https://mintlify.com/docs/llms.txt
 *   → https://mintlify.com/llms.txt
 *
 * Returns deduped URLs in probe order.
 */
function buildLlmsCandidates(sourceUrl) {
  const out = [];
  const seen = new Set();
  const add = (url) => {
    if (!seen.has(url)) { seen.add(url); out.push(url); }
  };

  const origin = sourceUrl.origin;
  const segs = sourceUrl.pathname.split('/').filter(Boolean);
  for (let i = segs.length; i >= 0; i--) {
    const prefix = segs.slice(0, i).join('/');
    add(`${origin}${prefix ? '/' + prefix : ''}/llms.txt`);
  }
  return out;
}

/**
 * Best-effort fetch of a site's /llms.txt. Returns { ok, status, error, parsed }
 * where parsed is { title, sections: [{ title, items: [{ text, url, description }] }] }.
 */
async function fetchLlmsTxt(llmsUrl) {
  try {
    const res = await fetch(llmsUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'readme-cli-import' },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const text = await res.text();
    return { ok: true, status: res.status, parsed: parseLlmsTxt(text) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Parse the llms.txt format. `##` headings become sections;
 * `- [text](url): description` bullets become items. Items before any `##`
 * land in an implicit "Resources" section.
 */
function parseLlmsTxt(body) {
  const lines = body.split(/\r?\n/);
  let title = null;
  const sections = [];
  let current = null;

  const itemRe = /^\s*-\s*\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)(?:\s*[:—–-]\s*(.+))?/;

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1 && !title) { title = h1[1].trim(); continue; }

    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      current = { title: h2[1].trim(), items: [] };
      sections.push(current);
      continue;
    }

    const item = line.match(itemRe);
    if (item) {
      if (!current) {
        current = { title: 'Resources', items: [] };
        sections.push(current);
      }
      current.items.push({
        text: item[1].trim(),
        url: item[2].replace(/[.,;]+$/, ''),
        description: item[3] ? item[3].trim() : null,
      });
    }
  }

  return { title, sections };
}

/**
 * Write the organized hierarchy to disk as git-format markdown stubs — just
 * frontmatter, no body yet. docs/ pages go under docs/<Category>/<slug>.md;
 * reference/recipes/custom_pages/custom_blocks get their own top-level dir
 * without a category subfolder (the git-format schema doesn't nest them).
 * Writes _order.yaml per directory so sidebar order matches input order.
 */
/**
 * Recursively print the page tree. Sub-pages are indented under their parent
 * with no leading bullet character, to show them as children of the parent.
 */
function printPagesTree(pages, indentLevel) {
  const indent = '  '.repeat(indentLevel);
  for (const page of pages) {
    const desc = page.description ? ` ${styles.dim('— ' + page.description)}` : '';
    console.log(`${indent}${styles.dim('·')} ${page.title} ${styles.dim(page.url)}${desc}`);
    if (page.pages && page.pages.length > 0) {
      printPagesTree(page.pages, indentLevel + 1);
    }
  }
}

function stageOrganized(organized, stagingDir) {
  const pickIcon = makeIconPicker();
  const usedSlugs = new Set(); // cross-dir: duplicates validator is global
  const byDir = new Map();
  const subDirsByTopDir = new Map();
  const counts = { fileCount: 0 };

  /**
   * Write a page (and its descendants) into `dir`. A page with children gets
   * its own subfolder named after its slug; the parent page lives at
   * `<dir>/<slug>.md` while children live at `<dir>/<slug>/<childSlug>.md`.
   * This matches git-format's on-disk convention for nested sidebars.
   */
  function writePage(page, dir, topDir, isSubPage = false) {
    const slug = resolveSlug(deriveSlug(page.url, page.title), usedSlugs);
    usedSlugs.add(slug);

    const relFilePath = `${dir}/${slug}.md`;

    // Sub-pages don't get icons per design decision.
    const frontmatter = buildFrontmatter(topDir, page, slug, pickIcon, { skipIcon: isSubPage });
    // x-import points at the source URL for this stub. The content-import
    // step reads it to fetch the page body. x-prefixed custom field is the
    // git-format convention for metadata the schema doesn't know about.
    frontmatter['x-import'] = toBrowsableUrl(page.url);

    const absPath = path.join(stagingDir, relFilePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, matter.stringify('', frontmatter));
    counts.fileCount++;

    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(slug);

    const children = page.pages || [];
    if (children.length > 0) {
      const subDir = `${dir}/${slug}`;
      for (const child of children) writePage(child, subDir, topDir, true);
    }
  }

  for (const cat of organized.categories || []) {
    const { topDir, subDir } = routeCategory(cat.title);
    const dir = subDir ? `${topDir}/${subDir}` : topDir;
    if (subDir) {
      if (!subDirsByTopDir.has(topDir)) subDirsByTopDir.set(topDir, []);
      if (!subDirsByTopDir.get(topDir).includes(subDir)) subDirsByTopDir.get(topDir).push(subDir);
    }

    for (const page of cat.pages || []) writePage(page, dir, topDir, false);
  }

  // Per-directory _order.yaml preserves input order in the sidebar.
  for (const [dir, slugs] of byDir) {
    const orderPath = path.join(stagingDir, dir, '_order.yaml');
    const body = slugs.map((s) => `- ${yamlSafeSlug(s)}`).join('\n') + '\n';
    fs.writeFileSync(orderPath, body);
  }

  // Top-level _order.yaml (e.g. docs/_order.yaml) lists category subfolders.
  for (const [topDir, subs] of subDirsByTopDir) {
    const orderPath = path.join(stagingDir, topDir, '_order.yaml');
    const body = subs.map((s) => `- ${yamlSafeSlug(s)}`).join('\n') + '\n';
    fs.writeFileSync(orderPath, body);
  }

  return { fileCount: counts.fileCount, dirCount: byDir.size };
}

/**
 * Map a category title to the git-format top-level directory + optional
 * category subdir. docs/ is the only top dir that takes a subfolder.
 */
function routeCategory(title) {
  const t = (title || '').trim();
  if (/^(api[ -]?reference|reference|api|endpoints?)$/i.test(t)) return { topDir: 'reference', subDir: null };
  if (/^(recipes?|cookbook|tutorials?|how[ -]?tos?)$/i.test(t)) return { topDir: 'recipes', subDir: null };
  if (/^(custom[ -]?pages?|landing( page)?s?)$/i.test(t)) return { topDir: 'custom_pages', subDir: null };
  if (/^(custom[ -]?blocks?|snippets?|reusable( content)?)$/i.test(t)) return { topDir: 'custom_blocks', subDir: null };
  return { topDir: 'docs', subDir: t || 'Documentation' };
}

function buildFrontmatter(topDir, page, slug, pickIcon, opts = {}) {
  const fm = {};
  const title = (page.title || titleCase(slug)).trim();

  if (topDir === 'custom_blocks') {
    fm.name = title;
  } else {
    fm.title = title;
  }

  if (page.description && page.description.trim()) {
    fm.excerpt = page.description.trim();
  }

  // Sub-pages skip icons by design — the parent carries the nav icon, and
  // children render without one.
  if (opts.skipIcon) return fm;

  // Recipes use `recipe.icon` instead of a top-level `icon` (per git-format schema).
  const icon = pickIcon(slug, title);
  if (topDir === 'recipes') {
    fm.recipe = { color: '#018ef5', icon: icon || 'book-open' };
  } else if (topDir === 'docs' || topDir === 'reference') {
    fm.icon = icon;
  }

  return fm;
}

/**
 * Turn a URL's trailing segment into a filename-safe slug. Strips `.md`, kebabs
 * the result, drops any leading numeric prefix (common in imports).
 */
function deriveSlug(url, fallbackTitle) {
  let raw = '';
  try {
    const segs = new URL(url).pathname.split('/').filter(Boolean);
    raw = segs[segs.length - 1] || '';
  } catch {}
  raw = raw.replace(/\.(md|mdx|html?)$/i, '').replace(/^\d+[-_.]/, '');
  const slug = kebabCase(raw || fallbackTitle || 'page');
  return slug || 'page';
}

/**
 * If `slug` is already in use anywhere in the staging tree, try `slug-2`,
 * `slug-3`, etc. The duplicates validator flags same-slug collisions across
 * directories, not just within a directory, so uniqueness must be global.
 */
function resolveSlug(slug, usedSlugs) {
  if (!usedSlugs.has(slug)) return slug;
  let n = 2;
  while (usedSlugs.has(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

// Values YAML interprets as non-strings need quoting when used as _order entries.
const YAML_UNSAFE = /^(?:\d+\.?\d*|true|false|yes|no|on|off|null|~)$/i;
function yamlSafeSlug(slug) {
  return YAML_UNSAFE.test(slug) ? `"${slug}"` : slug;
}

function kebabCase(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'page';
}

// Keyword → FontAwesome icon. Ported from v1 (most-specific entries first).
// Each rule maps to an ordered list of candidates; the first unused-in-this-dir
// icon wins so sibling pages don't all share the same icon.
const ICON_RULES = [
  [/\b(getting[- ]?started|quick[- ]?start|intro|introduction|welcome|overview|start)\b/, ['rocket', 'door-open', 'flag', 'star']],
  [/\b(api[- ]?keys?|token|secrets?|credentials?|scopes?)\b/, ['key', 'key-skeleton', 'fingerprint']],
  [/\b(auth|authn|authentication|sign[- ]?in|login|oauth|sso|identity|saml|oidc)\b/, ['lock', 'shield-halved', 'id-badge']],
  [/\b(permissions?|roles?|access|authz|authorization|rbac|acl)\b/, ['user-lock', 'user-shield', 'user-tag']],
  [/\b(users?|accounts?|profiles?|members?|people)\b/, ['user', 'user-gear', 'id-card', 'circle-user']],
  [/\b(groups?|org(anizations?)?|teams?|workspaces?)\b/, ['users', 'people-group', 'user-group']],
  [/\b(sync|syncing|mirror|pipeline|webhooks?)\b/, ['arrows-rotate', 'shuffle', 'bell']],
  [/\b(projects?|apps?|applications?)\b/, ['folder', 'folder-open', 'folder-tree']],
  [/\b(errors?|troubleshoot|debug(ging)?|issues?)\b/, ['triangle-exclamation', 'bug', 'circle-xmark']],
  [/\b(rate[- ]?limits?|throttl|quota|limits?)\b/, ['gauge', 'gauge-high']],
  [/\b(pagination|cursor|paginate)\b/, ['list', 'list-ol', 'ellipsis']],
  [/\b(versioning|versions?|changelog|releases?|release[- ]?notes?)\b/, ['code-branch', 'code-fork', 'timeline']],
  [/\b(sdks?|libraries|clients?|packages?)\b/, ['cube', 'cubes', 'boxes-stacked']],
  [/\b(cli|command[- ]?line|terminal|shell)\b/, ['terminal', 'square-terminal']],
  [/\b(billing|invoices?|subscriptions?|plans?)\b/, ['credit-card', 'file-invoice-dollar']],
  [/\b(security|compliance|privacy|gdpr|soc|hipaa|encryption)\b/, ['shield', 'shield-check', 'lock-keyhole']],
  [/\b(search|query|filters?|lookup)\b/, ['magnifying-glass', 'filter']],
  [/\b(uploads?|files?|storage|assets?|media)\b/, ['cloud-arrow-up', 'file-arrow-up']],
  [/\b(downloads?|exports?)\b/, ['cloud-arrow-down', 'download']],
  [/\b(imports?|ingest|ingestion)\b/, ['file-import', 'inbox-in']],
  [/\b(graphql)\b/, ['diagram-project', 'sitemap']],
  [/\b(sandbox|test(ing)?|staging|preview)\b/, ['flask', 'vial', 'eye']],
  [/\b(analytics|metrics|usage|stats|dashboard|reports?|monitoring|observability)\b/, ['chart-line', 'chart-pie', 'chart-bar']],
  [/\b(integrations?|plugins?|extensions?|connectors?)\b/, ['plug', 'puzzle-piece']],
  [/\b(tutorials?|how[- ]?to|guides?|recipes?|walkthroughs?)\b/, ['book-open', 'book-open-reader', 'graduation-cap']],
  [/\b(reference|endpoints?|api|apis|operations?)\b/, ['code', 'brackets-curly', 'file-code']],
  [/\b(configuration|config|settings?|preferences|admin|administration)\b/, ['sliders', 'gear', 'wrench', 'screwdriver-wrench']],
  [/\b(faq|questions?|answers?|help|support)\b/, ['circle-question', 'circle-info', 'life-ring']],
  [/\b(migration|migrations?|upgrade|upgrades?|migrate)\b/, ['arrow-up-right', 'stairs']],
  [/\b(logs?|logging|audit|audits?|history)\b/, ['file-lines', 'clock-rotate-left', 'scroll']],
  [/\b(data|datasets?|database|db|tables?|schemas?)\b/, ['database', 'table', 'server']],
  [/\b(ai|ml|machine[- ]?learning|llm|models?)\b/, ['robot', 'brain', 'microchip']],
  [/\b(globe|language|locale|i18n|internationalization|translations?)\b/, ['globe', 'language', 'earth-americas']],
];

const DEFAULT_ICON_POOL = ['file-lines', 'file', 'bookmark', 'note-sticky', 'circle', 'square', 'diamond'];

function makeIconPicker() {
  const used = new Set();
  // Every icon we could ever return, deduped so the round-robin fallback
  // spreads evenly. Order puts rule icons first (semantically meaningful)
  // then defaults — this order is also the cycle order once the pool is
  // exhausted.
  const allIcons = Array.from(new Set([
    ...ICON_RULES.flatMap(([, icons]) => icons),
    ...DEFAULT_ICON_POOL,
  ]));
  let cycleIndex = 0;

  return function pickIcon(slug, title) {
    const haystack = `${slug || ''} ${title || ''}`.toLowerCase();

    // First pass: find a semantically-matching rule whose candidates aren't
    // all already taken globally.
    for (const [re, icons] of ICON_RULES) {
      if (!re.test(haystack)) continue;
      for (const icon of icons) {
        if (!used.has(icon)) { used.add(icon); return icon; }
      }
    }

    // No rule matched, or all matching rules' candidates are taken. Take the
    // first globally-unused icon from the full pool.
    for (const icon of allIcons) {
      if (!used.has(icon)) { used.add(icon); return icon; }
    }

    // Pool exhausted — spread reuse evenly via round-robin rather than
    // piling every remaining page onto one icon.
    const icon = allIcons[cycleIndex % allIcons.length];
    cycleIndex++;
    return icon;
  };
}

function formatDuration(ms) {
  const safe = Math.max(0, ms);
  // Show ms under a second so sub-second work doesn't misleadingly read as "0m 0s".
  if (safe < 1000) return `${Math.round(safe)}ms`;
  const totalSeconds = Math.round(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
