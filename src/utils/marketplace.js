/**
 * Talks to the readmeio/marketplace repo: lists the available MDX components,
 * fetches a single component's files (the .mdx source + its readme.md), and
 * caches everything on disk so we're not hitting GitHub on every command.
 *
 * Components are read at https://github.com/readmeio/marketplace/tree/main/components
 * and copied into the user's local `components/` folder. The marketplace
 * `.mdx` files are the canonical source — they hold the JSX export plus an
 * example invocation at the bottom.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = 'readmeio/marketplace';
const BRANCH = 'main';
const COMPONENTS_PATH = 'components';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const CACHE_DIR = path.join(os.homedir(), '.cache', 'readme-cli', 'marketplace');

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cachePath(name) {
  return path.join(CACHE_DIR, name);
}

function readCache(name, maxAgeMs = CACHE_TTL_MS) {
  const file = cachePath(name);
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

function writeCache(name, contents) {
  ensureCacheDir();
  fs.writeFileSync(cachePath(name), contents, 'utf-8');
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': '@readme/cli', Accept: 'application/vnd.github.v3+json' },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Returns the list of marketplace components as an array of:
 *   { name, mdxUrl, readmeUrl, htmlUrl }
 * Hidden entries (e.g. `.ExampleComponent`) are filtered out.
 */
export async function listMarketplaceComponents({ force = false } = {}) {
  const cacheKey = 'index.json';
  if (!force) {
    const cached = readCache(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* fall through */ }
    }
  }

  const url = `https://api.github.com/repos/${REPO}/contents/${COMPONENTS_PATH}?ref=${BRANCH}`;
  const body = await fetchText(url);
  const entries = JSON.parse(body);

  const components = entries
    .filter((e) => e.type === 'dir' && !e.name.startsWith('.'))
    .map((e) => ({
      name: e.name,
      htmlUrl: `https://github.com/${REPO}/tree/${BRANCH}/${COMPONENTS_PATH}/${e.name}`,
      mdxUrl: `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${COMPONENTS_PATH}/${e.name}/${e.name}.mdx`,
      readmeUrl: `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${COMPONENTS_PATH}/${e.name}/readme.md`,
    }));

  writeCache(cacheKey, JSON.stringify(components, null, 2));
  return components;
}

/**
 * Fetch the .mdx + readme.md for a single component. Returns:
 *   { name, mdx, readme, htmlUrl }
 * `readme` may be null if the component has no readme.md.
 */
export async function fetchMarketplaceComponent(name, { force = false } = {}) {
  const components = await listMarketplaceComponents({ force });
  const match = components.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    throw new Error(`Component "${name}" not found in marketplace.`);
  }

  const mdxCacheKey = `${match.name}.mdx`;
  const readmeCacheKey = `${match.name}.readme.md`;

  let mdx = !force && readCache(mdxCacheKey);
  if (!mdx) {
    mdx = await fetchText(match.mdxUrl);
    writeCache(mdxCacheKey, mdx);
  }

  let readme = !force && readCache(readmeCacheKey);
  if (!readme) {
    try {
      readme = await fetchText(match.readmeUrl);
      writeCache(readmeCacheKey, readme);
    } catch {
      readme = null;
    }
  }

  return { name: match.name, mdx, readme, htmlUrl: match.htmlUrl };
}

/**
 * Pull the one-line summary out of a component's readme.md. We look for the
 * first non-empty paragraph after the `## Overview` heading, falling back to
 * the first non-heading line. Returns "" if nothing usable is found.
 */
export function summarizeReadme(readme) {
  if (!readme) return '';
  const lines = readme.split('\n');
  let inOverview = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^##\s+overview/i.test(line)) { inOverview = true; continue; }
    if (inOverview && line && !line.startsWith('#') && !line.startsWith('![')) {
      return line.replace(/[*_`]/g, '').slice(0, 140);
    }
  }
  // Fallback: first non-heading, non-image line.
  for (const line of lines) {
    const t = line.trim();
    if (t && !t.startsWith('#') && !t.startsWith('![') && !t.startsWith('<')) {
      return t.replace(/[*_`]/g, '').slice(0, 140);
    }
  }
  return '';
}

/**
 * Pull the first example invocation block out of a component's mdx. Components
 * conventionally end with a bare `<ComponentName ... />` line below the React
 * export — return that. Returns the full mdx as a fallback.
 */
export function extractExample(mdx, name) {
  const re = new RegExp(`^<${name}[\\s\\S]*?(?:/>|</${name}>)\\s*$`, 'm');
  const match = mdx.match(re);
  return match ? match[0] : '';
}

/**
 * Returns the absolute path to the local `components/` folder for a repo
 * (relative to gitRoot). Does not create it.
 */
export function localComponentsDir(gitRoot) {
  return path.join(gitRoot, 'components');
}

/**
 * Read a previously-cached readme for a component without hitting the network.
 * Returns null if there's nothing cached. Used so we can show short
 * descriptions in prompts/lists without slowing down the command on a cold
 * cache.
 */
export function readCachedReadme(name) {
  return readCache(`${name}.readme.md`, Infinity);
}

/**
 * Install a marketplace component into the user's local components/ folder.
 * Used by both the `components add` subcommand and the auto-install path in
 * `pretty`. Returns the destination path on success.
 */
export async function installComponent(gitRoot, name, { force = false } = {}) {
  const comp = await fetchMarketplaceComponent(name, { force });
  const dest = localComponentsDir(gitRoot);
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, `${comp.name}.mdx`);
  fs.writeFileSync(file, comp.mdx, 'utf-8');
  return { name: comp.name, file, mdx: comp.mdx };
}

/**
 * List components that have been copied into the user's local components/
 * folder. Returns an array of { name, file, source } where `source` is the
 * raw mdx contents.
 */
export function listLocalComponents(gitRoot) {
  const dir = localComponentsDir(gitRoot);
  if (!fs.existsSync(dir)) return [];

  const out = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.mdx')) continue;
    const file = path.join(dir, entry);
    const source = fs.readFileSync(file, 'utf-8');
    out.push({ name: entry.replace(/\.mdx$/, ''), file, source });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
