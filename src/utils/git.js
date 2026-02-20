import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let _hasGithubRemote;

export function hasGithubRemote() {
  if (_hasGithubRemote === undefined) {
    try {
      const remotes = execSync('git remote -v', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      _hasGithubRemote = /github\.com/i.test(remotes);
    } catch {
      _hasGithubRemote = false;
    }
  }
  return _hasGithubRemote;
}

export const WORKFLOW_VERSION = 2;

export function hasGithubWorkflow(gitRoot) {
  return fs.existsSync(path.join(gitRoot, '.github/workflows/readme-lint.yml'));
}

export function getWorkflowVersion(gitRoot) {
  const file = path.join(gitRoot, '.github/workflows/readme-lint.yml');
  if (!fs.existsSync(file)) return null;
  try {
    const first = fs.readFileSync(file, 'utf-8').split('\n')[0];
    const match = first.match(/^# readme-lint v(\d+)/);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}
