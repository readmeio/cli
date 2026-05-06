import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ora from "ora";
import * as styles from "./styles.js";
import { hasClaude } from "./claude.js";
import { hasGithubRemote, hasGithubWorkflow, getWorkflowVersion, WORKFLOW_VERSION, detectPlatform, hasReadmeWorkflow, PLATFORMS } from "./git.js";
import { getRandomTip } from "./tips.js";

const require = createRequire(import.meta.url);

const isRunningInClaude = !!process.env.CLAUDECODE;

const CATEGORY_LABELS = {
  custom_blocks: "custom blocks",
  docs: "docs",
  reference: "reference",
  custom_pages: "custom pages",
  recipes: "recipes",
};

function categorize(files) {
  const counts = new Map();
  for (const file of files) {
    const dir = file.split("/")[0];
    const label = CATEGORY_LABELS[dir] || dir;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()];
}

function splitResults(results) {
  const errors = results.filter((r) => r.severity !== "warning");
  const warnings = results.filter((r) => r.severity === "warning");
  return { errors, warnings };
}

/**
 * Style a result message for human display.
 * Title (before first ":") is colored, rest is normal with bold quoted values.
 */
function styleMessage(message, color) {
  // Strip "(fixed)" suffix — handled separately via the icon.
  const isFixed = message.endsWith("(fixed)");
  const raw = isFixed ? message.slice(0, -"(fixed)".length).trimEnd() : message;

  const colonIdx = raw.indexOf(":");
  let styled;

  if (colonIdx !== -1) {
    const title = raw.slice(0, colonIdx);
    const detail = raw
      .slice(colonIdx + 1)
      .replace(/"([^"]+)"/g, (_, val) => styles.bold(`"${val}"`));
    styled = `${color(title)}:${detail}`;
  } else {
    // No colon — highlight quoted values, keep rest normal.
    styled = raw.replace(/"([^"]+)"/g, (_, val) => styles.bold(`"${val}"`));
  }

  return styled;
}

function summaryLine(errorCount, warningCount) {
  const parts = [];
  if (errorCount > 0)
    parts.push(`${errorCount} ${errorCount === 1 ? "error" : "errors"}`);
  if (warningCount > 0)
    parts.push(
      `${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`,
    );
  return parts.join(" and ");
}

/**
 * Human-readable reporter with an animated spinner.
 */
export function createHumanReporter() {
  const spinner = ora({ text: "Running linting...", color: "blue" }).start();

  return {
    onFile(relativePath) {
      spinner.suffixText = styles.dim(relativePath);
    },

    pause() {
      spinner.stop();
    },

    finish(total, results, files, { fix, gitRoot } = {}) {
      spinner.suffixText = "";

      const { errors, warnings } = splitResults(results);
      const categories = categorize(files);
      const breakdown = categories
        .map(([label, count]) => `${count} ${label}`)
        .join(styles.dim(" · "));

      if (errors.length === 0 && warnings.length === 0) {
        spinner.succeed(`${total} files checked — all good!`);
        console.log(`  ${styles.dim(breakdown)}`);
        return;
      }

      if (errors.length > 0) {
        spinner.fail(
          `${summaryLine(errors.length, warnings.length)} in ${total} files`,
        );
      } else {
        spinner.warn(`${summaryLine(0, warnings.length)} in ${total} files`);
      }
      console.log(`  ${styles.dim(breakdown)}`);
      console.log();

      // Group all results by file
      const grouped = new Map();
      for (const r of [...errors, ...warnings]) {
        if (!grouped.has(r.file)) grouped.set(r.file, []);
        grouped.get(r.file).push(r);
      }

      for (const [file, fileResults] of grouped) {
        console.log(`  ${styles.bold(file)}`);
        for (const r of fileResults) {
          const baseColor = r.severity === "warning" ? styles.warn : styles.err;
          const isFixed = r.message.endsWith("(fixed)");
          const color = isFixed ? styles.success : baseColor;
          const styled = styleMessage(r.message, color);
          const icon = isFixed ? styles.success("✔") : baseColor("●");
          console.log(`    ${icon} ${styled}`);
        }
        console.log();
      }

      // Tips section.
      const fixable = !fix
        ? results.filter((r) => r.fixable && !r.message.endsWith("(fixed)"))
        : [];
      const unfixed = results.filter((r) => !r.message.endsWith("(fixed)"));
      const showTips =
        fixable.length > 0 || (unfixed.length > 0 && !isRunningInClaude);

      if (showTips) {
        console.log(`  ${styles.dim("─".repeat(40))}`);
        console.log();
      }

      if (fixable.length > 0) {
        console.log(
          `  ${styles.dim("Run")} ${styles.binName()} lint --fix ${styles.dim("to automatically fix some of these.")}`,
        );
        console.log();
      }

      if (unfixed.length > 0 && !isRunningInClaude) {
        const hasWorkflow = gitRoot ? hasGithubWorkflow(gitRoot) : true;
        const workflowVersion = gitRoot ? getWorkflowVersion(gitRoot) : null;
        const detection = gitRoot ? detectPlatform(gitRoot) : { recommended: null };
        const detectedPlatform = detection.recommended;
        const hasCiWorkflow = detectedPlatform && gitRoot
          ? hasReadmeWorkflow(gitRoot, detectedPlatform)
          : true;
        const tip = getRandomTip({
          isRunningInClaude,
          hasClaude: hasClaude(),
          hasGithubRemote: hasGithubRemote(),
          hasGithubWorkflow: hasWorkflow,
          workflowOutdated: hasWorkflow && workflowVersion !== null && workflowVersion < WORKFLOW_VERSION,
          detectedPlatform,
          detectedPlatformLabel: detectedPlatform ? PLATFORMS[detectedPlatform].label : null,
          hasCiWorkflow,
        });
        if (tip) tip.render();
      }

      // When running inside Claude, output instructions and structured issue list.
      if (isRunningInClaude && unfixed.length > 0) {
        const cliRoot = path.join(
          path.dirname(new URL(import.meta.url).pathname),
          "../..",
        );

        const gitFormatDir = path.dirname(require.resolve('@readmeio/git-format/package.json'));
        const claudeMdPath = path.join(gitFormatDir, "CLAUDE.md");
        const toolsMdPath = path.join(cliRoot, "vendor/TOOLS.md");
        const schemaPath = path.join(gitFormatDir, "frontmatter.schema.json");

        console.log("\n<claude-instructions>");

        if (fs.existsSync(toolsMdPath)) {
          console.log(fs.readFileSync(toolsMdPath, "utf-8"));
        }

        if (fs.existsSync(claudeMdPath)) {
          console.log(fs.readFileSync(claudeMdPath, "utf-8"));
        }

        if (fs.existsSync(schemaPath)) {
          console.log("\n## Frontmatter JSON Schema\n");
          console.log("```json");
          console.log(fs.readFileSync(schemaPath, "utf-8"));
          console.log("```");
        }

        console.log("</claude-instructions>\n");
        console.log("<issues>");
        for (const r of unfixed) {
          console.log(`- [${r.severity}] ${r.file}: ${r.message}`);
        }
        console.log("</issues>");
      }
    },
  };
}

