import fs from 'node:fs';
import path from 'node:path';

import { CORE_SCHEMA, load as loadYAML } from 'js-yaml';

/**
 * Sections are the top-level content directories of a ReadMe repo.
 *
 * Every project has the built-in ones (`docs`, `reference`, `recipes`,
 * `custom_pages`). Projects with multiple guides declare more in a
 * `_readme.yaml` file at the repo root:
 *
 *   navigation:
 *     - kind: guide
 *       directory: docs
 *       name: Guides
 *     - kind: guide
 *       directory: sdks
 *       name: SDKs
 *     - kind: reference
 *       directory: apis
 *
 * The file is optional. A repo without one (every repo from before the
 * feature) resolves to just the built-ins, exactly as ReadMe itself does.
 * The rules here mirror the ones ReadMe applies when it reads the file.
 */

export const CONFIG_FILE = '_readme.yaml';

/** Allowed shape for a section `directory`. */
export const SECTION_DIRECTORY_REGEX = /^[a-z0-9][a-z0-9_-]{0,29}$/;

/** Built-in directories, and the one kind each is locked to. */
export const BUILT_IN_KINDS = {
  changelogs: 'changelog',
  custom_pages: 'custom_pages',
  docs: 'guide',
  recipes: 'recipes',
  reference: 'reference',
  skills: 'skill',
};

/** Kinds a non-built-in directory may declare. */
export const DECLARABLE_KINDS = ['guide', 'reference'];

/** Kinds whose `navigation` entry owns a top-level directory. */
export const DIRECTORY_KINDS = ['guide', 'recipes', 'reference', 'skill'];

/** Kinds that may appear only once, and point at nothing. */
export const SINGLETON_KINDS = ['changelog', 'discuss', 'home', 'version'];

/** Directories that can never be declared as a section. */
export const RESERVED_DIRECTORIES = new Set([
  // Owned by ReadMe's storage.
  'custom_blocks',
  'llms_txt',
  'apidefinition',
  'api_config',
  // `docs` is served at /guides, so a directory of that name would collide.
  'guides',
  // URL segments the hub routes itself.
  'admin',
  'api',
  'auth',
  'blog',
  'chatgpt',
  'comments',
  'custom-login',
  'dash',
  'discuss',
  'discuss-new',
  'edit',
  'graphql',
  'inactive',
  'login',
  'login-webhook',
  'logout',
  'logs',
  'mcp',
  'oauth',
  'oauth2-redirect',
  'og-image',
  'openapi',
  'password',
  'reference-link',
  'suggested-edits',
  'throw-error',
  'unvalidated',
]);

// The sections the CLI has always handled, in the order it lists them.
const BUILT_IN_SECTIONS = [
  { directory: 'docs', kind: 'guide', label: 'Docs' },
  { directory: 'reference', kind: 'reference', label: 'Reference' },
  { directory: 'custom_pages', kind: 'custom_pages', label: 'Custom Pages' },
  { directory: 'recipes', kind: 'recipes', label: 'Recipes' },
];

// What ReadMe calls a built-in section that `_readme.yaml` lists without a name.
const DEFAULT_SECTION_NAMES = {
  docs: 'Guides',
  reference: 'API Reference',
  recipes: 'Recipes',
  custom_pages: 'Custom Pages',
};

export function isBuiltInDirectory(directory) {
  return Object.hasOwn(BUILT_IN_KINDS, directory);
}

/** Whether a directory could be declared as a section of its own. */
export function isDeclarableDirectory(directory) {
  return (
    typeof directory === 'string' &&
    SECTION_DIRECTORY_REGEX.test(directory) &&
    !isBuiltInDirectory(directory) &&
    !RESERVED_DIRECTORIES.has(directory)
  );
}

/**
 * Parse `_readme.yaml` content the way ReadMe does: core YAML types only, so a
 * directory called `2026-07-31` stays a string rather than becoming a date.
 *
 * @returns {{ config: object | null, error: string | null }}
 */
