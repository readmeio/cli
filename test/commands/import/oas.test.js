// oxlint-disable require-await
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, test, expect } from 'vitest';

import { __test__ } from '../../../src/commands/import.js';

const {
  sniffOasContent,
  buildWellKnownOasProbeUrls,
  probeWellKnownOasPaths,
  extractOasUrlsFromHtml,
  extractMintlifyOasCandidates,
  sitemapUrlsToKnownUrls,
  extractOasSpecUrlsFromParsed,
  downloadOasSpecs,
} = __test__;

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const JSON_SPEC = JSON.stringify({ openapi: '3.0.0', info: { title: 'T', version: '1' }, paths: {} });
const YAML_SPEC = 'openapi: 3.0.0\ninfo:\n  title: T\n  version: "1"\npaths: {}\n';
const HTML_SHELL = '<!DOCTYPE html><html><head><title>Docs</title></head><body>hi</body></html>';

function toArrayBuffer(str) {
  const buf = Buffer.from(str);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function mockProbeFetch(routes) {
  const seen = [];
  globalThis.fetch = async url => {
    const href = String(url);
    seen.push(href);
    const entry = routes[href] || routes['*'];
    if (!entry) return { ok: false, status: 404, url: href, arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      url: entry.finalUrl || href,
      arrayBuffer: async () => toArrayBuffer(entry.body),
    };
  };
  return seen;
}

test('sniffOasContent accepts JSON and YAML specs, rejects HTML and random content', () => {
  expect(sniffOasContent(JSON_SPEC)).toBe(true);
  expect(sniffOasContent(JSON.stringify({ swagger: '2.0', paths: {} }))).toBe(true);
  expect(sniffOasContent(YAML_SPEC)).toBe(true);
  expect(sniffOasContent('swagger: "2.0"\npaths: {}\n')).toBe(true);
  expect(sniffOasContent("'openapi': 3.1.0\n")).toBe(true);
  expect(sniffOasContent(HTML_SHELL)).toBe(false);
  expect(sniffOasContent('  <svg></svg>')).toBe(false);
  expect(sniffOasContent(JSON.stringify({ name: 'pkg', version: '1.0.0' }))).toBe(false);
  expect(sniffOasContent('')).toBe(false);
  expect(sniffOasContent('just some prose about openapi stuff')).toBe(false);
});

test('buildWellKnownOasProbeUrls covers both origins and path-kind docs bases without duplicates', () => {
  const docsBase = { kind: 'path', url: new URL('https://foo.com/docs/') };
  const urls = buildWellKnownOasProbeUrls(new URL('https://foo.com/docs/'), docsBase, 'https://foo.com');
  expect(urls).toContain('https://foo.com/openapi.json');
  expect(urls).toContain('https://foo.com/v3/api-docs');
  expect(urls).toContain('https://foo.com/docs/openapi.yaml');
  expect(urls).not.toContain('https://foo.com/docs/openapi.yml');
  expect(new Set(urls).size).toBe(urls.length);

  const subdomain = buildWellKnownOasProbeUrls(
    new URL('https://docs.foo.com/'),
    { kind: 'subdomain', url: new URL('https://docs.foo.com/') },
    'https://foo.com',
  );
  expect(subdomain).toContain('https://docs.foo.com/openapi.json');
  expect(subdomain).toContain('https://foo.com/openapi.json');
});

test('probeWellKnownOasPaths returns zero hits when every path 200s with HTML', async () => {
  const seen = mockProbeFetch({ '*': { body: HTML_SHELL } });
  const hits = await probeWellKnownOasPaths(new URL('https://foo.com/'), null, 'https://foo.com');
  expect(hits).toHaveLength(0);
  expect(seen.length).toBeLessThanOrEqual(27);
});

test('probeWellKnownOasPaths returns a hit with prefetched body for a real YAML spec', async () => {
  mockProbeFetch({ 'https://foo.com/openapi.yaml': { body: YAML_SPEC } });
  const hits = await probeWellKnownOasPaths(new URL('https://foo.com/'), null, 'https://foo.com');
  expect(hits).toHaveLength(1);
  expect(hits[0].url).toBe('https://foo.com/openapi.yaml');
  expect(hits[0].source).toBe('probe');
  expect(Buffer.isBuffer(hits[0].body)).toBe(true);
  expect(hits[0].body.toString('utf8')).toBe(YAML_SPEC);
});

test('probeWellKnownOasPaths skips hits that redirect off the probe origins', async () => {
  mockProbeFetch({
    'https://foo.com/openapi.json': { body: JSON_SPEC, finalUrl: 'https://other.example.com/openapi.json' },
    'https://foo.com/swagger.json': { body: JSON_SPEC },
  });
  const hits = await probeWellKnownOasPaths(new URL('https://foo.com/'), null, 'https://foo.com');
  expect(hits.map(h => h.url)).toStrictEqual(['https://foo.com/swagger.json']);
});

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
  };
  const items = extractMintlifyOasCandidates(config, 'https://foo.com');
  const urls = items.map(i => i.url);
  expect(urls).toStrictEqual([
    'https://foo.com/specs/root.json',
    'https://cdn.foo.com/a.yaml',
    'https://foo.com/specs/b.json',
    'https://foo.com/specs/c.json',
  ]);
  expect(items.every(i => i.source === 'mintlify' && i.text === null)).toBe(true);
});

