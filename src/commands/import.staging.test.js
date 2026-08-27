import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import matter from 'gray-matter'
import { __test__ } from './import.js'

const { stageOrganized } = __test__

const originalLog = console.log
afterEach(() => {
  console.log = originalLog
})

function withStaging(fn) {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-staging-'))
  console.log = () => {}
  try {
    return fn(stagingDir)
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true })
  }
}

function readFm(filePath) {
  return matter(fs.readFileSync(filePath, 'utf8')).data
}

test('stageOrganized writes parent pages as index.md and leaves as slug.md', () => {
  withStaging((stagingDir) => {
    const parent = {
      title: 'Getting Started',
      url: 'https://example.com/docs/getting-started',
      pages: [{ title: 'Install', url: 'https://example.com/docs/getting-started/install' }],
    }
    const leaf = { title: 'Pricing', url: 'https://example.com/docs/pricing' }

    const result = stageOrganized(
      { categories: [{ title: 'Guides', pages: [parent, leaf] }] },
      stagingDir,
    )

    const parentIndex = path.join(stagingDir, 'docs', 'Guides', 'getting-started', 'index.md')
    const child = path.join(stagingDir, 'docs', 'Guides', 'getting-started', 'install.md')
    const leafFile = path.join(stagingDir, 'docs', 'Guides', 'pricing.md')
    const siblingParent = path.join(stagingDir, 'docs', 'Guides', 'getting-started.md')

    assert.equal(fs.existsSync(parentIndex), true)
    assert.equal(fs.existsSync(child), true)
    assert.equal(fs.existsSync(leafFile), true)
    assert.equal(fs.existsSync(siblingParent), false)

    assert.equal(readFm(parentIndex).title, 'Getting Started')
    assert.equal(readFm(parentIndex)['x-import'], 'https://example.com/docs/getting-started')
    assert.equal(readFm(child).title, 'Install')
    assert.equal(readFm(leafFile).title, 'Pricing')

    const guidesOrder = fs.readFileSync(path.join(stagingDir, 'docs', 'Guides', '_order.yaml'), 'utf8')
    assert.match(guidesOrder, /^- getting-started$/m)
    assert.match(guidesOrder, /^- pricing$/m)
    assert.doesNotMatch(guidesOrder, /^- index$/m)

    const nestedOrder = fs.readFileSync(
      path.join(stagingDir, 'docs', 'Guides', 'getting-started', '_order.yaml'),
      'utf8',
    )
    assert.match(nestedOrder, /^- install$/m)
    assert.equal(result.fileCount, 3)
  })
})

test('stageOrganized rescues /api/docs pages when skipping API reference categories', () => {
  withStaging((stagingDir) => {
    const result = stageOrganized(
      {
        categories: [
          {
            title: 'API Reference',
            pages: [
              { title: 'List pets', url: 'https://example.com/api/reference/pets' },
              { title: 'Guides', url: 'https://example.com/api/docs/guides/intro' },
              {
                title: 'Mixed',
                pages: [{ title: 'Pricing', url: 'https://example.com/api/docs/pricing' }],
              },
            ],
          },
        ],
      },
      stagingDir,
      { skipApiReference: true },
    )

    assert.equal(result.skippedApiRef, 1)
    assert.equal(fs.existsSync(path.join(stagingDir, 'reference')), false)

    const rescuedDir = path.join(stagingDir, 'docs', 'API Docs')
    const guides = path.join(rescuedDir, 'intro.md')
    const pricing = path.join(rescuedDir, 'introduction', 'pricing.md')
    assert.equal(fs.existsSync(guides), true)
    assert.equal(fs.existsSync(pricing), true)
    assert.equal(readFm(guides)['x-import'], 'https://example.com/api/docs/guides/intro')
    assert.equal(readFm(pricing)['x-import'], 'https://example.com/api/docs/pricing')
  })
})

test('stageOrganized namespaces nested category folders that would otherwise share a basename', () => {
  withStaging((stagingDir) => {
    stageOrganized(
      {
        categories: [
          { title: 'Fundamentals', pages: [{ title: 'Hello', url: 'https://example.com/docs/hello' }] },
          { title: 'cockroach/Fundamentals', pages: [{ title: 'SQL', url: 'https://example.com/docs/sql' }] },
        ],
      },
      stagingDir,
    )

    const topLevel = path.join(stagingDir, 'docs', 'Fundamentals', 'hello.md')
    const nestedDir = path.join(stagingDir, 'docs', 'cockroach', 'cockroach-fundamentals')
    const nestedPage = path.join(nestedDir, 'sql.md')
    const nestedIndex = path.join(nestedDir, 'index.md')

    assert.equal(fs.existsSync(topLevel), true)
    assert.equal(fs.existsSync(nestedPage), true)
    assert.equal(fs.existsSync(nestedIndex), true)
    assert.equal(readFm(nestedIndex).title, 'Fundamentals')
    assert.equal('x-import' in readFm(nestedIndex), false)

    const docsOrder = fs.readFileSync(path.join(stagingDir, 'docs', '_order.yaml'), 'utf8')
    assert.match(docsOrder, /^- Fundamentals$/m)
    assert.match(docsOrder, /^- cockroach\/cockroach-fundamentals$/m)
  })
})

test('stageOrganized quotes YAML-unsafe slugs in _order.yaml', () => {
  withStaging((stagingDir) => {
    stageOrganized(
      {
        categories: [
          {
            title: 'Guides',
            pages: [
              { title: 'True', url: 'https://example.com/docs/true' },
              { title: 'Null', url: 'https://example.com/docs/null' },
            ],
          },
        ],
      },
      stagingDir,
    )

    const order = fs.readFileSync(path.join(stagingDir, 'docs', 'Guides', '_order.yaml'), 'utf8')
    assert.match(order, /^- "true"$/m)
    assert.match(order, /^- "null"$/m)
  })
})
