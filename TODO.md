- Add link to preview in the comment
- Figure out ReadMeConfig conflicts

-----

- when out of beta: switch GitHub Actions workflow (setup:github) from GitHub Packages (`npm.pkg.github.com` + `GITHUB_TOKEN`) to the public npm registry, and remove the `registry-url` / `NODE_AUTH_TOKEN` config. Bump `WORKFLOW_VERSION` in `src/utils/git.js` so users get prompted to re-run `setup:github`.
- we should update the README.md file in repos to mention how to use this tool
  - it will also help claude

-----

## `import` — fallbacks when llms.txt is missing or useless

Right now `import --source <url>` bails with a warning if `/llms.txt` isn't there. Things to try when that fails:

**Other well-known files to probe first (cheap):**
- `/llms-full.txt` — the long-form variant some sites publish
- `<source-path>/llms.txt` — if user passed a subpath (e.g. `/docs`), the file may live there
- `/sitemap.xml` (and `/sitemap_index.xml`) — authoritative URL list when it exists
- `/robots.txt` → follow `Sitemap:` directives

**If probes all fail — crawl strategies (pick one, probably configurable):**
- Fetch the source URL, extract nav links (common selectors: `nav a`, `[role=navigation] a`, sidebar-ish), same-origin only, depth-limited
- Feed the landing HTML to Claude and ask it to identify the docs index / table of contents
- BFS crawl from source URL, same-origin, capped at N pages

**Content-quality fallbacks (llms.txt exists but is thin):**
- 0 items parsed → treat as missing, fall through to crawl
- All items are off-origin → warn, still fall through
- Way too many items (e.g. 1136 like docs.anthropic.com) → cap / paginate / let user filter by section

**Decisions to make:**
- Hard-fail vs. soft-fail chain: do we try every fallback automatically, or ask the user?
- Cache: llms.txt + sitemap responses probably worth caching across runs (same origin, same day)
- Flag to force a strategy: `--discover=llms|sitemap|crawl|auto`
