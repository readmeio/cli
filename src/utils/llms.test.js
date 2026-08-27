import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLlmsTxt, analyzeLlmsTxt } from './llms.js'

const BASE = 'https://docs.example.com/llms.txt'

// ---------------------------------------------------------------------------
// parseLlmsTxt — root-relative resolution
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// parseLlmsTxt — standard H2 sections
// ---------------------------------------------------------------------------

test('parseLlmsTxt: parses H1 title and H2 sections', () => {
  const body = [
    '# My Docs',
    '',
    '## Getting Started',
    '- [Overview](https://docs.example.com/overview)',
    '- [Quickstart](https://docs.example.com/quickstart)',
    '',
    '## Reference',
    '- [API](https://docs.example.com/api)',
  ].join('\n')

  const result = parseLlmsTxt(body, BASE)
  assert.equal(result.title, 'My Docs')
  assert.equal(result.sections.length, 2)
  assert.equal(result.sections[0].title, 'Getting Started')
  assert.equal(result.sections[0].items.length, 2)
  assert.equal(result.sections[1].title, 'Reference')
  assert.equal(result.h3Fallback, undefined)
})

test('parseLlmsTxt: items with no H2 fall into implicit Resources section', () => {
  const body = [
    '# My Docs',
    '- [Overview](https://docs.example.com/overview)',
  ].join('\n')

  const result = parseLlmsTxt(body, BASE)
  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].title, 'Resources')
})

test('parseLlmsTxt: strips trailing (section) markers from H2 titles', () => {
  const body = [
    '# My Docs',
    '',
    '## getting-started (section)',
    '- [Overview](https://docs.example.com/overview)',
    '',
    '## API Reference (SECTION)',
    '- [Pets](https://docs.example.com/pets)',
    '',
    '## Guides (section) extra',
    '- [Install](https://docs.example.com/install)',
  ].join('\n')

  const result = parseLlmsTxt(body, BASE)
  assert.deepEqual(
    result.sections.map((s) => s.title),
    ['getting-started', 'API Reference', 'Guides (section) extra'],
  )
})

test('parseLlmsTxt: strips (section) markers when falling back to H3 headings', () => {
  const manyItems = Array.from({ length: 201 }, (_, i) => `- [Page ${i}](https://docs.example.com/page-${i})`).join('\n')
  const body = [
    '# Big Site',
    '',
    '## Docs',
    manyItems,
    '',
    '### getting-started (section)',
    '- [A1](https://docs.example.com/a1)',
    '',
    '### Reference (section)',
    '- [B1](https://docs.example.com/b1)',
  ].join('\n')

  const result = parseLlmsTxt(body, BASE)
  assert.equal(result.h3Fallback, true)
  const titles = result.sections.map((s) => s.title)
  assert.ok(titles.includes('getting-started'))
  assert.ok(titles.includes('Reference'))
  assert.ok(!titles.includes('getting-started (section)'))
  assert.ok(!titles.includes('Reference (section)'))
})

// ---------------------------------------------------------------------------
// parseLlmsTxt — H3 fallback
// ---------------------------------------------------------------------------

// Generates a Couchbase-style body: one H2 bucket, N H3 sub-sections each
// with `itemsPerSection` pages. With itemsPerSection >= 68, the single H2
// section exceeds MAX_SECTION_ITEMS (200) and triggers the H3 fallback.
function makeCouchbaseBody(sections, itemsPerSection) {
  const lines = ['# Couchbase', '', '> Official Couchbase docs.', '', '## Docs', '']
  for (const title of sections) {
    lines.push(`### ${title}`)
    for (let i = 0; i < itemsPerSection; i++) {
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      lines.push(`- [Page ${i}](https://docs.couchbase.com/${slug}/page-${i})`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

const CB_SECTIONS = ['.NET Analytics SDK (1.0)', '.NET Entity Framework (1.0)', '.NET SDK (3.9)']

test('parseLlmsTxt: falls back to H3 when single H2 section is oversized', () => {
  const manyItems = Array.from({ length: 201 }, (_, i) =>
    `- [Page ${i}](https://docs.example.com/page-${i})`
  ).join('\n')

  const body = [
    '# Big Site',
    '',
    '## Docs',
    manyItems,
    '',
    '### Section A',
    '- [A1](https://docs.example.com/a1)',
    '- [A2](https://docs.example.com/a2)',
    '',
    '### Section B',
    '- [B1](https://docs.example.com/b1)',
  ].join('\n')

  const result = parseLlmsTxt(body, BASE)
  assert.equal(result.h3Fallback, true)
  assert.ok(result.sections.length > 1, `expected >1 section, got ${result.sections.length}`)

  const titles = result.sections.map((s) => s.title)
  assert.ok(titles.includes('Section A'))
  assert.ok(titles.includes('Section B'))
})

test('parseLlmsTxt: Couchbase-style H3 structure produces one section per SDK', () => {
  const body = makeCouchbaseBody(CB_SECTIONS, 70)
  const result = parseLlmsTxt(body, 'https://docs.couchbase.com/llms.txt')

  assert.equal(result.h3Fallback, true)
  assert.equal(result.title, 'Couchbase')
  assert.equal(result.sections.length, 3)
  assert.equal(result.sections[0].title, '.NET Analytics SDK (1.0)')
  assert.equal(result.sections[1].title, '.NET Entity Framework (1.0)')
  assert.equal(result.sections[2].title, '.NET SDK (3.9)')
  assert.equal(result.sections[0].items.length, 70)
})

test('parseLlmsTxt: does NOT use H3 fallback when H2 sections are usable', () => {
  const body = [
    '# Site',
    '',
    '## Section A',
    '- [A1](https://docs.example.com/a1)',
    '- [A2](https://docs.example.com/a2)',
    '',
    '## Section B',
    '- [B1](https://docs.example.com/b1)',
    '',
    '### Sub B',
    '- [B2](https://docs.example.com/b2)',
  ].join('\n')

  const result = parseLlmsTxt(body, BASE)
  assert.equal(result.h3Fallback, undefined)
  assert.equal(result.sections.length, 2)
  assert.equal(result.sections[0].title, 'Section A')
  assert.equal(result.sections[1].title, 'Section B')
})

test('parseLlmsTxt: does NOT use H3 fallback when no H3 headings exist', () => {
  const manyItems = Array.from({ length: 201 }, (_, i) =>
    `- [Page ${i}](https://docs.example.com/page-${i})`
  ).join('\n')

  const body = ['# Big Site', '', '## Docs', manyItems].join('\n')

  const result = parseLlmsTxt(body, BASE)
  assert.equal(result.h3Fallback, undefined)
  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].title, 'Docs')
})

// ---------------------------------------------------------------------------
// analyzeLlmsTxt
// ---------------------------------------------------------------------------

test('analyzeLlmsTxt: marks usable when it has link items', () => {
  const body = '## Section\n- [Page](https://docs.example.com/page)'
  const result = analyzeLlmsTxt(body, BASE)
  assert.equal(result.usable, true)
  assert.equal(result.reason, null)
})

test('analyzeLlmsTxt: marks not usable when no link items', () => {
  const body = '# Just a title\n\nSome prose with no links.'
  const result = analyzeLlmsTxt(body, BASE)
  assert.equal(result.usable, false)
  assert.ok(result.reason)
})
