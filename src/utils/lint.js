import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

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

/**
 * Auto-discover all validators from src/validators/.
 * Validators can export `validate()` for per-file checks and/or
 * `validateAll()` for cross-file checks (like ordering).
 */
async function loadValidators() {
  const validatorsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'validators')
  const files = fs.readdirSync(validatorsDir).filter((f) => f.endsWith('.js'))
  const validators = []

  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(validatorsDir, file)).href)
    if (mod.name && (mod.validate || mod.validateAll)) {
      validators.push(mod)
    }
  }

  return validators
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
