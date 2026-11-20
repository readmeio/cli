import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { lint } from '../src/commands/lint.js';
import { syncOas } from '../src/commands/oas-sync.js';
import { validateOas } from '../src/commands/oas-validate.js';
import { loadSections } from '../src/utils/sections.js';

import { makeRepo, rmRepo } from './helpers.js';

const PAGE = '---\ntitle: Page\n---\n\nHello.\n';

const README_YAML = `navigation:
  - kind: home
    name: Home
  - kind: guide
    directory: docs
    name: Guides
  - kind: guide
    directory: sdks
    name: SDKs
  - kind: reference
    directory: reference
  - kind: reference
    directory: apis
    name: Partner API
  - kind: url
    url: https://example.com
    name: Status
`;

const SPEC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Partner', version: '1.0.0' },
  paths: {
    '/pets': { get: { operationId: 'listPets', tags: ['Pets'], responses: { 200: { description: 'OK' } } } },
  },
});

async function lintRepo(files) {
  const root = makeRepo(files);
  try {
    return await lint({ cwd: root, nonInteractive: true });
  } finally {
    rmRepo(root);
  }
}

const forRule = (results, rule) => results.filter(r => r.rule === rule);

test('a repo without _readme.yaml resolves to the built-in sections', () => {
  const root = makeRepo({ 'docs/a.md': PAGE });
  try {
    const sections = loadSections(root);
    expect(sections.exists).toBe(false);
    expect(sections.directories()).toStrictEqual(['docs', 'reference', 'custom_pages', 'recipes']);
  } finally {
    rmRepo(root);
  }
});

test('a repo without _readme.yaml lints exactly as before, with nothing about the config', async () => {
  const { files, results } = await lintRepo({
    'docs/a.md': PAGE,
    'docs/_order.yaml': '- a\n',
    // Not a section: no _readme.yaml declares it, and it has no _order.yaml.
    'notes/scratch.md': 'not frontmatter at all',
  });
  expect(files).toStrictEqual(['docs/a.md']);
  expect(results).toStrictEqual([]);
});

test('a declared guide section is linted like docs', async () => {
  const { files, results } = await lintRepo({
    '_readme.yaml': README_YAML,
    'docs/a.md': PAGE,
    'docs/_order.yaml': '- a\n',
    'sdks/node.md': '---\ntitle: Node\ntitel: typo\n---\n\nSee [missing](doc:nope).\n',
    'sdks/python.md': '---\ntitle: Python\n---\n',
    'sdks/_order.yaml': '- node\n- ghost\n',
  });

  expect(files).toContain('sdks/node.md');
  expect(forRule(results, 'config')).toStrictEqual([]);

  const messages = results.map(r => `${r.file}: ${r.message}`);
  const has = text => messages.some(m => m.includes(text));
  expect(has('sdks/node.md: Unknown property: "titel"')).toBe(true);
  expect(has('sdks/node.md: Broken link: "doc:nope"')).toBe(true);
  expect(has('sdks/python.md: Empty page')).toBe(true);
  expect(has('sdks/_order.yaml: Missing from _order.yaml: python')).toBe(true);
  expect(has('sdks/_order.yaml: Stale entry: "ghost"')).toBe(true);
});

test('links resolve to pages in a declared section', async () => {
  const { results } = await lintRepo({
    '_readme.yaml': README_YAML,
    'docs/a.md': '---\ntitle: A\n---\n\nSee [node](doc:node).\n',
    'docs/_order.yaml': '- a\n',
    'sdks/node.md': PAGE,
    'sdks/_order.yaml': '- node\n',
  });
  expect(forRule(results, 'links')).toStrictEqual([]);
});

test('the same slug in two sections is not a duplicate, but twice in one declared section is', async () => {
  const { results } = await lintRepo({
    '_readme.yaml': README_YAML,
    'docs/intro.md': PAGE,
    'docs/_order.yaml': '- intro\n',
    'sdks/intro.md': PAGE,
    'sdks/Node/intro.md': PAGE,
    'sdks/Node/_order.yaml': '- intro\n',
    'sdks/_order.yaml': '- intro\n- Node\n',
  });
  const duplicates = forRule(results, 'duplicates');
  expect(duplicates).toHaveLength(1);
  expect(duplicates[0].file.startsWith('sdks/')).toBe(true);
});