/**
 * GitHub reporter — outputs a PR comment body as markdown.
 */
export function createGithubReporter() {
  return {
    onFile() {},
    pause() {},

    finish(total, results, _files, { gitRoot } = {}) {
      const { errors, warnings } = splitResults(results);
      const all = [...errors, ...warnings];

      // Build file links using GitHub Actions env vars
      const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
      const repo = process.env.GITHUB_REPOSITORY || "";
      const sha = process.env.GITHUB_SHA || "";
      const canLink = repo && sha;

      function fileLink(filePath) {
        const name = filePath.split("/").pop();
        if (canLink) {
          const encoded = filePath.split("/").map(encodeURIComponent).join("/");
          return `[\`${name}\`](${serverUrl}/${repo}/blob/${sha}/${encoded})`;
        }
        return `\`${name}\``;
      }

      let body = "<!-- readme-lint-results -->\n";
      body += "## ReadMe Docs Lint\n\n";

      if (all.length === 0) {
        body += "> **All checks passed!** No lint issues found.\n";
      } else {
        body += "| File | Message |\n";
        body += "|------|--------|\n";
        for (const r of all) {
          const isError = r.severity !== "warning";
          const label = isError ? "\u{1F534} **Error:**" : "\u{1F7E1} **Warning:**";
          body += `| ${fileLink(r.file)} | ${label} ${r.message} |\n`;
        }
        body += "\n";
        body += "> \u{1F4A1} **Tip:** Run `npx @readme/cli-beta lint --fix` locally to automatically fix some of these issues.\n\n";
      }

      // OAS change detection
      const baseSha = process.env.GITHUB_BASE_SHA;
      if (baseSha && gitRoot) {
        try {
          const changed = execSync(
            `git diff --name-only ${baseSha}..HEAD -- 'reference/*.json' 'reference/*.yaml' 'reference/*.yml'`,
            { cwd: gitRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
          ).trim();

          if (changed) {
            const files = changed.split("\n");
            body += "### OAS Changes Detected\n\n";
            body += "The following OpenAPI spec files were changed in this PR:\n\n";
            for (const f of files) {
              body += `- ${fileLink(f)}\n`;
            }
            body += "\nRun `npx @readme/cli-beta oas:sync` to sync these changes to ReadMe.\n\n";
          }
        } catch {
          // git diff failed — skip OAS section silently
        }
      }

      body += "---\n";
      body += "\u{1F989} Powered by [ReadMe](https://readme.com)\n";

      console.log(body);
    },
  };
}

/**
 * JSON reporter for machine consumption.
 */
export function createJsonReporter() {
  return {
    onFile() {},
    pause() {},

    finish(total, results, _files) {
      const { errors, warnings } = splitResults(results);
      const output = {
        ok: errors.length === 0,
        total,
        errors: errors.map(({ file, rule, message }) => ({
          file,
          rule,
          message,
        })),
        warnings: warnings.map(({ file, rule, message }) => ({
          file,
          rule,
          message,
        })),
      };
      console.log(JSON.stringify(output));
    },
  };
}
