import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { __test__ } from './import.js'

const {
  sniffOasContent,
  buildWellKnownOasProbeUrls,
  probeWellKnownOasPaths,
  extractOasUrlsFromHtml,
  extractMintlifyOasCandidates,
  sitemapUrlsToKnownUrls,
  extractOasSpecUrlsFromParsed,
  downloadOasSpecs,
} = __test__

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const JSON_SPEC = JSON.stringify({ openapi: '3.0.0', info: { title: 'T', version: '1' }, paths: {} })
const YAML_SPEC = 'openapi: 3.0.0\ninfo:\n  title: T\n  version: "1"\npaths: {}\n'
const HTML_SHELL = '<!DOCTYPE html><html><head><title>Docs</title></head><body>hi</body></html>'

function toArrayBuffer(str) {
  const buf = Buffer.from(str)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

function mockProbeFetch(routes) {
  const seen = []
  globalThis.fetch = async (url) => {
    const href = String(url)
    seen.push(href)
    const entry = routes[href] || routes['*']
    if (!entry) return { ok: false, status: 404, url: href, arrayBuffer: async () => new ArrayBuffer(0) }
    return {
      ok: true,
      status: 200,
      url: entry.finalUrl || href,
      arrayBuffer: async () => toArrayBuffer(entry.body),
    }
  }
  return seen
}

test('sniffOasContent accepts JSON and YAML specs, rejects HTML and random content', () => {
  assert.equal(sniffOasContent(JSON_SPEC), true)
  assert.equal(sniffOasContent(JSON.stringify({ swagger: '2.0', paths: {} })), true)
  assert.equal(sniffOasContent(YAML_SPEC), true)
  assert.equal(sniffOasContent('swagger: "2.0"\npaths: {}\n'), true)
  assert.equal(sniffOasContent("'openapi': 3.1.0\n"), true)
  assert.equal(sniffOasContent(HTML_SHELL), false)
  assert.equal(sniffOasContent('  <svg></svg>'), false)
  assert.equal(sniffOasContent(JSON.stringify({ name: 'pkg', version: '1.0.0' })), false)
  assert.equal(sniffOasContent(''), false)
  assert.equal(sniffOasContent('just some prose about openapi stuff'), false)
})

test('buildWellKnownOasProbeUrls covers both origins and path-kind docs bases without duplicates', () => {
  const docsBase = { kind: 'path', url: new URL('https://foo.com/docs/') }
  const urls = buildWellKnownOasProbeUrls(new URL('https://foo.com/docs/'), docsBase, 'https://foo.com')
  assert(urls.includes('https://foo.com/openapi.json'))
  assert(urls.includes('https://foo.com/v3/api-docs'))
  assert(urls.includes('https://foo.com/docs/openapi.yaml'))
  assert(!urls.includes('https://foo.com/docs/openapi.yml'))
  assert.equal(new Set(urls).size, urls.length)

  const subdomain = buildWellKnownOasProbeUrls(
    new URL('https://docs.foo.com/'),
    { kind: 'subdomain', url: new URL('https://docs.foo.com/') },
    'https://foo.com',
  )
  assert(subdomain.includes('https://docs.foo.com/openapi.json'))
  assert(subdomain.includes('https://foo.com/openapi.json'))
})

test('probeWellKnownOasPaths returns zero hits when every path 200s with HTML', async () => {
  const seen = mockProbeFetch({ '*': { body: HTML_SHELL } })
  const hits = await probeWellKnownOasPaths(new URL('https://foo.com/'), null, 'https://foo.com')
  assert.equal(hits.length, 0)
  assert(seen.length <= 27)
})

test('probeWellKnownOasPaths returns a hit with prefetched body for a real YAML spec', async () => {
  mockProbeFetch({ 'https://foo.com/openapi.yaml': { body: YAML_SPEC } })
  const hits = await probeWellKnownOasPaths(new URL('https://foo.com/'), null, 'https://foo.com')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].url, 'https://foo.com/openapi.yaml')
  assert.equal(hits[0].source, 'probe')
  assert(Buffer.isBuffer(hits[0].body))
  assert.equal(hits[0].body.toString('utf8'), YAML_SPEC)
})

