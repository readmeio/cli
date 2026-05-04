/**
 * Prompts used by the `import` command to organize a scraped or llms.txt-derived
 * documentation site into a category/page hierarchy. Exposed as a stable public
 * API so other tools can reuse the exact prompts without depending on the CLI's
 * runtime — bring your own model client and call `runJsonQuery`-equivalent
 * yourself.
 *
 * Each prompt is exposed three ways:
 *   - `<name>SystemPrompt`        — the static system prompt string
 *   - `build<Name>UserPrompt(in)` — builds the dynamic user prompt for a given input
 *   - `<name>Prompt(input)`       — convenience wrapper returning { systemPrompt, userPrompt }
 *
 * Inputs use plain JS shapes documented per builder. They intentionally avoid
 * importing anything else from this package so the prompts module stays
 * dependency-free at runtime.
 */

// ─── slotOrphans ─────────────────────────────────────────────────────────────

export const slotOrphansSystemPrompt = [
  'You assign orphan documentation pages to existing categories.',
  'Output ONLY a valid JSON array of integers — one per orphan page, in order.',
  'Each integer is the category index (0-based) the orphan belongs in, or -1 if none fit.',
  '',
  'Example output: [0, 2, 0, 1, -1, 3]',
  '',
  'Guidance:',
  '- Choose the best semantic fit based on the orphan\'s title and URL path.',
  '- Only use -1 when no existing category is plausible.',
].join('\n');

/**
 * @param {object}   input
 * @param {Array<{ title: string, pages?: Array<{ title: string }> }>} input.categories
 * @param {Array<{ title: string, url: string }>} input.orphans
 * @returns {string}
 */
export function buildSlotOrphansUserPrompt({ categories, orphans }) {
  const catList = categories.map((c, i) => {
    const sample = (c.pages || []).slice(0, 3).map((p) => p.title).join(', ');
    return `${i}. ${c.title}${sample ? ` (e.g. ${sample})` : ''}`;
  });

  const orphanList = orphans.map((p, i) => {
    let relPath = p.url;
    try { relPath = new URL(p.url).pathname; } catch {}
    return `${i}. ${p.title} — ${relPath}`;
  });

  return [
    'Categories:',
    ...catList,
    '',
    `${orphans.length} orphan pages to slot:`,
    ...orphanList,
    '',
    `Output a JSON array of ${orphans.length} integers, one per orphan in order (category index 0..${categories.length - 1}, or -1 for none).`,
  ].join('\n');
}

export function slotOrphansPrompt(input) {
  return {
    systemPrompt: slotOrphansSystemPrompt,
    userPrompt: buildSlotOrphansUserPrompt(input),
  };
}

// ─── iconizeNav ──────────────────────────────────────────────────────────────

export const iconizeNavSystemPrompt = [
  'You assign one FontAwesome Free Solid icon to each documentation category.',
  'Output ONLY a valid JSON array of icon name strings, one per input category, in order.',
  'Use the icon name only (no "fa-" prefix, no object wrapper).',
  '',
  'Example output: ["rocket", "book", "code", "gear"]',
].join('\n');

/**
 * @param {object} input
 * @param {Array<{ title: string }>} input.categories
 * @returns {string}
 */
export function buildIconizeNavUserPrompt({ categories }) {
  return [
    `${categories.length} categories:`,
    '',
    ...categories.map((c, i) => `${i}. ${c.title}`),
    '',
    'Return a JSON array of FontAwesome icon names, one per category, in order.',
  ].join('\n');
}

export function iconizeNavPrompt(input) {
  return {
    systemPrompt: iconizeNavSystemPrompt,
    userPrompt: buildIconizeNavUserPrompt(input),
  };
}

// ─── organizeFromSections ────────────────────────────────────────────────────

export const organizeFromSectionsSystemPrompt = [
  'You assign a FontAwesome Free Solid icon to each documentation section, and lightly polish the section title.',
  'Output ONLY a valid JSON array — no prose, no markdown, no code fences.',
  '',
  'Schema:',
  '[',
  '  { "title": "<lightly polished Title Case, 1-4 words>", "icon": "<fontawesome icon name, no fa- prefix>" },',
  '  ...',
  ']',
  '',
  'Rules:',
  '- Return exactly one entry per input section, in the same order.',
  '- Keep the original title unless it clearly benefits from Title Case fixes; do not rename for topic/tone.',
  '- Pick an icon that semantically fits the section (e.g. rocket for Getting Started, code for API, plug for Integrations).',
].join('\n');

