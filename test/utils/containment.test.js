import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { test, expect } from 'vitest';

import { makeContainment } from '../../src/utils/containment.js';
import { makeRepo, rmRepo } from '../helpers.js';

test('containment allows a path that does not exist yet under a real directory', () => {
  const root = makeRepo({ 'reference/.keep': '' });
  try {
    const assertContained = makeContainment(path.join(root, 'reference'));
    expect(() => assertContained(path.join(root, 'reference/Pets/pets/listpets.md'))).not.toThrow();
  } finally {
    rmRepo(root);
  }
});

test('containment refuses a symlink even when its target is inside the base', () => {
  const root = makeRepo({
    'reference/Real/pets/listpets.md': 'keep',
  });

  fs.symlinkSync(path.join(root, 'reference/Real'), path.join(root, 'reference/Pets'));
  try {
    const assertContained = makeContainment(path.join(root, 'reference'));
    expect(() => assertContained(path.join(root, 'reference/Pets/pets/listpets.md'))).toThrow(/symbolic links/);
    expect(fs.readFileSync(path.join(root, 'reference/Real/pets/listpets.md'), 'utf-8')).toBe('keep');
  } finally {
    rmRepo(root);
  }
});

test('containment refuses a symlink that points outside the base', () => {
  const root = makeRepo({ 'reference/.keep': '' });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rdme-cli-outside-'));

  fs.writeFileSync(path.join(outside, 'victim.md'), 'keep me');
  fs.symlinkSync(outside, path.join(root, 'reference/Pets'));

  try {
    const assertContained = makeContainment(path.join(root, 'reference'));
    expect(() => assertContained(path.join(root, 'reference/Pets/pets/listpets.md'))).toThrow(/symbolic links/);
    expect(fs.readFileSync(path.join(outside, 'victim.md'), 'utf-8')).toBe('keep me');
  } finally {
    rmRepo(root);
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('containment refuses a lexical path that climbs out of the base', () => {
  const root = makeRepo({ 'reference/.keep': '' });

  try {
    const assertContained = makeContainment(path.join(root, 'reference'));
    expect(() => assertContained(path.join(root, 'reference/../escaped.md'))).toThrow(
      /escapes the reference directory/,
    );
    expect(fs.existsSync(path.join(root, 'escaped.md'))).toBe(false);
  } finally {
    rmRepo(root);
  }
});