test('probeWellKnownOasPaths skips hits that redirect off the probe origins', async () => {
  mockProbeFetch({
    'https://foo.com/openapi.json': { body: JSON_SPEC, finalUrl: 'https://other.example.com/openapi.json' },
    'https://foo.com/swagger.json': { body: JSON_SPEC },
  })
  const hits = await probeWellKnownOasPaths(new URL('https://foo.com/'), null, 'https://foo.com')
  assert.deepEqual(hits.map((h) => h.url), ['https://foo.com/swagger.json'])
})

test('extractMintlifyOasCandidates handles string, string[], {source}, and nested nav nodes', () => {
  const config = {
    openapi: '/specs/root.json',
    navigation: {
      tabs: [
        {
          tab: 'API',
          openapi: ['https://cdn.foo.com/a.yaml', '/specs/b.json'],
          groups: [{ group: 'Endpoints', openapi: { source: 'specs/c.json' }, pages: ['api/list'] }],
        },
      ],
    },
  }
  const items = extractMintlifyOasCandidates(config, 'https://foo.com')
  const urls = items.map((i) => i.url)
  assert.deepEqual(urls, [
    'https://foo.com/specs/root.json',
    'https://cdn.foo.com/a.yaml',
    'https://foo.com/specs/b.json',
    'https://foo.com/specs/c.json',
  ])
  assert(items.every((i) => i.source === 'mintlify' && i.text === null))
})

test('extractMintlifyOasCandidates ignores non-url values and dedupes', () => {
  const config = {
    navigation: {
      anchors: [{ openapi: '/spec.json' }, { openapi: '/spec.json' }, { openapi: { notSource: true } }],
    },
  }
  const items = extractMintlifyOasCandidates(config, 'https://foo.com')
  assert.deepEqual(items.map((i) => i.url), ['https://foo.com/spec.json'])
})

test('extractOasUrlsFromHtml finds Swagger UI single url and urls arrays', () => {
  const single = `<script>SwaggerUIBundle({ dom_id: '#swagger', url: "/openapi.json" })</script>`
  assert.deepEqual(extractOasUrlsFromHtml(single, 'https://foo.com/reference'), ['https://foo.com/openapi.json'])

  const multi = `<script>SwaggerUI({ urls: [{ url: "https://foo.com/v1.json", name: "v1" }, { url: '/v2.yaml', name: "v2" }] })</script>`
  assert.deepEqual(extractOasUrlsFromHtml(multi, 'https://foo.com/reference'), [
    'https://foo.com/v1.json',
    'https://foo.com/v2.yaml',
  ])
})

test('extractOasUrlsFromHtml finds redoc in every quoting variant plus Redoc.init', () => {
  for (const html of [
    '<redoc spec-url="/spec.yaml"></redoc>',
    "<redoc spec-url='/spec.yaml'></redoc>",
    '<redoc lazy-rendering spec-url=/spec.yaml></redoc>',
  ]) {
    assert.deepEqual(extractOasUrlsFromHtml(html, 'https://foo.com/api'), ['https://foo.com/spec.yaml'])
  }
  const init = `<script>Redoc.init("https://foo.com/openapi.json", {}, document.getElementById('redoc'))</script>`
  assert.deepEqual(extractOasUrlsFromHtml(init, 'https://foo.com/api'), ['https://foo.com/openapi.json'])
})

test('extractOasUrlsFromHtml finds Scalar script tags in both attribute orders', () => {
  const a = '<script id="api-reference" data-url="/openapi.json"></script>'
  const b = "<script data-url='/openapi.json' id='api-reference'></script>"
  assert.deepEqual(extractOasUrlsFromHtml(a, 'https://foo.com/'), ['https://foo.com/openapi.json'])
  assert.deepEqual(extractOasUrlsFromHtml(b, 'https://foo.com/'), ['https://foo.com/openapi.json'])
  const noId = '<script data-url="/openapi.json"></script>'
  assert.deepEqual(extractOasUrlsFromHtml(noId, 'https://foo.com/'), [])
})

test('extractOasUrlsFromHtml finds Stoplight apiDescriptionUrl and skips marketing pages', () => {
  const stoplight = '<elements-api apiDescriptionUrl="https://foo.com/api.yaml" router="hash" />'
  assert.deepEqual(extractOasUrlsFromHtml(stoplight, 'https://foo.com/'), ['https://foo.com/api.yaml'])
  const marketing = '<html><body><a href="/pricing">Pricing</a><script>analytics.track("url: nope")</script></body></html>'
  assert.deepEqual(extractOasUrlsFromHtml(marketing, 'https://foo.com/'), [])
})