/**
 * @param {object} input
 * @param {string|null|undefined} input.siteTitle
 * @param {Array<{ title: string, items: Array<unknown> }>} input.sections
 * @returns {string}
 */
export function buildOrganizeFromSectionsUserPrompt({ siteTitle, sections }) {
  return [
    `Site title: ${siteTitle || '(unknown)'}`,
    `${sections.length} sections:`,
    '',
    ...sections.map((s, i) => `${i}. ${s.title} (${s.items.length} pages)`),
    '',
    'Output the JSON array now.',
  ].join('\n');
}

export function organizeFromSectionsPrompt(input) {
  return {
    systemPrompt: organizeFromSectionsSystemPrompt,
    userPrompt: buildOrganizeFromSectionsUserPrompt(input),
  };
}

// ─── organizeFromScratch ─────────────────────────────────────────────────────

export const organizeFromScratchSystemPrompt = [
  'You organize documentation pages into a category hierarchy for a ReadMe-style docs site.',
  'Output ONLY a valid JSON object that matches the schema below — no prose, no markdown, no code fences.',
  '',
  'Schema:',
  '{',
  '  "title": "<short site or doc title>",',
  '  "categories": [',
  '    {',
  '      "title": "<Title Case, 1-4 words>",',
  '      "icon": "<FontAwesome solid icon name, e.g. rocket, book, code, gear, plug, key, chart-line>",',
  '      "pageIds": [<integer id from the input list>, ...]',
  '    }',
  '  ]',
  '}',
  '',
  'Rules:',
  '- Refer to pages by their integer `id` only — do NOT echo back titles, urls, or descriptions. The caller reconstructs full page data from the ids.',
  '- If the input sections look meaningful, use them as category starting points; merge or rename ones that are redundant, too-broad, or generic (e.g. "Resources", "English", "Root URL").',
  '- If the input sections are not useful, invent good categories from page titles and URLs.',
  '- Every category MUST include a FontAwesome Free Solid icon name that semantically fits the category theme. Use the icon name only (no "fa-" prefix).',
  '- Every input page id MUST appear in exactly one category. Do not drop or duplicate ids.',
  '- Keep category titles human-readable, Title Case, 1-4 words.',
].join('\n');

/**
 * @param {object} input
 * @param {string|null|undefined} input.siteTitle
 * @param {Array<{ title: string, url: string, description?: string }>} input.items
 *        Pre-flattened page list. The id used in the prompt is the array index.
 * @returns {string}
 */
export function buildOrganizeFromScratchUserPrompt({ siteTitle, items }) {
  const compactLines = items.map((it, idx) => {
    let relPath = it.url;
    try { relPath = new URL(it.url).pathname + new URL(it.url).search; } catch {}
    return `${idx}\t${it.title}\t${relPath}`;
  });

  let origin = '(unknown)';
  if (items.length > 0) {
    try { origin = new URL(items[0].url).origin; } catch {}
  }

  return [
    `Site title: ${siteTitle || '(unknown)'}`,
    `Origin: ${origin}`,
    `${items.length} pages to organize. Each line below is: \`id\\ttitle\\tpath\`.`,
    '',
    ...compactLines,
    '',
    `Output the organized JSON object now. Reference pages by \`pageIds\` (integers 0..${items.length - 1}) — do not echo page data back.`,
  ].join('\n');
}

export function organizeFromScratchPrompt(input) {
  return {
    systemPrompt: organizeFromScratchSystemPrompt,
    userPrompt: buildOrganizeFromScratchUserPrompt(input),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip leading/trailing markdown code fences from a model response so the
 * remaining text can be passed straight to JSON.parse. Models occasionally
 * wrap output in ```json … ``` even when told not to.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripCodeFences(text) {
  return String(text).trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}
