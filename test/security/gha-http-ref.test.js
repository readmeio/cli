import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { makeRepo, rmRepo } from '../helpers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = path.join(repoRoot, 'dist-gha', 'index.js');
const preload = path.join(repoRoot, 'test', 'helpers', 'gha-net-preload.js');

function specWithRef(ref) {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'SSRF', version: '1.0.0' },
    paths: {},
    components: { schemas: { X: { $ref: ref } } },
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const reserved = server.address().port;
      server.close(() => resolve(reserved));
    });
  });
}

function readHits(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

async function runAction(ref) {
  const port = await reservePort();
  const hitsFile = path.join(os.tmpdir(), `gha-hits-${port}.log`);
  fs.writeFileSync(hitsFile, '');
  const repo = makeRepo({ 'reference/ssrf.json': specWithRef(ref.replaceAll('{port}', String(port))) });
  try {
    const result = spawnSync(process.execPath, ['--import', preload, bundle], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        INPUT_README: 'oas:validate',
        GITHUB_WORKSPACE: repo,
        FIXTURE_PORT: String(port),
        FIXTURE_HITS: hitsFile,
      },
    });
    return { result, hits: readHits(hitsFile) };
  } finally {
    fs.rmSync(hitsFile, { force: true });
    rmRepo(repo);
  }
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

test('the action bundle keeps the http safety imports', () => {
  const source = fs.readFileSync(bundle, 'utf8');
  expect(source).toContain('globalThis.__readmeGhaDynamicImport');
  expect(source).toContain('if (known && Object.prototype.hasOwnProperty.call(known, req)) return known[req];');
});

test('a hostname that resolves to loopback does not crash the action', async () => {
  const { result, hits } = await runAction('http://rebind.attacker.test:{port}/secret');
  const output = outputOf(result);
  expect(output).not.toMatch(/MODULE_NOT_FOUND|Cannot find module/i);
  expect(output).not.toContain('MARKER-INTERNAL');
  expect(output).not.toMatch(/ENOTFOUND|getaddrinfo/i);
  expect(output).toMatch(/Unsafe URL/i);
  expect(hits).toStrictEqual([]);
  expect(result.status).toBe(1);
});

test('a redirect onto loopback does not crash the action or follow', async () => {
  const { result, hits } = await runAction('http://redirector.attacker.test:{port}/redir');
  const output = outputOf(result);
  expect(output).not.toMatch(/MODULE_NOT_FOUND|Cannot find module/i);
  expect(output).not.toContain('MARKER-INTERNAL');
  expect(output).toMatch(/Unsafe URL/i);
  expect(hits.map(hit => hit.url)).toStrictEqual(['/redir']);
  expect(result.status).toBe(1);
});
