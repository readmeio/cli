import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLlmsTxt } from './llms.js'

test('parseLlmsTxt: root-relative links resolve from the origin by default', () => {
  const parsed = parseLlmsTxt(
    `# Example\n\n## Guides\n- [Overview](/overview.md)\n- [Install](/docs/install.md)\n`,
    'https://example.com/docs/llms.txt',
  )

  const urls = parsed.sections[0].items.map((item) => item.url)
  assert.deepEqual(urls, [
    'https://example.com/overview.md',
    'https://example.com/docs/install.md',
  ])
})

test('parseLlmsTxt: explicit llms-dir policy resolves nested root-relative page links from the llms.txt directory', () => {
  const parsed = parseLlmsTxt(
    `# Example\n\n## Guides\n- [Overview](/overview.md)\n- [API](/api/reference.md)\n- [Absolute](https://example.com/reference/openapi.md)\n`,
    'https://example.com/docs/llms.txt',
    { rootRelativeResolution: 'llms-dir' },
  )

  const urls = parsed.sections[0].items.map((item) => item.url)
  assert.deepEqual(urls, [
    'https://example.com/docs/overview.md',
    'https://example.com/docs/api/reference.md',
    'https://example.com/reference/openapi.md',
  ])
})

test('parseLlmsTxt: llms-dir policy preserves links already scoped to the llms.txt directory', () => {
  const parsed = parseLlmsTxt(
    `# Example\n\n## Guides\n- [Already scoped](/docs/reference.md)\n- [Deep already scoped](/docs/api/reference.md?version=1#auth)\n`,
    'https://example.com/docs/llms.txt',
    { rootRelativeResolution: 'llms-dir' },
  )

  const urls = parsed.sections[0].items.map((item) => item.url)
  assert.deepEqual(urls, [
    'https://example.com/docs/reference.md',
    'https://example.com/docs/api/reference.md?version=1#auth',
  ])
})

test('parseLlmsTxt: llms-dir policy does not rewrite explicit nested llms.txt links', () => {
  const parsed = parseLlmsTxt(
    `# Example\n\n## Guides\n- [API llms](/api/llms.txt)\n- [Docs API llms](/docs/api/llms.txt)\n`,
    'https://example.com/docs/llms.txt',
    { rootRelativeResolution: 'llms-dir' },
  )

  const urls = parsed.sections[0].items.map((item) => item.url)
  assert.deepEqual(urls, [
    'https://example.com/api/llms.txt',
    'https://example.com/docs/api/llms.txt',
  ])
})

test('parseLlmsTxt: llms-dir policy preserves root-scoped non-page files', () => {
  const parsed = parseLlmsTxt(
    `# Example\n\n## Guides\n- [Overview](/overview.md)\n- [OpenAPI](/reference/openapi.yaml)\n- [Image](/assets/logo.png)\n`,
    'https://example.com/docs/llms.txt',
    { rootRelativeResolution: 'llms-dir' },
  )

  const urls = parsed.sections[0].items.map((item) => item.url)
  assert.deepEqual(urls, [
    'https://example.com/docs/overview.md',
    'https://example.com/reference/openapi.yaml',
    'https://example.com/assets/logo.png',
  ])
})

test('parseLlmsTxt: llms-dir policy handles query and hash page links', () => {
  const parsed = parseLlmsTxt(
    `# Example\n\n## Guides\n- [Overview](/overview.md?tab=js#install)\n- [No extension](/get-started?tab=js#install)\n- [Hash only](#local)\n`,
    'https://example.com/docs/llms.txt',
    { rootRelativeResolution: 'llms-dir' },
  )

  const urls = parsed.sections[0].items.map((item) => item.url)
  assert.deepEqual(urls, [
    'https://example.com/docs/overview.md?tab=js#install',
    'https://example.com/docs/get-started?tab=js#install',
  ])
})

test('parseLlmsTxt: malformed and unsupported links are ignored', () => {
  const parsed = parseLlmsTxt(
    `# Example\n\n## Guides\n- [Mail](mailto:test@example.com)\n- [JS](javascript:alert(1))\n- [OK](/ok.md)\n`,
    'https://example.com/docs/llms.txt',
    { rootRelativeResolution: 'llms-dir' },
  )

  const urls = parsed.sections[0].items.map((item) => item.url)
  assert.deepEqual(urls, ['https://example.com/docs/ok.md'])
})
