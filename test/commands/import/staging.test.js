import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, test, expect } from 'vitest';

import { args, __test__ } from '../../../src/commands/import.js';
import { PathEscapeError } from '../../../src/utils/containment.js';
import { parseFrontmatter, toFrontmatter } from '../../../src/utils/markdown.js';

const { stageOrganized, finalizeChangelogs, allocateChangelogFilenames } = __test__;

const originalLog = console.log;
afterEach(() => {
  console.log = originalLog;
});

function withStaging(fn) {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-staging-'));
  console.log = () => {};
  try {
    return fn(stagingDir);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function readFm(filePath) {
  return parseFrontmatter(fs.readFileSync(filePath, 'utf8')).data;
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/** Re-join staged paths with Windows path semantics and require they stay put. */
function expectContainedOnWin32(stagingDir) {
  const winRoot = 'C:\\Users\\dev\\AppData\\Local\\Temp\\readme-import-abc123';
  const rootReal = fs.realpathSync(stagingDir);
  const files = listFiles(stagingDir);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const rel = path.relative(rootReal, fs.realpathSync(file));
    expect(rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)).toBe(false);
    for (const part of rel.split(path.sep)) {
      expect(part).not.toBe('..');
      expect(part).not.toBe('.');
      expect(part).not.toContain('\\');
    }
    const winAbs = path.win32.join(winRoot, rel.split(path.sep).join(path.win32.sep));
    const winRel = path.win32.relative(winRoot, winAbs);
    expect(winRel === '..' || winRel.startsWith(`..${path.win32.sep}`) || path.win32.isAbsolute(winRel)).toBe(false);
  }
}

test('stageOrganized writes parent pages as index.md and leaves as slug.md', () => {
  withStaging(stagingDir => {
    const parent = {
      title: 'Getting Started',
      url: 'https://example.com/docs/getting-started',
      pages: [{ title: 'Install', url: 'https://example.com/docs/getting-started/install' }],
    };
    const leaf = { title: 'Pricing', url: 'https://example.com/docs/pricing' };

    const result = stageOrganized({ categories: [{ title: 'Guides', pages: [parent, leaf] }] }, stagingDir);

    const parentIndex = path.join(stagingDir, 'docs', 'Guides', 'getting-started', 'index.md');
    const child = path.join(stagingDir, 'docs', 'Guides', 'getting-started', 'install.md');
    const leafFile = path.join(stagingDir, 'docs', 'Guides', 'pricing.md');
    const siblingParent = path.join(stagingDir, 'docs', 'Guides', 'getting-started.md');

    expect(fs.existsSync(parentIndex)).toBe(true);
    expect(fs.existsSync(child)).toBe(true);
    expect(fs.existsSync(leafFile)).toBe(true);
    expect(fs.existsSync(siblingParent)).toBe(false);

    expect(readFm(parentIndex).title).toBe('Getting Started');
    expect(readFm(parentIndex)['x-import']).toBe('https://example.com/docs/getting-started');
    expect(readFm(child).title).toBe('Install');
    expect(readFm(leafFile).title).toBe('Pricing');

    const guidesOrder = fs.readFileSync(path.join(stagingDir, 'docs', 'Guides', '_order.yaml'), 'utf8');
    expect(guidesOrder).toMatch(/^- getting-started$/m);
    expect(guidesOrder).toMatch(/^- pricing$/m);
    expect(guidesOrder).not.toMatch(/^- index$/m);

    const nestedOrder = fs.readFileSync(
      path.join(stagingDir, 'docs', 'Guides', 'getting-started', '_order.yaml'),
      'utf8',
    );
    expect(nestedOrder).toMatch(/^- install$/m);
    expect(result.fileCount).toBe(3);
  });
});

test('stageOrganized rescues /api/docs pages when skipping API reference categories', () => {
  withStaging(stagingDir => {
    const result = stageOrganized(
      {
        categories: [
          {
            title: 'API Reference',
            pages: [
              { title: 'List pets', url: 'https://example.com/api/reference/pets' },
              { title: 'Guides', url: 'https://example.com/api/docs/guides/intro' },
              {
                title: 'Mixed',
                pages: [{ title: 'Pricing', url: 'https://example.com/api/docs/pricing' }],
              },
            ],
          },
        ],
      },
      stagingDir,
      { skipApiReference: true },
    );

    expect(result.skippedApiRef).toBe(1);
    expect(fs.existsSync(path.join(stagingDir, 'reference'))).toBe(false);

    const rescuedDir = path.join(stagingDir, 'docs', 'API Docs');
    const guides = path.join(rescuedDir, 'intro.md');
    const pricing = path.join(rescuedDir, 'introduction', 'pricing.md');
    expect(fs.existsSync(guides)).toBe(true);
    expect(fs.existsSync(pricing)).toBe(true);
    expect(readFm(guides)['x-import']).toBe('https://example.com/api/docs/guides/intro');
    expect(readFm(pricing)['x-import']).toBe('https://example.com/api/docs/pricing');
  });
});

test('stageOrganized namespaces nested category folders that would otherwise share a basename', () => {
  withStaging(stagingDir => {
    stageOrganized(
      {
        categories: [
          { title: 'Fundamentals', pages: [{ title: 'Hello', url: 'https://example.com/docs/hello' }] },
          { title: 'cockroach/Fundamentals', pages: [{ title: 'SQL', url: 'https://example.com/docs/sql' }] },
        ],
      },
      stagingDir,
    );

    const topLevel = path.join(stagingDir, 'docs', 'Fundamentals', 'hello.md');
    const nestedDir = path.join(stagingDir, 'docs', 'cockroach', 'cockroach-fundamentals');
    const nestedPage = path.join(nestedDir, 'sql.md');
    const nestedIndex = path.join(nestedDir, 'index.md');

    expect(fs.existsSync(topLevel)).toBe(true);
    expect(fs.existsSync(nestedPage)).toBe(true);
    expect(fs.existsSync(nestedIndex)).toBe(true);
    expect(readFm(nestedIndex).title).toBe('Fundamentals');
    expect('x-import' in readFm(nestedIndex)).toBe(false);

    const docsOrder = fs.readFileSync(path.join(stagingDir, 'docs', '_order.yaml'), 'utf8');
    expect(docsOrder).toMatch(/^- Fundamentals$/m);
    expect(docsOrder).toMatch(/^- cockroach\/cockroach-fundamentals$/m);
  });
});

test('finalizeChangelogs emits flat canonical changelogs without an order file and suffixes case-insensitive collisions', () => {
  withStaging(stagingDir => {
    const changelogDir = path.join(stagingDir, 'docs', 'Changelog');
    fs.mkdirSync(path.join(changelogDir, 'foo'), { recursive: true });
    fs.writeFileSync(
      path.join(changelogDir, 'foo', 'Bar.md'),
      toFrontmatter({ title: 'Nested', icon: 'fa-book', 'x-import': 'https://example.com/nested' }),
    );
    fs.writeFileSync(
      path.join(changelogDir, 'foo-bar.md'),
      toFrontmatter({ title: 'Root', icon: 'fa-book', 'x-import': 'https://example.com/root' }),
    );
    fs.writeFileSync(
      path.join(changelogDir, 'unchanged.md'),
      toFrontmatter({ title: 'Unchanged', icon: 'fa-book', 'x-import': 'https://example.com/unchanged' }),
    );
    fs.writeFileSync(path.join(stagingDir, 'docs', '_order.yaml'), '- Changelog\n');

    expect(finalizeChangelogs(stagingDir)).toBe(3);

    const outputDir = path.join(stagingDir, 'changelogs');
    expect(fs.readdirSync(outputDir).sort()).toStrictEqual(['foo-Bar.md', 'foo-bar-2.md', 'unchanged.md']);
    expect(fs.existsSync(path.join(outputDir, '_order.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(stagingDir, 'changelog'))).toBe(false);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'Changelog'))).toBe(false);
    expect(fs.existsSync(path.join(stagingDir, 'docs', '_order.yaml'))).toBe(false);
    expect(readFm(path.join(outputDir, 'foo-Bar.md')).icon).toBeUndefined();
    expect(readFm(path.join(outputDir, 'foo-Bar.md'))['x-import']).toBe('https://example.com/nested');
    expect(readFm(path.join(outputDir, 'foo-bar-2.md'))['x-import']).toBe('https://example.com/root');
    expect(readFm(path.join(outputDir, 'unchanged.md'))['x-import']).toBe('https://example.com/unchanged');
  });
});

test('stageOrganized retains case-only changelog names before finalization', () => {
  withStaging(stagingDir => {
    const upper = { title: 'Upper A', url: 'https://example.com/A' };
    const lower = { title: 'Lower a', url: 'https://example.com/a' };
    const independent = { title: 'Independent a-2', url: 'https://example.com/a-2' };
    stageOrganized({ categories: [{ title: 'Changelog', pages: [upper, lower, independent] }] }, stagingDir, {
      slugFor: new Map([
        [upper, 'A'],
        [lower, 'a'],
        [independent, 'a-2'],
      ]),
    });
    expect(finalizeChangelogs(stagingDir)).toBe(3);

    const outputDir = path.join(stagingDir, 'changelogs');
    expect(fs.readdirSync(outputDir).sort()).toStrictEqual(['A.md', 'a-2.md', 'a-3.md']);
    expect(readFm(path.join(outputDir, 'A.md')).title).toBe('Upper A');
    expect(readFm(path.join(outputDir, 'a-3.md')).title).toBe('Lower a');
    expect(readFm(path.join(outputDir, 'a-2.md')).title).toBe('Independent a-2');
  });
});

test('allocateChangelogFilenames preserves an independent numeric-suffix filename', () => {
  expect(
    allocateChangelogFilenames([
      { ancestors: [], slug: 'A' },
      { ancestors: [], slug: 'a' },
      { ancestors: [], slug: 'a-2' },
    ]),
  ).toStrictEqual(['A', 'a-3', 'a-2']);
});

test('import command has no conditional changelog layout option', () => {
  const cmd = new Command();
  args(cmd);

  expect(cmd.options.some(option => option.long === '--separate-changelog')).toBe(false);
});

test('stageOrganized keeps hostile category titles inside staging on win32', () => {
  withStaging(stagingDir => {
    const backslash = '..\\..\\..\\..\\..\\..\\..\\Users\\Public\\poc';
    const pages = n =>
      Array.from({ length: n }, (_, i) => ({
        title: `Page ${i + 1}`,
        url: `https://example.com/docs/bs-${i + 1}`,
      }));

    stageOrganized(
      {
        categories: [
          { title: 'Guides', pages: [{ title: 'Pricing', url: 'https://example.com/docs/pricing' }] },
          { title: backslash, pages: pages(5) },
          { title: '..\\poc', pages: [{ title: 'Near', url: 'https://example.com/docs/near' }] },
          { title: '..\\..\\poc', pages: [{ title: 'Far', url: 'https://example.com/docs/far' }] },
          {
            title: 'C:\\Users\\Public\\poc-drive',
            pages: [{ title: 'Drive', url: 'https://example.com/docs/drive' }],
          },
          {
            title: '\\\\server\\share\\poc',
            pages: [{ title: 'Unc', url: 'https://example.com/docs/unc' }],
          },
          {
            title: '../../../../../../../../tmp/rm19530-slash-escape',
            pages: [
              { title: 'Slash', url: 'https://example.com/docs/slash-1' },
              { title: 'Slash 2', url: 'https://example.com/docs/slash-2' },
            ],
          },
          {
            title: '..\\..\\..\\outside/Nested group',
            pages: [{ title: 'Mixed', url: 'https://example.com/docs/mixed' }],
          },
          { title: 'v2.', pages: [{ title: 'Release', url: 'https://example.com/docs/v2-notes' }] },
        ],
      },
      stagingDir,
    );

    expect(fs.existsSync(path.join(stagingDir, 'docs', 'Guides', 'pricing.md'))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'users-public-poc', 'bs-1.md'))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'users-public-poc', 'bs-5.md'))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'users-public-poc', '_order.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'poc', 'near.md'))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'poc-2', 'far.md'))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'c-users-public-poc-drive', 'drive.md'))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'server-share-poc', 'unc.md'))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'outside', 'outside-nested-group', 'mixed.md'))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'v2.', 'v2-notes.md'))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'page'))).toBe(true);

    const names = fs.readdirSync(path.join(stagingDir, 'docs'));
    expect(names.some(name => name.includes('\\') || name === '..' || name === '.')).toBe(false);
    expect(fs.readFileSync(path.join(stagingDir, 'docs', '_order.yaml'), 'utf8')).toContain('users-public-poc');
    expect(readFm(path.join(stagingDir, 'docs', 'users-public-poc', 'bs-1.md'))['x-import']).toBe(
      'https://example.com/docs/bs-1',
    );

    expectContainedOnWin32(stagingDir);
  });
});

test('stageOrganized rewrites a parent segment that trims to empty', () => {
  withStaging(stagingDir => {
    stageOrganized(
      {
        categories: [
          { title: '.', pages: [{ title: 'Dot', url: 'https://example.com/docs/dot' }] },
          { title: '..', pages: [{ title: 'Up', url: 'https://example.com/docs/up' }] },
          // routeCategory trims the whole title, so the trailing space has to
          // sit on an earlier segment to survive until the folder name.
          { title: '.. /Notes', pages: [{ title: 'Note', url: 'https://example.com/docs/note' }] },
        ],
      },
      stagingDir,
    );

    expect(fs.existsSync(path.join(stagingDir, 'docs', 'page', 'dot.md'))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'page-2', 'up.md'))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'page-3', 'notes', 'note.md'))).toBe(true);
    const names = fs.readdirSync(path.join(stagingDir, 'docs'));
    expect(names).not.toContain('.');
    expect(names).not.toContain('..');
    expect(names).not.toContain('.. ');
    expectContainedOnWin32(stagingDir);
  });
});