test('extractMintlifyOasCandidates ignores non-url values and dedupes', () => {
  const config = {
    navigation: {
      anchors: [{ openapi: '/spec.json' }, { openapi: '/spec.json' }, { openapi: { notSource: true } }],
    },
  };
  const items = extractMintlifyOasCandidates(config, 'https://foo.com');
  expect(items.map(i => i.url)).toStrictEqual(['https://foo.com/spec.json']);
});

test('extractOasUrlsFromHtml finds Swagger UI single url and urls arrays', () => {
  const single = `<script>SwaggerUIBundle({ dom_id: '#swagger', url: "/openapi.json" })</script>`;
  expect(extractOasUrlsFromHtml(single, 'https://foo.com/reference')).toStrictEqual(['https://foo.com/openapi.json']);

  const multi = `<script>SwaggerUI({ urls: [{ url: "https://foo.com/v1.json", name: "v1" }, { url: '/v2.yaml', name: "v2" }] })</script>`;
  expect(extractOasUrlsFromHtml(multi, 'https://foo.com/reference')).toStrictEqual([
    'https://foo.com/v1.json',
    'https://foo.com/v2.yaml',
  ]);
});

test('extractOasUrlsFromHtml finds redoc in every quoting variant plus Redoc.init', () => {
  for (const html of [
    '<redoc spec-url="/spec.yaml"></redoc>',
    "<redoc spec-url='/spec.yaml'></redoc>",
    '<redoc lazy-rendering spec-url=/spec.yaml></redoc>',
  ]) {
    expect(extractOasUrlsFromHtml(html, 'https://foo.com/api')).toStrictEqual(['https://foo.com/spec.yaml']);
  }
  const init = `<script>Redoc.init("https://foo.com/openapi.json", {}, document.getElementById('redoc'))</script>`;
  expect(extractOasUrlsFromHtml(init, 'https://foo.com/api')).toStrictEqual(['https://foo.com/openapi.json']);
});

test('extractOasUrlsFromHtml finds Scalar script tags in both attribute orders', () => {
  const a = '<script id="api-reference" data-url="/openapi.json"></script>';
  const b = "<script data-url='/openapi.json' id='api-reference'></script>";
  expect(extractOasUrlsFromHtml(a, 'https://foo.com/')).toStrictEqual(['https://foo.com/openapi.json']);
  expect(extractOasUrlsFromHtml(b, 'https://foo.com/')).toStrictEqual(['https://foo.com/openapi.json']);

  const noId = '<script data-url="/openapi.json"></script>';
  expect(extractOasUrlsFromHtml(noId, 'https://foo.com/')).toStrictEqual([]);
});

test('extractOasUrlsFromHtml finds Stoplight apiDescriptionUrl and skips marketing pages', () => {
  const stoplight = '<elements-api apiDescriptionUrl="https://foo.com/api.yaml" router="hash" />';
  expect(extractOasUrlsFromHtml(stoplight, 'https://foo.com/')).toStrictEqual(['https://foo.com/api.yaml']);

  const marketing =
    '<html><body><a href="/pricing">Pricing</a><script>analytics.track("url: nope")</script></body></html>';
  expect(extractOasUrlsFromHtml(marketing, 'https://foo.com/')).toStrictEqual([]);
});

