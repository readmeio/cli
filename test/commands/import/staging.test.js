import { afterEach, test, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Command } from 'commander'
import { args, __test__ } from '../../../src/commands/import.js'
import { parseFrontmatter, toFrontmatter } from '../../../src/utils/markdown.js'

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
  return parseFrontmatter(fs.readFileSync(filePath, 'utf8')).data
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

    expect(fs.existsSync(parentIndex)).toBe(true)
    expect(fs.existsSync(child)).toBe(true)
    expect(fs.existsSync(leafFile)).toBe(true)
    expect(fs.existsSync(siblingParent)).toBe(false)

    expect(readFm(parentIndex).title).toBe('Getting Started')
    expect(readFm(parentIndex)['x-import']).toBe('https://example.com/docs/getting-started')
    expect(readFm(child).title).toBe('Install')
    expect(readFm(leafFile).title).toBe('Pricing')

    const guidesOrder = fs.readFileSync(path.join(stagingDir, 'docs', 'Guides', '_order.yaml'), 'utf8')
    expect(guidesOrder).toMatch(/^- getting-started$/m)
    expect(guidesOrder).toMatch(/^- pricing$/m)
    expect(guidesOrder).not.toMatch(/^- index$/m)

    const nestedOrder = fs.readFileSync(
      path.join(stagingDir, 'docs', 'Guides', 'getting-started', '_order.yaml'),
      'utf8',
    )
    expect(nestedOrder).toMatch(/^- install$/m)
    expect(result.fileCount).toBe(3)
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

    expect(result.skippedApiRef).toBe(1)
    expect(fs.existsSync(path.join(stagingDir, 'reference'))).toBe(false)

    const rescuedDir = path.join(stagingDir, 'docs', 'API Docs')
    const guides = path.join(rescuedDir, 'intro.md')
    const pricing = path.join(rescuedDir, 'introduction', 'pricing.md')
    expect(fs.existsSync(guides)).toBe(true)
    expect(fs.existsSync(pricing)).toBe(true)
    expect(readFm(guides)['x-import']).toBe('https://example.com/api/docs/guides/intro')
    expect(readFm(pricing)['x-import']).toBe('https://example.com/api/docs/pricing')
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

    expect(fs.existsSync(topLevel)).toBe(true)
    expect(fs.existsSync(nestedPage)).toBe(true)
    expect(fs.existsSync(nestedIndex)).toBe(true)
    expect(readFm(nestedIndex).title).toBe('Fundamentals')
    expect('x-import' in readFm(nestedIndex)).toBe(false)

    const docsOrder = fs.readFileSync(path.join(stagingDir, 'docs', '_order.yaml'), 'utf8')
    expect(docsOrder).toMatch(/^- Fundamentals$/m)
    expect(docsOrder).toMatch(/^- cockroach\/cockroach-fundamentals$/m)
  })
})

test('finalizeChangelogs emits flat canonical changelogs without an order file and suffixes case-insensitive collisions', () => {
  withStaging((stagingDir) => {
    const changelogDir = path.join(stagingDir, 'docs', 'Changelog')
    fs.mkdirSync(path.join(changelogDir, 'foo'), { recursive: true })
    fs.writeFileSync(
      path.join(changelogDir, 'foo', 'Bar.md'),
      toFrontmatter({ title: 'Nested', icon: 'fa-book', 'x-import': 'https://example.com/nested' }),
    )
    fs.writeFileSync(
      path.join(changelogDir, 'foo-bar.md'),
      toFrontmatter({ title: 'Root', icon: 'fa-book', 'x-import': 'https://example.com/root' }),
    )
    fs.writeFileSync(
      path.join(changelogDir, 'unchanged.md'),
      toFrontmatter({ title: 'Unchanged', icon: 'fa-book', 'x-import': 'https://example.com/unchanged' }),
    )
    fs.writeFileSync(path.join(stagingDir, 'docs', '_order.yaml'), '- Changelog\n')

    expect(finalizeChangelogs(stagingDir)).toBe(3)

    const outputDir = path.join(stagingDir, 'changelogs')
    expect(fs.readdirSync(outputDir).sort()).toStrictEqual(['foo-Bar.md', 'foo-bar-2.md', 'unchanged.md'])
    expect(fs.existsSync(path.join(outputDir, '_order.yaml'))).toBe(false)
    expect(fs.existsSync(path.join(stagingDir, 'changelog'))).toBe(false)
    expect(fs.existsSync(path.join(stagingDir, 'docs', 'Changelog'))).toBe(false)
    expect(fs.existsSync(path.join(stagingDir, 'docs', '_order.yaml'))).toBe(false)
    expect(readFm(path.join(outputDir, 'foo-Bar.md')).icon).toBeUndefined()
    expect(readFm(path.join(outputDir, 'foo-Bar.md'))['x-import']).toBe('https://example.com/nested')
    expect(readFm(path.join(outputDir, 'foo-bar-2.md'))['x-import']).toBe('https://example.com/root')
    expect(readFm(path.join(outputDir, 'unchanged.md'))['x-import']).toBe('https://example.com/unchanged')
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
    expect(finalizeChangelogs(stagingDir)).toBe(3)

    const outputDir = path.join(stagingDir, 'changelogs')
    expect(fs.readdirSync(outputDir).sort()).toStrictEqual(['A.md', 'a-2.md', 'a-3.md'])
    expect(readFm(path.join(outputDir, 'A.md')).title).toBe('Upper A')
    expect(readFm(path.join(outputDir, 'a-3.md')).title).toBe('Lower a')
    expect(readFm(path.join(outputDir, 'a-2.md')).title).toBe('Independent a-2')
  })
})

test('allocateChangelogFilenames preserves an independent numeric-suffix filename', () => {
  expect(
    allocateChangelogFilenames([
      { ancestors: [], slug: 'A' },
      { ancestors: [], slug: 'a' },
      { ancestors: [], slug: 'a-2' },
    ])).toStrictEqual(
    ['A', 'a-3', 'a-2'],
  )
})

test('import command has no conditional changelog layout option', () => {
  const cmd = new Command()
  args(cmd)

  expect(cmd.options.some((option) => option.long === '--separate-changelog')).toBe(false)
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
    expect(order).toMatch(/^- "true"$/m)
    expect(order).toMatch(/^- "null"$/m)
  })
})
