# CLI Tools

The ReadMe CLI (`npx @readmeio/cli-beta`) has several commands that can help fix issues automatically. Run these before trying to fix things by hand.

## `npx @readmeio/cli-beta lint --fix`

Automatically fixes common linting issues: ordering problems, frontmatter cleanup, numbering suffixes, etc. Always try this first.

## `npx @readmeio/cli-beta oas:sync`

Syncs reference pages with OpenAPI specs. Fixes many OAS-related issues automatically: creates missing endpoint pages, removes stale ones, updates titles/excerpts to match the spec, and maintains `_order.yaml` files. Run this whenever you see `oas-reference` errors.

## `npx @readmeio/cli-beta lint`

Runs all validators and reports errors/warnings. Use this to check your work after making changes.

## `npx @readmeio/cli-beta dev`

Starts a local dev server to preview docs. Useful for visually verifying changes.
