import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import * as styles from '../utils/styles.js';

export const name = 'numbering';

const SUFFIX_RE = /-(\d+)$/;

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function updateOrderYaml(fromPath, toPath) {
  const dir = path.dirname(fromPath);
  const orderFile = path.join(dir, '_order.yaml');
  if (!fs.existsSync(orderFile)) return;

  const oldSlug = path.basename(fromPath).replace(/\.(md|mdx)$/, '');
  const newSlug = path.basename(toPath).replace(/\.(md|mdx)$/, '');

  const content = fs.readFileSync(orderFile, 'utf-8');
  const updated = content.replace(
    new RegExp(`^(- )${oldSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
    `$1${newSlug}`,
  );

  if (updated !== content) {
    fs.writeFileSync(orderFile, updated);
  }
}

export async function validateAll(files, gitRoot, { fix } = {}) {
  const results = [];
  const renames = [];

  // Collect all slugs (filenames without ext) and directory names across the repo.
  const allSlugs = new Set();
  const allDirs = new Set();
  for (const relPath of files) {
    allSlugs.add(path.basename(relPath).replace(/\.(md|mdx)$/, ''));
    const parts = relPath.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      allDirs.add(parts[i]);
    }
  }

  // Check files: if slug ends with -N and the base slug doesn't exist anywhere, warn.
  for (const relPath of files) {
    const slug = path.basename(relPath).replace(/\.(md|mdx)$/, '');
    const match = slug.match(SUFFIX_RE);
    if (!match) continue;

    const baseSlug = slug.slice(0, -match[0].length);
    if (!allSlugs.has(baseSlug)) {
      const ext = path.extname(relPath);
      const from = path.join(gitRoot, relPath);
      const toRel = path.join(path.dirname(relPath), `${baseSlug}${ext}`);
      const to = path.join(gitRoot, toRel);

      results.push({
        file: relPath,
        rule: name,
        severity: 'warning',
        fixable: true,
        message: `"${slug}${ext}" should be renamed to "${baseSlug}${ext}"`,
      });
      renames.push({ from, to, label: `${relPath} → ${toRel}` });
    }
  }

  // Check directories: if a dir name ends with -N and the base dir doesn't exist, warn.
  const warnedDirs = new Set();
  for (const relPath of files) {
    const parts = relPath.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      if (warnedDirs.has(dirName)) continue;

      const match = dirName.match(SUFFIX_RE);
      if (!match) continue;

      const baseName = dirName.slice(0, -match[0].length);
      if (!allDirs.has(baseName)) {
        warnedDirs.add(dirName);
        const dirPath = parts.slice(0, i + 1).join('/');
        const baseDirPath = [...parts.slice(0, i), baseName].join('/');
        const from = path.join(gitRoot, dirPath);
        const to = path.join(gitRoot, baseDirPath);

        results.push({
          file: dirPath,
          rule: name,
          severity: 'warning',
          fixable: true,
          message: `"${dirName}" folder should be renamed to "${baseName}"`,
        });
        renames.push({ from, to, label: `${dirPath}/ → ${baseDirPath}/` });
      }
    }
  }

  // Interactive rename when --fix is passed.
  if (fix && renames.length > 0) {
    console.log();
    console.log(`  The following will be renamed:`);
    for (const r of renames) {
      console.log(`    ${styles.dim(r.label)}`);
    }
    console.log();
    console.log(`  ${styles.warn('Note:')} Renaming changes slugs, which could break existing URLs.`);
    console.log();

    const answer = await prompt(`  Rename ${renames.length} ${renames.length === 1 ? 'path' : 'paths'}? (y/N) `);

    if (answer === 'y' || answer === 'yes') {
      // Sort longest path first so nested dirs get renamed before parents.
      renames.sort((a, b) => b.from.length - a.from.length);
      for (const r of renames) {
        fs.renameSync(r.from, r.to);
        updateOrderYaml(r.from, r.to);
      }
      for (const r of results) {
        r.message += ' (fixed)';
      }
    }
  }

  return results.length > 0 ? results : null;
}
