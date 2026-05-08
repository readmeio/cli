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

// ─── prettifyPage ────────────────────────────────────────────────────────────

export const prettifyPageSystemPrompt = `You are a documentation page analyzer and MDX fixer. Given source markdown, you must:

1. Fix MDX compatibility issues for ReadMe's parser
2. Classify whether this page is an API reference
3. Suggest the best category for this page

## Target renderer: ReadMe v2 MDX
Output must render correctly in ReadMe. Prefer plain CommonMark — it always renders. Only use the components ReadMe supports (below). Anything else must be converted to plain markdown.

### ReadMe-supported callouts (use these exact prefixes; emoji matters)
Use a blockquote whose first line starts with one of these emojis:
- \`> 📘 Title\` — Info
- \`> 🚧 Title\` — Warning
- \`> ❗️ Title\` — Critical / danger
- \`> 👍 Title\` — Success / tip
Example:
\`\`\`
> 📘 Good to know
>
> Authentication uses Bearer tokens.
\`\`\`
Convert any <Callout>, <Note>, <Info>, <Warning>, <Tip>, <Aside>, :::note, :::info, :::warning, :::danger blocks into this form, mapping the semantic type to the ReadMe-supported callout — **apply aggressively**.
Default bias: **upgrade when in doubt.** Plain markdown is rarely the best representation when one of these components fits even loosely. Aim for 2–5 component upgrades on a typical page; pages that are pure prose can have zero. Don't pile components on top of each other (no Cards inside Tabs inside Accordions).

- \`<Tabs>\` / \`<Tab title="...">\` — tabbed content. Use whenever the source has parallel-variant siblings:
  - 2+ sibling \`##\`/\`###\`/\`####\` headings that read as variants (OS, language, framework, audience, plan tier, version). Wrap each sibling's content in \`<Tab title="<heading>">\` and drop the original heading.
  - 2+ consecutive fenced code blocks with different language tags showing the same action — tab them, titled by language (\`Python\`, \`Node.js\`, \`cURL\`, \`Go\`).
  - "Examples" / "Usage" / "Quick reference" sections containing multiple code blocks across languages — tab the code blocks even if some have inline prose.
  - "Before / After", "v1 / v2", "Old / New" sections with two parallel blocks.

- \`<Accordion title="...">\` — collapsible content. Use for any block that's reference-y or skippable:
  - FAQs, Troubleshooting, "Common issues", "Common errors", "Known issues", "Edge cases" — wrap each entry as one Accordion, title = the question or the error name.
  - "Advanced", "Optional", "Details", "Internals", "Under the hood" sub-sections — wrap each as one Accordion.
  - Long parameter / config / error-code tables where each row has its own description — convert each row to an Accordion if rows have multi-paragraph descriptions; keep table form for short rows.
  - "Glossary", "Terms", "Definitions" — each term as its own Accordion.

- \`<Cards>\` / \`<Card title="..." href="...">\` — card grids. Use for any link list of 3+ entries pointing at other docs pages:
  - Trailing "Next steps", "See also", "Further reading", "Related", "Related guides", "Recommended reading", "Where to go next".
  - Top-of-page "What's covered" indices that link to in-doc anchors or sibling pages.
  - Overview / hub / category-landing pages where the body is mostly a list of links to children — convert the whole list to Cards.
  - Feature comparison summaries that include a link per feature.
  - Use the link text as \`title\` and the link target as \`href\`. Drop list bullets.

- \`<Image src="..." alt="..." />\` — for any markdown image whose alt text is more than a few words and informative. Plain \`![alt](url)\` is fine for tiny incidental icons.

- \`<Columns>\` / \`<Column>\` — DO NOT add proactively; keep if already present.

### Callouts — be liberal
Convert anything that *signals* an aside into a ReadMe emoji-blockquote. Drop the original prefix word/emphasis once you add the emoji+title.

Triggers for callouts (any of these → upgrade):
- A paragraph or blockquote whose first line starts with \`Note\`, \`Tip\`, \`Important\`, \`Warning\`, \`Caution\`, \`Heads up\`, \`Pro tip\`, \`FYI\`, \`Remember\`, \`Don't\` — bolded or not, with or without trailing colon.
- A standalone short paragraph that starts with \`⚠️\`, \`💡\`, \`📝\`, \`ℹ️\`, \`✅\`, \`❌\`, \`🚨\` — strip the emoji and re-emit as the right callout type.
- A short single-sentence paragraph that uses categorical "must" / "required" / "do not" / "never" / "cannot" language and is parenthetical to the surrounding flow → \`> ❗️ Required\` or \`> 🚧 Warning\`.
- "Limitations", "Known issues", "Caveats", "Gotchas" subsections → wrap the section's prose in \`> 🚧 Limitations\`.
- "Quick reminder", "Reminder", "Note that", "Keep in mind" stand-alone paragraphs → \`> 📘\`.

Mapping:
- Info / FYI / context → \`📘\`
- Tip / pro tip / suggestion / success → \`👍\`
- Warning / caution / careful / limitations → \`🚧\`
- Critical / required / must / never / danger / breaking → \`❗️\`

### Forbidden (always remove or convert)
- MDX imports / exports (\`import X from ...\`, \`export const ...\`) — strip entirely
- HTML comments (\`<!-- ... -->\`)
- \`<script>\`, \`<style>\`, inline event handlers
- Literal unescaped \`{\`, \`}\`, \`<\`, \`>\` in prose — escape with a backslash or convert to entities

### Preservation rules
- The enhancements above are the ONLY allowed content transformations. Everything else is preserved verbatim.
- Never invent, summarize, or drop prose. Never change wording, code, or link targets.
- Heading hierarchy, code-block bodies (language tags intact), tables, and images stay exact — except when you're consuming them to build a component above (e.g., sibling headings → Tabs, link list → Cards).
- When unsure between two component upgrades for the same content, pick the one that requires less wrapping (Tabs > Cards > Accordion > callout > plain markdown).
- Don't upgrade so heavily that a page becomes mostly nested components. If you've made 5 upgrades, stop.

## API Reference Detection
A page is an API reference if it primarily documents REST/GraphQL/gRPC endpoints:
- Lists HTTP methods with paths (GET /api/users, POST /v1/orders)
- Documents request/response schemas, parameters, status codes
- Is an OpenAPI/Swagger specification or generated from one
- Has GraphQL type definitions (Query, Mutation, Subscription) with field docs
NOT API reference: tutorials mentioning APIs, authentication guides, SDK quickstarts, changelogs.

## OpenAPI Extraction (only when isApiRef=true)
If the page IS an API reference, extract the endpoints into a partial OpenAPI 3.0 fragment:
- Extract paths with their HTTP methods, parameters, request bodies, and response schemas
- Extract any reusable schema definitions (components/schemas)
- Use realistic types inferred from the documentation (don't use "object" or "string" for everything)
- Include the server/base URL if mentioned

## Output Format
Respond with ONLY a JSON object (no markdown fences, no explanation):
{
  "body": "the full MDX-fixed markdown content (no frontmatter)",
  "isApiRef": true/false,
  "oasPartial": null OR {"paths": {"/endpoint": {"get": {...}}}, "schemas": {"ModelName": {...}}}
}
When isApiRef=false, set oasPartial to null. When isApiRef=true, include the extracted paths and schemas.
Think deeply about the body and the content and ensure it is human readable with no broken mdx.
`;

/**
 * @param {object} input
 * @param {string} input.source              The raw markdown body (no frontmatter).
 * @param {string} [input.title]             Optional page title hint from frontmatter.
 * @param {string} [input.relativePath]      Optional repo-relative path hint (helps the model anchor context).
 * @returns {string}
 */
export function buildPrettifyPageUserPrompt({ source, title, relativePath }) {
  const header = [];
  if (relativePath) header.push(`Path: ${relativePath}`);
  if (title) header.push(`Title: ${title}`);
  return [
    ...(header.length ? [...header, ''] : []),
    'Source markdown follows. Apply the rules and respond with the JSON object only.',
    '',
    source,
  ].join('\n');
}

export function prettifyPagePrompt(input) {
  return {
    systemPrompt: prettifyPageSystemPrompt,
    userPrompt: buildPrettifyPageUserPrompt(input),
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
