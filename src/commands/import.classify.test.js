import { test } from 'node:test'
import assert from 'node:assert/strict'
import { __test__ } from './import.js'

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
  assert.equal(isDocsUnderApiPath('https://example.com/api/docs/guides/intro'), true)
  assert.equal(isDocsUnderApiPath('https://example.com/api/docs/pricing'), true)
  assert.equal(isDocsUnderApiPath('https://example.com/api/docs'), true)
  assert.equal(isDocsUnderApiPath('https://example.com/API/DOC/guides'), true)
  assert.equal(isDocsUnderApiPath('https://example.com/api/docs/api'), false)
  assert.equal(isDocsUnderApiPath('https://example.com/api/docs/reference'), false)
  assert.equal(isDocsUnderApiPath('https://example.com/api/docs/api-reference'), false)
  assert.equal(isDocsUnderApiPath('https://example.com/docs/guides'), false)
  assert.equal(isDocsUnderApiPath('https://example.com/api/reference/pets'), false)
  assert.equal(isDocsUnderApiPath('not a url'), false)
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
  assert.deepEqual(
    kept.map((p) => p.title),
    ['Guides', 'Mixed'],
  )
  assert.deepEqual(
    kept[1].pages.map((p) => p.title),
    ['Pricing'],
  )
})

test('urlIsApiReference matches api-reference / endpoints segments only', () => {
  assert.equal(urlIsApiReference('https://example.com/api-reference/pets'), true)
  assert.equal(urlIsApiReference('https://example.com/api_reference/pets'), true)
  assert.equal(urlIsApiReference('https://example.com/endpoints/create'), true)
  assert.equal(urlIsApiReference('https://example.com/endpoint/create'), true)
  assert.equal(urlIsApiReference('https://example.com/api/docs/guides'), false)
  assert.equal(urlIsApiReference('https://example.com/docs/api'), false)
  assert.equal(urlIsApiReference('://bad'), false)
})

test('urlIsChangelog matches changelog-ish slugs without sweeping release-pipeline', () => {
  assert.equal(urlIsChangelog('https://example.com/docs/changelog'), true)
  assert.equal(urlIsChangelog('https://example.com/docs/changelog-javascript-agent'), true)
  assert.equal(urlIsChangelog('https://example.com/docs/release-notes'), true)
  assert.equal(urlIsChangelog('https://example.com/docs/whats-new'), true)
  assert.equal(urlIsChangelog('https://example.com/docs/releases'), true)
  assert.equal(urlIsChangelog('https://example.com/docs/release-2026-2'), true)
  assert.equal(urlIsChangelog('https://example.com/docs/release-pipeline'), false)
  assert.equal(urlIsChangelog('https://example.com/docs/getting-started'), false)
  assert.equal(urlIsChangelog('://bad'), false)
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
  assert.deepEqual(extracted, [
    { title: 'Notes', url: 'https://example.com/docs/changelog', description: 'What shipped' },
    { title: 'v1', url: 'https://example.com/docs/release-notes/v1' },
  ])
  assert.deepEqual(sections[0].items.map((i) => i.url), ['https://example.com/docs/intro'])
  assert.deepEqual(sections[1].items, [])
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

  assert.equal(reclassifyReferencePages(scraped), 3)
  assert.deepEqual(
    scraped.categories.map((c) => c.title),
    ['Developers', 'API Reference'],
  )
  assert.deepEqual(
    scraped.categories[0].pages.map((p) => p.title),
    ['Guide'],
  )
  assert.deepEqual(
    scraped.categories[1].pages.map((p) => p.url),
    [
      'https://example.com/api-reference/pets',
      'https://example.com/endpoints/create',
      'https://example.com/endpoints/delete',
    ],
  )
})

test('isAuthChromeUrl matches leading login/account routes only', () => {
  assert.equal(isAuthChromeUrl('https://example.com/auth'), true)
  assert.equal(isAuthChromeUrl('https://example.com/login/callback'), true)
  assert.equal(isAuthChromeUrl('https://example.com/sign-in'), true)
  assert.equal(isAuthChromeUrl('https://example.com/signup'), true)
  assert.equal(isAuthChromeUrl('https://example.com/oauth2/authorize'), true)
  assert.equal(isAuthChromeUrl('https://example.com/sso'), true)
  assert.equal(isAuthChromeUrl('https://example.com/docs/auth'), false)
  assert.equal(isAuthChromeUrl('https://example.com/authenticate'), false)
  assert.equal(isAuthChromeUrl('://bad'), false)
})

test('isDiscoverableLink keeps same-origin doc paths and drops assets, chrome, and off-origin', () => {
  const base = new URL('https://example.com/docs')
  assert.equal(isDiscoverableLink('https://example.com/docs/intro', base), true)
  assert.equal(isDiscoverableLink('https://other.com/docs/intro', base), false)
  assert.equal(isDiscoverableLink('https://example.com/', base), false)
  assert.equal(isDiscoverableLink('https://example.com/logo.png', base), false)
  assert.equal(isDiscoverableLink('https://example.com/_next/static/chunk.js', base), false)
  assert.equal(isDiscoverableLink('https://example.com/assets/app.js', base), false)
  assert.equal(isDiscoverableLink('not a url', base), false)
})

test('decodeEntities and stripTags clean sidebar titles that would otherwise miss category routing', () => {
  assert.equal(decodeEntities('New Features &amp; Upgrade Changes'), 'New Features & Upgrade Changes')
  assert.equal(decodeEntities('A &#38; B'), 'A & B')
  assert.equal(decodeEntities('hex &#x26; amp'), 'hex & amp')
  assert.equal(decodeEntities('plain'), 'plain')
  assert.equal(stripTags('<span>API\u200B Reference</span>'), 'API Reference')
  assert.equal(stripTags('Guides &amp; <b>Recipes</b>'), 'Guides & Recipes')
})
