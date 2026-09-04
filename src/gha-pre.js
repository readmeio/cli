// Pre step for the readmeio/cli GitHub Action (see action.yml's runs.pre).
//
// dist-gha/index.js (built by the build:gha script) excludes @readme/markdown
// from its bundle: it's a ~25MB package with 50+ dependencies (including
// tailwindcss and postcss) pulled in for one narrow helper the "lint" command
// uses, mdxishTags, and bundling it whole breaks on its embedded CSS/asset
// references. Rather than vendoring that whole tree into this repo, this step
// installs just that one package into the action's own directory immediately
// before dist-gha/index.js runs, so plain Node module resolution finds it —
// GITHUB_ACTION_PATH is set by the runner for both pre and main steps and
// points at this same checkout.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const actionPath = process.env.GITHUB_ACTION_PATH;
const pkg = JSON.parse(readFileSync(path.join(actionPath, 'package.json'), 'utf-8'));
const range = pkg.dependencies['@readme/markdown'];

execFileSync(
  'npm',
  ['install', '--no-save', '--no-audit', '--no-fund', '--prefix', actionPath, `@readme/markdown@${range}`],
  { stdio: 'inherit' },
);
