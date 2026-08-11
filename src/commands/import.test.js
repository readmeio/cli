import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { __test__ } from './import.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockLlmsFetch(files) {
  const seen = []
  globalThis.fetch = async (url) => {
    const href = String(url)
    seen.push(href)
    if (!Object.hasOwn(files, href)) return new Response('', { status: 404 })
    return new Response(files[href], {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })
  }
  return seen
}

function mockRedirectFetch(files) {
  globalThis.fetch = async (url) => {
    const entry = files[String(url)]
    if (!entry) return { ok: false, status: 404, url: String(url), text: async () => '' }
    return { ok: true, status: 200, url: entry.finalUrl || String(url), text: async () => entry.body || '' }
  }
}

function mergedItems(merged) {
  return merged.parsed.sections.flatMap((section) => section.items.map((item) => ({ text: item.text, url: item.url })))
}

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

test('llms.txt fetched through a cross-origin redirect resolves links against the final URL', async () => {
  mockRedirectFetch({
    'https://docs.example.com/llms.txt': {
      finalUrl: 'https://example.com/docs/llms.txt',
      body: `# Docs\n\n## Guides\n- [Sample APIs](/docs/sample-apis.md)\n- [Policies](/policies.md)\n`,
    },
  })

  const discovery = await __test__.discoverLlmsTxt(new URL('https://docs.example.com'))
  const merged = __test__.mergeValidHits(discovery.hits)
  const urls = mergedItems(merged).map((item) => item.url)

  assert(urls.includes('https://example.com/docs/sample-apis.md'))
  assert(urls.includes('https://example.com/docs/policies.md'))
  assert(!urls.some((url) => url.startsWith('https://docs.example.com/')))
})

test('nested llms.txt with its own redirect resolves links on its final path', async () => {
  mockRedirectFetch({
    'https://example.com/llms.txt': {
      body: `# Root\n\n## Index\n- [Guide llms](/guide/llms.txt)\n`,
    },
    'https://example.com/guide/llms.txt': {
      finalUrl: 'https://example.com/docs/guide/llms.txt',
      body: `# Guide\n\n## Guides\n- [Intro](intro.md)\n- [Setup](setup.md)\n`,
    },
  })

  const discovery = await __test__.discoverLlmsTxt(new URL('https://example.com'))
  const merged = __test__.mergeValidHits(discovery.hits)
  const urls = mergedItems(merged).map((item) => item.url)

  assert(urls.includes('https://example.com/docs/guide/intro.md'))
  assert(urls.includes('https://example.com/docs/guide/setup.md'))
  assert(!urls.includes('https://example.com/guide/intro.md'))
  assert(!urls.includes('https://example.com/guide/setup.md'))
})

test('resolveRedirectedSourceUrl adopts cross-origin path redirects', async () => {
  mockRedirectFetch({
    'https://docs.example.com/': { finalUrl: 'https://example.com/docs' },
  })
  const final = await __test__.resolveRedirectedSourceUrl(new URL('https://docs.example.com/'))
  assert.equal(final?.href, 'https://example.com/docs')
})

test('resolveRedirectedSourceUrl ignores trailing-slash redirects', async () => {
  mockRedirectFetch({
    'https://example.com/docs': { finalUrl: 'https://example.com/docs/' },
  })
  assert.equal(await __test__.resolveRedirectedSourceUrl(new URL('https://example.com/docs')), null)
})

test('resolveRedirectedSourceUrl ignores query and hash-only redirects', async () => {
  mockRedirectFetch({
    'https://example.com/docs': { finalUrl: 'https://example.com/docs?lang=en#top' },
  })
  assert.equal(await __test__.resolveRedirectedSourceUrl(new URL('https://example.com/docs')), null)
})

test('resolveRedirectedSourceUrl returns null on non-ok responses', async () => {
  globalThis.fetch = async (url) => ({ ok: false, status: 500, url: String(url), text: async () => '' })
  assert.equal(await __test__.resolveRedirectedSourceUrl(new URL('https://example.com/')), null)
})

test('resolveRedirectedSourceUrl returns null when fetch throws', async () => {
  globalThis.fetch = async () => {
    throw new Error('network down')
  }
  assert.equal(await __test__.resolveRedirectedSourceUrl(new URL('https://example.com/')), null)
})

function mockDocsProbeFetch(files, { catchAllBody } = {}) {
  globalThis.fetch = async (url) => {
    const href = String(url)
    if (new URL(href).hostname !== 'example.com') throw new Error('getaddrinfo ENOTFOUND')
    const entry = files[href]
    if (entry) return { ok: true, status: 200, url: entry.finalUrl || href, text: async () => entry.body || '' }
    if (catchAllBody && !href.endsWith('/llms.txt')) return { ok: true, status: 200, url: href, text: async () => catchAllBody }
    return { ok: false, status: 404, url: href, text: async () => '' }
  }
}

test('resolveDocsBaseUrl adopts a path route whose trailing slash gets stripped by a redirect', async () => {
  mockDocsProbeFetch({
    'https://example.com/docs/': { finalUrl: 'https://example.com/docs', body: '<title>API Docs</title>' },
  })
  const result = await __test__.resolveDocsBaseUrl(new URL('https://example.com'))
  assert.equal(result?.url.href, 'https://example.com/docs/')
  assert.equal(result?.kind, 'path')
  assert.equal(result?.hasLlms, false)
})

test('resolveDocsBaseUrl rejects a path route that redirects to the homepage', async () => {
  mockDocsProbeFetch({
    'https://example.com/docs/': { finalUrl: 'https://example.com/' },
  })
  assert.equal(await __test__.resolveDocsBaseUrl(new URL('https://example.com')), null)
})

test('resolveDocsBaseUrl skips SPA catch-all routes and adopts the route with distinct content', async () => {
  mockDocsProbeFetch(
    {
      'https://example.com/developers/': { finalUrl: 'https://example.com/developers', body: '<title>API Documentation</title>' },
    },
    { catchAllBody: '<title>Example - Empowering</title>' },
  )
  const result = await __test__.resolveDocsBaseUrl(new URL('https://example.com'))
  assert.equal(result?.url.href, 'https://example.com/developers/')
  assert.equal(result?.kind, 'path')
  assert.equal(result?.hasLlms, false)
})

test('resolveDocsBaseUrl returns null when every candidate fails', async () => {
  mockDocsProbeFetch({})
  assert.equal(await __test__.resolveDocsBaseUrl(new URL('https://example.com')), null)
})

test('inCandidateScope normalizes trailing slashes and enforces segment boundaries', () => {
  const candidate = { kind: 'path', url: new URL('https://example.com/docs/') }
  assert.equal(__test__.inCandidateScope(candidate, 'https://example.com/docs'), true)
  assert.equal(__test__.inCandidateScope(candidate, 'https://www.example.com/docs'), true)
  assert.equal(__test__.inCandidateScope(candidate, 'https://example.com/docs/llms.txt'), true)
  assert.equal(__test__.inCandidateScope(candidate, 'https://example.com/DOCS//'), true)
  assert.equal(__test__.inCandidateScope(candidate, 'https://example.com/docsomething'), false)
  assert.equal(__test__.inCandidateScope(candidate, 'https://example.com/'), false)
})
