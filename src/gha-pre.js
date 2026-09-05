// Pre step for the readmeio/cli GitHub Action (see action.yml's runs.pre).
//
// dist-gha/index.js (built by the build:gha script) excludes @readme/markdown
// from its bundle: it's a ~25MB package with 50+ dependencies (including
// tailwindcss and postcss) pulled in for one narrow helper the "lint" command
// uses, mdxishTags, and bundling it whole breaks on its embedded CSS/asset
// references. Rather than vendoring that whole tree into this repo, this step
// installs just that one package into the action's own directory immediately
// before dist-gha/index.js runs, so plain Node module resolution finds it.
//
// GITHUB_ACTION_PATH looked like the natural way to find that directory (and
// is what a version of this file first tried), but it came back undefined
// when actually tested on a real Actions runner. import.meta.dirname doesn't
// depend on the runner setting anything at all -- it's just "where is this
// file" -- and it's the same approach readmeio/rdme's own pre-step
// (bin/write-gha-pjson.js) already uses.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const actionPath = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(actionPath, 'package.json'), 'utf-8'));
const range = pkg.dependencies['@readme/markdown'];

execFileSync(
  'npm',
  ['install', '--no-save', '--no-audit', '--no-fund', '--prefix', actionPath, `@readme/markdown@${range}`],
  { stdio: 'inherit' },
);
