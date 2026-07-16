import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Write a set of files into a fresh temp directory and return its absolute root.
 * @param {Record<string, string>} files  Map of repo-relative path -> file content.
 */
export function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdme-cli-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

export function rmRepo(root) {
  fs.rmSync(root, { recursive: true, force: true });
}
