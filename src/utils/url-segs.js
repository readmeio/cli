/**
 * URL segment parsing utilities shared across import.js pipeline stages.
 * Centralised here so the single-extension-strip bug only lives in one place.
 */

// Extensions that are implementation artifacts, not meaningful path segments.
const DOC_FILE_EXTENSIONS = ['md', 'mdx', 'html', 'htm', 'txt']
const DOC_EXT_RE = new RegExp(`(\\.(${DOC_FILE_EXTENSIONS.join('|')}))+$`, 'i')

/**
 * Strip all chained doc-file extensions (.html.md, .html, .md, .mdx, .htm, .txt)
 * from a single URL path segment. Handles the double-extension pattern used
 * by some SSGs (e.g. `.html.md`).
 */
export function stripSegmentExtensions(s) {
  return s.replace(DOC_EXT_RE, '')
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
 * slash, strips all chained doc-file extensions from the path tail, and
 * lowercases — so `/foo/bar.html.md`, `/foo/bar.html`, and `/foo/bar` all
 * resolve to the same key `/foo/bar`.
 */
export function normalizePath(url) {
  try {
    const u = new URL(url)
    let p = u.pathname.replace(/\/$/, '').toLowerCase()
    p = p.replace(DOC_EXT_RE, '')
    return p
  } catch {
    return String(url).toLowerCase()
  }
}