test('sitemapUrlsToKnownUrls routes spec-shaped locs to the sink instead of known pages', () => {
  const sink = [];
  const known = sitemapUrlsToKnownUrls(
    [
      'https://foo.com/docs/getting-started',
      'https://foo.com/openapi.json',
      'https://foo.com/specs/api.yaml',
      'https://foo.com/specs/api.yml',
    ],
    sink,
  );
  expect(known.map(k => k.url)).toStrictEqual(['https://foo.com/docs/getting-started']);
  expect(sink.map(s => s.url)).toStrictEqual([
    'https://foo.com/openapi.json',
    'https://foo.com/specs/api.yaml',
    'https://foo.com/specs/api.yml',
  ]);
  expect(sink.every(s => s.source === 'sitemap')).toBe(true);
});

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
  };
  const captured = extractOasSpecUrlsFromParsed(parsed);
  expect(captured).toStrictEqual([
    { url: 'https://foo.com/openapi.yaml', text: 'OpenAPI', source: 'llms' },
    { url: 'https://foo.com/spec.json', text: 'Spec', source: 'llms' },
  ]);
  expect(parsed.sections).toHaveLength(1);
  expect(parsed.sections[0].items.map(i => i.url)).toStrictEqual(['https://foo.com/docs/intro']);
});

test('downloadOasSpecs writes prefetched bodies without fetching and preserves extensions', async () => {
  const seen = [];
  globalThis.fetch = async url => {
    seen.push(String(url));
    return { ok: true, status: 200, url: String(url), arrayBuffer: async () => toArrayBuffer(YAML_SPEC) };
  };
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-oas-test-'));
  const written = await downloadOasSpecs(
    [
      { url: 'https://foo.com/openapi.json', text: null, source: 'probe', body: Buffer.from(JSON_SPEC) },
      { url: 'https://foo.com/specs/api.yaml', text: null, source: 'llms' },
    ],
    stagingDir,
  );
  expect(written).toBe(2);
  expect(seen).toStrictEqual(['https://foo.com/specs/api.yaml']);

  const files = fs.readdirSync(path.join(stagingDir, 'oas')).sort();
  expect(files).toStrictEqual(['api.yaml', 'openapi.json']);
  expect(fs.readFileSync(path.join(stagingDir, 'oas', 'openapi.json'), 'utf8')).toStrictEqual(JSON_SPEC);
  expect(fs.readFileSync(path.join(stagingDir, 'oas', 'api.yaml'), 'utf8')).toStrictEqual(YAML_SPEC);
});

test('downloadOasSpecs sniffs an extension for extensionless URLs', async () => {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-oas-test-'));
  const written = await downloadOasSpecs(
    [
      { url: 'https://foo.com/v3/api-docs', text: null, source: 'probe', body: Buffer.from(JSON_SPEC) },
      { url: 'https://foo.com/spec/latest', text: null, source: 'probe', body: Buffer.from(YAML_SPEC) },
    ],
    stagingDir,
  );
  expect(written).toBe(2);

  const files = fs.readdirSync(path.join(stagingDir, 'oas')).sort();
  expect(files).toStrictEqual(['api-docs.json', 'latest.yaml']);
});

test('downloadOasSpecs skips HTML bodies and suffixes filename collisions', async () => {
  globalThis.fetch = async url => ({
    ok: true,
    status: 200,
    url: String(url),
    arrayBuffer: async () => toArrayBuffer(HTML_SHELL),
  });
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-oas-test-'));
  const written = await downloadOasSpecs(
    [
      { url: 'https://foo.com/a/openapi.json', text: null, source: 'probe', body: Buffer.from(JSON_SPEC) },
      { url: 'https://foo.com/b/openapi.json', text: null, source: 'probe', body: Buffer.from(JSON_SPEC) },
      { url: 'https://foo.com/shell.json', text: null, source: 'html' },
    ],
    stagingDir,
  );
  expect(written).toBe(2);

  const files = fs.readdirSync(path.join(stagingDir, 'oas')).sort();
  expect(files).toStrictEqual(['openapi-2.json', 'openapi.json']);
});
