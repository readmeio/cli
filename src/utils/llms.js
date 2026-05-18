const H1_RE = /^#\s+(.+)$/
const H2_RE = /^##\s+(.+)$/
const STANDARD_LIST_LINK_RE = /^\s*[-*+]\s+\[([^\]]+)\]\(([^)\s]+)\)(?:\s*[:—–-]\s*(.+?))?\s*$/
const BLOCKQUOTE_RE = /^\s*>/
const FENCE_RE = /^\s*(?:```|~~~)/

// A llms.txt is considered usable when at least MIN_LINK_ROWS link items
// parse cleanly AND the share of "spec-shaped" lines (H1/H2/blockquote/link
// row/blank) over total lines is at least MIN_CONFORMING_RATIO. Fenced code
// blocks (including the fence delimiters) and anything else (prose
// paragraphs, image markdown, HTML, etc.) count against the ratio. Tuned to
// accept real-world files that include a short prose preamble/epilogue while
// still rejecting prose-heavy or llms-full.txt-shaped documents.
const MIN_LINK_ROWS = 10
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
  if (linkItems < MIN_LINK_ROWS) {
    return `only ${linkItems} link item${linkItems === 1 ? '' : 's'} (need at least ${MIN_LINK_ROWS})`
  }
  if (lineStats.ratio < MIN_CONFORMING_RATIO) {
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
    if (H1_RE.test(line) || H2_RE.test(line) || STANDARD_LIST_LINK_RE.test(line) || BLOCKQUOTE_RE.test(line)) {
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
  const match = line.match(STANDARD_LIST_LINK_RE)
  if (!match) return null

  const url = normalizeUrl(match[2], llmsUrl)
  if (!url) return null

  return {
    text: match[1].trim(),
    url,
    description: match[3] ? match[3].trim() : null,
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
