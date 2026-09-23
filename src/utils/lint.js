import fs from 'node:fs'
import path from 'node:path'
import * as componentsValidator from '../validators/components.js'
import * as contentValidator from '../validators/content.js'
import * as duplicatesValidator from '../validators/duplicates.js'
import * as frontmatterValidator from '../validators/frontmatter.js'
import * as linksValidator from '../validators/links.js'
import * as nestingValidator from '../validators/nesting.js'
import * as oasReferenceValidator from '../validators/oas-reference.js'
import * as oasSchemaValidator from '../validators/oas-schema.js'
import * as orderingValidator from '../validators/ordering.js'
import * as recipesValidator from '../validators/recipes.js'

const TARGET_PATTERNS = [
  { dir: 'custom_blocks', ext: ['.mdx', '.md'] },
  { dir: 'docs', ext: '.md' },
  { dir: 'reference', ext: '.md' },
  { dir: 'custom_pages', ext: '.md' },
  { dir: 'recipes', ext: '.md' },
]

/**
 * Collect all target files from the repo root.
 */
export function collectFiles(gitRoot) {
  const files = []

  for (const { dir, ext } of TARGET_PATTERNS) {
    const dirPath = path.join(gitRoot, dir)
    if (!fs.existsSync(dirPath)) continue

    const exts = Array.isArray(ext) ? ext : [ext]
    const entries = fs.readdirSync(dirPath, { recursive: true })
    for (const entry of entries) {
      if (exts.some((e) => entry.endsWith(e))) {
        files.push(path.join(dir, entry))
      }
    }
  }

  return files.sort()
}

// Every validator in src/validators/, imported statically (rather than
// discovered via a runtime directory scan) so this file — and anything that
// imports it, like the GitHub Action entrypoint in src/gha.js — can be
// bundled into a single file by a tool like ncc. Add a new validator's
// import above and its module here.
const ALL_VALIDATORS = [
  componentsValidator,
  contentValidator,
  duplicatesValidator,
  frontmatterValidator,
  linksValidator,
  nestingValidator,
  oasReferenceValidator,
  oasSchemaValidator,
  orderingValidator,
  recipesValidator,
]

/**
 * Validators can export `validate()` for per-file checks and/or
 * `validateAll()` for cross-file checks (like ordering).
 */
function loadValidators() {
  return ALL_VALIDATORS.filter((mod) => mod.name && (mod.validate || mod.validateAll))
}

/**
 * Run all validators against every file. Returns array of result objects.
 * Each result has { file, rule, message, severity? } where severity defaults to 'error'.
 * Calls `onFile(relativePath)` before processing each file (for progress reporting).
 */
export async function runValidators(files, gitRoot, { onFile, onBeforeCrossFile, fix, nonInteractive } = {}) {
  const validators = await loadValidators()
  const results = []

  // Per-file validators.
  for (const relativePath of files) {
    if (onFile) onFile(relativePath)

    const filePath = path.join(gitRoot, relativePath)
    const content = fs.readFileSync(filePath, 'utf-8')

    for (const validator of validators) {
      if (!validator.validate) continue
      const result = validator.validate({ filePath, content, relativePath, fix })
      if (result) {
        if (Array.isArray(result)) {
          results.push(...result)
        } else {
          results.push(result)
        }
      }
    }
  }

  // Cross-file validators — stop the spinner first so interactive prompts work.
  if (onBeforeCrossFile) onBeforeCrossFile()
  for (const validator of validators) {
    if (!validator.validateAll) continue
    const result = await validator.validateAll(files, gitRoot, { fix, nonInteractive })
    if (result) {
      if (Array.isArray(result)) {
        results.push(...result)
      } else {
        results.push(result)
      }
    }
  }

  return results
}