export function parseConfig(content) {
  let parsed;
  try {
    parsed = loadYAML(content, { json: true, schema: CORE_SCHEMA });
  } catch (err) {
    return { config: null, error: err.reason || err.message || 'invalid YAML' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { config: null, error: 'must be a YAML object' };
  }
  return { config: parsed, error: null };
}

class Sections {
  constructor({ exists, config, error, list, order }) {
    /** Whether the repo has a `_readme.yaml`. */
    this.exists = exists;
    /** The parsed file, or null when it's missing or unreadable. */
    this.config = config;
    /** Why the file couldn't be parsed, or null. */
    this.error = error;
    this.list = list;
    /** Directories in the order `_readme.yaml` lists them, the rest after. */
    this.order = [...new Set([...(order || []), ...list.map(section => section.directory)])];
    this.byDirectory = new Map(list.map(section => [section.directory, section]));
  }

  /** The kind of a top-level directory, or undefined when it isn't a section. */
  kindOf(directory) {
    if (directory === 'custom_blocks') return 'custom_blocks';
    return this.byDirectory.get(directory)?.kind;
  }

  /** Every directory that holds pages: the built-ins plus the declared ones. */
  directories() {
    return this.list.map(section => section.directory);
  }

  /** The directories of the given kind(s), e.g. every API reference. */
  directoriesOfKind(...kinds) {
    return this.list.filter(section => kinds.includes(section.kind)).map(section => section.directory);
  }

  /** The directories declared in `_readme.yaml` on top of the built-ins. */
  declaredDirectories() {
    return this.list.filter(section => !section.builtIn).map(section => section.directory);
  }
}

/**
 * The API reference directories that exist in a repo: `reference`, plus any
 * section `_readme.yaml` declares with the `reference` kind.
 */
export function findReferenceDirs(gitRoot, sections = loadSections(gitRoot)) {
  return sections.directoriesOfKind('reference').filter(directory => {
    try {
      return fs.statSync(path.join(gitRoot, directory)).isDirectory();
    } catch {
      return false;
    }
  });
}

/** The sections of a repo with no `_readme.yaml`. */
export const DEFAULT_SECTIONS = new Sections({
  exists: false,
  config: null,
  error: null,
  list: BUILT_IN_SECTIONS.map(section => ({ ...section, builtIn: true, hidden: false })),
});

/**
 * Resolve a repo's sections from its `_readme.yaml`.
 *
 * Never throws: a missing, unparseable, or partly invalid file still resolves
 * (to the built-ins, plus whichever declared sections are usable), so one bad
 * entry doesn't stop the rest of the repo from being linted. Reporting what's
 * wrong with the file is the `config` validator's job.
 */
export function loadSections(gitRoot) {
  const configPath = path.join(gitRoot, CONFIG_FILE);

  let content;
  try {
    // `readFile` follows a symlink, and a linked config could declare sections
    // from a file outside the repo. Like every other linked path, it's refused.
    if (fs.lstatSync(configPath).isSymbolicLink()) {
      return new Sections({
        exists: true,
        config: null,
        error: 'symbolic links are not followed',
        list: BUILT_IN_SECTIONS.map(section => ({ ...section, builtIn: true, hidden: false })),
      });
    }
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return DEFAULT_SECTIONS;
  }

  const { config, error } = parseConfig(content);
  const navigation = Array.isArray(config?.navigation) ? config.navigation : [];

  const list = BUILT_IN_SECTIONS.map(section => ({ ...section, builtIn: true, hidden: false }));
  const byDirectory = new Map(list.map(section => [section.directory, section]));
  const order = [];

  for (const entry of navigation) {
    if (!entry || typeof entry !== 'object' || typeof entry.directory !== 'string') continue;
    const { directory, kind } = entry;
    const name = typeof entry.name === 'string' && entry.name ? entry.name : null;

    const builtIn = byDirectory.get(directory);
    if (builtIn?.builtIn) {
      // A built-in keeps its kind whatever the file says; only its label and
      // visibility are the file's to set.
      builtIn.label = name || DEFAULT_SECTION_NAMES[directory];
      builtIn.hidden = entry.hidden === true;
      if (!order.includes(directory)) order.push(directory);
      continue;
    }

    if (builtIn || !isDeclarableDirectory(directory) || !DECLARABLE_KINDS.includes(kind)) continue;

    const section = { directory, kind, label: name || directory, builtIn: false, hidden: entry.hidden === true };
    list.push(section);
    byDirectory.set(directory, section);
    order.push(directory);
  }

  return new Sections({ exists: true, config, error, list, order });
}
