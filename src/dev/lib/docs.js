import { createRequire } from 'node:module';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { compile, run } from '@readme/markdown';
import yaml from 'js-yaml';

// Use createRequire to load react-dom/server at runtime,
// bypassing Next.js App Router's static import restriction.
const _require = createRequire(import.meta.url);
const React = _require('react');
const { renderToStaticMarkup } = _require('react-dom/server');

const DOCS_ROOT = process.env.DOCS_ROOT;

const SECTIONS = [
  { dir: 'docs', label: 'Docs' },
  { dir: 'reference', label: 'Reference' },
  { dir: 'custom_pages', label: 'Custom Pages' },
  { dir: 'recipes', label: 'Recipes' },
];

// Max folder nesting per section — anything deeper doesn't render in ReadMe's
// sidebar, so we mirror the cap here. Keep in sync with src/validators/nesting.js.
const MAX_DEPTH = {
  docs: 3,
  reference: 3,
  recipes: 0,
  custom_pages: 0,
};

function walkDir(dirPath, sectionDir, depth = 0) {
  if (!fs.existsSync(dirPath)) return [];

  // Read _order.yaml for ordering
  let order = [];
  const orderPath = path.join(dirPath, '_order.yaml');
  if (fs.existsSync(orderPath)) {
    order = yaml.load(fs.readFileSync(orderPath, 'utf-8')) || [];
  }

  // Get all items (exclude dotfiles and _-prefixed files)
  const items = fs.readdirSync(dirPath).filter(f => !f.startsWith('.') && !f.startsWith('_'));

  const mdFiles = new Set(items.filter(f => f.endsWith('.md') && f !== 'index.md').map(f => f.replace(/\.md$/, '')));
  const dirs = new Set(
    items.filter(f => {
      try {
        return fs.statSync(path.join(dirPath, f)).isDirectory();
      } catch {
        return false;
      }
    }),
  );

  // Build ordered list: ordered items first, then any remaining
  const allNames = new Set([...mdFiles, ...dirs]);
  const ordered = order.filter(name => allNames.has(name));
  const remaining = [...allNames].filter(name => !ordered.includes(name));
  const finalOrder = [...ordered, ...remaining];

  const entries = [];
  for (const name of finalOrder) {
    const isDir = dirs.has(name);
    const isMd = mdFiles.has(name);

    if (isDir) {
      // Skip folders whose contents would exceed ReadMe's sidebar nesting
      // cap — they won't render in production, so don't show them here either.
      const maxDepth = MAX_DEPTH[sectionDir];
      if (maxDepth !== undefined && depth + 1 > maxDepth) continue;

      const children = walkDir(path.join(dirPath, name), sectionDir, depth + 1);

      // ReadMeConfig pages are internal — show them without a group header
      if (name === 'ReadMeConfig') {
        entries.push(...children);
        continue;
      }

      // A directory can represent either:
      //   1. A pure category (no content of its own) → render as group label
      //   2. A parent page with children → render as a clickable page with
      //      a nested list underneath
      //
      // Two file layouts signal #2:
      //   a. `<name>/index.md` — the "index" convention
      //   b. `<parent>/<name>.md` right alongside the `<name>/` folder
      //      (sibling convention) — the importer writes parent pages this way
      // If either exists, treat this as a clickable parent page.
      const indexPath = path.join(dirPath, name, 'index.md');
      const siblingMdPath = path.join(dirPath, `${name}.md`);
      const parentPagePath = fs.existsSync(indexPath)
        ? indexPath
        : fs.existsSync(siblingMdPath) ? siblingMdPath : null;

      let title = name;
      let href = null;
      let hidden = false;
      let icon = null;
      if (parentPagePath) {
        const { data } = matter(fs.readFileSync(parentPagePath, 'utf-8'));
        title = data.title || name;
        href = `/${sectionDir}/${encodeURIComponent(name)}`;
        hidden = !!data.hidden;
        icon = data.icon || null;
      }

      entries.push({ title, href, hidden, icon, children });
      // If a sibling .md is providing the parent content, remove it from
      // mdFiles so we don't also render it as a standalone page below.
      mdFiles.delete(name);
    } else if (isMd) {
      const filePath = path.join(dirPath, `${name}.md`);
      const { data } = matter(fs.readFileSync(filePath, 'utf-8'));
      const linkUrl = data.link?.url;
      entries.push({
        title: data.title || name,
        href: linkUrl || `/${sectionDir}/${encodeURIComponent(name)}`,
        external: !!linkUrl,
        hidden: !!data.hidden,
        icon: data.icon || null,
        children: [],
      });
    }
  }

  return entries;
}

