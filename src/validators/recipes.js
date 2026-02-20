import matter from 'gray-matter';

export const name = 'recipes';

/**
 * Parse fenced code blocks from the body. Returns an array of
 * { lang, title, lines } where lang is the language identifier.
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
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    blocks.push({ lang, title, lines });
  }
  return blocks;
}

/**
 * Parse snippet references from the body.
 * Canonical format from ReadMe's parser: <!-- language@lineSpec -->
 * where lineSpec is 1-indexed: "1", "1-5", "1-5,10,15-20"
 * Regex sourced from packages/api/src/mappings/recipe/util.ts
 */
function parseSnippetRefs(body) {
  const refs = [];
  const pattern = /<!--\s*([\w-]+)@(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)?\s*-->/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    refs.push({
      lang: match[1],
      lineSpec: match[2] || '',
      raw: match[0],
    });
  }
  return refs;
}

/**
 * Parse a 1-indexed line spec and return the max line number (1-indexed).
 * Handles: "1", "2-8", "1-5,10,15-20"
 */
function maxLineFromSpec(lineSpec) {
  if (!lineSpec) return 0;
  let max = 0;
  for (const part of lineSpec.split(',')) {
    const nums = part.split('-').map(Number);
    for (const n of nums) {
      if (n > max) max = n;
    }
  }
  return max;
}

/**
 * Parse h1 headings from the body.
 */
function parseSections(body) {
  const sections = [];
  const pattern = /^# (.+)$/gm;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    sections.push(match[1]);
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

  if (!data.recipe) return null;

  const codeBlocks = parseCodeBlocks(body);
  const snippetRefs = parseSnippetRefs(body);
  const sections = parseSections(body);

  const blocksByLang = new Map();
  for (const block of codeBlocks) {
    blocksByLang.set(block.lang, block);
  }

  if (codeBlocks.length === 0) {
    results.push({
      file: relativePath,
      rule: name,
      severity: 'warning',
      message: 'No code blocks: recipe has no code snippets defined',
    });
  }

  if (sections.length === 0) {
    results.push({
      file: relativePath,
      rule: name,
      severity: 'warning',
      message: 'No sections: recipe has no step headings (# Heading)',
    });
  }

  for (const ref of snippetRefs) {
    const block = blocksByLang.get(ref.lang);

    if (!block) {
      const available = codeBlocks.map((b) => b.lang).join(', ');
      results.push({
        file: relativePath,
        rule: name,
        message: `Unknown snippet language: "${ref.lang}" does not match any code block${available ? ` (available: ${available})` : ''}`,
      });
      continue;
    }

    // Line spec is 1-indexed, so max line must be <= total lines.
    const maxLine = maxLineFromSpec(ref.lineSpec);
    if (maxLine > block.lines.length) {
      results.push({
        file: relativePath,
        rule: name,
        severity: 'warning',
        message: `Snippet out of range: "${ref.raw}" references line ${maxLine} but "${ref.lang}" block has only ${block.lines.length} lines`,
      });
    }
  }

  return results.length > 0 ? results : null;
}
