import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensureUniqueSlugs } from './import.js'

function assignedSlug(categories, page) {
  return ensureUniqueSlugs(categories).get(page)
}

test('ensureUniqueSlugs: generic docs terminal paths fall back to introduction', () => {
  for (const segment of ['doc', 'docs', 'documentation', 'documentations']) {
    const page = { title: segment, url: `https://example.com/${segment}` }
    assert.equal(
      assignedSlug([{ title: 'Documentation', pages: [page] }], page),
      'introduction',
    )
  }
})

test('ensureUniqueSlugs: terminal generic docs paths use introduction under non-generic categories', () => {
  const page = { title: 'Docs', url: 'https://example.com/docs' }

  assert.equal(
    assignedSlug([{ title: 'Guides', pages: [page] }], page),
    'introduction',
  )
})

test('ensureUniqueSlugs: category segment disambiguates introduction collisions', () => {
  const guidesPage = { title: 'Docs', url: 'https://example.com/docs' }
  const apiPage = { title: 'Docs', url: 'https://example.com/docs' }
  const slugs = ensureUniqueSlugs([
    { title: 'Guides', pages: [guidesPage] },
    { title: 'API', pages: [apiPage] },
  ])

  assert.equal(slugs.get(guidesPage), 'guides-introduction')
  assert.equal(slugs.get(apiPage), 'api-introduction')
})

test('ensureUniqueSlugs: generic docs category does not prefix an available page slug', () => {
  const page = { title: 'Getting Started', url: 'https://example.com/docs/getting-started' }

  assert.equal(
    assignedSlug([{ title: 'Docs', pages: [page] }], page),
    'getting-started',
  )
})

test('ensureUniqueSlugs: generic docs categories use existing numeric suffix fallback for irreducible collisions', () => {
  const first = { title: 'Getting Started', url: 'https://example.com/docs/getting-started' }
  const second = { title: 'Getting Started', url: 'https://example.com/documentation/getting-started' }
  const slugs = ensureUniqueSlugs([
    { title: 'Docs', pages: [first] },
    { title: 'Documentation', pages: [second] },
  ])

  assert.equal(slugs.get(first), 'getting-started')
  assert.equal(slugs.get(second), 'getting-started-2')
})

test('ensureUniqueSlugs: generic docs category is assigned before non-generic categories', () => {
  const docsPage = { title: 'Getting Started', url: 'https://example.com/docs/getting-started' }
  const aiPage = { title: 'Getting Started', url: 'https://example.com/ai/getting-started' }
  const slugs = ensureUniqueSlugs([
    { title: 'AI', pages: [aiPage] },
    { title: 'Docs', pages: [docsPage] },
  ])

  assert.equal(slugs.get(docsPage), 'getting-started')
  assert.equal(slugs.get(aiPage), 'ai-getting-started')
})

test('ensureUniqueSlugs: non-generic docs paths keep current base slug behavior', () => {
  const api = { title: 'API', url: 'https://example.com/docs/api' }
  const gettingStarted = { title: 'Getting Started', url: 'https://example.com/docs/getting-started' }
  const docsApi = { title: 'Docs API', url: 'https://example.com/docs-api' }
  const documentationSettings = { title: 'Documentation Settings', url: 'https://example.com/documentation-settings' }
  const slugs = ensureUniqueSlugs([
    { title: 'Guides', pages: [api, gettingStarted, docsApi, documentationSettings] },
  ])

  assert.equal(slugs.get(api), 'api')
  assert.equal(slugs.get(gettingStarted), 'getting-started')
  assert.equal(slugs.get(docsApi), 'docs-api')
  assert.equal(slugs.get(documentationSettings), 'documentation-settings')
})
