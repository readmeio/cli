# ReadMe Git-Based Docs Format

This repo is the reference implementation of ReadMe's Git-based documentation format. It defines how documentation is structured when syncing with ReadMe via Git.

Any LLM modifying a repo that uses this format should reference this file and the examples in this repo.

## Directory structure

```
your-repo/
├── frontmatter.schema.json   # Frontmatter validation schema
├── docs/                      # Guides and documentation pages
│   ├── {Category Name}/       # Category folders (Title Case with spaces)
│   │   ├── _order.yaml        # Page ordering within this category
│   │   ├── page-slug.md       # Documentation pages (kebab-case filenames)
│   │   └── parent-page/       # Parent page with children
│   │       ├── index.md       # The parent page content
│   │       └── child-page.md  # Child page nested under parent
│   └── {Another Category}/
│       └── ...
├── reference/                 # API reference documentation
│   ├── oas.json               # OpenAPI spec file(s)
│   └── {API Title}/           # Matches info.title from OAS
│       └── {Tag}/             # Matches OAS operation tags
│           ├── index.md       # Optional category landing page
│           └── operationId.md # Endpoint page linked to OAS operation
├── recipes/                   # Code recipe/tutorial pages
│   ├── _order.yaml
│   └── recipe-slug.md
├── custom_pages/              # Standalone pages (markdown or HTML)
│   └── page-slug.md
├── custom_blocks/             # Reusable content snippets and components
│   ├── snippet.md             # Markdown snippet
│   └── Component.mdx          # React component (single-file)
└── reusable_content/          # (also valid top-level directory)
```

**Valid top-level directories:** `docs/`, `reference/`, `custom_pages/`, `recipes/`, `custom_blocks/`, `reusable_content/`

## Frontmatter

Every page uses YAML frontmatter. The full schema is in `frontmatter.schema.json`. Here's a summary by content type:

### Doc pages (`docs/`)

```yaml
---
title: Page Title        # Required
excerpt: One-sentence summary
hidden: true             # Hides page from navigation
deprecated: true         # Marks page as deprecated
icon: star               # Icon identifier
metadata:
  title: SEO Title
  description: SEO description
  keywords: [keyword1, keyword2]
  image: https://example.com/image.png
  robots: noindex         # "index" or "noindex"
next:
  description: What's next
  pages:
    - slug: page-slug
      title: Display Title
      type: basic          # basic, endpoint, changelog, custom_page
    - title: External Link
      type: link
      url: https://example.com
link:
  url: https://example.com  # Redirect page to this URL
  new_tab: true
---
```

Only `title` is required. All other fields are optional — don't add fields you don't need.

### API reference pages (`reference/`)

Same fields as doc pages, plus:

```yaml
---
title: Get a Pet
excerpt: Fetch a specific pet by ID
api:
  file: oas.json           # Path to OAS file (relative to reference/)
  operationId: getPet      # Matches operationId in the OAS spec
  webhook: false           # Set true for webhook operations
api_config: authentication # Special page type: "authentication", "getting-started", or "my-requests"
recipes:                   # Related recipe slugs
  - publish-all-docs-in-category
---
```

Set `api` to `null` to detach a reference page from its API operation (makes it a plain page within `reference/`).

### Recipe pages (`recipes/`)

```yaml
---
title: Publish all Docs in Category          # Required
description: Update each doc as published.   # Optional
hidden: true
recipe:                                       # Required
  color: '#018FF4'                            # Hex color, required
  icon: circle-play                           # Icon string, required
---
```

### Custom pages (`custom_pages/`)

```yaml
---
title: My Custom Page    # Required
hidden: true
fullscreen: true         # Renders page without sidebar/nav chrome
metadata:
  description: ...
  keywords: ...
  title: ...
  image: ...
---
```

Custom pages support markdown (`.md`) and HTML (`.html`). They cannot use `deprecated`.

### Custom blocks (`custom_blocks/`)

Markdown snippets (`.md`):
```yaml
---
name: my-snippet         # Required
---
Content here...
```

React components (`.mdx`) — export a component and include a usage example:
```yaml
---
name: MyComponent        # Required
---
```

## Ordering with `_order.yaml`

Every directory containing pages needs an `_order.yaml` to control display order.

**Category ordering** — lists folder names (Title Case with spaces):
```yaml
# docs/_order.yaml (if it existed — currently categories display alphabetically without one)
- Documentation
- More Documentation
```

**Page ordering within a category** — lists page slugs (kebab-case, no `.md`):
```yaml
# docs/Documentation/_order.yaml
- hello-world
- parent-page
- another-page
```

**Recipe ordering:**
```yaml
# recipes/_order.yaml
- publish-all-docs-in-category
```

## Parent-child pages

Create a folder named after the parent page slug, with `index.md` as the parent and additional `.md` files as children:

```
docs/Documentation/
└── parent-page/
    ├── index.md       # Parent page (title: "Parent Page")
    └── child-page.md  # Child page nested underneath
```

## Linking between pages

### Published URL structure

On the published ReadMe site, pages have flat URL paths based on their content type:

| Content type | Published URL |
|---|---|
| Doc pages (`docs/`) | `/docs/{slug}` |
| API reference (`reference/`) | `/reference/{slug}` |
| Recipes (`recipes/`) | `/recipes/{slug}` |
| Custom pages (`custom_pages/`) | `/page/{slug}` |

The slug comes from the filename (without `.md`). Category folders do **not** appear in published URLs — `docs/Getting Started/quickstart.md` becomes `/docs/quickstart`. Child pages nest under their parent: `docs/Category/parent-page/child-page.md` becomes `/docs/parent-page/child-page`.

**Important:** Site URLs may include a prefix (e.g., `/lang-en/docs/slug`), so never use absolute paths when linking between pages. Use relative links instead.

