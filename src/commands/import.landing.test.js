import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { __test__ } from './import.js'

const {
  injectSectionLandingPages,
  parseMetaRefreshTarget,
  parseHtmlCanonical,
} = __test__

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockLandingFetch(routes) {
  globalThis.fetch = async (url) => {
    const href = String(url)
    const entry = routes[href]
    if (!entry) return { ok: false, status: 404, url: href, text: async () => '' }
    if (entry instanceof Error) throw entry
    return {
      ok: entry.ok !== false,
      status: entry.status ?? 200,
      url: entry.finalUrl || href,
      text: async () => entry.body || '',
    }
  }
}

test('parseMetaRefreshTarget resolves relative, quoted, and entity-encoded targets', () => {
  const base = 'https://example.com/docs/guides/'
  assert.equal(
    parseMetaRefreshTarget('<meta http-equiv="refresh" content="0;url=/docs/guides/intro">', base),
    'https://example.com/docs/guides/intro',
  )
  assert.equal(
    parseMetaRefreshTarget("<meta http-equiv='refresh' content='0; url=intro'>", base),
    'https://example.com/docs/guides/intro',
  )
  assert.equal(
    parseMetaRefreshTarget('<meta http-equiv="refresh" content="0;url=/docs/guides?tab=js&amp;x=1">', base),
    'https://example.com/docs/guides?tab=js&x=1',
  )
  assert.equal(parseMetaRefreshTarget('<html><title>Guides</title></html>', base), null)
  assert.equal(parseMetaRefreshTarget('', base), null)
  assert.equal(parseMetaRefreshTarget('<meta http-equiv="refresh" content="5">', base), null)
})

test('parseHtmlCanonical resolves relative and entity-encoded hrefs', () => {
  const base = 'https://example.com/docs/guides/'
  assert.equal(
    parseHtmlCanonical('<link rel="canonical" href="/docs/guides/intro">', base),
    'https://example.com/docs/guides/intro',
  )
  assert.equal(
    parseHtmlCanonical("<link rel='canonical' href='intro'>", base),
    'https://example.com/docs/guides/intro',
  )
  assert.equal(
    parseHtmlCanonical('<link rel="canonical" href="/docs/guides?tab=js&amp;x=1">', base),
    'https://example.com/docs/guides?tab=js&x=1',
  )
  assert.equal(parseHtmlCanonical('<html></html>', base), null)
  assert.equal(parseHtmlCanonical('', base), null)
})

test('injectSectionLandingPages prepends a real common-prefix landing page', async () => {
  mockLandingFetch({
    'https://example.com/docs/guides': { body: '<title>Guides</title>' },
  })
  const organized = {
    categories: [
      {
        title: 'Guides',
        pages: [
          { title: 'Intro', url: 'https://example.com/docs/guides/intro' },
          { title: 'Install', url: 'https://example.com/docs/guides/install' },
        ],
      },
    ],
  }

  await injectSectionLandingPages(organized, 'https://example.com/docs')

  assert.equal(organized.categories[0].pages[0].url, 'https://example.com/docs/guides')
  assert.equal(organized.categories[0].pages[0].title, 'Guides')
  assert.equal(organized.categories[0].pages.length, 3)
})

test('injectSectionLandingPages skips client-redirect stub landings via meta refresh', async () => {
  mockLandingFetch({
    'https://example.com/docs/guides': {
      body: '<meta http-equiv="refresh" content="0;url=/docs/guides/intro">',
    },
  })
  const organized = {
    categories: [
      {
        title: 'Guides',
        pages: [
          { title: 'Intro', url: 'https://example.com/docs/guides/intro' },
          { title: 'Install', url: 'https://example.com/docs/guides/install' },
        ],
      },
    ],
  }

  await injectSectionLandingPages(organized, 'https://example.com/docs')
  assert.deepEqual(
    organized.categories[0].pages.map((p) => p.url),
    ['https://example.com/docs/guides/intro', 'https://example.com/docs/guides/install'],
  )
})

test('injectSectionLandingPages skips landings whose canonical points at a known child', async () => {
  mockLandingFetch({
    'https://example.com/docs/guides': {
      body: '<link rel="canonical" href="/docs/guides/intro">',
    },
  })
  const organized = {
    categories: [
      {
        title: 'Guides',
        pages: [
          { title: 'Intro', url: 'https://example.com/docs/guides/intro' },
          { title: 'Install', url: 'https://example.com/docs/guides/install' },
        ],
      },
    ],
  }

  await injectSectionLandingPages(organized, 'https://example.com/docs')
  assert.equal(organized.categories[0].pages.length, 2)
})

test('injectSectionLandingPages skips landings that HTTP-redirect onto a known child', async () => {
  mockLandingFetch({
    'https://example.com/docs/guides': {
      finalUrl: 'https://example.com/docs/guides/intro',
      body: '<title>Intro</title>',
    },
  })
  const organized = {
    categories: [
      {
        title: 'Guides',
        pages: [
          { title: 'Intro', url: 'https://example.com/docs/guides/intro' },
          { title: 'Install', url: 'https://example.com/docs/guides/install' },
        ],
      },
    ],
  }

  await injectSectionLandingPages(organized, 'https://example.com/docs')
  assert.equal(organized.categories[0].pages.length, 2)
})

test('injectSectionLandingPages does not probe the import base or categories with a single child', async () => {
  const seen = []
  globalThis.fetch = async (url) => {
    seen.push(String(url))
    return { ok: true, status: 200, url: String(url), text: async () => '<title>Docs</title>' }
  }
  const organized = {
    categories: [
      {
        title: 'Docs',
        pages: [
          { title: 'A', url: 'https://example.com/docs/a' },
          { title: 'B', url: 'https://example.com/docs/b' },
        ],
      },
      {
        title: 'Lonely',
        pages: [{ title: 'Only', url: 'https://example.com/docs/guides/only' }],
      },
    ],
  }

  await injectSectionLandingPages(organized, 'https://example.com/docs')
  assert.deepEqual(seen, [])
  assert.equal(organized.categories[0].pages.length, 2)
  assert.equal(organized.categories[1].pages.length, 1)
})

test('injectSectionLandingPages ignores 404s and fetch failures', async () => {
  mockLandingFetch({
    'https://example.com/docs/guides': new Error('network down'),
    'https://example.com/docs/api': { ok: false, status: 404, body: '' },
  })
  const organized = {
    categories: [
      {
        title: 'Guides',
        pages: [
          { title: 'Intro', url: 'https://example.com/docs/guides/intro' },
          { title: 'Install', url: 'https://example.com/docs/guides/install' },
        ],
      },
      {
        title: 'API',
        pages: [
          { title: 'Auth', url: 'https://example.com/docs/api/auth' },
          { title: 'Errors', url: 'https://example.com/docs/api/errors' },
        ],
      },
    ],
  }

  await injectSectionLandingPages(organized, 'https://example.com/docs')
  assert.equal(organized.categories[0].pages.length, 2)
  assert.equal(organized.categories[1].pages.length, 2)
})
