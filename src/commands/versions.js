import { execSync } from 'node:child_process';
import * as styles from '../utils/styles.js';

export const command = 'versions';
export const order = 4;
export const category = 'Other';
export const description = 'List all doc versions and their branches';

const VERSION_RE = /^v\d+(\.\d+)*$/;
const SUB_BRANCH_RE = /^(v\d+(?:\.\d+)*)_(.+)$/;

export function run(_options, _cmd, ctx) {
  const { gitRoot } = ctx;

  const raw = execSync('git branch -a --format="%(refname:short)"', {
    cwd: gitRoot,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  const branches = raw.split('\n').map((b) => b.trim()).filter(Boolean);

  // Strip "origin/" prefix and deduplicate.
  const seen = new Set();
  const cleaned = [];
  for (const b of branches) {
    const name = b.replace(/^origin\//, '');
    if (!seen.has(name)) {
      seen.add(name);
      cleaned.push(name);
    }
  }

  // Group: version branches and their sub-branches.
  const versions = new Map();
  const subBranches = [];

  for (const name of cleaned) {
    if (VERSION_RE.test(name)) {
      versions.set(name, []);
    } else {
      const match = name.match(SUB_BRANCH_RE);
      if (match) {
        subBranches.push({ parent: match[1], name: match[2], full: name });
      }
    }
  }

  // Attach sub-branches to their parent version.
  for (const sub of subBranches) {
    if (versions.has(sub.parent)) {
      versions.get(sub.parent).push(sub);
    }
  }

  // Sort versions by semver-ish ordering (descending).
  const sorted = [...versions.entries()].sort((a, b) => {
    const aParts = a[0].slice(1).split('.').map(Number);
    const bParts = b[0].slice(1).split('.').map(Number);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const diff = (bParts[i] || 0) - (aParts[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  console.log();
  console.log(`  ${styles.logo()}  ${styles.dim('versions')}`);
  console.log();

  for (const [version, subs] of sorted) {
    console.log(`  ${styles.bold(version)}`);
    for (let i = 0; i < subs.length; i++) {
      const isLast = i === subs.length - 1;
      const connector = isLast ? '└─' : '├─';
      console.log(`  ${styles.dim(connector)} ${styles.dim(version + '_')}${subs[i].name} ${styles.dim('(branch)')}`);
    }
  }

  console.log();
}
