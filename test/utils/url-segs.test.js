import { describe, it, expect } from 'vitest'
import { stripSegmentExtensions, urlTrieSegs, extractUrlPathSegments, normalizePath, compareCanonicalUrlPreference, llmsPageDedupeKey } from '../../src/utils/url-segs.js'

describe('#stripSegmentExtensions()', () => {
  it('stripSegmentExtensions: strips single .md', () => {
    expect(stripSegmentExtensions('index.md')).toBe('index')
  })

  it('stripSegmentExtensions: strips single .html', () => {
    expect(stripSegmentExtensions('index.html')).toBe('index')
  })

  it('stripSegmentExtensions: strips single .htm', () => {
    expect(stripSegmentExtensions('index.htm')).toBe('index')
  })

  it('stripSegmentExtensions: strips double .html.md (plaid pattern)', () => {
    expect(stripSegmentExtensions('index.html.md')).toBe('index')
  })

  it('stripSegmentExtensions: strips .mdx', () => {
    expect(stripSegmentExtensions('page.mdx')).toBe('page')
  })

  it('stripSegmentExtensions: strips .txt', () => {
    expect(stripSegmentExtensions('terminal.txt')).toBe('terminal')
  })

  it('stripSegmentExtensions: leaves bare txt segment untouched (no dot prefix)', () => {
    expect(stripSegmentExtensions('txt')).toBe('txt')
  })

  it('stripSegmentExtensions: leaves plain segments untouched', () => {
    expect(stripSegmentExtensions('quickstart')).toBe('quickstart')
  })

  it('stripSegmentExtensions: leaves kebab segments untouched', () => {
    expect(stripSegmentExtensions('getting-started')).toBe('getting-started')
  })
});

describe('#urlTrieSegs()', () => {
  it('urlTrieSegs: .html.md index collapses to parent path (plaid pattern)', () => {
    expect(
      urlTrieSegs('https://plaid.com/docs/account/index.html.md')).toStrictEqual(
      ['docs', 'account'],
    )
  })

  it('urlTrieSegs: .html index collapses to parent path', () => {
    expect(
      urlTrieSegs('https://plaid.com/docs/account/index.html')).toStrictEqual(
      ['docs', 'account'],
    )
  })

  it('urlTrieSegs: trailing slash collapses correctly', () => {
    expect(
      urlTrieSegs('https://plaid.com/docs/account/')).toStrictEqual(
      ['docs', 'account'],
    )
  })

  it('urlTrieSegs: non-index .html.md page keeps its segment', () => {
    expect(
      urlTrieSegs('https://plaid.com/docs/account/billing/index.html.md')).toStrictEqual(
      ['docs', 'account', 'billing'],
    )
  })

  it('urlTrieSegs: orval.dev docs/index.html.md collapses correctly', () => {
    expect(
      urlTrieSegs('https://orval.dev/docs/index.html.md')).toStrictEqual(
      ['docs'],
    )
  })

  it('urlTrieSegs: plain URL without extension passes through', () => {
    expect(
      urlTrieSegs('https://example.com/docs/quickstart')).toStrictEqual(
      ['docs', 'quickstart'],
    )
  })

  it('urlTrieSegs: returns null on unparseable input', () => {
    expect(urlTrieSegs('not-a-url')).toBeNull()
  })

  it('urlTrieSegs: .txt segment strips extension (warp.dev pattern)', () => {
    expect(
      urlTrieSegs('https://docs.warp.dev/_llms-txt/terminal.txt')).toStrictEqual(
      ['_llms-txt', 'terminal'],
    )
  })
});

describe('#extractUrlPathSegments()', () => {
  it('extractUrlPathSegments: .html.md index → parent segments only (plaid pattern)', () => {
    expect(
      extractUrlPathSegments('https://plaid.com/docs/account/index.html.md')).toStrictEqual(
      ['docs', 'account'],
    )
  })

  it('extractUrlPathSegments: slug from deepened path', () => {
    expect(
      extractUrlPathSegments('https://plaid.com/docs/account/billing/index.html.md')).toStrictEqual(
      ['docs', 'account', 'billing'],
    )
  })

  it('extractUrlPathSegments: strips leading numeric prefix', () => {
    expect(
      extractUrlPathSegments('https://example.com/docs/01-intro.md')).toStrictEqual(
      ['docs', 'intro'],
    )
  })

  it('extractUrlPathSegments: plain .md page', () => {
    expect(
      extractUrlPathSegments('https://example.com/docs/quickstart.md')).toStrictEqual(
      ['docs', 'quickstart'],
    )
  })

  it('extractUrlPathSegments: returns [] for empty/null input', () => {
    expect(extractUrlPathSegments('')).toStrictEqual([])
    expect(extractUrlPathSegments(null)).toStrictEqual([])
  })
});

