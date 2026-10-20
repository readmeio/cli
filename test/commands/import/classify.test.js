import { test, expect } from 'vitest'
import { __test__ } from '../../../src/commands/import.js'

const {
  isDiscoverableLink,
  isAuthChromeUrl,
  isDocsUnderApiPath,
  filterUrlPagesTree,
  urlIsApiReference,
  urlIsChangelog,
  reclassifyReferencePages,
  extractChangelogFromSections,
  decodeEntities,
  stripTags,
} = __test__

test('isDocsUnderApiPath treats /api/docs guides as docs, not reference', () => {
  expect(isDocsUnderApiPath('https://example.com/api/docs/guides/intro')).toBe(true)
  expect(isDocsUnderApiPath('https://example.com/api/docs/pricing')).toBe(true)
  expect(isDocsUnderApiPath('https://example.com/api/docs')).toBe(true)
  expect(isDocsUnderApiPath('https://example.com/API/DOC/guides')).toBe(true)
  expect(isDocsUnderApiPath('https://example.com/api/docs/api')).toBe(false)
  expect(isDocsUnderApiPath('https://example.com/api/docs/reference')).toBe(false)
  expect(isDocsUnderApiPath('https://example.com/api/docs/api-reference')).toBe(false)
  expect(isDocsUnderApiPath('https://example.com/docs/guides')).toBe(false)
  expect(isDocsUnderApiPath('https://example.com/api/reference/pets')).toBe(false)
  expect(isDocsUnderApiPath('not a url')).toBe(false)
})

test('filterUrlPagesTree keeps matching URL pages and empty parents with survivors', () => {
  const tree = [
    { title: 'Guides', url: 'https://example.com/api/docs/guides' },
    { title: 'Pets', url: 'https://example.com/api/reference/pets' },
    {
      title: 'Mixed',
      pages: [
        { title: 'Pricing', url: 'https://example.com/api/docs/pricing' },
        { title: 'Endpoint', url: 'https://example.com/api/reference/create' },
      ],
    },
    { title: 'Empty leftover', pages: [{ title: 'Gone', url: 'https://example.com/api/reference/gone' }] },
  ]

  const kept = filterUrlPagesTree(tree, isDocsUnderApiPath)
  expect(
    kept.map((p) => p.title)).toStrictEqual(
    ['Guides', 'Mixed'],
  );
  expect(
    kept[1].pages.map((p) => p.title)).toStrictEqual(
    ['Pricing'],
  );
})

test('urlIsApiReference matches api-reference / endpoints segments only', () => {
  expect(urlIsApiReference('https://example.com/api-reference/pets')).toBe(true)
  expect(urlIsApiReference('https://example.com/api_reference/pets')).toBe(true)
  expect(urlIsApiReference('https://example.com/endpoints/create')).toBe(true)
  expect(urlIsApiReference('https://example.com/endpoint/create')).toBe(true)
  expect(urlIsApiReference('https://example.com/api/docs/guides')).toBe(false)
  expect(urlIsApiReference('https://example.com/docs/api')).toBe(false)
  expect(urlIsApiReference('://bad')).toBe(false)
})

test('urlIsChangelog matches changelog-ish slugs without sweeping release-pipeline', () => {
  expect(urlIsChangelog('https://example.com/docs/changelog')).toBe(true)
  expect(urlIsChangelog('https://example.com/docs/changelog-javascript-agent')).toBe(true)
  expect(urlIsChangelog('https://example.com/docs/release-notes')).toBe(true)
  expect(urlIsChangelog('https://example.com/docs/whats-new')).toBe(true)
  expect(urlIsChangelog('https://example.com/docs/releases')).toBe(true)
  expect(urlIsChangelog('https://example.com/docs/release-2026-2')).toBe(true)
  expect(urlIsChangelog('https://example.com/docs/release-pipeline')).toBe(false)
  expect(urlIsChangelog('https://example.com/docs/getting-started')).toBe(false)
  expect(urlIsChangelog('://bad')).toBe(false)
})

