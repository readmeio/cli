const H1_RE = /^#\s+(.+)$/
const H2_RE = /^##\s+(.+)$/
const STANDARD_LIST_LINK_RE = /^\s*[-*+]\s+\[([^\]]+)\]\(([^)\s]+)\)(?:\s*[:—–-]\s*(.+?))?\s*$/

export function analyzeLlmsTxt(body, llmsUrl) {
  const parsed = parseLlmsTxt(body, llmsUrl)
  const reason = getSkipReason(body, parsed)

  return {
    parsed,
    usable: !reason,
    reason,
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

function getSkipReason(body, parsed) {
  if (/^---\r?\n/.test(body)) return 'starts with YAML frontmatter'
  if (/^\s*(?:```|~~~)/m.test(body)) return 'contains fenced code blocks'
  if (/^!\[/m.test(body)) return 'contains image markdown'

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
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}
