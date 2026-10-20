import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import matter from 'gray-matter'
import { Command } from 'commander'
import { args, __test__ } from './import.js'

const { stageOrganized, finalizeChangelogs, allocateChangelogFilenames } = __test__

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

test('finalizeChangelogs emits flat canonical changelogs without an order file and suffixes case-insensitive collisions', () => {
  withStaging((stagingDir) => {
    const changelogDir = path.join(stagingDir, 'docs', 'Changelog')
    fs.mkdirSync(path.join(changelogDir, 'foo'), { recursive: true })
    fs.writeFileSync(
      path.join(changelogDir, 'foo', 'Bar.md'),
      matter.stringify('', { title: 'Nested', icon: 'fa-book', 'x-import': 'https://example.com/nested' }),
    )
    fs.writeFileSync(
      path.join(changelogDir, 'foo-bar.md'),
      matter.stringify('', { title: 'Root', icon: 'fa-book', 'x-import': 'https://example.com/root' }),
    )
    fs.writeFileSync(
      path.join(changelogDir, 'unchanged.md'),
      matter.stringify('', { title: 'Unchanged', icon: 'fa-book', 'x-import': 'https://example.com/unchanged' }),
    )
    fs.writeFileSync(path.join(stagingDir, 'docs', '_order.yaml'), '- Changelog\n')

    assert.equal(finalizeChangelogs(stagingDir), 3)

    const outputDir = path.join(stagingDir, 'changelogs')
    assert.deepEqual(fs.readdirSync(outputDir).sort(), ['foo-Bar.md', 'foo-bar-2.md', 'unchanged.md'])
    assert.equal(fs.existsSync(path.join(outputDir, '_order.yaml')), false)
    assert.equal(fs.existsSync(path.join(stagingDir, 'changelog')), false)
    assert.equal(fs.existsSync(path.join(stagingDir, 'docs', 'Changelog')), false)
    assert.equal(fs.existsSync(path.join(stagingDir, 'docs', '_order.yaml')), false)
    assert.equal(readFm(path.join(outputDir, 'foo-Bar.md')).icon, undefined)
    assert.equal(readFm(path.join(outputDir, 'foo-Bar.md'))['x-import'], 'https://example.com/nested')
    assert.equal(readFm(path.join(outputDir, 'foo-bar-2.md'))['x-import'], 'https://example.com/root')
    assert.equal(readFm(path.join(outputDir, 'unchanged.md'))['x-import'], 'https://example.com/unchanged')
  })
})

test('stageOrganized retains case-only changelog names before finalization', () => {
  withStaging((stagingDir) => {
    const upper = { title: 'Upper A', url: 'https://example.com/A' }
    const lower = { title: 'Lower a', url: 'https://example.com/a' }
    const independent = { title: 'Independent a-2', url: 'https://example.com/a-2' }
    stageOrganized(
      { categories: [{ title: 'Changelog', pages: [upper, lower, independent] }] },
      stagingDir,
      { slugFor: new Map([[upper, 'A'], [lower, 'a'], [independent, 'a-2']]) },
    )
    assert.equal(finalizeChangelogs(stagingDir), 3)

    const outputDir = path.join(stagingDir, 'changelogs')
    assert.deepEqual(fs.readdirSync(outputDir).sort(), ['A.md', 'a-2.md', 'a-3.md'])
    assert.equal(readFm(path.join(outputDir, 'A.md')).title, 'Upper A')
    assert.equal(readFm(path.join(outputDir, 'a-3.md')).title, 'Lower a')
    assert.equal(readFm(path.join(outputDir, 'a-2.md')).title, 'Independent a-2')
  })
})

test('allocateChangelogFilenames preserves an independent numeric-suffix filename', () => {
  assert.deepEqual(
    allocateChangelogFilenames([
      { ancestors: [], slug: 'A' },
      { ancestors: [], slug: 'a' },
      { ancestors: [], slug: 'a-2' },
    ]),
    ['A', 'a-3', 'a-2'],
  )
})

test('import command has no conditional changelog layout option', () => {
  const cmd = new Command()
  args(cmd)

  assert.equal(cmd.options.some((option) => option.long === '--separate-changelog'), false)
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
