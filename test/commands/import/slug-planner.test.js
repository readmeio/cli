import { test, expect } from 'vitest';

import { ensureUniqueSlugs } from '../../../src/commands/import.js';

function assignedSlug(categories, page) {
  return ensureUniqueSlugs(categories).get(page);
}

test('ensureUniqueSlugs: generic docs terminal paths fall back to introduction', () => {
  for (const segment of ['doc', 'docs', 'documentation', 'documentations']) {
    const page = { title: segment, url: `https://example.com/${segment}` };
    expect(assignedSlug([{ title: 'Documentation', pages: [page] }], page)).toBe('introduction');
  }
});

test('ensureUniqueSlugs: terminal generic docs paths use introduction under non-generic categories', () => {
  const page = { title: 'Docs', url: 'https://example.com/docs' };

  expect(assignedSlug([{ title: 'Guides', pages: [page] }], page)).toBe('introduction');
});

test('ensureUniqueSlugs: category segment disambiguates introduction collisions', () => {
  const guidesPage = { title: 'Docs', url: 'https://example.com/docs' };
  const apiPage = { title: 'Docs', url: 'https://example.com/docs' };
  const slugs = ensureUniqueSlugs([
    { title: 'Guides', pages: [guidesPage] },
    { title: 'API', pages: [apiPage] },
  ]);

  expect(slugs.get(guidesPage)).toBe('guides-introduction');
  expect(slugs.get(apiPage)).toBe('api-introduction');
});

test('ensureUniqueSlugs: generic docs category does not prefix an available page slug', () => {
  const page = { title: 'Getting Started', url: 'https://example.com/docs/getting-started' };

  expect(assignedSlug([{ title: 'Docs', pages: [page] }], page)).toBe('getting-started');
});

test('ensureUniqueSlugs: generic docs categories use existing numeric suffix fallback for irreducible collisions', () => {
  const first = { title: 'Getting Started', url: 'https://example.com/docs/getting-started' };
  const second = { title: 'Getting Started', url: 'https://example.com/documentation/getting-started' };
  const slugs = ensureUniqueSlugs([
    { title: 'Docs', pages: [first] },
    { title: 'Documentation', pages: [second] },
  ]);

  expect(slugs.get(first)).toBe('getting-started');
  expect(slugs.get(second)).toBe('getting-started-2');
});

test('ensureUniqueSlugs: generic docs category is assigned before non-generic categories', () => {
  const docsPage = { title: 'Getting Started', url: 'https://example.com/docs/getting-started' };
  const aiPage = { title: 'Getting Started', url: 'https://example.com/ai/getting-started' };
  const slugs = ensureUniqueSlugs([
    { title: 'AI', pages: [aiPage] },
    { title: 'Docs', pages: [docsPage] },
  ]);

  expect(slugs.get(docsPage)).toBe('getting-started');
  expect(slugs.get(aiPage)).toBe('ai-getting-started');
});

test('ensureUniqueSlugs: non-generic docs paths keep current base slug behavior', () => {
  const api = { title: 'API', url: 'https://example.com/docs/api' };
  const gettingStarted = { title: 'Getting Started', url: 'https://example.com/docs/getting-started' };
  const docsApi = { title: 'Docs API', url: 'https://example.com/docs-api' };
  const documentationSettings = { title: 'Documentation Settings', url: 'https://example.com/documentation-settings' };
  const slugs = ensureUniqueSlugs([{ title: 'Guides', pages: [api, gettingStarted, docsApi, documentationSettings] }]);

  expect(slugs.get(api)).toBe('api');
  expect(slugs.get(gettingStarted)).toBe('getting-started');
  expect(slugs.get(docsApi)).toBe('docs-api');
  expect(slugs.get(documentationSettings)).toBe('documentation-settings');
});
