import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import * as styles from '../utils/styles.js';
import { hasGithubRemote, WORKFLOW_VERSION } from '../utils/git.js';

export const command = 'setup:github';
export const order = 5;
export const description = 'Set up a GitHub Action to lint your docs on every PR';

export async function run(_options, _cmd, ctx) {
  const { gitRoot } = ctx;

  if (!hasGithubRemote()) {
    styles.error("This repo doesn't have a GitHub remote.");
    styles.info('Add one with: git remote add origin https://github.com/your-org/your-repo.git');
    process.exit(1);
  }

  const workflowPath = path.join(gitRoot, '.github/workflows/readme-lint.yml');
  const isOverwrite = fs.existsSync(workflowPath);

  // Show what will be set up
  console.log();
  console.log(`  ${styles.heading('GitHub Actions Setup')}`);
  console.log();
  console.log(`  This will create a workflow that runs on every pull request:`);
  console.log();
  console.log(`    ${styles.success('✔')} ${styles.bold('Lint docs')} — runs ${styles.orange(`${styles.binName()} lint`)} and posts results as a PR comment`);
  console.log(`    ${styles.success('✔')} ${styles.bold('OAS change detection')} — flags modified OpenAPI spec files and suggests syncing`);
  console.log(`    ${styles.success('✔')} ${styles.bold('Auto-fix base branch')} — redirects PRs from ${styles.orange('main')} to the correct version branch`);
  console.log();
  console.log(`  ${styles.dim('Creates:')} ${path.relative(gitRoot, workflowPath)}`);
  console.log();

  const prompt = isOverwrite
    ? 'This will overwrite the existing workflow. Continue?'
    : 'Set up this workflow?';

  const confirmed = await confirm(prompt);
  if (!confirmed) {
    styles.info('Setup cancelled.');
    return;
  }

  fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
  fs.writeFileSync(workflowPath, WORKFLOW_YAML);

  console.log();
  styles.ok('Created GitHub Actions workflow!');
  console.log();
  styles.info('Commit and push this file to start linting PRs automatically.');
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

const WORKFLOW_YAML = `# readme-lint v${WORKFLOW_VERSION}
name: ReadMe Docs Lint

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write
  packages: read

jobs:
  lint:
    name: Lint docs
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Fix PR base branch
        id: fix-base
        if: github.event.pull_request.base.ref == 'main' || github.event.pull_request.base.ref == 'master'
        uses: actions/github-script@v7
        with:
          script: |
            const head = context.payload.pull_request.head.ref;
            // Extract version prefix (e.g. "v1.0" from "v1.0_test")
            const match = head.match(/^(v\\d+(?:\\.\\d+)*)/);
            if (!match) return;

            const versionBranch = match[1];

            // Check if the version branch exists
            try {
              await github.rest.repos.getBranch({
                owner: context.repo.owner,
                repo: context.repo.repo,
                branch: versionBranch,
              });
            } catch {
              return; // Branch doesn't exist
            }

            // Update the PR base branch
            await github.rest.pulls.update({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
              base: versionBranch,
            });

            core.setOutput('changed', 'true');
            core.setOutput('new_base', versionBranch);
            core.setOutput('old_base', context.payload.pull_request.base.ref);

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://npm.pkg.github.com

      - name: Lint docs
        id: lint
        continue-on-error: true
        env:
          NODE_AUTH_TOKEN: $\{{ secrets.GITHUB_TOKEN }}
          GITHUB_BASE_SHA: $\{{ github.event.pull_request.base.sha }}
        run: npx -y @readme/cli-beta --no-check lint --github > comment.md

      - name: Comment on PR
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const marker = '<!-- readme-lint-results -->';
            let body = '';
            try { body = fs.readFileSync('comment.md', 'utf-8'); } catch {}
            if (!body.includes(marker)) return;

            // Base branch fix notice
            const baseChanged = '$\{{ steps.fix-base.outputs.changed }}' === 'true';
            if (baseChanged) {
              const oldBase = '$\{{ steps.fix-base.outputs.old_base }}';
              const newBase = '$\{{ steps.fix-base.outputs.new_base }}';
              body = body.replace('---', \`> **Base branch updated:** This PR was targeting \\\`\${oldBase}\\\` but has been updated to target \\\`\${newBase}\\\`.\\n\\n---\`);
            }

            // Find existing comment to update
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find(c => c.body.includes(marker));

            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body,
              });
            }


      - name: Fail if lint errors
        if: steps.lint.outcome == 'failure'
        run: exit 1
`;
