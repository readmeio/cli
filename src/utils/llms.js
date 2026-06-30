const H1_RE = /^#\s+(.+)$/
const H2_RE = /^##\s+(.+)$/
const H3_RE = /^###\s+(.+)$/

// Max items per section before we consider it "oversized" for usability purposes.
// Mirrors the cap in usableSections() in import.js.
const MAX_SECTION_ITEMS = 200
// Any line whose meaningful content is a markdown link. Accepts:
//   - Standard list rows:           `- [text](url)`, `* [text](url) — desc`
//   - Bare link lines:              `[text](url)`
//   - Breadcrumb-prefixed rows used by Fern/Mintlify-style indices:
//       `ElevenAgents [Agent WebSockets](url)`
//       `API Reference > Agents > Branches [List branches](url)`
//   - Trailing-parenthetical-breadcrumb rows (AssemblyAI/Fern variant) — the
//     breadcrumb sits between the url and the description and is matched-and-discarded:
//       `[text](url) (Breadcrumb > path): description`
// Captures: [prefix, text, url, description] (prefix and description may be empty).
const LINK_LINE_RE = /^\s*(?:[-*+]\s+)?([^\[\n]*?)\s*\[([^\]]+)\] ?\(([^)\s]+)\)(?:\s+\([^)]*\))?(?:\s*[:—–-]\s*(.+?))?\s*$/
const BLOCKQUOTE_RE = /^\s*>/
const FENCE_RE = /^\s*(?:```|~~~)/

// A llms.txt is considered usable as long as it has at least one link row.
// Beyond that we enforce a structural ratio (share of "spec-shaped" lines —
// H1/H2/blockquote/link row/blank — over total lines), but only once the
// file has enough links for the ratio to be statistically meaningful. A
// 3-link file with one prose sentence would compute a misleading ratio; we
// can't tell signal from noise at that size, so we trust it and let the
// BFS-merge dedupe handle any junk that slips through.
const RATIO_CHECK_MIN_LINKS = 10
const MIN_CONFORMING_RATIO = 0.7

export function analyzeLlmsTxt(body, llmsUrl, options = {}) {
  const parsed = parseLlmsTxt(body, llmsUrl, options)
  const lineStats = classifyLines(body)
  const linkItems = parsed.sections.reduce((sum, s) => sum + s.items.length, 0)
  const reason = getSkipReason(body, linkItems, lineStats)

  return {
    parsed,
    usable: !reason,
    reason,
    stats: { ...lineStats, linkItems },
  }
}

export function parseLlmsTxt(body, llmsUrl, options = {}) {
  const h2Result = parseSections(body, llmsUrl, H2_RE, options)

  // If every H2 section is oversized (or there are none), and the file has H3
  // headings, re-parse treating H3 (###) as section boundaries.
  // For strange LLMS.txt formatting
  const allOversized = h2Result.sections.length === 0 ||
    h2Result.sections.every((s) => s.items.length > MAX_SECTION_ITEMS)
  if (allOversized && /^###\s/m.test(body)) {
    const h3Result = parseSections(body, llmsUrl, H3_RE, options)
    if (h3Result.sections.length > 1) {
      return { ...h3Result, h3Fallback: true }
    }
  }

  return h2Result
}

function parseSections(body, llmsUrl, sectionRe, options = {}) {
  const lines = body.split(/\r?\n/)
  let title = null
  const sections = []
  let current = null

  for (const line of lines) {
    const h1 = line.match(H1_RE)
    if (h1 && !title) {
      title = h1[1].trim()
      continue
    }

    const sectionMatch = line.match(sectionRe)
    if (sectionMatch) {
      current = { title: sectionMatch[1].trim(), items: [] }
      sections.push(current)
      continue
    }

    const item = parseListLink(line, llmsUrl, options)
    if (!item) continue

    if (!current) {
      current = { title: 'Resources', items: [] }
      sections.push(current)
    }
    current.items.push(item)
  }

  return { title, sections }
}

function getSkipReason(body, linkItems, lineStats) {
  if (/^---\r?\n/.test(body)) return 'starts with YAML frontmatter'
  if (linkItems === 0) return 'no link items'
  if (linkItems >= RATIO_CHECK_MIN_LINKS && lineStats.ratio < MIN_CONFORMING_RATIO) {
    return `conforming-line ratio ${lineStats.ratio.toFixed(2)} below ${MIN_CONFORMING_RATIO} (${lineStats.conforming}/${lineStats.total} lines)`
  }
  return null
}

/**
 * Walk the body line-by-line and bucket each line as conforming or not.
 *
 *   conforming     blank, H1, H2, blockquote, standard link-row
 *   non-conforming everything else, plus every line inside (and the delimiters
 *                  of) a fenced code block
 */
function classifyLines(body) {
  const lines = body.split(/\r?\n/)
  let inFence = false
  let conforming = 0
  let nonConforming = 0

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      nonConforming++
      inFence = !inFence
      continue
    }
    if (inFence) {
      nonConforming++
      continue
    }
    if (line.trim() === '') {
      conforming++
      continue
    }
    if (H1_RE.test(line) || H2_RE.test(line) || LINK_LINE_RE.test(line) || BLOCKQUOTE_RE.test(line)) {
      conforming++
      continue
    }
    nonConforming++
  }

  const total = conforming + nonConforming
  const ratio = total === 0 ? 0 : conforming / total
  return { conforming, nonConforming, total, ratio }
}

function parseListLink(line, llmsUrl, options = {}) {
  const match = line.match(LINK_LINE_RE)
  if (!match) return null

  const [, prefix, text, rawUrl, trailingDesc] = match
  const url = normalizeUrl(rawUrl, llmsUrl, options)
  if (!url) return null

  // Prefer an explicit trailing description (`[text](url) — desc`); fall back
  // to the breadcrumb prefix (`API Reference > Agents [text](url)`) when no
  // explicit description is present. Either gives downstream extra context.
  const description = trailingDesc?.trim() || prefix?.trim() || null

  return {
    text: text.trim(),
    url,
    description: description || null,
  }
}

function normalizeUrl(rawUrl, llmsUrl, options = {}) {
  const trimmed = String(rawUrl || '').trim().replace(/[.,;]+$/, '')
  if (!trimmed || /^#/.test(trimmed) || /^(mailto|javascript):/i.test(trimmed)) return null

  try {
    const url = llmsUrl ? new URL(resolveLlmsRelativeUrl(trimmed, llmsUrl, options), llmsUrl) : new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function resolveLlmsRelativeUrl(trimmed, llmsUrl, options) {
  if (options.rootRelativeResolution !== 'llms-dir' || !isRootRelativeUrl(trimmed)) return trimmed

  const nestedPrefix = getLlmsNestedPrefix(llmsUrl)
  if (!nestedPrefix) return trimmed

  const normallyResolved = new URL(trimmed, llmsUrl)
  if (!shouldResolveRootRelativeFromLlmsDir(trimmed, normallyResolved.pathname, nestedPrefix)) return trimmed

  return `.${trimmed}`
}

function shouldResolveRootRelativeFromLlmsDir(rawUrl, pathname, nestedPrefix) {
  if (isPathWithinPrefix(pathname, nestedPrefix)) return false
  if (/\/llms\.txt$/i.test(pathname)) return false

  const lastSegment = pathname.split('/').pop() || ''
  const ext = lastSegment.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
  if (ext && !['htm', 'html', 'md', 'mdx'].includes(ext)) return false

  return isRootRelativeUrl(rawUrl)
}

function getLlmsNestedPrefix(llmsUrl) {
  if (!llmsUrl) return null

  try {
    const pathname = new URL(llmsUrl).pathname
    const dir = pathname.replace(/llms\.txt$/i, '').replace(/\/+$/, '/')
    return dir === '/' ? null : dir
  } catch {
    return null
  }
}

function isRootRelativeUrl(rawUrl) {
  return /^\/(?!\/)/.test(rawUrl)
}

function isPathWithinPrefix(pathname, prefix) {
  return pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix)
}