test('a folder that looks like a section but is not declared gets a warning, not an error', async () => {
  const withoutConfig = await lintRepo({
    'docs/a.md': PAGE,
    'docs/_order.yaml': '- a\n',
    'sdks/node.md': PAGE,
    'sdks/_order.yaml': '- node\n',
  });
  expect(withoutConfig.hasErrors).toBe(false);
  expect(withoutConfig.results.map(r => [r.file, r.rule, r.severity])).toStrictEqual([['sdks', 'config', 'warning']]);
  expect(withoutConfig.results[0].message).toMatch(/no _readme\.yaml declaring it/);

  const withConfig = await lintRepo({
    '_readme.yaml': 'navigation:\n  - kind: guide\n    directory: docs\n',
    'docs/a.md': PAGE,
    'docs/_order.yaml': '- a\n',
    'sdks/node.md': PAGE,
    'sdks/_order.yaml': '- node\n',
  });
  expect(withConfig.hasErrors).toBe(false);
  expect(withConfig.results[0].message).toMatch(/isn't declared in _readme\.yaml/);
});

test('an unparseable _readme.yaml is an error, and the built-ins are still linted', async () => {
  const { files, results } = await lintRepo({
    '_readme.yaml': 'navigation: [unclosed\n',
    'docs/a.md': PAGE,
    'docs/_order.yaml': '- a\n',
  });
  expect(files).toStrictEqual(['docs/a.md']);
  const config = forRule(results, 'config');
  expect(config).toHaveLength(1);
  expect(config[0].severity).toBe('error');
  expect(config[0].file).toBe('_readme.yaml');
});

test('_readme.yaml entries ReadMe would reject are errors', async () => {
  const { results } = await lintRepo({
    '_readme.yaml': `navigation:
  - kind: guide
    directory: sdks
  - kind: guide
    directory: sdks
  - kind: guide
    directory: Bad Name
  - kind: guide
    directory: guides
  - kind: reference
    directory: docs
  - kind: recipes
    directory: cookbook
  - kind: home
  - kind: home
  - kind: url
    url: /relative
  - kind: custom_pages
  - kind: guide
  - kind: changelog
    directory: changelogs
  - kind: custom_pages
    slug: 404
`,
    'docs/a.md': PAGE,
    'docs/_order.yaml': '- a\n',
  });
  const errors = forRule(results, 'config')
    .filter(r => r.severity === 'error')
    .map(r => r.message);
  const expected = [
    'Duplicate section: the "sdks" directory',
    'Invalid directory: "Bad Name"',
    'Reserved directory: "guides"',
    'the "docs" directory must use the "guide" kind',
    '"cookbook" must be one of guide or reference',
    'a "home" entry may only appear once',
    'a "url" entry needs an absolute "url"',
    'a "custom_pages" entry needs a "slug"',
    'a "guide" entry needs a "directory"',
    'a "changelog" entry can\'t have a "directory"',
    '404 must be wrapped in quotes to be used as a slug',
  ];
  for (const text of expected) {
    expect(
      errors.some(m => m.includes(text)),
      `expected an error containing: ${text}`,
    ).toBe(true);
  }
  expect(errors).toHaveLength(expected.length);
});

test('things this CLI version does not recognize in _readme.yaml are warnings', async () => {
  const { results, hasErrors } = await lintRepo({
    '_readme.yaml': `theme: dark
navigation:
  - kind: hologram
  - kind: guide
    directory: docs
    color: blue
  - kind: custom_pages
    slug: pricing
  - kind: custom_pages
    slug: terms
`,
    'docs/a.md': PAGE,
    'docs/_order.yaml': '- a\n',
    // A custom page can be raw HTML, so this one isn't missing.
    'custom_pages/terms.html': '<h1>Terms</h1>',
  });
  expect(hasErrors).toBe(false);
  const warnings = forRule(results, 'config').map(r => r.message);
  expect(warnings).toHaveLength(4);
  expect(warnings.some(m => m.includes('"theme"'))).toBe(true);
  expect(warnings.some(m => m.includes('"hologram"'))).toBe(true);
  expect(warnings.some(m => m.includes('"color"'))).toBe(true);
  expect(warnings.some(m => m.includes('custom_pages/pricing.md'))).toBe(true);
});

test('a navigation that is not a list is a warning, since ReadMe reads it as empty', async () => {
  const { results, hasErrors } = await lintRepo({
    '_readme.yaml': 'navigation: docs\n',
    'docs/a.md': PAGE,
    'docs/_order.yaml': '- a\n',
  });
  expect(hasErrors).toBe(false);
  expect(forRule(results, 'config')).toHaveLength(1);
});

test('a built-in listed without a name takes the name ReadMe gives it', () => {
  const root = makeRepo({
    '_readme.yaml':
      'navigation:\n  - kind: reference\n    directory: reference\n  - kind: guide\n    directory: docs\n',
  });
  try {
    const sections = loadSections(root);
    expect(sections.order.slice(0, 2)).toStrictEqual(['reference', 'docs']);
    expect(sections.byDirectory.get('docs').label).toBe('Guides');
    expect(sections.byDirectory.get('reference').label).toBe('API Reference');
    expect(sections.kindOf('docs')).toBe('guide');
  } finally {
    rmRepo(root);
  }
});

test('a directory that looks like a date stays a string, and a bare number has to be quoted', async () => {
  const files = {
    '_readme.yaml': 'navigation:\n  - kind: guide\n    directory: 2026\n  - kind: guide\n    directory: 2026-07-31\n',
  };
  const root = makeRepo(files);
  try {
    expect(loadSections(root).declaredDirectories()).toStrictEqual(['2026-07-31']);
  } finally {
    rmRepo(root);
  }

  const { results } = await lintRepo(files);
  expect(forRule(results, 'config').map(r => r.message)).toStrictEqual([
    'Invalid directory: 2026 must be wrapped in quotes to be used as a directory (navigation[0])',
  ]);
});

test('oas:sync and oas:validate cover a declared reference section', async () => {
  const root = makeRepo({
    '_readme.yaml': README_YAML,
    'apis/partner.json': SPEC,
  });
  try {
    const validated = await validateOas({ cwd: root });
    expect(validated.fileCount).toBe(1);
    expect(validated.results[0].section).toBe('apis');

    const [result] = syncOas(root);
    expect(result.section).toBe('apis');
    expect(result.changes.added.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(root, 'apis'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'reference'))).toBe(false);

    const { results } = await lint({ cwd: root, nonInteractive: true });
    expect(forRule(results, 'oas-reference')).toStrictEqual([]);
  } finally {
    rmRepo(root);
  }
});

