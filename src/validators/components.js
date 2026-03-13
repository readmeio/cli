import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export const name = "components";

// Built-in components provided by @readme/markdown.
const BUILTIN_COMPONENTS = new Set([
  // Documented in ReadMe user docs
  "Accordion",
  "Tabs",
  "Tab",
  "Cards",
  "Card",
  "Columns",
  "Column",
  "Image",
  // Available from @readme/markdown
  "Anchor",
  "Callout",
  "Code",
  "CodeTabs",
  "Embed",
  "Glossary",
  "Heading",
  "HTMLBlock",
  "Table",
  "TableOfContents",
  "Recipe",
  "MCPIntro",
  "PostmanRunButton",
  "TailwindRoot",
  "TailwindStyle",
  "TutorialTile",
]);

// Directories that can contain MDXish content with component references.
const CONTENT_DIRS = new Set(["docs", "reference", "custom_pages", "recipes"]);

/**
 * Extract component tag names from MDXish content.
 * MDXish = parsed as markdown, only uppercase-first tags are components.
 * Ignores code blocks, inline code, and HTML comments.
 */
function extractComponentTags(content) {
  // Remove frontmatter.
  let text = content.replace(/^---[\s\S]*?---/, "");

  // Remove fenced code blocks (``` or ~~~).
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(/~~~[\s\S]*?~~~/g, "");

  // Remove inline code.
  text = text.replace(/`[^`\n]+`/g, "");

  // Remove HTML comments.
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Find all uppercase-first tags: <Component or <Component> or <Component />
  const pattern = /<([A-Z][a-zA-Z0-9]*)/g;
  const components = new Set();
  let match;
  while ((match = pattern.exec(text)) !== null) {
    components.add(match[1]);
  }

  return components;
}

/**
 * Extract exported component names from .mdx file body.
 * Matches: export const Foo, export function Foo, export default function Foo
 */
function extractExportedNames(body) {
  const names = new Set();
  const pattern = /export\s+(?:const|function|class)\s+([A-Z][a-zA-Z0-9]*)/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    names.add(match[1]);
  }
  return names;
}

/**
 * Collect available custom block component names from custom_blocks/.
 * .mdx files: uses the actual exported component names (e.g., export const Foo → <Foo />).
 * .md files: uses the filename slug (e.g., Greeting.md → <Greeting />).
 */
function collectCustomBlockNames(gitRoot) {
  const blocksDir = path.join(gitRoot, "custom_blocks");
  if (!fs.existsSync(blocksDir)) return new Set();

  const names = new Set();
  const entries = fs.readdirSync(blocksDir);

  for (const entry of entries) {
    if (!entry.endsWith(".md") && !entry.endsWith(".mdx")) continue;

    try {
      const content = fs.readFileSync(path.join(blocksDir, entry), "utf-8");

      if (entry.endsWith(".mdx")) {
        // .mdx: component names come from exports.
        const { content: body } = matter(content);
        for (const n of extractExportedNames(body)) {
          names.add(n);
        }
      } else {
        // .md snippet: component name is the PascalCase filename.
        const slug = entry.replace(/\.md$/, "");
        names.add(slug);
        // Also register the PascalCase form so references resolve.
        const pascalCase = slug
          .split(/[-_]/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join("");
        names.add(pascalCase);
      }
    } catch {
      // Skip unparseable files.
    }
  }

  return names;
}

/**
 * Per-file: validate custom_block files.
 * - .mdx: must have an exported component and a usage example
 * - .md: filename must be capitalized (used as component name via <Name />)
 */
export function validate({ content, relativePath }) {
  if (!relativePath.startsWith("custom_blocks/")) return null;

  const filename = path.basename(relativePath);
  const isMdx = relativePath.endsWith(".mdx");
  const isMd = relativePath.endsWith(".md");

  if (!isMdx && !isMd) return null;

  const results = [];

  // .md snippet files: filename must be PascalCase (it becomes the component tag).
  if (isMd) {
    const slug = filename.replace(/\.md$/, "");
    const pascalCase = slug
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
    if (slug !== pascalCase) {
      results.push({
        file: relativePath,
        rule: name,
        severity: "warning",
        message: `Bad filename: should be PascalCase — rename to "${pascalCase}.md" so it can be used as <${pascalCase} />`,
      });
    }
    return results.length > 0 ? results : null;
  }

  // .mdx component files: validate export and usage example.
  let data;
  let body;

  try {
    ({ data, content: body } = matter(content));
  } catch {
    return null; // frontmatter validator handles parse errors.
  }

  const componentName = data.name;
  if (!componentName) return null; // frontmatter validator handles missing name.

  // Check for an exported component.
  // Matches: export const Name, export function Name, export default
  const hasExport = /export\s+(const|function|default)\s+/.test(body);
  if (!hasExport) {
    results.push({
      file: relativePath,
      rule: name,
      message: `Missing export: no exported component found in "${componentName}"`,
    });
  }

  // Check for a usage example — a component tag at the start of a line (not indented
  // inside an export). The example demonstrates the component for the slash menu preview.
  const hasExample = /^<[A-Z][a-zA-Z0-9]*/m.test(body);
  if (!hasExample) {
    results.push({
      file: relativePath,
      rule: name,
      severity: "warning",
      message: `Missing example: no usage example found for "${componentName}"`,
    });
  }

  return results.length > 0 ? results : null;
}

/**
 * Cross-file: check that all component references in content files resolve.
 */
export function validateAll(files, gitRoot) {
  const results = [];
  const customBlocks = collectCustomBlockNames(gitRoot);
  const available = new Set([...BUILTIN_COMPONENTS, ...customBlocks]);

  for (const relPath of files) {
    const dir = relPath.split("/")[0];
    if (!CONTENT_DIRS.has(dir)) continue;
    if (!relPath.endsWith(".md")) continue;

    const filePath = path.join(gitRoot, relPath);
    let content;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const usedComponents = extractComponentTags(content);

    for (const comp of usedComponents) {
      if (!available.has(comp)) {
        results.push({
          file: relPath,
          rule: name,
          message: `Unknown component: <${comp}> is not a built-in or custom block`,
        });
      }
    }
  }

  return results;
}
