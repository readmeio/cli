import { execSync } from 'node:child_process';

let _hasClaude;

export function hasClaude() {
  if (_hasClaude === undefined) {
    try {
      execSync('which claude', { stdio: 'pipe' });
      _hasClaude = true;
    } catch {
      _hasClaude = false;
    }
  }
  return _hasClaude;
}