### Relative links (preferred)

Always use relative links based on the published URL structure above (not the file structure in this repo). Do not include `.md` extensions in links.

```markdown
<!-- Link to a page in the same section -->
[Link text](./other-page)

<!-- Link from a doc page to a reference page -->
[Link text](../reference/some-endpoint)

<!-- Link from a child page to a sibling -->
[Link text](./sibling-page)

<!-- Link from a child page up to another doc -->
[Link text](../other-page)

<!-- HTML anchor tags also work with relative links -->
<a href="./other-page">Link text</a>
```

### `doc:` protocol links

ReadMe supports a special `doc:slug` protocol that resolves to doc pages regardless of URL prefix. This is convenient but only works in markdown links (not in `<a>` tags or component `href` attributes):

```markdown
[Link text](doc:hello-world)
```

**Use relative links as the default.** The `doc:` protocol is an acceptable alternative for markdown-only links to doc pages.

## Markdown content conventions

- Write in active voice, address the reader as "you"
- Use sentence case for headings
- Category folder names: Title Case with spaces (e.g., `Getting Started`, `Core Features`)
- Page filenames: lowercase kebab-case (e.g., `quickstart.md`, `error-handling.md`)

### MDX components

These built-in components are available in markdown content:

**Tabs** — for non-code tabbed content:
```markdown
<Tabs>
  <Tab title="First Tab">
    Content for tab 1
  </Tab>
  <Tab title="Second Tab">
    Content for tab 2
  </Tab>
</Tabs>
```

**Tabbed code blocks** — place fenced code blocks back-to-back with NO blank lines between them:

````markdown
```javascript
const pet = await sdk.getPet({ petId: 123 });
```
```python
pet = sdk.get_pet(pet_id=123)
```
````

**Accordion:**
```markdown
<Accordion title="Click to expand" icon="info">
  Hidden content here
</Accordion>
```

**Cards:**
```markdown
<Cards columns={3}>
  <Card title="Getting Started" icon="rocket" href="./getting-started">
    Quick intro to the platform
  </Card>
  <Card title="API Reference" icon="code" href="../reference/">
    Explore the API
  </Card>
</Cards>
```

**Columns:**
```markdown
<Columns>
  <Column>
    Left side content
  </Column>
  <Column>
    Right side content
  </Column>
</Columns>
```

Only these components are valid. Convert any other components (e.g., `<Callout>`, `<Note>`, `<Info>`, `<Steps>`) to plain markdown or blockquotes.

### Recipe line highlighting

Recipes can highlight specific code lines per language using HTML comments:

```markdown
<!-- node@L0-L4,L6 -->
<!-- python@L2-L3,L9 -->
```

These comments go after a markdown heading and before the explanatory text for that step. They reference the code blocks at the top of the recipe.

## API reference structure

OAS (OpenAPI) spec files go in `reference/`. The directory structure maps to the API:

```
reference/
├── oas.json                    # The OpenAPI spec
└── Simple Pet API/             # Matches spec's info.title
    ├── Pet/                    # Matches a tag name
    │   ├── index.md            # Optional: landing page for this tag
    │   └── getPet.md           # Endpoint page (filename = operationId)
    └── Pets/
        ├── index.md
        └── randomPet.md
```

If you only need the auto-generated endpoint pages (no custom markdown), you can just have the OAS file with no subdirectories — ReadMe creates "virtual" categories from the spec's tags.

Endpoint pages link to their OAS operation via frontmatter:
```yaml
api:
  file: oas.json
  operationId: getPet
```

You can also add **conceptual guide pages** inside `reference/` (authentication, error handling, pagination, etc.) by creating pages without an `api` frontmatter field, or by setting `api: null`.

## Validation rules

When attempting to validate the repo, these are the common issues to check for and how to fix them:

- **frontmatter** — Invalid or unknown frontmatter properties. Unknown properties should either be removed or prefixed with `x-` (e.g., `category` → `x-category`). Typos are flagged with the closest valid property name.
- **ordering** — Every file and subdirectory should be listed in its directory's `_order.yaml`. Slugs that YAML interprets as non-strings (numbers like `404`, booleans like `true`/`false`/`yes`/`no`) must be quoted (e.g., `- "404"`). Never remove quotes from existing entries.
- **numbering** — Files ending in `-1`, `-2`, etc. where no base name exists should be renamed (e.g., `setup-1.md` → `setup.md`). These suffixes are holdovers from an old bug.
- **duplicates** — Slugs must be unique across all `docs/` and `reference/` pages. Never rename files inside `ReadMeConfig/` — these have special internal names.
- **oas-reference** — Reference pages with `api.file` frontmatter must point to a valid OAS file. The `api.operationId` must exist in the spec.
- **oas-schema** — OAS files must be valid OpenAPI or Swagger specs. Error messages include line numbers and context.
- **components** — MDX component tags (`<Name>`) must reference a built-in or custom block. Custom block `.md` snippets should use PascalCase filenames (e.g., `MySnippet.md` for `<MySnippet />`).
- **recipes** — Must have code blocks at the top, then `# Heading` sections. Snippet references (`<!-- lang@lines -->`) must reference existing code blocks with valid line ranges.

## Key rules when editing

1. **Don't add frontmatter fields not in the schema.** Check `frontmatter.schema.json` if unsure.
2. **Every directory with pages needs `_order.yaml`** to control ordering.
3. **Category folders use Title Case with spaces.** Page files use kebab-case.
4. **Don't modify auto-generated endpoint files** in `reference/` unless adding custom markdown to existing ones. You can add new conceptual pages alongside them.
5. **Prefer more focused pages over fewer long ones.** Split distinct concepts into separate files.
6. **Don't create changelog/release-notes content** — ReadMe handles that separately.