test('lint flags a missing page for a spec in a declared reference section', async () => {
  const { results } = await lintRepo({
    '_readme.yaml': README_YAML,
    'apis/partner.json': SPEC,
  });
  const missing = forRule(results, 'oas-reference');
  expect(missing).toHaveLength(1);
  expect(missing[0].file).toBe('apis/partner.json');
});

test('a reference-kind folder is ignored by the OAS tooling until it is declared', async () => {
  const root = makeRepo({ 'apis/partner.json': SPEC, 'docs/a.md': PAGE });
  try {
    expect(syncOas(root)).toBeNull();
    await expect(validateOas({ cwd: root })).resolves.toBeNull();
  } finally {
    rmRepo(root);
  }
});

test('a symlinked _readme.yaml is refused, and declares nothing', async () => {
  const outside = makeRepo({ 'config.yaml': 'navigation:\n  - kind: guide\n    directory: sdks\n' });
  const root = makeRepo({ 'docs/a.md': PAGE, 'docs/_order.yaml': '- a\n', 'sdks/node.md': PAGE });
  try {
    fs.symlinkSync(path.join(outside, 'config.yaml'), path.join(root, '_readme.yaml'));

    expect(loadSections(root).declaredDirectories()).toStrictEqual([]);

    const { files, results } = await lint({ cwd: root, nonInteractive: true });
    expect(files).toStrictEqual(['docs/a.md']);
    expect(forRule(results, 'config')).toMatchObject([{ file: '_readme.yaml', severity: 'error' }]);
  } finally {
    rmRepo(root);
    rmRepo(outside);
  }
});

test('oas:sync refuses a symlink in a declared reference section before touching any section', () => {
  const outside = makeRepo({ 'elsewhere.json': SPEC });
  const root = makeRepo({ '_readme.yaml': README_YAML, 'reference/partner.json': SPEC, 'apis/.keep': '' });
  try {
    fs.symlinkSync(path.join(outside, 'elsewhere.json'), path.join(root, 'apis/linked.json'));

    expect(() => syncOas(root)).toThrow(/symbolic links/);
    expect(fs.readdirSync(path.join(root, 'reference'))).toStrictEqual(['partner.json']);
  } finally {
    rmRepo(root);
    rmRepo(outside);
  }
});
