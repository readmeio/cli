import path from 'node:path';
import matter from 'gray-matter';

export const name = 'recipes';

/**
 * Parse fenced code blocks from the body. Returns an array of
 * { lang, title, lines, startIndex } where lang is the language identifier.
 * Code blocks have the format: ```lang OptionalTitle
 */
function parseCodeBlocks(body) {
  const blocks = [];
  const pattern = /^```(\S+)(?:\s+(.+))?\n([\s\S]*?)^```$/gm;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const lang = match[1];
    const title = match[2] || null;
    const code = match[3];
    const lines = code.split('\n');
    // Remove trailing empty line from the split (code ends with \n before ```)
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    blocks.push({ lang, title, lines, startIndex: match.index });
  }
  return blocks;
}

/**
 * Parse snippet references from the body.
 * Format: <!-- lang@lineSpec --> where lineSpec can be:
 *   - "1" or "2-8" (1-indexed)
 *   - "L0-L4,L6" (0-indexed with L prefix)
 */
function parseSnippetRefs(body) {
  const refs = [];
  const pattern = /<!--\s*(\S+?)@(\S+?)\s*-->/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    refs.push({
      lang: match[1],
      lineSpec: match[2],
      raw: match[0],
      index: match.index,
    });
  }
  return refs;
}

/**
 * Parse a line spec and return the max line number referenced (0-indexed).
 * Handles: "1", "2-8", "L0-L4,L6", "L0-L4,L6"
 */
function maxLineFromSpec(lineSpec) {
  let maxLine = 0;

  // Split on commas for multi-range specs.
  const parts = lineSpec.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    // Strip leading "L" if present.
    const clean = trimmed.replace(/^L/i, '');
    const rangeParts = clean.split('-').map((s) => s.replace(/^L/i, ''));

    for (const r of rangeParts) {
      const n = parseInt(r, 10);
      if (!Number.isNaN(n)) {
        // If the spec uses L prefix, lines are 0-indexed; otherwise 1-indexed.
        const zeroIndexed = trimmed.startsWith('L') || trimmed.startsWith('l') ? n : n - 1;
        if (zeroIndexed > maxLine) maxLine = zeroIndexed;
      }
    }
  }

  return maxLine;
}

/**
 * Parse h1 headings from the body.
 */
function parseSections(body) {
  const sections = [];
  const pattern = /^# (.+)$/gm;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    sections.push({ title: match[1], index: match.index });
  }
  return sections;
}

export function validate({ content, relativePath }) {
  if (!relativePath.startsWith('recipes/')) return null;
  if (!relativePath.endsWith('.md')) return null;

  const results = [];
  let data;
  let body;

  try {
    ({ data, content: body } = matter(content));
  } catch {
    return null;
  }

  // Skip non-recipe files (like index.md or files without recipe frontmatter).
  if (!data.recipe) return null;

  const codeBlocks = parseCodeBlocks(body);
  const snippetRefs = parseSnippetRefs(body);
  const sections = parseSections(body);

  // Build a map of language -> code block.
  const blocksByLang = new Map();
  for (const block of codeBlocks) {
    blocksByLang.set(block.lang, block);
  }

  // Check: recipe should have at least one code block.
  if (codeBlocks.length === 0) {
    results.push({
      file: relativePath,
      rule: name,
      severity: 'warning',
      message: 'No code blocks: recipe has no code snippets defined',
    });
  }

  // Check: recipe should have at least one section.
  if (sections.length === 0) {
    results.push({
      file: relativePath,
      rule: name,
      severity: 'warning',
      message: 'No sections: recipe has no step headings (# Heading)',
    });
  }

  // Check snippet references.
  for (const ref of snippetRefs) {
    const block = blocksByLang.get(ref.lang);

    if (!block) {
      // Find available languages for a helpful message.
      const available = codeBlocks.map((b) => b.lang).join(', ');
      results.push({
        file: relativePath,
        rule: name,
        message: `Unknown snippet language: "${ref.lang}" does not match any code block${available ? ` (available: ${available})` : ''}`,
      });
      continue;
    }

    // Check line range is within the code block.
    const maxLine = maxLineFromSpec(ref.lineSpec);
    if (maxLine >= block.lines.length) {
      results.push({
        file: relativePath,
        rule: name,
        severity: 'warning',
        message: `Snippet out of range: "${ref.raw}" references line ${maxLine + 1} but "${ref.lang}" block has only ${block.lines.length} lines`,
      });
    }
  }

  return results.length > 0 ? results : null;
}
