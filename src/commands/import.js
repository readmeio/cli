import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as styles from '../utils/styles.js';
import { hasClaude } from '../utils/claude.js';
import { collectFiles, runValidators } from '../utils/lint.js';
import { createHumanReporter } from '../utils/reporter.js';

const require = createRequire(import.meta.url);

export const command = 'import';
export const description = 'Import content from an external folder using Claude';

export async function run(_options, _cmd, ctx) {
  const { gitRoot } = ctx;

  if (!hasClaude()) {
    styles.error('Claude is not installed. Install it from https://claude.ai/download to use this command.');
    process.exit(1);
  }

  const folder = await promptForFolder();
  const resolvedFolder = path.resolve(folder);

  if (!fs.existsSync(resolvedFolder) || !fs.statSync(resolvedFolder).isDirectory()) {
    styles.error(`Folder not found: ${styles.bold(resolvedFolder)}`);
    process.exit(1);
  }

  // Scan the source folder and show what we found
  const sourceFiles = listSourceFiles(resolvedFolder);
  if (sourceFiles.length === 0) {
    styles.error(`No files found in ${styles.bold(resolvedFolder)}`);
    process.exit(1);
  }

  console.log();
  styles.info(`Found ${styles.bold(String(sourceFiles.length))} files in ${styles.bold(resolvedFolder)}:`);
  console.log();
  for (const file of sourceFiles) {
    console.log(`  ${styles.dim('·')} ${file}`);
  }
  console.log();

  const confirmed = await confirm(`Import these files into ${styles.bold(gitRoot)}? This will run Claude to convert and organize them.`);
  if (!confirmed) {
    styles.info('Import cancelled.');
    return;
  }

  const claudeMdPath = path.join(path.dirname(require.resolve('@readmeio/git-format/package.json')), 'CLAUDE.md');

  const prompt = [
    `You are importing documentation into a ReadMe docs repo.`,
    ``,
    `Source folder: ${resolvedFolder}`,
    `Target repo: ${gitRoot}`,
    ``,
    `Instructions:`,
    `1. Read ALL files in the source folder (markdown, PDFs, OAS/OpenAPI specs, code files, etc.)`,
    `2. Convert and organize the content into the git-format structure in the target repo, following the CLAUDE.md conventions in your system prompt`,
    `3. **Split content into multiple focused pages.** Do NOT dump everything into one big page. Each distinct topic, concept, or section should be its own page file. If a source file covers multiple topics, split it into separate pages. Prefer more focused pages over fewer long ones.`,
    `4. Create proper directories (docs/, reference/, recipes/, etc.) with _order.yaml files for each`,
    `5. If the repo already has a default "Getting Started" or "hello-world" page with placeholder content, replace it with real content derived from the source material — write a genuine getting-started guide based on what was imported`,
    `6. **First / landing page:** The first page in the Getting Started category should feel like a real landing page, not a wall of text. Use <Cards> with icons to link to the main sections (e.g., quickstart, API reference, key concepts). Use <Columns> if there's a natural side-by-side layout (e.g., feature highlights). Keep the prose short — let the cards and layout do the work.`,
    `7. **Recipes:** If the source contains code samples, an OAS/OpenAPI spec, or an SDK, generate 4-5 recipe pages in recipes/. Each recipe should be a practical how-to (e.g., "Authenticate and make your first request", "List and filter resources", "Handle pagination", "Error handling patterns", "Webhook setup"). Follow the recipe format: code blocks at the top, then # Heading sections with step-by-step explanations and <!-- lang@lines --> line highlights.`,
    `8. **Use MDX components liberally** — these are a key feature of ReadMe and make docs look professional:`,
    `   - <Cards columns={2|3}>/<Card title="" icon="" href=""> — use on landing/overview pages to link to sub-sections, on any page that lists related topics, and wherever you'd otherwise have a bulleted list of links`,
    `   - <Tabs>/<Tab title=""> — use for language/framework alternatives, OS-specific instructions, different approaches to the same task`,
    `   - Tabbed code blocks (back-to-back fenced code blocks with NO blank lines between them) — use for multi-language code examples`,
    `   - <Accordion title="" icon=""> — use for FAQs, optional details, advanced configuration, troubleshooting sections`,
    `   - <Columns>/<Column> — use for side-by-side comparisons, feature highlights, or pairing text with diagrams`,
    `   - Only use these built-in components — do NOT use <Callout>, <Note>, <Info>, <Steps>, or other non-standard components`,
    `   - Aim to use at least one component on every page where it makes sense. Plain markdown walls of text should be the exception, not the rule.`,
    `9. Preserve the meaning and technical accuracy of the source content while adapting to git-format conventions`,
    `10. Use proper frontmatter for every page (title is required, add excerpt where helpful)`,
    `11. Use relative links between pages based on the published URL structure (not file paths)`,
  ].join('\n');

  console.log();

  const args = [
    prompt,
    '--allowedTools',
    'Bash,Read,Write,Edit',
  ];

  if (fs.existsSync(claudeMdPath)) {
    args.push('--append-system-prompt-file', claudeMdPath);
  }

  // Launch Claude interactively so the user sees the full TUI with tool calls
  // and file operations. stdio: 'inherit' hands the terminal over to Claude.
  // When Claude finishes and the user exits, control returns here.
  await new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: gitRoot,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      // User may exit Claude with Ctrl+C — that's fine, the work is done
      resolve(code);
    });

    child.on('error', (err) => {
      reject(err);
    });
  });

  console.log();
  styles.ok('Import complete! Running validation...');
  console.log();

  // Run lint to validate the imported content
  const files = collectFiles(gitRoot);
  const reporter = createHumanReporter();

  const results = await runValidators(files, gitRoot, {
    onFile: (f) => reporter.onFile(f),
    onBeforeCrossFile: () => reporter.pause(),
  });

  reporter.finish(files.length, results, files, { gitRoot });

  const hasErrors = results.some((r) => r.severity !== 'warning');
  if (hasErrors) {
    console.log();
    styles.info(`Run ${styles.bold(`${styles.binName()} lint --fix`)} to automatically fix some issues.`);
  }
}

function promptForFolder() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `${styles.brand('?')} What folder do you want to import from? ${styles.dim('(markdown, OAS files, PDFs, etc.)')}\n  ${styles.dim('›')} `,
      (answer) => {
        rl.close();
        resolve(answer.trim());
      },
    );
  });
}

function listSourceFiles(dir, prefix = '') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listSourceFiles(path.join(dir, entry.name), rel));
    } else {
      results.push(rel);
    }
  }
  return results;
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