test('sitemapUrlsToKnownUrls routes spec-shaped locs to the sink instead of known pages', () => {
  const sink = []
  const known = sitemapUrlsToKnownUrls(
    [
      'https://foo.com/docs/getting-started',
      'https://foo.com/openapi.json',
      'https://foo.com/specs/api.yaml',
      'https://foo.com/specs/api.yml',
    ],
    sink,
  )
  assert.deepEqual(known.map((k) => k.url), ['https://foo.com/docs/getting-started'])
  assert.deepEqual(
    sink.map((s) => s.url),
    ['https://foo.com/openapi.json', 'https://foo.com/specs/api.yaml', 'https://foo.com/specs/api.yml'],
  )
  assert(sink.every((s) => s.source === 'sitemap'))
})

test('extractOasSpecUrlsFromParsed captures .yaml links too and prunes emptied sections', () => {
  const parsed = {
    sections: [
      { title: 'Specs', items: [{ text: 'OpenAPI', url: 'https://foo.com/openapi.yaml' }] },
      {
        title: 'Guides',
        items: [
          { text: 'Intro', url: 'https://foo.com/docs/intro' },
          { text: 'Spec', url: 'https://foo.com/spec.json' },
        ],
      },
    ],
  }
  const captured = extractOasSpecUrlsFromParsed(parsed)
  assert.deepEqual(captured, [
    { url: 'https://foo.com/openapi.yaml', text: 'OpenAPI', source: 'llms' },
    { url: 'https://foo.com/spec.json', text: 'Spec', source: 'llms' },
  ])
  assert.equal(parsed.sections.length, 1)
  assert.deepEqual(parsed.sections[0].items.map((i) => i.url), ['https://foo.com/docs/intro'])
})

test('downloadOasSpecs writes prefetched bodies without fetching and preserves extensions', async () => {
  const seen = []
  globalThis.fetch = async (url) => {
    seen.push(String(url))
    return { ok: true, status: 200, url: String(url), arrayBuffer: async () => toArrayBuffer(YAML_SPEC) }
  }
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-oas-test-'))
  const written = await downloadOasSpecs(
    [
      { url: 'https://foo.com/openapi.json', text: null, source: 'probe', body: Buffer.from(JSON_SPEC) },
      { url: 'https://foo.com/specs/api.yaml', text: null, source: 'llms' },
    ],
    stagingDir,
  )
  assert.equal(written, 2)
  assert.deepEqual(seen, ['https://foo.com/specs/api.yaml'])
  const files = fs.readdirSync(path.join(stagingDir, 'oas')).sort()
  assert.deepEqual(files, ['api.yaml', 'openapi.json'])
  assert.equal(fs.readFileSync(path.join(stagingDir, 'oas', 'openapi.json'), 'utf8'), JSON_SPEC)
  assert.equal(fs.readFileSync(path.join(stagingDir, 'oas', 'api.yaml'), 'utf8'), YAML_SPEC)
})

test('downloadOasSpecs sniffs an extension for extensionless URLs', async () => {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-oas-test-'))
  const written = await downloadOasSpecs(
    [
      { url: 'https://foo.com/v3/api-docs', text: null, source: 'probe', body: Buffer.from(JSON_SPEC) },
      { url: 'https://foo.com/spec/latest', text: null, source: 'probe', body: Buffer.from(YAML_SPEC) },
    ],
    stagingDir,
  )
  assert.equal(written, 2)
  const files = fs.readdirSync(path.join(stagingDir, 'oas')).sort()
  assert.deepEqual(files, ['api-docs.json', 'latest.yaml'])
})

test('downloadOasSpecs skips HTML bodies and suffixes filename collisions', async () => {
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    url: String(url),
    arrayBuffer: async () => toArrayBuffer(HTML_SHELL),
  })
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-oas-test-'))
  const written = await downloadOasSpecs(
    [
      { url: 'https://foo.com/a/openapi.json', text: null, source: 'probe', body: Buffer.from(JSON_SPEC) },
      { url: 'https://foo.com/b/openapi.json', text: null, source: 'probe', body: Buffer.from(JSON_SPEC) },
      { url: 'https://foo.com/shell.json', text: null, source: 'html' },
    ],
    stagingDir,
  )
  assert.equal(written, 2)
  const files = fs.readdirSync(path.join(stagingDir, 'oas')).sort()
  assert.deepEqual(files, ['openapi-2.json', 'openapi.json'])
})
