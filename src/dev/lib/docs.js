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

function walkDir(dirPath, sectionDir) {
  if (!fs.existsSync(dirPath)) return [];

  // Read _order.yaml for ordering
  let order = [];
  const orderPath = path.join(dirPath, '_order.yaml');
  if (fs.existsSync(orderPath)) {
    order = yaml.load(fs.readFileSync(orderPath, 'utf-8')) || [];
  }

  // Get all items (exclude dotfiles and _-prefixed files)
  const items = fs.readdirSync(dirPath).filter(f => !f.startsWith('.') && !f.startsWith('_'));

  const mdFiles = new Set(items.filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')));
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
      const children = walkDir(path.join(dirPath, name), sectionDir);

      // ReadMeConfig pages are internal — show them without a group header
      if (name === 'ReadMeConfig') {
        entries.push(...children);
        continue;
      }

      // Check for index.md inside directory (parent page pattern)
      const indexPath = path.join(dirPath, name, 'index.md');
      let title = name;
      let href = null;
      if (fs.existsSync(indexPath)) {
        const { data } = matter(fs.readFileSync(indexPath, 'utf-8'));
        title = data.title || name;
        href = `/${sectionDir}/${encodeURIComponent(name)}`;
      }

      entries.push({ title, href, children });
    } else if (isMd) {
      const filePath = path.join(dirPath, `${name}.md`);
      const { data } = matter(fs.readFileSync(filePath, 'utf-8'));
      const linkUrl = data.link?.url;
      entries.push({
        title: data.title || name,
        href: linkUrl || `/${sectionDir}/${encodeURIComponent(name)}`,
        external: !!linkUrl,
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

  return {
    title: data.title || slug,
    excerpt: data.excerpt || '',
    html,
  };
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
