#! /usr/bin/env node

// Vendored copies of the two files this CLI reads from readmeio/git-format.
// Checked into the repo so installs do not fetch a git dependency (npm 12
// refuses those by default). `schemas:check` fails when upstream main drifts;
// `schemas:write` refreshes the copies.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

const REPO = 'https://raw.githubusercontent.com/readmeio/git-format/main';

const files = [
  {
    filePath: 'vendor/git-format/frontmatter.schema.json',
    url: `${REPO}/frontmatter.schema.json`,
    json: true,
  },
  {
    filePath: 'vendor/git-format/CLAUDE.md',
    url: `${REPO}/CLAUDE.md`,
    json: false,
  },
];

function getHash(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return createHash('sha1').update(Buffer.from(text, 'utf8')).digest('hex');
}

async function refresh() {
  const isUpdate = process.argv.includes('--update');

  try {
    await Promise.all(
      files.map(async file => {
        const res = await fetch(file.url);
        if (!res.ok) throw new Error(`Received ${res.status} when attempting to fetch ${file.url}`);

        if (file.json) {
          const rawFile = await res.json();
          if (isUpdate) {
            await fs.writeFile(file.filePath, JSON.stringify(rawFile));
          } else {
            const currentData = JSON.parse(await fs.readFile(file.filePath, 'utf-8'));
            if (getHash(currentData) !== getHash(rawFile)) {
              throw new Error(`${file.filePath} is outdated! Run \`npm run schemas:write\` to update.`);
            }
          }
          return;
        }

        const rawFile = await res.text();
        if (isUpdate) {
          await fs.writeFile(file.filePath, rawFile);
        } else {
          const current = await fs.readFile(file.filePath, 'utf-8');
          if (getHash(current) !== getHash(rawFile)) {
            throw new Error(`${file.filePath} is outdated! Run \`npm run schemas:write\` to update.`);
          }
        }
      }),
    );

    console.log(isUpdate ? 'git-format files updated!' : 'git-format files are up-to-date!');
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

await refresh();
