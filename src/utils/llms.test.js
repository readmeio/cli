import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLlmsTxt } from './llms.js'

test('parseLlmsTxt: nested llms.txt resolves mostly root-relative links from the llms.txt directory', () => {
  const parsed = parseLlmsTxt(
    `# Example\n\n## Guides\n- [Overview](/overview.md)\n- [API](/api/reference.md)\n- [Absolute](https://example.com/reference/openapi.md)\n`,
    'https://example.com/docs/llms.txt',
  )

  const urls = parsed.sections[0].items.map((item) => item.url)
  assert.deepEqual(urls, [
    'https://example.com/docs/overview.md',
    'https://example.com/docs/api/reference.md',
    'https://example.com/reference/openapi.md',
  ])
})

test('parseLlmsTxt: nested root-relative heuristic does not trigger at 50%', () => {
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

test('parseLlmsTxt: nested root-relative heuristic triggers above 50% and preserves in-prefix links', () => {
  const parsed = parseLlmsTxt(
    `# Example\n\n## Guides\n- [Overview](/overview.md)\n- [Install](/install.md)\n- [Already scoped](/docs/reference.md)\n`,
    'https://example.com/docs/llms.txt',
  )

  const urls = parsed.sections[0].items.map((item) => item.url)
  assert.deepEqual(urls, [
    'https://example.com/docs/overview.md',
    'https://example.com/docs/install.md',
    'https://example.com/docs/reference.md',
  ])
})
