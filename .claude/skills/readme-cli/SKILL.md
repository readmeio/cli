---
name: readme-cli
description: Use the ReadMe CLI to lint, fix, preview, sync, and manage ReadMe documentation repos. Use when the user wants to run CLI commands, check docs for errors, fix linting issues, sync OpenAPI specs, or preview docs locally.
user-invocable: false
---

# ReadMe CLI (`@readme/cli`)

A CLI tool for writing, previewing, and managing ReadMe docs from the terminal. It operates on git-based ReadMe documentation repos.

## Commands

### Linting
```bash
npx @readme/cli lint          # Check docs for errors
npx @readme/cli lint --fix    # Automatically fix common issues
npx @readme/cli lint --json   # Machine-readable output (good for CI)
```

Validates: frontmatter, ordering, duplicates, OAS references, OAS schema, MDX components, and recipes.

Always try `lint --fix` before attempting manual fixes.

### OpenAPI Sync
```bash
npx @readme/cli oas:sync
```
Syncs `reference/` directory with OpenAPI specs. Creates, updates, or removes pages based on spec operations. Run this when you see `oas-reference` errors.

### Import
```bash
npx @readme/cli import
```
Imports content from an external folder and converts it into ReadMe's format using Claude.

### Versions
```bash
npx @readme/cli versions
```
Lists all doc versions and their branches.

### Dev Server
```bash
npx @readme/cli dev
```
Starts a local dev server to preview docs with live reload.

## Prerequisites

The CLI expects to be run inside a git repo that has:
- A version branch matching `v[0-9]*` (e.g., `v1`, `v2.0`)
- A `docs/` and/or `reference/` directory at the repo root

Use `--no-check` to skip this validation if needed.

## Typical Workflow

1. Run `npx @readme/cli lint` to check for issues
2. Run `npx @readme/cli lint --fix` to auto-fix what it can
3. Run `npx @readme/cli lint` again to verify remaining issues
4. Fix any remaining issues manually
5. Run `npx @readme/cli dev` to preview changes locally
