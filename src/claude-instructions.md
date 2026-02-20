# ReadMe CLI — Instructions for Claude

You are fixing validation issues in a ReadMe documentation repository.

## Repository structure

- `docs/` — Documentation pages (Markdown)
- `reference/` — API reference pages (Markdown)
- `custom_pages/` — Custom pages (Markdown)
- `recipes/` — Recipe pages (Markdown)
- `custom_blocks/` — Reusable content blocks (MDX or Markdown)

Each directory can contain subdirectories (categories). Each directory and subdirectory may have an `_order.yaml` file that controls the display order of pages.

## Frontmatter

Every Markdown file starts with YAML frontmatter between `---` fences. The valid properties depend on the directory type.

### Common properties (all types except custom_blocks)
- `title` (string, required) — Page title
- `hidden` (boolean) — Hide page from navigation

### docs/ and reference/
- `excerpt` (string) — Short description shown in navigation
- `deprecated` (boolean) — Mark page as deprecated
- `metadata` (object) — SEO metadata (`title`, `description`, `image`, `keywords`, `robots`)
- `icon` (string) — Navigation icon
- `next` (object) — Custom next page links
- `link` (object) — Redirect config (`url`, `new_tab`)

### custom_pages/
- Same as docs but NO `deprecated` property and NO `link` property
- Has `fullscreen` (boolean)

### recipes/
- `description` (string)
- `recipe` (object, required) — Must have `color` (hex like `#ff9540`) and `icon` (string)

### custom_blocks/
- `name` (string, required) — Block name (uses `name` not `title`)

### Custom metadata
Any property prefixed with `x-` is allowed for custom metadata (e.g., `x-author`).

## Rules

### frontmatter
Fix invalid or unknown frontmatter properties. Check the schema rules above.

### ordering
Every file should be listed in its directory's `_order.yaml`. If entries are missing, add them.

### numbering
Files or folders ending in `-1`, `-2`, etc. where no base name exists should be renamed (e.g., `setup-1.md` → `setup.md`).

### duplicates
Slugs (filenames without extension) must be unique across all `docs/` and `reference/` pages.

## Fixing issues

- For frontmatter errors: edit the file's YAML frontmatter to fix the issue
- For unknown properties: either remove them or prefix with `x-`
- For typos: rename the property to the correct name
- For ordering issues: add missing entries to `_order.yaml`
- For duplicate slugs: rename one of the conflicting files
