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
    const file = files[href]
    const response = new Response(typeof file === 'string' ? file : file.body, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })
    if (typeof file !== 'string' && file.url) Object.defineProperty(response, 'url', { value: file.url })
    return response
  }
  return seen
}

function mergedItems(merged) {
  return merged.parsed.sections.flatMap((section) => section.items.map((item) => ({ text: item.text, url: item.url })))
}

function organizedPages(organized) {
  const pages = []
  const visit = (page) => {
    pages.push(page)
    for (const child of page.pages || []) visit(child)
  }
  for (const category of organized.categories || []) {
    for (const page of category.pages || []) visit(page)
  }
  return pages
}

test('llms import drops external page links before organization', async () => {
  mockLlmsFetch({
    'https://docs.example.com/llms.txt': `# Docs

## Guides
- [Overview](/overview.md)
- [Install](/install.md)
- [Configure](/configure.md)
- [Deploy](/deploy.md)
- [Operate](/operate.md)

## Reference
- [CLI](/cli.md)
- [SDK](/sdk.md)
- [API](/api.md)
- [Auth](/auth.md)
- [Webhooks](/webhooks.md)

## Admin
- [Users](/users.md)
- [Teams](/teams.md)
- [Billing](/billing.md)
- [Audit Logs](/audit-logs.md)
- [Settings](/settings.md)

## External
- [Platform Status](https://status.example.com/)
- [GitHub](https://github.com/example/project)
`,
  })

  const organized = await __test__.produceOrganizedForSource(
    new URL('https://docs.example.com/'),
    { model: 'test' },
    async (_label, fn) => fn(),
  )
  const pages = organizedPages(organized)
  const urls = pages.map((page) => page.url).filter(Boolean)

  assert(urls.includes('https://docs.example.com/overview.md'))
  assert(urls.includes('https://docs.example.com/cli.md'))
  assert(!urls.some((url) => url.includes('status.example.com')))
  assert(!urls.some((url) => url.includes('github.com/example/project')))
})

test('llms import preserves same-site docs origins before organization', async () => {
  mockLlmsFetch({
    'https://docs.example.com/llms.txt': `# Docs

## Guides
- [Overview](/overview.md)
- [Install](/install.md)
- [Quickstart](https://example.com/docs/quickstart.md)
- [Tutorials](https://developers.example.com/tutorials.md)
- [Learn](https://learn.example.com/docs/concepts.md)

## API
- [API Home](https://api.example.com/api-home.md)
- [Authentication](https://api.example.com/authentication.md)
- [Errors](https://api.example.com/errors.md)
- [Pagination](https://api.example.com/pagination.md)
- [Rate Limits](https://api.example.com/rate-limits.md)

## Reference
- [Reference Home](https://reference.example.com/home.md)
- [Users](https://reference.example.com/users.md)
- [Teams](https://reference.example.com/teams.md)
- [Webhooks](https://reference.example.com/webhooks.md)
- [SDKs](https://reference.example.com/sdks.md)

## External
- [Platform Status](https://status.example.com/)
- [Blog](https://blog.example.com/launch)
- [GitHub](https://github.com/example/project)
`,
  })

  const organized = await __test__.produceOrganizedForSource(
    new URL('https://docs.example.com/'),
    { model: 'test' },
    async (_label, fn) => fn(),
  )
  const urls = organizedPages(organized).map((page) => page.url).filter(Boolean)

  assert(urls.includes('https://docs.example.com/overview.md'))
  assert(urls.includes('https://example.com/docs/quickstart.md'))
  assert(urls.includes('https://api.example.com/api-home.md'))
  assert(urls.includes('https://developers.example.com/tutorials.md'))
  assert(urls.includes('https://reference.example.com/home.md'))
  assert(!urls.some((url) => url.includes('status.example.com')))
  assert(!urls.some((url) => url.includes('blog.example.com')))
  assert(!urls.some((url) => url.includes('github.com/example/project')))
})

test('redirected llms files resolve relative page links against the final canonical origin', async () => {
  mockLlmsFetch({
    'https://docs.example.com/llms.txt': {
      url: 'https://canonical-docs.example.com/llms.txt',
      body: `# Canonical Docs

## Guides
- [Overview](/overview.md)
- [Install](/install.md)
- [Configure](/configure.md)
- [Deploy](/deploy.md)
- [Operate](/operate.md)

## Reference
- [CLI](/cli.md)
- [SDK](/sdk.md)
- [API](/api.md)
- [Auth](/auth.md)
- [Webhooks](/webhooks.md)

## Admin
- [Users](/users.md)
- [Teams](/teams.md)
- [Billing](/billing.md)
- [Audit Logs](/audit-logs.md)
- [Settings](/settings.md)
`,
    },
  })

  const organized = await __test__.produceOrganizedForSource(
    new URL('https://docs.example.com/'),
    { model: 'test' },
    async (_label, fn) => fn(),
  )
  const urls = organizedPages(organized).map((page) => page.url).filter(Boolean)

  assert(urls.includes('https://canonical-docs.example.com/overview.md'))
  assert(urls.includes('https://canonical-docs.example.com/cli.md'))
  assert(!urls.includes('https://docs.example.com/overview.md'))
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
