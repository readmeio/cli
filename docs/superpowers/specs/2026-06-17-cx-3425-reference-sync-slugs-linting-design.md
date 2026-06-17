# CX-3425 — Reference sync, slugs, and linting fixes

**Ticket:** [CX-3425](https://linear.app/readme-io/issue/CX-3425/misc-cli-issues-around-reference-sync-slugs-and-linting)
**Date:** 2026-06-17
**Branch:** `jesse/cx-3425-misc-cli-issues-around-reference-sync-slugs-and-linting`

## Background

Feedback on the ReadMe CLI surfaced five follow-up issues across reference syncing,
slug handling, and linting. OpenAPI specs are now the source of truth for `reference/`
content, but the CLI still validates and rewrites Markdown frontmatter as if the
Markdown owned the title/excerpt. Separately, the linter produces false positives for
duplicate slugs and unknown components, the `-1` slug renamer misses files and emits no
redirects, and stale `_order.yaml` entries go uncaught.

This spec covers all five items. There is currently **no test infrastructure** in the
repo (`"test": "echo \"No tests yet\""`); a lightweight `node:test` setup is added as
part of this work.

## Goals

1. Stop the CLI from owning `title`/`excerpt` on OAS-backed reference pages.
2. Improve `-1` slug rename coverage and emit a redirect file.
3. Stop flagging slugs shared across `docs/` and `reference/` as duplicates.
4. Stop failing CI on unknown (global/Enterprise) custom blocks.
5. Flag stale `_order.yaml` entries that no longer exist on disk.

## Non-goals

- Redirecting `-1` URLs to the base slug in the **conflict case** (base already exists,
  so no rename happens). The `bidi_remove_-1.js` script does not handle this either;
  tracked as a follow-up.
- Fetching global custom blocks from the ReadMe API, or adding an allowlist config.
- Stripping pre-existing `title`/`excerpt` from reference Markdown (non-destructive).

---

## Item 1 — Reference is OAS-owned (drop title/excerpt ownership)

OAS is the source of truth for `reference/`. The CLI should stop writing, requiring,
and sync-checking `title`/`excerpt` on api-backed reference pages. They render from the
spec.

### `src/commands/oas-sync.js`
- `buildPageContent`: emit frontmatter with **only** `api.file` + `api.operationId`.
  Remove the `title` and `excerpt` fields.
- `syncOneOas`: remove the title/excerpt **update** branch (the `else if (!skipUpdates)`
  block). Keep add and delete behavior. Remove the now-unused `skipUpdates`/
  `isReadMeConfig` plumbing for updates.
- Existing pages are not modified beyond add/delete — this is non-destructive for any
  `title`/`excerpt` already present.

### `src/validators/frontmatter.js`
- For pages where `relativePath` starts with `reference/` **and** parsed frontmatter has
  `api.file`, suppress the missing-`title` schema error (filter AJV errors where
  `err.keyword === 'required'` and `err.params.missingProperty === 'title'`). All other
  frontmatter validation is unchanged.

### `src/validators/oas-reference.js`
- Remove the two out-of-sync checks (`title`, `excerpt`) and the now-moot
  `isReadMeConfig` skip block.
- Keep: *OAS file not found*, *operation not found*, *missing page*.

**Effect:** The reported errors disappear:
`Invalid frontmatter: must have required property 'title'`,
`Out of sync: title is "undefined"...`,
`Out of sync: excerpt does not match spec description...`.

---

## Item 2 — `-1` slugs → redirects, folded into `numbering.js`

Port the useful behavior of `bidi_remove_-1.js` into the existing
`src/validators/numbering.js` (which already renames `-N` files/dirs and updates
`_order.yaml` on `--fix`), rather than adding a parallel command.

### `src/validators/numbering.js`
- **Narrow the suffix match to a single digit**: `/-(\d)$/` instead of `/-(\d+)$/`,
  matching `bidi_remove_-1.js` and ReadMe's auto-dedup behavior (`foo-1`, not `foo-123`).
  This is a deliberate narrowing of current coverage, approved.
- On `--fix`, when a rename is applied, record redirect lines in the script's
  **bidirectional** format, for both sections regardless of the page's location:
  - `/docs/<oldSlug> -> /docs/<newSlug>`
  - `/reference/<oldSlug> -> /reference/<newSlug>`
- After all renames, write the redirect file to
  `~/Desktop/<repoFolderName>_redirect.txt` (matching the script's output location),
  one mapping per line.
- Redirect file is only written when renames are actually applied (i.e. on `--fix` with
  confirmed renames). No file on a plain lint run.

**Coverage win:** `numbering.js` walks the filesystem rather than `_order.yaml` entries,
so it catches the files the original script missed.

**Out of scope:** the conflict case (base slug already exists) — `numbering.js` already
declines to rename it, and no redirect is emitted, matching the script.

---

## Item 3 — Duplicate slugs scoped per section

Slugs may legitimately repeat across `docs/` and `reference/`. Uniqueness should be
enforced within each section, not globally.

### `src/validators/duplicates.js`
- Key the slug map by `"<topDir>:<slug>"` rather than bare `slug`.
- A slug appearing in both `docs/` and `reference/` is no longer flagged; duplicates
  within the same section still are.
- The existing `ReadMeConfig/` skip is preserved.

---

## Item 4 — Unknown components → warning

Enterprise projects rely on global custom blocks (e.g. `<ClosedBeta>`) defined in the
ReadMe app, not in the repo. These should not fail CI.

### `src/validators/components.js`
- In `validateAll`, set `severity: 'warning'` on the "Unknown component" result.
- Per-file `custom_blocks/` validation is unchanged.
- No allowlist / config (kept simple by decision).

---

## Item 5 — Stale `_order.yaml` entries flagged

`ordering.js` only checks files *missing from* `_order.yaml`. It should also flag entries
*present in* `_order.yaml` with no matching file/folder on disk.

### `src/validators/ordering.js`
- Add a new check, independent of `ORDERED_DIRS`: for every `_order.yaml` under content
  dirs (`docs`, `reference`, `recipes`, `custom_pages`), flag any entry with no matching
  `<entry>.md`, `<entry>.mdx`, or `<entry>/` directory in that folder.
  - Severity: `warning`. Fixable: on `--fix`, remove the stale entry from `_order.yaml`.
- Also flag `index` / `index.md` entries appearing in `_order.yaml` (they should not be
  listed) — directly answering the ticket's open question.
- The existing "missing from `_order.yaml`" behavior (scoped to `ORDERED_DIRS`) is
  untouched, so adding `reference` to the stale check does not introduce
  "missing from order" noise for OAS-managed reference pages.

---

## Testing

Add a minimal test harness using Node's built-in test runner (zero new dependencies):

- `package.json`: `"test": "node --test"`.
- Fixture-based tests under `test/` covering the five changed validators, each with a
  small temp-dir fixture:
  - reference page with only `api` frontmatter → no missing-title / out-of-sync errors.
  - same slug in `docs/` and `reference/` → no duplicate error; same-section dup → error.
  - unknown component → warning (not error).
  - `_order.yaml` with a stale entry and an `index` entry → warnings; `--fix` removes them.
  - `numbering.js`: `foo-1.md` with no `foo.md` → rename + bidirectional redirect lines;
    `foo-12.md` → not matched.

### End-to-end verification
Run `lint` and `oas:sync` against the ticket's example repo
[`production-lightcast-api-7a9ba2da223798f9c29a`](https://github.com/readme-internal-sync/production-lightcast-api-7a9ba2da223798f9c29a/tree/v1.0)
and confirm the previously-reported errors no longer appear.

## Rollout

Single PR against `main` covering all five items plus tests. Bump the CLI version so a
release can ship the fixes (CastAI / Lightcast are blocked on these).
