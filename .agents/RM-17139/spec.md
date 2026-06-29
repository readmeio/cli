# RM-17139: AI Importer (mintlify): entry page slug generated as "docs" — resulting in doubled /docs/docs URL

## Problem

When the AI Importer builds the skeleton for a docs site whose entry page path ends at a generic documentation route such as `/docs`, the CLI derives the ReadMe page slug from that route segment. For Mintlify, `https://www.mintlify.com/docs` becomes a page slug of `docs`, which publishes as `/docs/docs` because ReadMe already nests guide pages under `/docs`.

The same generic route terms can also pollute collision resolution. A category or path segment like `Docs`, `Doc`, or `Documentation` can be prepended to otherwise good slugs, producing values such as `docs-getting-started` instead of preserving `getting-started` where possible.

## Success criteria

1. A source page whose derived slug would be exactly `docs`, `doc`, `documentation`, or `documentations` is emitted with a meaningful fallback slug, `introduction`, instead of the generic route slug.
2. Generic docs route/category terms are normalized before unique-slug resolution, so they are attempted first and do not unnecessarily reserve or pollute later slugs.
   - For example, if the organized tree has `Docs` and `AI` categories, run unique-slug assignment for the `Docs` category first so generic docs normalization cannot be forced into polluted slugs by later categories.
3. Generic docs category/path terms are not used as disambiguating prefixes for page slugs. For example, a `Docs / Getting Started` page should prefer `getting-started`, not `docs-getting-started`.
4. If normalization still leaves a slug collision, the CLI keeps the existing collision fallback behavior and suffix style; this ticket does not change global suffix semantics.
5. Non-generic route segments keep current behavior. For example, `/docs/api`, `/docs/getting-started`, and segments like `docs-api` or `documentation-settings` are not rewritten just because they contain a generic docs word.
6. Running the runner repo smoke command `npm run step:skeleton https://www.mintlify.com/docs` uses the CLI worktree and no longer produces problematic `docs.md`, `doc.md`, `documentation.md`, `documentations.md`, or `docs-*` slugs caused solely by generic docs route/category normalization.

## Out of scope

- Runner page formatting, MDX conversion, hydration, or post-skeleton cleanup.
- ReadMe URL routing or published-site behavior outside the generated skeleton slugs.
- Changing global slug collision suffix behavior.
- Fixing unrelated model/Claude invalid-JSON failures that can block a full skeleton smoke run before staging.
- Broad slug quality improvements unrelated to exact generic docs route/category terms.

## Implementation decisions

- Implement the fix in the CLI skeleton slug planning path, not in the runner.
- Normalize slug candidate segments before uniqueness resolution so filenames, `_order.yaml`, frontmatter, and slug logging all derive from one source of truth.
- Treat exact generic docs terms as non-semantic only when they are standalone segments/category labels: `docs`, `doc`, `documentation`, and `documentations`.
- Replace a terminal slug candidate that would be exactly one of those generic terms with `introduction`.
- Ensure generic docs category/path terms are tried/normalized before other slug assignment work so they do not claim useful slugs or force later pages into `docs-*` expansions.
- Process categories with generic docs labels before non-generic categories during unique-slug assignment; for example, `Docs` should be assigned before `AI`.
- Do not rewrite partial matches such as `docs-api` or `documentation-settings`.
- Preserve the CLI's existing final collision fallback behavior, including its current numeric suffix style.

## Proposed test seams

1. Unit test the slug planner with a synthetic tree containing a page at `https://example.com/docs`; assert the assigned slug is `introduction`.
2. Unit test the same behavior for `doc`, `documentation`, and `documentations` terminal paths.
3. Unit test a generic `Docs`/`Documentation` category containing `Getting Started`; assert the slug is `getting-started` when available, not `docs-getting-started`.
4. Unit test a collision where a generic docs category/page competes with another page for the same slug; assert existing collision fallback is used rather than introducing a generic `docs-` prefix.
5. Unit test non-generic cases such as `/docs/api`, `/docs/getting-started`, `docs-api`, and `documentation-settings`; assert current slug behavior is preserved.
6. Smoke validate from the runner repo with `npm run step:skeleton https://www.mintlify.com/docs`, confirming the generated skeleton no longer contains generic docs slugs for the entry page or generic `docs-*` prefixes introduced solely by docs-route normalization.

## Further notes

The runner repo depends on the CLI via the local `@readme/cli` file dependency in this worktree setup, so the final Mintlify smoke should be run from the runner repo after CLI changes are in place.

## Approval

Approved by Xavier on 2026-06-29T07:18:23Z.
