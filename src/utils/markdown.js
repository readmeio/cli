import { CORE_SCHEMA, YAMLException, dump as dumpYAML, load as loadYAML } from 'js-yaml';
import removeUndefinedObjects from 'remove-undefined-objects';

// Each retry rewrites one rejected line and parses again. A real page has a few of these.
// Ten parses bounds a frontmatter block full of broken lines.
const MAX_FRONTMATTER_YAML_ATTEMPTS = 10;

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const FRONTMATTER_NOEND_RE = /^---\s*\r?\n([\s\S]*)$/;

// A mapping entry whose value is still a plain scalar: `description: POST : PATCH`.
// `:[ \t]` matches PLAIN_SCALAR_COLON: space or tab ends a plain scalar.
const PLAIN_MAPPING_VALUE = /^(\s*)([^\s:#][^:\n]*?)(:[ \t]+)(\S.*)$/;
const PLAIN_SCALAR_COLON = /:[ \t]/;

function removeNullValues(obj) {
  // Check if obj is not an object or is null, return it directly
  if (typeof obj !== 'object' || obj === null) return obj;

  // Array handling
  if (Array.isArray(obj)) {
    return obj.map(removeNullValues).filter(item => item !== null);
  }

  // Object handling
  const result = {};
  for (const key in obj) {
    if (Object.hasOwn(obj, key)) {
      const value = removeNullValues(obj[key]);
      if (value !== null) {
        result[key] = value;
      }
    }
  }

  return result;
}

// This function takes a JSON object and sorts it:
// First, any key in customOrder
// Second, alphabetically
//
function sortFrontmatterObj(obj, customOrder = []) {
  const sortedObj = {};

  // Helper function to check if a value is an object
  const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

  // Add keys in the custom order first
  customOrder.forEach(key => {
    if (key in obj) {
      sortedObj[key] = isObject(obj[key]) ? sortFrontmatterObj(obj[key], customOrder) : obj[key];
    }
  });

  // Add the rest of the keys in alphabetical order
  Object.keys(obj)
    .sort()
    .forEach(key => {
      if (!customOrder.includes(key)) {
        sortedObj[key] = isObject(obj[key]) ? sortFrontmatterObj(obj[key], customOrder) : obj[key];
      }
    });

  return sortedObj;
}

/**
 * Quote one plain mapping value that contains `:` followed by space or tab. Returns null when the
 * line is any other shape. A trailing ` #…` stays a comment outside the quotes.
 *
 */
function quoteUnquotedColonValue(line) {
  const carriageReturn = line.endsWith('\r') ? '\r' : '';
  const source = carriageReturn ? line.slice(0, -1) : line;
  const match = PLAIN_MAPPING_VALUE.exec(source);
  if (!match) return null;

  const [, indent, key, separator, value] = match;
  if (/^['"|>[{*]/.test(value)) return null;

  // A YAML comment starts at `#` after a space or tab. Other whitespace, including a
  // non-breaking space, is part of the value.
  const commentAt = value.search(/[ \t]+#/);
  const scalar = commentAt === -1 ? value : value.slice(0, commentAt);
  const comment = commentAt === -1 ? '' : value.slice(commentAt);
  if (!PLAIN_SCALAR_COLON.test(scalar)) return null;

  return `${indent}${key}${separator}'${scalar.replaceAll("'", "''")}'${comment}${carriageReturn}`;
}

/**
 * Parse frontmatter YAML. When a plain value contains `:` + whitespace, quote the line js-yaml
 * rejected and parse again. Gives up after {@link MAX_FRONTMATTER_YAML_ATTEMPTS} parses.
 *
 */
function loadFrontmatterYAML(yamlContent) {
  let source = yamlContent;
  const quotedLines = new Set();

  for (let attempt = 0; ; attempt++) {
    try {
      return loadYAML(source, { schema: CORE_SCHEMA });
    } catch (err) {
      const line =
        err instanceof YAMLException && err.reason === 'bad indentation of a mapping entry'
          ? err.mark?.line
          : undefined;
      if (line === undefined || quotedLines.has(line) || attempt >= MAX_FRONTMATTER_YAML_ATTEMPTS - 1) {
        throw err;
      }

      const lines = source.split('\n');
      const repaired = quoteUnquotedColonValue(lines[line] ?? '');
      if (repaired === null) throw err;

      quotedLines.add(line);
      lines[line] = repaired;
      source = lines.join('\n');
    }
  }
}

/**
 * Parse frontmatter from markdown content. Extracts YAML frontmatter between --- delimiters.
 *
 */
export function parseFrontmatter(content) {
  // Strip BOM (Byte Order Mark) if present
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  // Allow frontmatter to be preceded by blank lines (common in hand-edited docs)
  const stripped = withoutBom.replace(/^[\r\n]+/, '');

  // Check if content starts with ---
  if (!stripped.startsWith('---')) {
    return { content: withoutBom, data: {} };
  }

  // If the character after --- is also -, then it's not a delimiter (e.g., -----)
  if (stripped.length > 3 && stripped[3] === '-') {
    return { content: stripped, data: {} };
  }

  // Normalize CRLF (and bare CR) so Windows-saved docs parse like LF files
  const normalized = stripped.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Try to match frontmatter with closing delimiter first
  // Matches: ---\n...content...\n---
  // The newline after the closing --- is optional but only one newline is consumed
  let match = normalized.match(FRONTMATTER_RE);
  let yamlContent;
  let body;

  if (match) {
    // Found frontmatter with closing delimiter
    yamlContent = match[1];
    body = match[2] || '';
  } else {
    // Try to match frontmatter without closing delimiter
    // Matches: ---\n...content... (until end of string)
    match = normalized.match(FRONTMATTER_NOEND_RE);
    if (match) {
      yamlContent = match[1];
      body = '';
    } else {
      // No valid frontmatter found
      return { content: normalized, data: {} };
    }
  }

  try {
    const parsed = loadFrontmatterYAML(yamlContent);

    // If the parsed YAML is not an object (e.g., a string, number, boolean),
    // return an empty object for the data, matching gray-matter's behavior
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { content: body, data: {} };
    }

    return { content: body, data: parsed };
  } catch {
    return { content: body, data: {} };
  }
}

/**
 * Convert a given object into a frontmatter string. When `body` is provided, append it after the
 * closing fence (same shape as gray-matter's `stringify`).
 *
 * @see {@link https://jekyllrb.com/docs/front-matter/}
 */
export function toFrontmatter(data, body = '') {
  if (data === null) {
    return body || '';
  }

  // Remove all `null` data from our Frontmatter and then remove any objects that may be undefined.
  // This'll help prevent us from creating empty properties there like `metadata: {}` which
  // wouldn't look very nice.
  let sanitized = removeNullValues(data);
  sanitized = removeUndefinedObjects(sanitized);
  if (sanitized === undefined) {
    return body || '';
  }

  // Converting an empty object into YAML will create `{}`, which putting into frontmatter will
  // become invalid so if we don't have any data don't create anything.
  if (
    typeof sanitized === 'object' &&
    !Array.isArray(sanitized) &&
    sanitized !== null &&
    !Object.keys(sanitized).length
  ) {
    return body || '';
  }

  const sorted = sortFrontmatterObj(sanitized, ['title', 'excerpt', 'description']);
  const yaml = dumpYAML(sorted);
  const fence = `---\n${yaml}---`;

  return body ? `${fence}\n${body}` : fence;
}
