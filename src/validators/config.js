import fs from 'node:fs';
import path from 'node:path';

import {
  BUILT_IN_KINDS,
  CONFIG_FILE,
  DECLARABLE_KINDS,
  DIRECTORY_KINDS,
  RESERVED_DIRECTORIES,
  SECTION_DIRECTORY_REGEX,
  SINGLETON_KINDS,
  isBuiltInDirectory,
  loadSections,
} from '../utils/sections.js';

export const name = 'config';

// Fields every `navigation` entry may carry, plus the one its kind points at.
const COMMON_KEYS = ['kind', 'name', 'hidden', 'icon'];
// The fields that say what an entry points at. Each belongs to certain kinds.
const TARGET_KEYS = ['directory', 'slug', 'url'];
// Custom pages are markdown or raw HTML.
const CUSTOM_PAGE_EXTENSIONS = ['md', 'mdx', 'html'];
const KNOWN_KINDS = [...DIRECTORY_KINDS, ...SINGLETON_KINDS, 'custom_pages', 'url'];

function targetKeyFor(kind) {
  if (DIRECTORY_KINDS.includes(kind)) return 'directory';
  if (kind === 'custom_pages') return 'slug';
  if (kind === 'url') return 'url';
  return null;
}

function isAbsoluteUrl(value) {
  try {
    return Boolean(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Top-level folders that are laid out like a section (they have an
 * `_order.yaml`) but that ReadMe doesn't know about, because nothing in
 * `_readme.yaml` declares them.
 */
function findUndeclaredSections(gitRoot, sections) {
  let entries;
  try {
    entries = fs.readdirSync(gitRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const known = new Set(sections.directories());
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(directory => !known.has(directory) && !isBuiltInDirectory(directory))
    .filter(directory => !RESERVED_DIRECTORIES.has(directory) && SECTION_DIRECTORY_REGEX.test(directory))
    .filter(directory => fs.existsSync(path.join(gitRoot, directory, '_order.yaml')))
    .sort();
}

/**
 * Validate `_readme.yaml`, the optional file that declares a project's
 * navigation and any sections beyond the built-in ones.
 *
 * A repo without the file is fine: it's how every repo looked before multiple
 * guides, and ReadMe falls back to the built-in sections.
 *
 * The checks mirror the ones ReadMe runs when the file is saved from the
 * dashboard. A file that arrives through git sync skips some of those (a
 * reserved or duplicated directory, a built-in declared as the wrong kind), so
 * this is the only place they get caught.
 *
 * One deliberate difference: ReadMe ignores the whole file when it holds a
 * property or kind it doesn't recognize, but the format can grow ahead of this
 * CLI, so anything this version merely doesn't know is a warning, not an error.
 */
export function validateAll(_files, gitRoot, { sections = loadSections(gitRoot) } = {}) {
  const results = [];
  const error = message => results.push({ file: CONFIG_FILE, rule: name, severity: 'error', message });
  const warning = message => results.push({ file: CONFIG_FILE, rule: name, severity: 'warning', message });

  for (const directory of findUndeclaredSections(gitRoot, sections)) {
    results.push({
      file: directory,
      rule: name,
      severity: 'warning',
      message: sections.exists
        ? `Undeclared section: "${directory}" has an _order.yaml but isn't declared in ${CONFIG_FILE}, so ReadMe will ignore it`
        : `Undeclared section: "${directory}" has an _order.yaml but there's no ${CONFIG_FILE} declaring it, so ReadMe will ignore it`,
    });
  }

  if (!sections.exists) return results;

  if (sections.error) {
    error(`Invalid ${CONFIG_FILE}: ${sections.error}`);
    return results;
  }

  const { config } = sections;

  for (const key of Object.keys(config)) {
    if (key !== 'navigation') {
      warning(
        `Unknown property: "${key}" isn't recognized by this version of the CLI (if ReadMe doesn't recognize it either, it ignores the whole file)`,
      );
    }
  }

  // ReadMe reads a file with no `navigation` as an empty one.
  if (config.navigation === undefined || config.navigation === null) return results;

  // ...and one whose `navigation` isn't a list the same way, which is never
  // what was meant.
  if (!Array.isArray(config.navigation)) {
    warning('Invalid navigation: "navigation" must be a list (ReadMe treats anything else as empty)');
    return results;
  }

  const directories = new Set();
  const customPageSlugs = new Set();
  const singletons = new Set();

  config.navigation.forEach((entry, index) => {
    const where = `navigation[${index}]`;

    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      error(`Invalid entry: ${where} must be an object with a "kind"`);
      return;
    }

    const { kind } = entry;
    if (typeof kind !== 'string' || !kind) {
      error(`Invalid entry: ${where} is missing a "kind"`);
      return;
    }
    if (!KNOWN_KINDS.includes(kind)) {
      warning(
        `Unknown kind: "${kind}" (${where}) isn't recognized by this version of the CLI (if ReadMe doesn't recognize it either, it ignores the whole file)`,
      );
      return;
    }

    const targetKey = targetKeyFor(kind);
    const allowed = targetKey ? [...COMMON_KEYS, targetKey] : COMMON_KEYS;
    for (const key of Object.keys(entry)) {
      if (allowed.includes(key)) continue;
      if (TARGET_KEYS.includes(key)) {
        // A real field, on a kind that can't carry it. ReadMe rejects the file.
        error(`Invalid entry: a "${kind}" entry can't have a "${key}" (${where})`);
      } else {
        warning(
          `Unknown property: "${key}" on a "${kind}" entry (${where}) isn't recognized by this version of the CLI (if ReadMe doesn't recognize it either, it ignores the whole file)`,
        );
      }
    }

    if (entry.name !== undefined && entry.name !== null && (typeof entry.name !== 'string' || !entry.name)) {
      error(`Invalid entry: "name" must be a non-empty string (${where})`);
    }
    if (entry.hidden !== undefined && entry.hidden !== null && typeof entry.hidden !== 'boolean') {
      error(`Invalid entry: "hidden" must be true or false (${where})`);
    }
    if (entry.icon !== undefined && entry.icon !== null && typeof entry.icon !== 'string') {
      error(`Invalid entry: "icon" must be a string (${where})`);
    }

    if (kind === 'custom_pages') {
      const { slug } = entry;
      if (typeof slug === 'number' || typeof slug === 'boolean') {
        // YAML reads a bare `404` or `true` as a number or boolean, not a slug.
        error(`Invalid entry: ${slug} must be wrapped in quotes to be used as a slug (${where})`);
      } else if (typeof slug !== 'string' || !slug) {
        error(`Invalid entry: a "custom_pages" entry needs a "slug" (${where})`);
      } else if (customPageSlugs.has(slug)) {
        error(`Duplicate entry: the "${slug}" custom page is listed more than once`);
      } else {
        customPageSlugs.add(slug);
        const exists = CUSTOM_PAGE_EXTENSIONS.some(ext =>
          fs.existsSync(path.join(gitRoot, 'custom_pages', `${slug}.${ext}`)),
        );
        if (!exists) {
          warning(`Missing page: "${slug}" is in the navigation but there's no custom_pages/${slug}.md (or .html)`);
        }
      }
      return;
    }

    if (kind === 'url') {
      if (typeof entry.url !== 'string' || !isAbsoluteUrl(entry.url)) {
        error(`Invalid entry: a "url" entry needs an absolute "url" (${where})`);
      }
      return;
    }

    if (SINGLETON_KINDS.includes(kind)) {
      if (singletons.has(kind)) error(`Duplicate entry: a "${kind}" entry may only appear once`);
      singletons.add(kind);
      return;
    }

    // What's left owns a top-level directory.
    const { directory } = entry;
    if (typeof directory === 'number' || typeof directory === 'boolean') {
      // YAML reads a bare `2026` or `true` as a number or boolean, not a name.
      error(`Invalid directory: ${directory} must be wrapped in quotes to be used as a directory (${where})`);
      return;
    }
    if (typeof directory !== 'string' || !directory) {
      error(`Invalid entry: a "${kind}" entry needs a "directory" (${where})`);
      return;
    }
    if (directories.has(directory)) {
      error(`Duplicate section: the "${directory}" directory is declared more than once`);
      return;
    }
    directories.add(directory);

    if (!SECTION_DIRECTORY_REGEX.test(directory)) {
      error(
        `Invalid directory: "${directory}" must be 1-30 characters of lowercase letters, numbers, "-" or "_", and start with a letter or number`,
      );
      return;
    }
    if (RESERVED_DIRECTORIES.has(directory)) {
      error(`Reserved directory: "${directory}" can't be used as a section`);
      return;
    }

    // `hasOwn`, not a bare lookup: `constructor` is a valid directory name.
    const builtInKind = isBuiltInDirectory(directory) ? BUILT_IN_KINDS[directory] : undefined;
    if (builtInKind !== undefined) {
      if (kind !== builtInKind) {
        error(`Invalid kind: the "${directory}" directory must use the "${builtInKind}" kind, not "${kind}"`);
      }
      return;
    }
    if (!DECLARABLE_KINDS.includes(kind)) {
      error(`Invalid kind: "${directory}" must be one of ${DECLARABLE_KINDS.join(' or ')}, not "${kind}"`);
    }
  });

  return results;
}