test('extractChangelogFromSections pulls changelog rows out of llms sections in place', () => {
  const sections = [
    {
      title: 'Guides',
      items: [
        { text: 'Intro', url: 'https://example.com/docs/intro' },
        { text: 'Notes', url: 'https://example.com/docs/changelog', description: 'What shipped' },
      ],
    },
    {
      title: 'History',
      items: [{ text: 'v1', url: 'https://example.com/docs/release-notes/v1' }],
    },
  ]

  const extracted = extractChangelogFromSections(sections)
  expect(extracted).toStrictEqual([
    { title: 'Notes', url: 'https://example.com/docs/changelog', description: 'What shipped' },
    { title: 'v1', url: 'https://example.com/docs/release-notes/v1' },
  ])
  expect(sections[0].items.map((i) => i.url)).toStrictEqual(['https://example.com/docs/intro'])
  expect(sections[1].items).toStrictEqual([])
})

test('reclassifyReferencePages sweeps api-reference URLs into one category and drops emptied ones', () => {
  const scraped = {
    categories: [
      {
        title: 'Developers',
        pages: [
          { title: 'Guide', url: 'https://example.com/docs/guide' },
          {
            title: 'List pets',
            url: 'https://example.com/api-reference/pets',
            pages: [{ title: 'Create pet', url: 'https://example.com/endpoints/create' }],
          },
        ],
      },
      {
        title: 'Only endpoints',
        pages: [{ title: 'Delete pet', url: 'https://example.com/endpoints/delete' }],
      },
    ],
  }

  expect(reclassifyReferencePages(scraped)).toBe(3)
  expect(
    scraped.categories.map((c) => c.title)).toStrictEqual(
    ['Developers', 'API Reference'],
  )
  expect(
    scraped.categories[0].pages.map((p) => p.title)).toStrictEqual(
    ['Guide'],
  )
  expect(
    scraped.categories[1].pages.map((p) => p.url)).toStrictEqual(
    [
      'https://example.com/api-reference/pets',
      'https://example.com/endpoints/create',
      'https://example.com/endpoints/delete',
    ],
  )
})

test('isAuthChromeUrl matches leading login/account routes only', () => {
  expect(isAuthChromeUrl('https://example.com/auth')).toBe(true)
  expect(isAuthChromeUrl('https://example.com/login/callback')).toBe(true)
  expect(isAuthChromeUrl('https://example.com/sign-in')).toBe(true)
  expect(isAuthChromeUrl('https://example.com/signup')).toBe(true)
  expect(isAuthChromeUrl('https://example.com/oauth2/authorize')).toBe(true)
  expect(isAuthChromeUrl('https://example.com/sso')).toBe(true)
  expect(isAuthChromeUrl('https://example.com/docs/auth')).toBe(false)
  expect(isAuthChromeUrl('https://example.com/authenticate')).toBe(false)
  expect(isAuthChromeUrl('://bad')).toBe(false)
})

test('isDiscoverableLink keeps same-origin doc paths and drops assets, chrome, and off-origin', () => {
  const base = new URL('https://example.com/docs')
  expect(isDiscoverableLink('https://example.com/docs/intro', base)).toBe(true)
  expect(isDiscoverableLink('https://other.com/docs/intro', base)).toBe(false)
  expect(isDiscoverableLink('https://example.com/', base)).toBe(false)
  expect(isDiscoverableLink('https://example.com/logo.png', base)).toBe(false)
  expect(isDiscoverableLink('https://example.com/_next/static/chunk.js', base)).toBe(false)
  expect(isDiscoverableLink('https://example.com/assets/app.js', base)).toBe(false)
  expect(isDiscoverableLink('not a url', base)).toBe(false)
})

test('decodeEntities and stripTags clean sidebar titles that would otherwise miss category routing', () => {
  expect(decodeEntities('New Features &amp; Upgrade Changes')).toBe('New Features & Upgrade Changes')
  expect(decodeEntities('A &#38; B')).toBe('A & B')
  expect(decodeEntities('hex &#x26; amp')).toBe('hex & amp')
  expect(decodeEntities('plain')).toBe('plain')
  expect(stripTags('<span>API\u200B Reference</span>')).toBe('API Reference')
  expect(stripTags('Guides &amp; <b>Recipes</b>')).toBe('Guides & Recipes')
})
