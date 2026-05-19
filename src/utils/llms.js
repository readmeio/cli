const H1_RE = /^#\s+(.+)$/
const H2_RE = /^##\s+(.+)$/
// Any line whose meaningful content is a markdown link. Accepts:
//   - Standard list rows:           `- [text](url)`, `* [text](url) — desc`
//   - Bare link lines:              `[text](url)`
//   - Breadcrumb-prefixed rows used by Fern/Mintlify-style indices:
//       `ElevenAgents [Agent WebSockets](url)`
//       `API Reference > Agents > Branches [List branches](url)`
// Captures: [prefix, text, url, description] (prefix and description may be empty).
const LINK_LINE_RE = /^\s*(?:[-*+]\s+)?([^\[\n]*?)\s*\[([^\]]+)\]\(([^)\s]+)\)(?:\s*[:—–-]\s*(.+?))?\s*$/
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

export function analyzeLlmsTxt(body, llmsUrl) {
  const parsed = parseLlmsTxt(body, llmsUrl)
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

export function parseLlmsTxt(body, llmsUrl) {
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

    const h2 = line.match(H2_RE)
    if (h2) {
      current = { title: h2[1].trim(), items: [] }
      sections.push(current)
      continue
    }

    const item = parseListLink(line, llmsUrl)
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

function parseListLink(line, llmsUrl) {
  const match = line.match(LINK_LINE_RE)
  if (!match) return null

  const [, prefix, text, rawUrl, trailingDesc] = match
  const url = normalizeUrl(rawUrl, llmsUrl)
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

function normalizeUrl(rawUrl, llmsUrl) {
  const trimmed = String(rawUrl || '').trim().replace(/[.,;]+$/, '')
  if (!trimmed || /^#/.test(trimmed) || /^(mailto|javascript):/i.test(trimmed)) return null

  try {
    const url = llmsUrl ? new URL(trimmed, llmsUrl) : new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}
