import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const WORKFLOW_VERSION = 2;

// Platform definitions: keep ordering — first match wins for filesystem detection.
export const PLATFORMS = {
  github: {
    label: 'GitHub Actions',
    remoteHosts: ['github.com'],
    workflowFile: '.github/workflows/readme-lint.yml',
    fsMarkers: ['.github/workflows'],
  },
  gitlab: {
    label: 'GitLab CI',
    remoteHosts: ['gitlab.com'],
    remotePathHints: ['/gitlab/'],
    workflowFile: '.gitlab-ci.yml',
    fsMarkers: ['.gitlab-ci.yml'],
  },
  bitbucket: {
    label: 'Bitbucket Pipelines',
    remoteHosts: ['bitbucket.org'],
    workflowFile: 'bitbucket-pipelines.yml',
    fsMarkers: ['bitbucket-pipelines.yml'],
  },
  circleci: {
    label: 'CircleCI',
    workflowFile: '.circleci/config.yml',
    fsMarkers: ['.circleci/config.yml'],
  },
  rwx: {
    label: 'RWX Mint',
    workflowFile: '.mint/readme-lint.yml',
    fsMarkers: ['.mint'],
  },
};

let _remotesCache;

function readRemotes() {
  if (_remotesCache !== undefined) return _remotesCache;
  try {
    _remotesCache = execSync('git remote -v', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    _remotesCache = '';
  }
  return _remotesCache;
}

export function hasGithubRemote() {
  return /github\.com/i.test(readRemotes());
}

/**
 * Inspect the git remote and return the matching platform key, or null.
 */
export function detectRemotePlatform() {
  const remotes = readRemotes();
  if (!remotes) return null;
  for (const [key, def] of Object.entries(PLATFORMS)) {
    if (def.remoteHosts && def.remoteHosts.some((h) => remotes.toLowerCase().includes(h))) {
      return key;
    }
    if (def.remotePathHints && def.remotePathHints.some((p) => remotes.toLowerCase().includes(p))) {
      return key;
    }
  }
  return null;
}

/**
 * Scan the filesystem for existing CI configuration files. Returns an array
 * of platform keys (in PLATFORMS declaration order) that have markers present.
 */
export function detectExistingCi(gitRoot) {
  if (!gitRoot) return [];
  const found = [];
  for (const [key, def] of Object.entries(PLATFORMS)) {
    const hit = def.fsMarkers.some((marker) => fs.existsSync(path.join(gitRoot, marker)));
    if (hit) found.push(key);
  }
  return found;
}

/**
 * Detect whether an existing GitHub workflow uses the Blacksmith runner.
 */
export function usesBlacksmith(gitRoot) {
  if (!gitRoot) return false;
  const dir = path.join(gitRoot, '.github/workflows');
  if (!fs.existsSync(dir)) return false;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/\.ya?ml$/.test(f)) continue;
      const body = fs.readFileSync(path.join(dir, f), 'utf-8');
      if (/blacksmith/i.test(body)) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Combined detection for the bare `setup` command. Filesystem markers win
 * over remote host (existing CI is the strongest signal of intent).
 */
export function detectPlatform(gitRoot) {
  const existing = detectExistingCi(gitRoot);
  const remote = detectRemotePlatform();
  return {
    existing,
    remote,
    recommended: existing[0] || remote || null,
  };
}

export function hasGithubWorkflow(gitRoot) {
  return fs.existsSync(path.join(gitRoot, PLATFORMS.github.workflowFile));
}

export function hasReadmeWorkflow(gitRoot, platformKey) {
  const def = PLATFORMS[platformKey];
  if (!def) return false;
  return fs.existsSync(path.join(gitRoot, def.workflowFile));
}

export function getWorkflowVersion(gitRoot) {
  const file = path.join(gitRoot, PLATFORMS.github.workflowFile);
  if (!fs.existsSync(file)) return null;
  try {
    const first = fs.readFileSync(file, 'utf-8').split('\n')[0];
    const match = first.match(/^# readme-lint v(\d+)/);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}