describe('#normalizePath()', () => {
  it('normalizePath: .html.md and .html and bare path all produce same key', () => {
    const a = normalizePath('https://plaid.com/docs/account/index.html.md')
    const b = normalizePath('https://plaid.com/docs/account/index.html')
    const c = normalizePath('https://plaid.com/docs/account/index')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('normalizePath: trailing slash and bare path produce same key', () => {
    const a = normalizePath('https://example.com/docs/foo/')
    const b = normalizePath('https://example.com/docs/foo')
    expect(a).toBe(b)
  })

  it('normalizePath: index variants and bare path produce same key', () => {
    const bare = normalizePath('https://example.com/docs/get-started')
    expect(normalizePath('https://example.com/docs/get-started/'), bare).toBe(bare)
    expect(normalizePath('https://example.com/docs/get-started/index.html'), bare).toBe(bare)
    expect(normalizePath('https://example.com/docs/get-started/index.htm'), bare).toBe(bare)
  })

  it('normalizePath: lowercases result', () => {
    expect(normalizePath('https://example.com/Docs/QuickStart')).toBe('/docs/quickstart')
  })

  it('normalizePath: falls back for unparseable input', () => {
    expect(normalizePath('not-a-url')).toBe('not-a-url')
  })

  it('normalizePath: strips .txt extension (warp.dev pattern)', () => {
    expect(
      normalizePath('https://docs.warp.dev/_llms-txt/terminal.txt')).toBe(
      '/_llms-txt/terminal',
    )
  })
});

describe('#llmsPageDedupeKey()', () => {
  it('llmsPageDedupeKey: includes origin so same paths on different hosts stay distinct', () => {
    expect(
      llmsPageDedupeKey('https://docs.example.com/docs/get-started.md')).not.toBe(
      llmsPageDedupeKey('https://example.com/docs/get-started.md'),
    )
  })

  it('llmsPageDedupeKey: preserves query params by default', () => {
    expect(
      llmsPageDedupeKey('https://example.com/docs/search?product=api')).not.toBe(
      llmsPageDedupeKey('https://example.com/docs/search?product=sdk'),
    )
  })

  it('llmsPageDedupeKey: normalizes query param order', () => {
    expect(
      llmsPageDedupeKey('https://example.com/docs/search?b=2&a=1')).toBe(
      llmsPageDedupeKey('https://example.com/docs/search?a=1&b=2'),
    )
  })

  it('llmsPageDedupeKey: ignores fragments but preserves router query state', () => {
    expect(
      llmsPageDedupeKey('https://example.com/docs/get-started.md?tab=js#install')).toBe(
      llmsPageDedupeKey('https://example.com/docs/get-started?tab=js#auth'),
    )
  })

  it('llmsPageDedupeKey: collapses doc URL spellings for the same page', () => {
    const bare = llmsPageDedupeKey('https://example.com/docs/get-started')
    expect(llmsPageDedupeKey('https://example.com/docs/get-started.md'), bare).toBe(bare)
    expect(llmsPageDedupeKey('https://example.com/docs/get-started.txt'), bare).toBe(bare)
    expect(llmsPageDedupeKey('https://example.com/docs/get-started/index.html'), bare).toBe(bare)
    expect(llmsPageDedupeKey('https://example.com/docs/get-started/'), bare).toBe(bare)
  })
});

describe('#compareCanonicalUrlPreference()', () => {
  it('compareCanonicalUrlPreference: prefers md over txt, bare, trailing slash, and index', () => {
    const urls = [
      'https://example.com/docs/get-started/index.html',
      'https://example.com/docs/get-started/',
      'https://example.com/docs/get-started',
      'https://example.com/docs/get-started.txt',
      'https://example.com/docs/get-started.md',
    ]

    expect([...urls].sort(compareCanonicalUrlPreference)).toStrictEqual([
      'https://example.com/docs/get-started.md',
      'https://example.com/docs/get-started.txt',
      'https://example.com/docs/get-started',
      'https://example.com/docs/get-started/',
      'https://example.com/docs/get-started/index.html',
    ])
  })
});
