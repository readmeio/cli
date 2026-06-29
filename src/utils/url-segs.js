/**
 * URL segment parsing utilities shared across import.js pipeline stages.
 * Centralised here so the single-extension-strip bug only lives in one place.
 */

/**
 * Strip all chained doc-file extensions (.html.md, .html, .md, .mdx, .htm)
 * from a single URL path segment. Handles the double-extension pattern used
 * by some SSGs (e.g. plaid.com's llms.txt links end with `.html.md`).
 */
export function stripSegmentExtensions(s) {
  return s.replace(/(\.(md|mdx|html?))+$/i, '')
}

/**
 * Parse a URL's pathname into segments suitable for trie nesting. Strips file
 * extensions (including double-extensions like `.html.md`) and drops a trailing
 * `index` segment so `/foo`, `/foo/`, `/foo/index.html`, `/foo/index.html.md`,
 * and `/foo/index.md` all collapse to the same logical page.
 * Returns null if the URL can't be parsed.
 */
export function urlTrieSegs(url) {
  try {
    const segs = new URL(url).pathname
      .split('/')
      .filter(Boolean)
      .map((s) => stripSegmentExtensions(s))
      .filter(Boolean)
    if (segs.length > 0 && segs[segs.length - 1].toLowerCase() === 'index') segs.pop()
    return segs
  } catch {
    return null
  }
}

/**
 * Extract URL path segments for slug planning. Strips file extensions
 * (including double-extensions like `.html.md`) and leading numeric prefixes
 * (e.g. `01-intro` → `intro`). Also drops a trailing `index` segment so
 * `/foo/index.html.md` and `/foo/` both collapse to the same slug base.
 */
export function extractUrlPathSegments(url) {
  if (!url) return []
  try {
    const segs = new URL(url).pathname
      .split('/')
      .filter(Boolean)
      .map((s) => stripSegmentExtensions(s).replace(/^\d+[-_.]/, ''))
      .filter(Boolean)
    if (segs.length > 0 && segs[segs.length - 1].toLowerCase() === 'index') segs.pop()
    return segs
  } catch {
    return []
  }
}

/**
 * Normalise a URL to a canonical path key for deduplication. Strips trailing
 * slash, strips all chained doc-file extensions from the path tail, drops a
 * trailing `index`, and lowercases — so `/foo/bar.html.md`, `/foo/bar.html`,
 * `/foo/bar/index.html`, and `/foo/bar` all resolve to the same key `/foo/bar`.
 */
export function normalizePath(url) {
  try {
    const u = new URL(url)
    let p = u.pathname.replace(/\/$/, '').toLowerCase()
    p = p.replace(/(\.(md|mdx|html?))+$/i, '')
    p = p.replace(/\/index$/i, '')
    return p || '/'
  } catch {
    return String(url).toLowerCase()
  }
}

/**
 * Dedupe key for llms.txt page rows only.
 *
 * Invariants:
 * - includes origin so same-path docs on different hosts stay distinct
 * - collapses doc URL spellings for the same page tail (.md/.mdx/.html/.htm, /index, trailing slash)
 * - preserves query params because some docs routers encode page state there
 * - ignores fragments because they identify anchors within a page, not separate import pages
 */
export function llmsPageDedupeKey(url) {
  try {
    const u = new URL(url)
    let p = u.pathname.replace(/\/$/, '').toLowerCase()
    p = p.replace(/(\.(md|mdx|html?))+$/i, '')
    p = p.replace(/\/index$/i, '')

    const params = [...u.searchParams.entries()].sort(([ak, av], [bk, bv]) => (ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)))
    const query = params.length > 0 ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : ''

    return `${u.origin.toLowerCase()}${p || '/'}${query}`
  } catch {
    return String(url).toLowerCase()
  }
}

export function compareCanonicalUrlPreference(a, b) {
  const aRank = canonicalUrlPreferenceRank(a)
  const bRank = canonicalUrlPreferenceRank(b)
  if (aRank !== bRank) return aRank - bRank
  return String(a || '').length - String(b || '').length
}

function canonicalUrlPreferenceRank(url) {
  try {
    const pathname = new URL(url).pathname
    const lower = pathname.toLowerCase()
    if (/\.md$/.test(lower)) return 0
    if (/\.txt$/.test(lower)) return 1
    if (!/\/$/.test(pathname) && !/\/index\.html?$/.test(lower) && !/\.[^/]+$/.test(lower)) return 2
    if (/\/$/.test(pathname)) return 3
    if (/\/index\.html?$/.test(lower)) return 4
    return 5
  } catch {
    return 5
  }
}