test('stageOrganized keeps one folder for a shared rewritten category root', () => {
  withStaging(stagingDir => {
    stageOrganized(
      {
        categories: [
          {
            title: 'SDK: Java/Setup/Windows',
            pages: [{ title: 'Win', url: 'https://example.com/docs/sdk-win' }],
          },
          {
            title: 'SDK: Java/Setup/Linux',
            pages: [{ title: 'Lin', url: 'https://example.com/docs/sdk-lin' }],
          },
        ],
      },
      stagingDir,
    );

    const setup = path.join(stagingDir, 'docs', 'sdk-java', 'sdk-java-setup');
    expect(fs.existsSync(path.join(setup, 'sdk-java-setup-windows', 'sdk-win.md'))).toBe(true);
    expect(fs.existsSync(path.join(setup, 'sdk-java-setup-linux', 'sdk-lin.md'))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'sdk-java-2'))).toBe(false);
    expect(readFm(path.join(setup, 'index.md')).title).toBe('Setup');
    expect(readFm(path.join(setup, 'sdk-java-setup-windows', 'index.md')).title).toBe('Windows');
    expect(readFm(path.join(setup, 'sdk-java-setup-linux', 'index.md')).title).toBe('Linux');
    expectContainedOnWin32(stagingDir);
  });
});

