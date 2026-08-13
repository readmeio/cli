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

function fernHtml(fragments, { aside = true, generator = false, extraBody = '' } = {}) {
  const scripts = fragments.map((fragment) => `<script>self.__next_f.push([1,${JSON.stringify(fragment)}])</script>`).join('\n')
  const head = generator ? '<meta name="generator" content="https://buildwithfern.com">' : ''
  const sidebar = aside ? '<aside id="fern-sidebar" class="fern-sidebar-container"></aside>' : ''
  return `<!doctype html><html><head>${head}</head><body>${sidebar}${extraBody}${scripts}</body></html>`
}

function mockHtmlFetch(pages) {
  globalThis.fetch = async (url) => {
    const entry = pages[String(url)]
    if (entry === undefined) return { ok: false, status: 404, url: String(url), text: async () => '' }
    if (entry instanceof Error) throw entry
    return { ok: true, status: 200, url: String(url), text: async () => entry }
  }
}

const GEN1_TREE =
  '7a:["$","$L7b",null,{"children":[' +
  '{"type":"sidebarGroup","id":"sidebar-group:section:docs/get-started","collapsed":"$undefined","children":[' +
  '{"type":"section","id":"section:docs/get-started","title":"Get started","slug":"docs/get-started","hidden":false,"pointsTo":"$undefined","children":[' +
  '{"type":"page","id":"page:intro","title":"Introduction","slug":"intro","hidden":false},' +
  '{"type":"page","id":"page:secret","title":"Secret","slug":"secret","hidden":true},' +
  '{"type":"section","id":"section:docs/nested","title":"Nested","slug":"nested/overview","hidden":false,"pointsTo":"$undefined","overviewPageId":"nested/overview.mdx","children":[' +
  '{"type":"page","id":"page:nested/deep","title":"Deep page","slug":"nested/deep","hidden":false}]}]}]}]}]'

const GEN2_TREE =
  '7a:["$","$L7b",null,{"children":[' +
  '{"type":"sidebarGroup","id":"c00ed6ec6366da0ae76c9bd27e2e2c23bf3785a61bbb0990","collapsed":"$undefined","children":[' +
  '{"type":"section","id":"28eaf69e90e0a08edb3d6840439eeacb0b9dbdb3","title":"Get started","slug":"docs/get-started","hidden":false,"pointsTo":"$undefined","children":[' +
  '{"type":"page","id":"bc59f5966f28f9f0c31ac71f02619db1e70e8c65","title":"Introduction","slug":"intro","hidden":false},' +
  '{"type":"page","id":"3d9a0da0ad64e4f360afee1dee83e4ae1b848dff","title":"Secret","slug":"secret","hidden":true},' +
  '{"type":"section","id":"75861c60edfc32eefed7d2a77f7d1b9563a7bb74","title":"Nested","slug":"docs/nested","hidden":false,"pointsTo":"nested/overview","children":[' +
  '{"type":"page","id":"03b7470af4ce00f9a9dc979ba32fec3fd1c4a7bd","title":"Deep page","slug":"nested/deep","hidden":false}]}]}]}]}]'

function assertGetStartedTree(nav) {
  assert.equal(nav.categories.length, 1)
  const [category] = nav.categories
  assert.equal(category.title, 'Get started')
  assert.deepEqual(
    category.pages.map((p) => p.url),
    ['https://fern.example/intro', 'https://fern.example/nested/overview'],
  )
  assert.equal(category.pages[0].title, 'Introduction')
  assert(!category.pages.some((p) => p.title === 'Secret'))
  const nested = category.pages[1]
  assert.equal(nested.title, 'Nested')
  assert.deepEqual(nested.pages, [{ title: 'Deep page', url: 'https://fern.example/nested/deep' }])
}

test('tryFernNav parses the page:<slug> id generation into nested categories, skipping hidden pages', async () => {
  mockHtmlFetch({ 'https://fern.example/intro': fernHtml([GEN1_TREE]) })
  const nav = await __test__.tryFernNav('https://fern.example/intro', [])
  assertGetStartedTree(nav)
})

