import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { InvalidArgumentError, Option } from 'commander'
import matter from 'gray-matter'
import { collectFiles } from '../utils/lint.js'
import { prettifyPagePrompt, prettifyPageOutputSchema } from '../prompts/index.js'
import { printHeader, isAgenticCli } from '../utils/eyes.js'
import { MultiSpinner } from '../utils/multi-spinner.js'
import { runPool } from '../utils/promise-pool.js'
import {
  listLocalComponents,
  listMarketplaceComponents,
  installComponent,
  readCachedReadme,
  summarizeReadme,
} from '../utils/marketplace.js'
import * as styles from '../utils/styles.js'

const require = createRequire(import.meta.url)
const pkg = require('../../package.json')

/**
 * Native ReadMe MDX tags that don't need a marketplace install — the renderer
 * supports them out of the box. We exclude these from auto-install detection.
 */
const NATIVE_TAGS = new Set([
  'Tabs', 'Tab',
  'Accordion',
  'Cards', 'Card',
  'Columns', 'Column',
  'Image',
])

/**
 * Pull every PascalCase tag name out of a block of mdx. Matches both
 * `<Foo ... />` and `<Foo>...</Foo>`. Returns a Set of unique names.
 */
function extractUsedTags(mdx) {
  const tags = new Set()
  const re = /<([A-Z][A-Za-z0-9]*)\b/g
  let m
  while ((m = re.exec(mdx)) !== null) tags.add(m[1])
  return tags
}

export const command = 'pretty [file]'
export const order = 2
export const description = 'Polish docs into ReadMe-ready MDX with Claude'
export const beta = true

export function args(cmd) {
  cmd.addOption(new Option('-m, --model <name>', 'Claude model alias: haiku, sonnet, opus').choices(['haiku', 'sonnet', 'opus']).default('sonnet'))

  cmd.option('--dry-run', 'Show what would change without writing files')
  cmd.option('--no-auto-install', 'Don\'t auto-install marketplace components used in output')
  cmd.option(
    '-j, --jobs <n>',
    'Number of files to prettify in parallel',
    (raw) => {
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 1) {
        throw new InvalidArgumentError('must be a positive integer')
      }
      return n
    },
    1,
  )
}

/**
 * Fetch with exponential backoff for transient (5xx / network) failures.
 * `retries: 3` does up to 4 attempts with delays of 1s, 2s, 4s before each
 * retry. 4xx responses are definitive and short-circuit so callers can fall
 * through to the next strategy.
 */
