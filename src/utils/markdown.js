import { YAMLException, dump as dumpYAML, load as loadYAML } from 'js-yaml';
import removeUndefinedObjects from 'remove-undefined-objects';

// Each retry rewrites one rejected line and parses again. A real page has a few of these.
// Ten parses bounds a frontmatter block full of broken lines.
const MAX_FRONTMATTER_YAML_ATTEMPTS = 10;

// Opening fence, optional YAML (must end with a newline when present), closing fence, body.
// The YAML group is optional so empty headers (`---\n---\n# Body`) still yield the body.
const FRONTMATTER_RE = /^---\s*\r?\n(?:([\s\S]*?)\r?\n)?---\r?\n?([\s\S]*)$/;
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
      return loadYAML(source);
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
 * On YAML failure returns `{ content, data: {}, error }` so callers can soft-fail or report.
 * This function does not throw for invalid YAML.
 *
 */
export function parseFrontmatter(content) {
  // Strip BOM (Byte Order Mark) if present. Non-frontmatter paths always return this string.
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  // Allow frontmatter to be preceded by blank lines (common in hand-edited docs)
  const stripped = withoutBom.replace(/^[\r\n]+/, '');

  // Not frontmatter: keep the original (minus BOM), including leading blank lines
  if (!stripped.startsWith('---') || (stripped.length > 3 && stripped[3] === '-')) {
    return { content: withoutBom, data: {} };
  }

  // Normalize CRLF (and bare CR) so Windows-saved docs parse like LF files
  const normalized = stripped.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  let match = normalized.match(FRONTMATTER_RE);
  let yamlContent;
  let body;

  if (match) {
    // Group 1 is absent for empty headers (`---\n---`).
    yamlContent = match[1] ?? '';
    body = match[2] || '';
  } else {
    match = normalized.match(FRONTMATTER_NOEND_RE);
    if (!match) {
      return { content: withoutBom, data: {} };
    }
    yamlContent = match[1];
    body = '';
  }

  // Empty / whitespace-only frontmatter is valid → empty data, no error
  if (!yamlContent.trim()) {
    return { content: body, data: {} };
  }

  try {
    const parsed = loadFrontmatterYAML(yamlContent);

    // Non-object YAML (string, number, boolean, array) → empty data
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { content: body, data: {} };
    }

    return { content: body, data: parsed };
  } catch (err) {
    return { content: body, data: {}, error: err };
  }
}

/**
 * Guard for write paths. Returns an Error when {@link parseFrontmatter} could not load YAML so
 * callers never rewrite a page from empty `data`. Returns `null` when the parse is safe to write.
 *
 */
export function frontmatterWriteError(parsed) {
  if (!parsed?.error) return null;
  const detail = parsed.error.reason || parsed.error.message || 'unknown error';
  return new Error(`Invalid frontmatter: ${detail}`, { cause: parsed.error });
}

/**
 * Convert a given object into a frontmatter string. When `body` is provided, append it after the
 * closing fence.
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
