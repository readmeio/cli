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
