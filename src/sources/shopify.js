import matter from 'gray-matter'
import { runPool } from '../utils/promise-pool.js'
import * as styles from '../utils/styles.js'

const BASE = 'https://shopify.dev'
const FETCH_CONCURRENCY = 5
const FETCH_TIMEOUT_MS = 15000

const VERBOSE = !!process.env.SHOPIFY_DEBUG
const verbose = (msg) => { if (VERBOSE) styles.info(styles.dim(`  [debug] ${msg}`)) }

const SEEDS = [
  { url: `${BASE}/docs/apps/build`,     bucket: 'apps' },
  { url: `${BASE}/docs/apps/design`,    bucket: 'apps' },
  { url: `${BASE}/docs/apps/launch`,    bucket: 'apps' },
  { url: `${BASE}/docs/storefronts`,    bucket: 'storefronts' },
  { url: `${BASE}/docs/agents`,         bucket: 'agents' },
]

const BUCKETS = [
  { id: 'apps',        title: 'Apps',        icon: 'gear' },
  { id: 'storefronts', title: 'Storefronts', icon: 'store' },
  { id: 'agents',      title: 'Agents',      icon: 'robot' },
]

export function matches(sourceUrl) {
  return sourceUrl.hostname === 'shopify.dev'
}

/**
 * Build the skeleton for shopify.dev: fetch 5 hardcoded seed pages, extract
 * link cards from each body, return the same tree shape `organizeWithClaude`
 * produces. `##` section grouping is intentionally dropped — it would create
 * label-less folders in the sidebar.
 */
export async function buildSkeleton() {
  styles.info(`Shopify path: fetching ${SEEDS.length} seed pages${VERBOSE ? ' (verbose)' : ''}.`)

  const seedPages = await fetchSeeds()
  const organized = assemble(seedPages)

  const totalPages = organized.categories.reduce((sum, c) => sum + countLeafPages(c.pages), 0)
  styles.info(`Built ${organized.categories.length} categories containing ${totalPages} pages.`)
  return organized
}

async function fetchSeeds() {
  const results = new Map()
  await runPool(SEEDS, FETCH_CONCURRENCY, async (seed) => {
    const fetched = await fetchMd(seed.url)
    if (!fetched.ok) {
      throw new Error(`Failed to fetch seed ${seed.url}: ${fetched.error || `HTTP ${fetched.status}`}`)
    }
    const { data: fm } = matter(fetched.text)
    results.set(seed.url, {
      url: seed.url,
      bucket: seed.bucket,
      title: (typeof fm.title === 'string' && fm.title.trim()) || pathTitle(seed.url),
      description: (typeof fm.description === 'string' && fm.description.trim()) || null,
      body: fetched.text,
    })
    verbose(`seed ${seed.url} (${fetched.text.length}B, bucket=${seed.bucket})`)
  })
  return results
}

/**
 * Extract link cards from a seed body. A "card" is a markdown link whose
 * text is decorated (multi-line via `\` continuations or `####` prefix —
 * Shopify's two card conventions). When two consecutive links target the
 * same URL, the second one's text is treated as the description.
 *
 * Off-origin and non-`/docs/` URLs are dropped; duplicates are deduped
 * within the seed and across seeds (via `globalSeen`).
 */
function extractCards(seed, globalSeen) {
  const body = stripFrontmatter(seed.body)
  const seedPath = pathOf(seed.url)
  // `s` flag lets `\\.` match `\\\n` — card titles span multiple lines.
  const linkRe = /\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)\)/gs

  const matches = []
  for (let m; (m = linkRe.exec(body)) !== null; ) {
    matches.push({ text: m[1], url: m[2] })
  }

  const isCardTitle = (text) => /^#{2,6}\s/.test(text) || text.includes('\\\n')

  const cards = []
  const seen = new Set()
  let dropped = 0
  for (let i = 0; i < matches.length; i++) {
    const head = matches[i]
    if (!isCardTitle(head.text)) continue

    let abs
    try { abs = new URL(head.url, BASE) } catch { continue }
    if (abs.origin !== BASE || !abs.pathname.startsWith('/docs/')) {
      dropped++
      continue
    }
    abs.hash = ''
    const url = abs.toString().replace(/\/+$/, '')
    if (pathOf(url) === seedPath || seen.has(url) || globalSeen.has(url)) continue

    // Description partner: next link with same URL whose text isn't itself a
    // card-title (prevents two adjacent `####` titles from pairing).
    const next = matches[i + 1]
    let description = null
    if (next && next.url === head.url && !isCardTitle(next.text)) {
      description = cleanCardText(next.text)
      i++ // consume it
    }

    seen.add(url)
    globalSeen.add(url)
    cards.push({ title: cleanCardTitle(head.text), url, description })
  }
  return { cards, dropped }
}

function assemble(seedPages) {
  const byBucket = new Map(BUCKETS.map((b) => [b.id, { title: b.title, icon: b.icon, pages: [] }]))
  const globalSeen = new Set()

  for (const seed of seedPages.values()) {
    const { cards, dropped } = extractCards(seed, globalSeen)
    verbose(`${seed.url} → ${cards.length} cards` + (dropped > 0 ? `, ${dropped} dropped off-origin` : ''))

    const seedPage = {
      title: seed.title,
      url: seed.url,
      ...(seed.description ? { description: seed.description } : {}),
      pages: cards.map((c) => ({
        title: c.title,
        url: c.url,
        ...(c.description ? { description: c.description } : {}),
      })),
    }
    byBucket.get(seed.bucket).pages.push(seedPage)
  }

  return {
    title: 'Shopify Developer Platform',
    categories: Array.from(byBucket.values()).filter((c) => c.pages.length > 0),
  }
}

function countLeafPages(pages) {
  let n = 0
  for (const p of pages || []) {
    if (p.url) n++
    if (p.pages) n += countLeafPages(p.pages)
  }
  return n
}

async function fetchMd(url) {
  const target = url.endsWith('.md') ? url : `${url}.md`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(target, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'readme-cli-import' },
    })
    if (!res.ok) return { ok: false, status: res.status }
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (ct.includes('text/html')) {
      // SPA fallback: `.md` should be text/markdown; HTML means the path 404'd.
      return { ok: false, status: res.status, error: 'served as text/html' }
    }
    return { ok: true, status: res.status, text: await res.text() }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message }
  } finally {
    clearTimeout(timer)
  }
}

function stripFrontmatter(text) {
  if (!text.startsWith('---\n')) return text
  const end = text.indexOf('\n---\n', 4)
  return end === -1 ? text : text.slice(end + 5)
}

// Strip `####` heading markers and `\` line-breaks from card title text.
function cleanCardTitle(text) {
  return text
    .replace(/\\\s*/g, ' ')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/\*+([^*]+)\*+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '')
}

function cleanCardText(text) {
  return text
    .replace(/\\\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
}

function pathOf(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, '')
  } catch {
    return url
  }
}

// Fallback when a seed's frontmatter has no title — derive from URL slug.
function pathTitle(url) {
  const segs = pathOf(url).split('/').filter(Boolean)
  const last = segs[segs.length - 1] || 'untitled'
  return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