test('tryFernNav parses the hashed id generation into the same categories', async () => {
  mockHtmlFetch({ 'https://fern.example/intro': fernHtml([GEN2_TREE]) })
  const nav = await __test__.tryFernNav('https://fern.example/intro', [])
  assertGetStartedTree(nav)
})

test('tryFernNav detects via generator meta when the sidebar aside is absent', async () => {
  mockHtmlFetch({ 'https://fern.example/intro': fernHtml([GEN1_TREE], { aside: false, generator: true }) })
  const nav = await __test__.tryFernNav('https://fern.example/intro', [])
  assertGetStartedTree(nav)
})

test('tryFernNav returns null when neither detection signal is present', async () => {
  mockHtmlFetch({ 'https://fern.example/intro': fernHtml([GEN1_TREE], { aside: false }) })
  assert.equal(await __test__.tryFernNav('https://fern.example/intro', []), null)
})

test('tryFernNav ignores prose mentions of the detection signals', async () => {
  mockHtmlFetch({
    'https://fern.example/intro': fernHtml([GEN1_TREE], {
      aside: false,
      extraBody: '<p>Docs generated with buildwithfern.com use an aside with id="fern-sidebar".</p>',
    }),
  })
  assert.equal(await __test__.tryFernNav('https://fern.example/intro', []), null)
})

test('tryFernNav returns null when the page has no flight chunks', async () => {
  mockHtmlFetch({ 'https://fern.example/intro': fernHtml([]) })
  assert.equal(await __test__.tryFernNav('https://fern.example/intro', []), null)
})

test('tryFernNav prefers llms.txt titles, urls, and descriptions over payload fields', async () => {
  mockHtmlFetch({ 'https://fern.example/intro': fernHtml([GEN1_TREE]) })
  const nav = await __test__.tryFernNav('https://fern.example/intro', [
    { title: 'Welcome', url: 'https://fern.example/intro.md', description: 'Start here' },
  ])
  assert.deepEqual(nav.categories[0].pages[0], { title: 'Welcome', url: 'https://fern.example/intro.md', description: 'Start here' })
})

const TAB_LIST =
  '5f:["$","$L60",null,{"tabs":[' +
  '{"type":"tab","id":"tab:docs","title":"Docs","slug":"docs","hidden":false,"pointsTo":"intro","child":{"type":"sidebarRoot","id":"sidebar:|||aa11","collapsed":"$undefined","children":[]}},' +
  '{"type":"tab","id":"tab:api","title":"API Reference","slug":"api","hidden":false,"pointsTo":"api/start","child":{"type":"sidebarRoot","id":"sidebar:|||bb22","collapsed":"$undefined","children":[]}}]}]'

const API_TAB_TREE =
  '9c:["$","$L9d",null,{"children":[' +
  '{"type":"apiPackage","id":"api-pkg:api/pets","title":"Pets","slug":"api/pets","hidden":false,"pointsTo":"api/start","children":[' +
  '{"type":"endpoint","id":"api-leaf:api/start","title":"List pets","slug":"api/start","hidden":false,"method":"GET"},' +
  '{"type":"endpoint","id":"api-leaf:api/pets/create","title":"Create pet","slug":"api/pets/create","hidden":false,"method":"POST"}]}]}]'

test('tryFernNav fetches non-active tabs once and merges their trees', async () => {
  mockHtmlFetch({
    'https://fern.example/intro': fernHtml([GEN1_TREE, TAB_LIST]),
    'https://fern.example/api/start': fernHtml([API_TAB_TREE]),
  })
  const nav = await __test__.tryFernNav('https://fern.example/intro', [])
  assert.deepEqual(
    nav.categories.map((c) => c.title),
    ['Get started', 'Pets'],
  )
  assert.deepEqual(
    nav.categories[1].pages.map((p) => p.url),
    ['https://fern.example/api/start', 'https://fern.example/api/pets/create'],
  )
})

test('tryFernNav keeps the entry tree when a tab fetch fails', async () => {
  mockHtmlFetch({
    'https://fern.example/intro': fernHtml([GEN1_TREE, TAB_LIST]),
    'https://fern.example/api/start': new Error('network down'),
  })
  const nav = await __test__.tryFernNav('https://fern.example/intro', [])
  assertGetStartedTree(nav)
})
