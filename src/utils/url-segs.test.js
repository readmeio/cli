import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripSegmentExtensions, urlTrieSegs, extractUrlPathSegments, normalizePath } from './url-segs.js'

// ---------------------------------------------------------------------------
// stripSegmentExtensions
// ---------------------------------------------------------------------------

test('stripSegmentExtensions: strips single .md', () => {
  assert.equal(stripSegmentExtensions('index.md'), 'index')
})

test('stripSegmentExtensions: strips single .html', () => {
  assert.equal(stripSegmentExtensions('index.html'), 'index')
})

test('stripSegmentExtensions: strips single .htm', () => {
  assert.equal(stripSegmentExtensions('index.htm'), 'index')
})

test('stripSegmentExtensions: strips double .html.md (plaid pattern)', () => {
  assert.equal(stripSegmentExtensions('index.html.md'), 'index')
})

test('stripSegmentExtensions: strips .mdx', () => {
  assert.equal(stripSegmentExtensions('page.mdx'), 'page')
})

test('stripSegmentExtensions: strips .txt', () => {
  assert.equal(stripSegmentExtensions('terminal.txt'), 'terminal')
})

test('stripSegmentExtensions: leaves bare txt segment untouched (no dot prefix)', () => {
  assert.equal(stripSegmentExtensions('txt'), 'txt')
})

test('stripSegmentExtensions: leaves plain segments untouched', () => {
  assert.equal(stripSegmentExtensions('quickstart'), 'quickstart')
})

test('stripSegmentExtensions: leaves kebab segments untouched', () => {
  assert.equal(stripSegmentExtensions('getting-started'), 'getting-started')
})

// ---------------------------------------------------------------------------
// urlTrieSegs — the double-extension plaid.com pattern
// ---------------------------------------------------------------------------

test('urlTrieSegs: .html.md index collapses to parent path (plaid pattern)', () => {
  assert.deepEqual(
    urlTrieSegs('https://plaid.com/docs/account/index.html.md'),
    ['docs', 'account'],
  )
})

test('urlTrieSegs: .html index collapses to parent path', () => {
  assert.deepEqual(
    urlTrieSegs('https://plaid.com/docs/account/index.html'),
    ['docs', 'account'],
  )
})

test('urlTrieSegs: trailing slash collapses correctly', () => {
  assert.deepEqual(
    urlTrieSegs('https://plaid.com/docs/account/'),
    ['docs', 'account'],
  )
})

test('urlTrieSegs: non-index .html.md page keeps its segment', () => {
  assert.deepEqual(
    urlTrieSegs('https://plaid.com/docs/account/billing/index.html.md'),
    ['docs', 'account', 'billing'],
  )
})

test('urlTrieSegs: orval.dev docs/index.html.md collapses correctly', () => {
  assert.deepEqual(
    urlTrieSegs('https://orval.dev/docs/index.html.md'),
    ['docs'],
  )
})

test('urlTrieSegs: plain URL without extension passes through', () => {
  assert.deepEqual(
    urlTrieSegs('https://example.com/docs/quickstart'),
    ['docs', 'quickstart'],
  )
})

test('urlTrieSegs: returns null on unparseable input', () => {
  assert.equal(urlTrieSegs('not-a-url'), null)
})

test('urlTrieSegs: .txt segment strips extension (warp.dev pattern)', () => {
  assert.deepEqual(
    urlTrieSegs('https://docs.warp.dev/_llms-txt/terminal.txt'),
    ['_llms-txt', 'terminal'],
  )
})

// ---------------------------------------------------------------------------
// extractUrlPathSegments — slug source
// ---------------------------------------------------------------------------

test('extractUrlPathSegments: .html.md index → parent segments only (plaid pattern)', () => {
  assert.deepEqual(
    extractUrlPathSegments('https://plaid.com/docs/account/index.html.md'),
    ['docs', 'account'],
  )
})

test('extractUrlPathSegments: slug from deepened path', () => {
  assert.deepEqual(
    extractUrlPathSegments('https://plaid.com/docs/account/billing/index.html.md'),
    ['docs', 'account', 'billing'],
  )
})

test('extractUrlPathSegments: strips leading numeric prefix', () => {
  assert.deepEqual(
    extractUrlPathSegments('https://example.com/docs/01-intro.md'),
    ['docs', 'intro'],
  )
})

test('extractUrlPathSegments: plain .md page', () => {
  assert.deepEqual(
    extractUrlPathSegments('https://example.com/docs/quickstart.md'),
    ['docs', 'quickstart'],
  )
})

test('extractUrlPathSegments: returns [] for empty/null input', () => {
  assert.deepEqual(extractUrlPathSegments(''), [])
  assert.deepEqual(extractUrlPathSegments(null), [])
})

// ---------------------------------------------------------------------------
// normalizePath — deduplication keys
// ---------------------------------------------------------------------------

test('normalizePath: .html.md and .html and bare path all produce same key', () => {
  const a = normalizePath('https://plaid.com/docs/account/index.html.md')
  const b = normalizePath('https://plaid.com/docs/account/index.html')
  const c = normalizePath('https://plaid.com/docs/account/index')
  assert.equal(a, b)
  assert.equal(b, c)
})

test('normalizePath: trailing slash and bare path produce same key', () => {
  const a = normalizePath('https://example.com/docs/foo/')
  const b = normalizePath('https://example.com/docs/foo')
  assert.equal(a, b)
})

test('normalizePath: lowercases result', () => {
  assert.equal(normalizePath('https://example.com/Docs/QuickStart'), '/docs/quickstart')
})

test('normalizePath: falls back for unparseable input', () => {
  assert.equal(normalizePath('not-a-url'), 'not-a-url')
})

test('normalizePath: strips .txt extension (warp.dev pattern)', () => {
  assert.equal(
    normalizePath('https://docs.warp.dev/_llms-txt/terminal.txt'),
    '/_llms-txt/terminal',
  )
})