test('stageOrganized refuses a slug that resolves outside staging', () => {
  withStaging(stagingDir => {
    const probe = path.join(path.dirname(stagingDir), 'rm19530-escape-probe.md');
    fs.rmSync(probe, { force: true });
    const page = { title: 'Escape', url: 'https://example.com/docs/escape' };
    try {
      expect(() =>
        stageOrganized({ categories: [{ title: 'Guides', pages: [page] }] }, stagingDir, {
          slugFor: new Map([[page, '../../../rm19530-escape-probe']]),
        }),
      ).toThrow(PathEscapeError);
      expect(fs.existsSync(probe)).toBe(false);
    } finally {
      fs.rmSync(probe, { force: true });
    }
  });
});

test('stageOrganized quotes YAML-unsafe slugs in _order.yaml', () => {
  withStaging(stagingDir => {
    stageOrganized(
      {
        categories: [
          {
            title: 'Guides',
            pages: [
              { title: 'True', url: 'https://example.com/docs/true' },
              { title: 'Null', url: 'https://example.com/docs/null' },
            ],
          },
        ],
      },
      stagingDir,
    );

    const order = fs.readFileSync(path.join(stagingDir, 'docs', 'Guides', '_order.yaml'), 'utf8');
    expect(order).toMatch(/^- "true"$/m);
    expect(order).toMatch(/^- "null"$/m);
  });
});
