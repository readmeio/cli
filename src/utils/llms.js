const H1_RE = /^#\s+(.+)$/
const H2_RE = /^##\s+(.+)$/
const CODE_FENCE_RE = /^\s*(?:```|~~~)/
const STANDARD_LIST_LINK_RE = /^\s*[-*+]\s+\[([^\]]+)\]\(([^)\s]+)\)(?::\s*(.+))?\s*$/

export function analyzeLlmsTxt(body, llmsUrl) {
  const parsed = parseLlmsTxt(body, llmsUrl)
  const reason = getSkipReason(body, parsed, llmsUrl)

  return {
    parsed,
    structurallyUsable: !reason,
    reason,
  }
}

export function parseLlmsTxt(body, llmsUrl) {
  let title = null
  const sections = []
  let current = null

  for (const line of body.split(/\r?\n/)) {
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

function getSkipReason(body, parsed, llmsUrl) {
  const lines = body.split(/\r?\n/)
  if (body.length < 20) return 'empty or too small to be a usable llms.txt index'
  if (lines.some(line => CODE_FENCE_RE.test(line))) return 'contains fenced code blocks'
  if (!lines.some(line => H2_RE.test(line))) return 'contains no H2 sections'

  const itemCount = parsed.sections.reduce((sum, section) => sum + section.items.length, 0)
  if (itemCount === 0) return 'contains no standard llms.txt link rows'

  return null
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
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
