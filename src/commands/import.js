import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as styles from '../utils/styles.js';
import { hasClaude } from '../utils/claude.js';
import { collectFiles, runValidators } from '../utils/lint.js';
import { createHumanReporter } from '../utils/reporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  const claudeMdPath = path.join(__dirname, '../../vendor/git-format/CLAUDE.md');

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
    `6. **Recipes:** If the source contains code samples, an OAS/OpenAPI spec, or an SDK, generate 4-5 recipe pages in recipes/. Each recipe should be a practical how-to (e.g., "Authenticate and make your first request", "List and filter resources", "Handle pagination", "Error handling patterns", "Webhook setup"). Follow the recipe format: code blocks at the top, then # Heading sections with step-by-step explanations and <!-- lang@lines --> line highlights.`,
    `7. **Use MDX components** wherever they improve the docs:`,
    `   - Use <Tabs>/<Tab> for showing alternatives (e.g., different languages, different approaches)`,
    `   - Use tabbed code blocks (back-to-back fenced code blocks with NO blank lines) for multi-language code examples`,
    `   - Use <Accordion> for optional/advanced details the reader can expand`,
    `   - Use <Cards>/<Card> for navigation sections or feature overviews`,
    `   - Use <Columns>/<Column> for side-by-side content`,
    `   - Only use these built-in components — do NOT use <Callout>, <Note>, <Info>, <Steps>, or other non-standard components`,
    `8. Preserve the meaning and technical accuracy of the source content while adapting to git-format conventions`,
    `9. Use proper frontmatter for every page (title is required, add excerpt where helpful)`,
    `10. Use relative links between pages based on the published URL structure (not file paths)`,
  ].join('\n');

  console.log();
  styles.info(`Importing from ${styles.bold(resolvedFolder)}`);
  styles.info(styles.dim('Claude is reading and converting your content...'));
  console.log();

  const args = [
    '-p',
    prompt,
    '--allowedTools',
    'Bash,Read,Write,Edit',
  ];

  if (fs.existsSync(claudeMdPath)) {
    args.push('--append-system-prompt-file', claudeMdPath);
  }

  await new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: gitRoot,
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Claude exited with code ${code}`));
      }
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

  reporter.finish(files.length, results, files);

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
