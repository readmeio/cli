import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { __test__ } from './import.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockLlmsFetch(files) {
  return mockFetch(files, 'text/plain')
}

function mockFetch(files, contentType = 'application/xml') {
  const seen = []
  globalThis.fetch = async (url) => {
    const href = String(url)
    seen.push(href)
    if (!Object.hasOwn(files, href)) return new Response('', { status: 404 })
    return new Response(files[href], {
      status: 200,
      headers: { 'content-type': contentType },
    })
  }
  return seen
}

function sitemapXml(urls) {
  return `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join('')}</urlset>`
}

function mergedItems(merged) {
  return merged.parsed.sections.flatMap((section) => section.items.map((item) => ({ text: item.text, url: item.url })))
}

test('well-known sitemap candidates use the same docs route order as llms route probing, then walk source path to root', () => {
  const sourceUrl = new URL('https://www.example.com/a/b')
  const routeBases = __test__.buildWellKnownDocRoutes(sourceUrl).map((candidate) => candidate.url.href)
  const sitemapCandidates = __test__.buildSitemapCandidates(sourceUrl).map((candidate) => candidate.url)

  assert.deepEqual(
    sitemapCandidates.slice(0, routeBases.length),
    routeBases.map((href) => `${href}sitemap.xml`),
  )
  assert.deepEqual(sitemapCandidates.slice(-3), [
    'https://www.example.com/a/b/sitemap.xml',
    'https://www.example.com/a/sitemap.xml',
    'https://www.example.com/sitemap.xml',
  ])
})

test('sitemap discovery gathers root sitemap URLs before narrowing and does not scope to an ambiguous source path', async () => {
  mockFetch({
    'https://www.cerqlar.com/sitemap.xml': sitemapXml([
      'https://www.cerqlar.com/',
      'https://www.cerqlar.com/learn',
      'https://www.cerqlar.com/blog/example',
      'https://www.cerqlar.com/resources/thing',
    ]),
  })

  const discovery = await __test__.discoverSitemapXml(new URL('https://www.cerqlar.com/learn'))

  assert(discovery.urls.includes('https://www.cerqlar.com/learn'))
  assert(discovery.urls.includes('https://www.cerqlar.com/blog/example'))
  assert(discovery.urls.includes('https://www.cerqlar.com/resources/thing'))
  assert.equal(discovery.urls.length, 4)
})

test('sitemap post-filtering narrows root sitemap URLs to a strong docs subtree on non-docs hosts', () => {
  const urls = [
    'https://example.com/pricing',
    'https://example.com/blog/foo',
    'https://example.com/docs/getting-started',
    'https://example.com/docs/api/auth',
  ]
  const narrowed = __test__.narrowSitemapUrlsToDocsSubtreeIfNeeded(urls, new URL('https://example.com/learn'), [
    { sitemapUrl: 'https://example.com/sitemap.xml' },
  ])

  assert.deepEqual(narrowed.urls, ['https://example.com/docs/getting-started', 'https://example.com/docs/api/auth'])
  assert.equal(narrowed.segment, 'docs')
  assert.equal(narrowed.dropped, 2)
})

test('sitemap post-filtering does not narrow to ambiguous learn subtree', () => {
  const urls = [
    'https://example.com/pricing',
    'https://example.com/learn',
    'https://example.com/learn/article',
  ]
  const narrowed = __test__.narrowSitemapUrlsToDocsSubtreeIfNeeded(urls, new URL('https://example.com/learn'), [
    { sitemapUrl: 'https://example.com/sitemap.xml' },
  ])

  assert.equal(narrowed, null)
})

test('llms discovery and merge resolve nested files, dedupe canonical pages, and preserve distinct page states', async () => {
  const seen = mockLlmsFetch({
    'https://example.com/docs/llms.txt': `# Docs\n\n## Index\n- [Guide llms](guide/llms.txt)\n- [API llms](https://example.com/docs/api/llms.txt)\n`,
    'https://example.com/docs/guide/llms.txt': `# Guide\n\n## Guides\n- [Rendered redirect](/getting-started)\n- [Rendered slash](/getting-started/)\n- [Rendered index](/getting-started/index.html)\n- [Markdown source](/getting-started.md)\n- [Search API](/search?product=api)\n- [Search SDK](/search?product=sdk)\n- [Search API Anchor](/search?product=api#overview)\n- [Hash only](#local)\n- [Mail](mailto:test@example.com)\n- [JS](javascript:alert(1))\n- [Malformed](http://%zz)\n`,
    'https://example.com/docs/api/llms.txt': `# API\n\n## Reference\n- [Reference](/reference.md)\n- [OpenAPI](/openapi.yaml)\n`,
  })

  const discovery = await __test__.discoverLlmsTxt(new URL('https://example.com/docs/'))
  const merged = __test__.mergeValidHits(discovery.hits)
  const items = mergedItems(merged)
  const urls = items.map((item) => item.url)

  assert(seen.includes('https://example.com/docs/guide/llms.txt'))
  assert(seen.includes('https://example.com/docs/api/llms.txt'))

  assert.equal(urls.filter((url) => url.includes('/docs/guide/getting-started')).length, 1)
  assert(urls.includes('https://example.com/docs/guide/getting-started.md'))

  assert(urls.includes('https://example.com/docs/guide/search?product=api'))
  assert(urls.includes('https://example.com/docs/guide/search?product=sdk'))
  assert.equal(urls.filter((url) => url.includes('/docs/guide/search?product=api')).length, 1)

  assert(urls.includes('https://example.com/docs/api/reference.md'))
  assert(urls.includes('https://example.com/openapi.yaml'))

  assert(!urls.some((url) => url.includes('%zz')))
  assert(!urls.some((url) => url.startsWith('mailto:') || url.startsWith('javascript:')))
})
