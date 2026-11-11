import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { lint } from '../../src/commands/lint.js';
import { makeRepo, rmRepo } from '../helpers.js';

const page = '---\ntitle: x\n---\nbody\n';

// The walk admits a directory or an order file once. These three links are the
// ways that admission can fail, and each one used to be a write to the target.
const orderEscapes = [
  {
    name: 'append through a symlinked _order.yaml',
    file: 'docs/_order.yaml',
    arrange(root, outside) {
      const original = 'keep\n';
      const victim = path.join(outside, 'outside.txt');
      fs.mkdirSync(path.join(root, 'docs'));
      fs.writeFileSync(path.join(root, 'docs/a.md'), page);
      fs.writeFileSync(path.join(root, 'docs/pwned.md'), page);
      fs.writeFileSync(victim, original);
      fs.symlinkSync(victim, path.join(root, 'docs/_order.yaml'));
      return { victim, original, outsideListing: ['outside.txt'] };
    },
  },
  {
    name: 'rewrite lines through a symlinked _order.yaml',
    file: 'docs/_order.yaml',
    hidden: ['keep', 'other'],
    arrange(root, outside) {
      const original = '# outside list\n- keep\n- other\n';
      const victim = path.join(outside, 'outside.txt');
      fs.mkdirSync(path.join(root, 'docs'));
      fs.writeFileSync(path.join(root, 'docs/a.md'), page);
      fs.writeFileSync(path.join(root, 'docs/pwned.md'), page);
      fs.writeFileSync(victim, original);
      fs.symlinkSync(victim, path.join(root, 'docs/_order.yaml'));
      return { victim, original, outsideListing: ['outside.txt'] };
    },
  },
  {
    name: 'follow a symlinked docs directory',
    file: 'docs',
    arrange(root, outside) {
      const original = '---\ntitle: x\nfoo: 1\n---\nbody\n';
      const victim = path.join(outside, 'a.md');
      fs.writeFileSync(victim, original);
      fs.writeFileSync(path.join(outside, 'pwned.md'), page);
      fs.symlinkSync(outside, path.join(root, 'docs'));
      return { victim, original, outsideListing: ['a.md', 'pwned.md'] };
    },
  },
];

test.each(orderEscapes)('lint --fix does not $name', async ({ file, hidden, arrange }) => {
  const root = makeRepo({});
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rdme-cli-outside-'));
  const { victim, original, outsideListing } = arrange(root, outside);
  try {
    const { results } = await lint({ cwd: root, fix: true });
    const refusals = results.filter(r => r.message.includes('symbolic links'));
    expect(refusals).toHaveLength(1);
    const refusal = refusals[0];
    expect(refusal).toMatchObject({ file, rule: 'ordering', severity: 'error', fixable: false });
    expect(refusal.message).not.toContain('(fixed)');
    for (const word of hidden ?? []) {
      expect(results.some(r => r.message.includes(word))).toBe(false);
    }
    expect(fs.readFileSync(victim, 'utf-8')).toBe(original);
    expect(fs.readdirSync(outside).sort()).toStrictEqual(outsideListing);
  } finally {
    rmRepo(root);
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('lint --fix does not rewrite frontmatter through a symlinked page', async () => {
  const body = '---\ntitle: x\nfoo: 1\n---\nbody\n';
  const root = makeRepo({});
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rdme-cli-outside-'));
  fs.mkdirSync(path.join(root, 'docs'));
  const victim = path.join(outside, 'page.md');
  fs.writeFileSync(victim, body);
  const link = path.join(root, 'docs/x.md');
  fs.symlinkSync(victim, link);
  try {
    const { results } = await lint({ cwd: root, fix: true });
    const refusal = results.find(r => r.rule === 'path' && r.message.includes('symbolic links'));
    expect(refusal).toMatchObject({
      file: 'docs/x.md',
      severity: 'error',
      fixable: false,
    });
    expect(refusal.message).not.toContain('(fixed)');
    expect(fs.readFileSync(victim, 'utf-8')).toBe(body);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  } finally {
    rmRepo(root);
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('lint --fix reports a dangling page symlink instead of throwing', async () => {
  const root = makeRepo({
    'docs/ok.md': '---\ntitle: ok\n---\n[missing](doc:nope)\n',
    'docs/_order.yaml': '- ok\n',
  });
  fs.symlinkSync(path.join(root, 'does-not-exist.md'), path.join(root, 'docs/gone.md'));
  try {
    const { results, hasErrors } = await lint({ cwd: root, fix: true });
    expect(hasErrors).toBe(true);
    expect(results).toContainEqual(
      expect.objectContaining({
        file: 'docs/gone.md',
        rule: 'path',
        severity: 'error',
        fixable: false,
      }),
    );
    expect(results.some(r => r.rule === 'links' && r.file === 'docs/ok.md')).toBe(true);
  } finally {
    rmRepo(root);
  }
});

test('lint reports a symlinked custom_blocks directory and does not rewrite it', async () => {
  const body = '---\nname: Block\nfoo: 1\n---\nexport const Block = () => null\n\n<Block />\n';
  const root = makeRepo({});
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rdme-cli-outside-'));
  const victim = path.join(outside, 'Block.mdx');
  fs.writeFileSync(victim, body);
  fs.symlinkSync(outside, path.join(root, 'custom_blocks'));
  try {
    const { results, hasErrors } = await lint({ cwd: root, fix: true });
    expect(hasErrors).toBe(true);
    const refusals = results.filter(r => r.message.includes('symbolic links'));
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      file: 'custom_blocks',
      rule: 'path',
      severity: 'error',
      fixable: false,
    });
    expect(fs.readFileSync(victim, 'utf-8')).toBe(body);
  } finally {
    rmRepo(root);
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('lint does not flag a real custom_blocks directory', async () => {
  const root = makeRepo({
    'custom_blocks/myBlock.md': 'A snippet.\n',
  });
  try {
    const { results } = await lint({ cwd: root });
    expect(results.some(r => r.file === 'custom_blocks' && r.rule === 'path')).toBe(false);
    expect(results.some(r => r.file === 'custom_blocks/myBlock.md')).toBe(true);
  } finally {
    rmRepo(root);
  }
});

test('lint --fix still rewrites a real page', async () => {
  const root = makeRepo({
    'docs/x.md': '---\ntitle: x\nfoo: 1\n---\nbody\n',
    'docs/_order.yaml': '- x\n',
  });
  try {
    await lint({ cwd: root, fix: true });
    const after = fs.readFileSync(path.join(root, 'docs/x.md'), 'utf-8');
    expect(after).toContain('x-foo: 1');
    expect(after).not.toContain('\nfoo: 1');
  } finally {
    rmRepo(root);
  }
});
