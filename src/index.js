/**
 * Programmatic API for `@readme/cli`.
 *
 * Each function mirrors the behavior of its CLI command but returns
 * structured data and never calls `process.exit`. Callers own how to format,
 * report, and exit on errors.
 */

export { lint } from './commands/lint.js';
export { syncOas } from './commands/oas-sync.js';
export { validateOas } from './commands/oas-validate.js';
export { importDocs } from './commands/import.js';