export function collectSidebar() {
  const sections = [];
  for (const { dir, label } of SECTIONS) {
    const fullPath = path.join(DOCS_ROOT, dir);
    if (!fs.existsSync(fullPath)) continue;

    const children = walkDir(fullPath, dir);
    if (children.length > 0) {
      sections.push({ title: label, dir, firstHref: findFirstHref(children), children });
    }
  }
  return sections;
}

function loadCustomBlocks(docsRoot) {
  const blocksDir = path.join(docsRoot, 'custom_blocks');
  if (!fs.existsSync(blocksDir)) return { sources: {}, modules: {} };

  const files = fs.readdirSync(blocksDir).filter(f => f.endsWith('.md') || f.endsWith('.mdx'));
  const sources = {};
  const modules = {};

  for (const file of files) {
    const raw = fs.readFileSync(path.join(blocksDir, file), 'utf-8');
    const { data, content } = matter(raw);
    const name = data.name || path.basename(file, path.extname(file));
    sources[name] = content;
    modules[name] = run(compile(content));
  }

  return { sources, modules };
}

// Recursively find a .md file matching the given slug within a directory
function findFile(dirPath, slug) {
  if (!fs.existsSync(dirPath)) return null;

  // Check for slug.md directly in this directory
  const direct = path.join(dirPath, `${slug}.md`);
  if (fs.existsSync(direct)) return direct;

  // Check for slug/index.md
  const index = path.join(dirPath, slug, 'index.md');
  if (fs.existsSync(index)) return index;

  // Search subdirectories
  const entries = fs.readdirSync(dirPath).filter(f => !f.startsWith('.') && !f.startsWith('_'));
  for (const entry of entries) {
    const full = path.join(dirPath, entry);
    try {
      if (fs.statSync(full).isDirectory()) {
        const found = findFile(full, slug);
        if (found) return found;
      }
    } catch {
      // skip
    }
  }

  return null;
}

export function getPage(slugArray) {
  // slugArray = ['docs', 'getting-started'] or ['reference', 'getPet']
  const [section, ...rest] = slugArray.map(s => decodeURIComponent(s));
  const slug = rest.join('/');
  if (!section || !slug) return null;

  const sectionPath = path.join(DOCS_ROOT, section);
  const filePath = findFile(sectionPath, slug);

  if (!filePath) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);

  let html;

  // Reference pages stubbed by the import command (or by oas:sync) have an
  // empty body — the real endpoint UI comes from the OAS spec at render
  // time. The production ReadMe renderer handles this; our local dev server
  // used to show a blank page. If we see `api.file` + `api.operationId`,
  // render a minimal preview from the spec so the page isn't empty.
  if (data.api?.file && data.api?.operationId && !content.trim()) {
    html = renderOasOperationPreview(data.api.file, data.api.operationId);
  } else {
    try {
      const { sources, modules } = loadCustomBlocks(DOCS_ROOT);
      const compiled = compile(content, { components: sources });
      const mod = run(compiled, { components: modules });

      // Suppress React warnings about class vs className from raw HTML in markdown
      const origError = console.error;
      console.error = (...args) => {
        if (typeof args[0] === 'string' && args[0].includes('Invalid DOM property')) return;
        origError.apply(console, args);
      };
      html = renderToStaticMarkup(React.createElement(mod.default));
      console.error = origError;
    } catch {
      html = `<p><em>Error rendering MDX. Raw content below:</em></p><pre>${content.replace(/</g, '&lt;')}</pre>`;
    }
  }

  return {
    title: data.title || slug,
    excerpt: data.excerpt || '',
    html,
  };
}