async function fetchWithRetry(url, { headers = {}, retries = 3, baseDelayMs = 1000 } = {}) {
  const maxAttempts = retries + 1
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'readme-cli-pretty', ...headers },
      })
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText}`)
        err.status = res.status
        throw err
      }
      return await res.text()
    } catch (err) {
      lastError = err
      if (err.status && err.status >= 400 && err.status < 500) break
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}

function withMdExtension(url) {
  try {
    const u = new URL(url)
    if (u.pathname.endsWith('.md')) return null
    u.pathname = u.pathname.replace(/\/$/, '') + '.md'
    return u.toString()
  } catch {
    if (url.endsWith('.md')) return null
    return url.replace(/\/$/, '') + '.md'
  }
}

/**
 * Fetch a doc URL, preferring markdown. Falls through in order:
 *   1. <url>.md (when not already .md)
 *   2. <url> with Accept: text/markdown
 *   3. <url> directly
 * Each strategy gets its own retry budget for transient failures.
 */
async function fetchImport(url, opts = {}) {
  const strategies = []
  const mdUrl = withMdExtension(url)
  if (mdUrl) strategies.push({ url: mdUrl })
  strategies.push({ url, headers: { Accept: 'text/markdown' } })
  strategies.push({ url })

  let lastError
  for (const strategy of strategies) {
    try {
      return await fetchWithRetry(strategy.url, { ...opts, headers: strategy.headers })
    } catch (err) {
      lastError = err
    }
  }
  throw new Error(`failed to fetch ${url}: ${lastError?.message || lastError}`)
}

/**
 * Send one page through Claude using the prettify system prompt and the agent
 * SDK's structured-output mode. The runtime enforces `prettifyPageOutputSchema`
 * and surfaces the parsed object on the result message's `structured_output`
 * field — no fence-stripping or manual JSON.parse needed.
 *
 * `oasPartialJson` arrives as a string (the schema models it as such to dodge
 * structured outputs' `additionalProperties: false` rule, which is
 * incompatible with OpenAPI's free-form path/schema keys). We parse it here
 * and re-expose it as `oasPartial` so callers see the conventional shape.
 */
async function prettifyPage({ source, title, relativePath, model, localComponents, availableComponents }) {
  const { systemPrompt, userPrompt } = prettifyPagePrompt({
    source, title, relativePath, localComponents, availableComponents,
  })

  let structured
  for await (const message of query({
    prompt: userPrompt,
    options: {
      systemPrompt,
      allowedTools: [],
      outputFormat: { type: 'json_schema', schema: prettifyPageOutputSchema },
      ...(model ? { model } : {}),
    },
  })) {
    if (message.type === 'result') {
      if (message.subtype !== 'success') {
        throw new Error(`${message.subtype}${message.error?.message ? ' — ' + message.error.message : ''}`)
      }
      structured = message.structured_output
      break
    }
  }

  if (!structured || typeof structured !== 'object') {
    throw new Error('agent returned no structured output')
  }

  let oasPartial = null
  if (typeof structured.oasPartialJson === 'string' && structured.oasPartialJson.length > 0) {
    try {
      oasPartial = JSON.parse(structured.oasPartialJson)
    } catch (e) {
      throw new Error(`invalid oasPartialJson (${e.message}); first 200 chars: ${structured.oasPartialJson.slice(0, 200)}`)
    }
  }

  return { body: structured.body, isApiRef: structured.isApiRef, oasPartial }
}

export async function run(file, options, _cmd, ctx) {
  const { gitRoot } = ctx

  if (!isAgenticCli()) {
    printHeader({ version: pkg.version, binName: styles.binName(), indent: '  ' })
    console.log()
  }

  let files
  if (file) {
    const absFile = path.resolve(file)
    if (!fs.existsSync(absFile)) {
      styles.error(`File not found: ${styles.bold(file)}`)
      process.exit(1)
    }
    const relFile = path.relative(gitRoot, absFile)
    if (relFile.startsWith('..') || path.isAbsolute(relFile)) {
      styles.error(`File must be inside the repo: ${styles.bold(file)}`)
      process.exit(1)
    }
    files = [relFile]
  } else {
    files = collectFiles(gitRoot)
  }

  if (files.length === 0) {
    styles.warning('No docs files found to prettify.')
    return
  }

  const localComponents = listLocalComponents(gitRoot)
  const localNames = new Set(localComponents.map((c) => c.name))

  // Pull the full marketplace catalog so Claude knows what else it can use.
  // Summaries come from disk cache (populated by `readme components list`);
  // we don't fetch readmes here to keep the prompt path fast.
  let marketplace = []
  if (options.autoInstall !== false) {
    try {
      marketplace = await listMarketplaceComponents()
    } catch (err) {
      styles.warning(`Could not load marketplace catalog: ${err.message} (continuing without it)`)
    }
  }
  const marketplaceNames = new Set(marketplace.map((c) => c.name))
  const availableComponents = marketplace
    .filter((c) => !localNames.has(c.name))
    .map((c) => ({ name: c.name, summary: summarizeReadme(readCachedReadme(c.name)) }))

  // Concurrent workers may both try to install the same component. Coalesce
  // duplicate installs through a Map<tag, Promise> — the second caller awaits
  // the first's install instead of clobbering it.
  const inFlightInstalls = new Map()
  const autoInstalled = new Set()
  function ensureInstalled(tag) {
    if (inFlightInstalls.has(tag)) return inFlightInstalls.get(tag)
    const p = (async () => {
      await installComponent(gitRoot, tag)
      localNames.add(tag)
      autoInstalled.add(tag)
    })()
    inFlightInstalls.set(tag, p)
    return p
  }

  styles.info(
    `Prettifying ${styles.bold(String(files.length))} file${files.length === 1 ? '' : 's'} with ${styles.bold(options.model)}${options.jobs > 1 ? ` (${styles.bold('-j ' + options.jobs)})` : ''}${options.dryRun ? styles.dim(' (dry run)') : ''}.`,
  )
  if (localComponents.length > 0) {
    styles.info(
      `Found ${styles.bold(String(localComponents.length))} local component${localComponents.length === 1 ? '' : 's'} in ${styles.bold('./components/')}: ${localComponents.map((c) => c.name).join(', ')}`,
    )
  }
  if (options.autoInstall !== false && availableComponents.length > 0) {
    styles.info(
      `${styles.bold(String(availableComponents.length))} additional marketplace component${availableComponents.length === 1 ? '' : 's'} will be auto-installed if used.`,
    )
  }
  console.log()

  let updated = 0
  let unchanged = 0
  const failures = []

  const rows = Math.min(options.jobs, files.length)
  const multi = new MultiSpinner({ rows, color: 'blue' })
  multi.start()

  await runPool(files, options.jobs, async (relativePath, _i, workerIdx) => {
    multi.setLine(workerIdx, relativePath)

    try {
      const filePath = path.join(gitRoot, relativePath)
      const original = fs.readFileSync(filePath, 'utf-8')
      const parsed = matter(original)

      let source = parsed.content
      const importUrl = parsed.data?.['x-import']
      if (importUrl) {
        multi.setLine(workerIdx, `${relativePath} ${styles.dim(`(fetching ${importUrl})`)}`)
        source = await fetchImport(importUrl)
        multi.setLine(workerIdx, relativePath)
      }

      const result = await prettifyPage({
        source,
        title: parsed.data?.title,
        relativePath,
        model: options.model,
        localComponents,
        availableComponents: options.autoInstall === false ? [] : availableComponents,
      })

      if (typeof result?.body !== 'string') {
        throw new Error('response missing "body" field')
      }

      // Auto-install marketplace components Claude used in the body. We do
      // this before writing the file so the docs page and its components land
      // together — and we share the inFlightInstalls map across workers so a
      // tag is only fetched once.
      if (options.autoInstall !== false && !options.dryRun) {
        const used = extractUsedTags(result.body)
        for (const tag of used) {
          if (NATIVE_TAGS.has(tag)) continue
          if (localNames.has(tag)) continue
          if (!marketplaceNames.has(tag)) continue
          try {
            multi.setLine(workerIdx, `${relativePath} ${styles.dim(`(installing <${tag}>)`)}`)
            await ensureInstalled(tag)
          } catch (err) {
            failures.push({ relativePath, message: `auto-install <${tag}> failed: ${err.message}` })
          }
        }
        multi.setLine(workerIdx, relativePath)
      }

      const newFm = { ...parsed.data }
      delete newFm.hidden
      delete newFm['x-import']
      if (result.excerpt && !newFm.excerpt) newFm.excerpt = result.excerpt
      const next = matter.stringify(result.body, newFm)

      if (next === original) {
        unchanged++
        if (!process.stderr.isTTY) multi.log(`  ${styles.dim('·')} ${relativePath}`)
      } else {
        if (!options.dryRun) fs.writeFileSync(filePath, next, 'utf-8')
        updated++
        if (!process.stderr.isTTY) multi.log(`  ${styles.success('✓')} ${relativePath}`)
      }
    } catch (err) {
      failures.push({ relativePath, message: err.message || String(err) })
      if (!process.stderr.isTTY) {
        multi.log(`  ${styles.err('●')} ${relativePath} ${styles.dim('— ' + (err.message || String(err)))}`)
      }
    } finally {
      multi.clearLine(workerIdx)
    }
  })

  multi.stop()

  console.log()
  const verb = options.dryRun ? 'would update' : 'updated'
  styles.ok(`${styles.bold(String(updated))} ${verb} · ${styles.bold(String(unchanged))} unchanged${failures.length ? ` · ${styles.bold(String(failures.length))} failed` : ''}`)
  if (autoInstalled.size > 0) {
    styles.ok(`Auto-installed ${styles.bold(String(autoInstalled.size))} component${autoInstalled.size === 1 ? '' : 's'}: ${[...autoInstalled].join(', ')}`)
  }

  if (failures.length > 0) {
    console.log()
    for (const f of failures) {
      console.log(`  ${styles.err('●')} ${styles.bold(f.relativePath)} ${styles.dim('— ' + f.message)}`)
    }
    process.exit(1)
  }
}