/**
 * Render a small HTML preview of one OAS operation — method badge, path,
 * description, and parameter list. Not a full interactive API reference
 * (production ReadMe handles that); just enough so dev server pages show
 * something meaningful instead of a blank body.
 */
function renderOasOperationPreview(specFile, operationId) {
  const specPath = path.join(DOCS_ROOT, 'reference', specFile);
  if (!fs.existsSync(specPath)) {
    return `<p><em>OAS spec not found: <code>reference/${specFile}</code></em></p>`;
  }

  let spec;
  try {
    const rawSpec = fs.readFileSync(specPath, 'utf-8');
    spec = specFile.toLowerCase().endsWith('.json') ? JSON.parse(rawSpec) : yaml.load(rawSpec);
  } catch (e) {
    return `<p><em>Couldn't parse <code>reference/${specFile}</code>: ${escapeHtml(e.message)}</em></p>`;
  }

  let found = null;
  for (const [pathKey, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(pathItem || {})) {
      if (op && typeof op === 'object' && op.operationId === operationId) {
        found = { method: method.toUpperCase(), path: pathKey, op };
      }
    }
  }
  if (!found) {
    return `<p><em>Operation <code>${escapeHtml(operationId)}</code> not found in <code>${escapeHtml(specFile)}</code>.</em></p>`;
  }

  const { method, path: opPath, op } = found;
  const methodColor = {
    GET: '#22c55e', POST: '#3b82f6', PUT: '#f59e0b', PATCH: '#a855f7', DELETE: '#ef4444',
  }[method] || '#6b7280';

  const parts = [];
  parts.push(
    `<div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem;">` +
    `<span style="background: ${methodColor}; color: white; padding: 0.15rem 0.5rem; border-radius: 0.25rem; font-family: monospace; font-weight: 600; font-size: 0.85rem;">${method}</span>` +
    `<code style="font-size: 1rem;">${escapeHtml(opPath)}</code>` +
    `</div>`,
  );
  if (op.description) parts.push(`<p>${escapeHtml(op.description)}</p>`);

  if (Array.isArray(op.parameters) && op.parameters.length > 0) {
    parts.push(`<h2>Parameters</h2>`);
    parts.push(`<ul>`);
    for (const p of op.parameters) {
      const name = p.name || '(unnamed)';
      const where = p.in ? ` <code style="color: #6b7280;">(${p.in})</code>` : '';
      const required = p.required ? ' <strong>required</strong>' : '';
      const desc = p.description ? ` — ${escapeHtml(p.description)}` : '';
      parts.push(`<li><code>${escapeHtml(name)}</code>${where}${required}${desc}</li>`);
    }
    parts.push(`</ul>`);
  }

  if (op.responses && typeof op.responses === 'object') {
    parts.push(`<h2>Responses</h2>`);
    parts.push(`<ul>`);
    for (const [status, resp] of Object.entries(op.responses)) {
      const desc = resp?.description ? ` — ${escapeHtml(resp.description)}` : '';
      parts.push(`<li><code>${escapeHtml(status)}</code>${desc}</li>`);
    }
    parts.push(`</ul>`);
  }

  parts.push(
    `<hr style="margin: 2rem 0; border: 0; border-top: 1px solid #e5e7eb;">`,
    `<p style="color: #6b7280; font-size: 0.875rem;"><em>Local preview rendered from the OAS spec. Full interactive API reference (try-it-out, request/response schemas, auth) renders when imported into ReadMe.</em></p>`,
  );

  return parts.join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function findFirstHref(items) {
  for (const item of items) {
    if (item.href) return item.href;
    if (item.children?.length) {
      const found = findFirstHref(item.children);
      if (found) return found;
    }
  }
  return null;
}

export function getFirstPageHref() {
  const sidebar = collectSidebar();
  return findFirstHref(sidebar);
}
