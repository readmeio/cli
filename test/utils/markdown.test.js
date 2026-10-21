import { describe, expect, test, it } from 'vitest';

import { parseFrontmatter, toFrontmatter, frontmatterWriteError } from '../../src/utils/markdown.js';

describe('#frontmatterWriteError()', () => {
  it('frontmatterWriteError guards write paths against failed parses', () => {
    const ok = parseFrontmatter('---\ntitle: ok\n---\n# Body');
    expect(frontmatterWriteError(ok)).toBeNull();

    const bad = parseFrontmatter('---\na: 1\n  b: 2\n---\n# Body');
    const writeError = frontmatterWriteError(bad);
    expect(writeError).toBeInstanceOf(Error);
    expect(writeError.message).toMatch(/^Invalid frontmatter:/);

    // Empty data + body must not be treated as a safe rewrite target
    expect(bad.data).toStrictEqual({});
  });
});

describe('#parseFrontmatter()', () => {
  it('should parse and extract metadata from a piece fully populated content', () => {
    const content = `---
deprecated: true
hidden: true
title: Hello world!
excerpt: This is the excerpt for the hello world page!
link:
  new_tab: true
  url: https://example.com
---
# Hello world`;

    expect(parseFrontmatter(content)).toStrictEqual({
      content: '# Hello world',
      data: {
        deprecated: true,
        hidden: true,
        title: 'Hello world!',
        excerpt: 'This is the excerpt for the hello world page!',
        link: {
          new_tab: true,
          url: 'https://example.com',
        },
      },
    });
  });

  it('should extract unknown top-level and metadata keys', () => {
    const content = `---
title: test5
anotherCustomValue: anotherCustomValue
deprecated: true
metadata:
  description: string
  customField: customValue
  keywords:
    - string
  robots: index
---
# Body`;

    expect(parseFrontmatter(content)).toStrictEqual({
      content: '# Body',
      data: {
        title: 'test5',
        anotherCustomValue: 'anotherCustomValue',
        deprecated: true,
        metadata: {
          description: 'string',
          customField: 'customValue',
          keywords: ['string'],
          robots: 'index',
        },
      },
    });
  });

  it('should parse an unquoted value that contains a colon', () => {
    const content = `---
title: Upsert a contact from a CRM
description: GET → 404 ? POST : PATCH — the canonical sync pattern for any CRM integration.
hidden: false
recipe:
  color: '#018FF4'
  icon: 🔄
---
# Body`;

    expect(parseFrontmatter(content)).toStrictEqual({
      content: '# Body',
      data: {
        title: 'Upsert a contact from a CRM',
        description: 'GET → 404 ? POST : PATCH — the canonical sync pattern for any CRM integration.',
        hidden: false,
        recipe: {
          color: '#018FF4',
          icon: '🔄',
        },
      },
    });
  });

  it('should parse several unquoted colon values, including apostrophes and nested keys', () => {
    const content = `---
title: Sync
excerpt: say "hello": world
metadata:
  description: it's the : pattern
---
# Body`;

    expect(parseFrontmatter(content)).toStrictEqual({
      content: '# Body',
      data: {
        title: 'Sync',
        excerpt: 'say "hello": world',
        metadata: {
          description: "it's the : pattern",
        },
      },
    });
  });

  it('should leave block scalar text alone when a sibling value contains a colon', () => {
    const content = `---
title: ok
body: |
  keep: this : text
folded: >
  also: keep this : text
description: POST : PATCH
---
# Body`;

    expect(parseFrontmatter(content)).toStrictEqual({
      content: '# Body',
      data: {
        title: 'ok',
        body: 'keep: this : text\n',
        folded: 'also: keep this : text\n',
        description: 'POST : PATCH',
      },
    });
  });

  it('should parse an unquoted colon value that uses a tab, and drop a trailing comment', () => {
    const content = `---
description: POST :\tPATCH # note
---
# Body`;

    expect(parseFrontmatter(content)).toStrictEqual({
      content: '# Body',
      data: {
        description: 'POST :\tPATCH',
      },
    });
  });

  it('should keep a non-breaking space before a hash inside the value', () => {
    const content = `---
description: POST : PATCH\u00a0#tag
---
# Body`;

    expect(parseFrontmatter(content)).toStrictEqual({
      content: '# Body',
      data: {
        description: 'POST : PATCH\u00a0#tag',
      },
    });
  });

  it('should repair nine unquoted colon values within the parse attempt cap', () => {
    const fields = Array.from({ length: 9 }, (_, index) => `field${index}: value : ${index}`).join('\n');
    const content = `---\n${fields}\n---\n# Body`;

    expect(parseFrontmatter(content)).toStrictEqual({
      content: '# Body',
      data: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`field${index}`, `value : ${index}`])),
    });
  });

  it('should give up when unquoted colon values need more than ten parses', () => {
    const fields = Array.from({ length: 10 }, (_, index) => `field${index}: value : ${index}`).join('\n');
    const content = `---\n${fields}\n---\n# Body`;

    const result = parseFrontmatter(content);
    expect(result.content).toBe('# Body');
    expect(result.data).toStrictEqual({});
    expect(result.error, 'YAML failure is surfaced on `error`').toBeDefined();
  });

  it('should leave frontmatter empty when a mapping is mis-indented', () => {
    const content = `---
a: 1
  b: 2
---
# Body`;

    const result = parseFrontmatter(content);
    expect(result.content).toBe('# Body');
    expect(result.data).toStrictEqual({});
    expect(result.error, 'YAML failure is surfaced on `error`').toBeDefined();
  });

  it('should parse and extract metadata from a piece sparsely-populated content', () => {
    const content = `---
title: Hello world!
---
`;

    expect(parseFrontmatter(content)).toStrictEqual({
      content: '',
      data: {
        title: 'Hello world!',
      },
    });
  });

  describe('quirks', () => {
    it('should be able to handle frontmatter that is preceded with linebreaks', () => {
      const content = `

---
title: title
hidden: true
deprecated: true
link:
  new_tab: true
  url: http://example.com
---
# Hello world`;

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Hello world',
        data: {
          deprecated: true,
          hidden: true,
          link: { new_tab: true, url: 'http://example.com' },
          title: 'title',
        },
      });
    });

    it('should preserve leading newline in body when present after closing ---', () => {
      // When there's a blank line after ---, preserve it in the body
      const content = '---\nname: test\n---\n\n# Content';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '\n# Content',
        data: {
          name: 'test',
        },
      });
    });

    it('should not add leading newline in body when not present after closing ---', () => {
      // When there's no blank line after ---, body starts immediately
      const content = '---\nname: test\n---\n# Content';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Content',
        data: {
          name: 'test',
        },
      });
    });

    it('should strip BOM (Byte Order Mark) from content', () => {
      // Add BOM character (U+FEFF) to the beginning of content
      const contentWithBOM = '\uFEFF---\ntitle: Hello BOM!\n---\n# Content with BOM';

      expect(parseFrontmatter(contentWithBOM)).toStrictEqual({
        content: '# Content with BOM',
        data: {
          title: 'Hello BOM!',
        },
      });
    });

    it('should strip BOM even when there is no frontmatter', () => {
      const contentWithBOM = '\uFEFF# Just content with BOM';

      expect(parseFrontmatter(contentWithBOM)).toStrictEqual({
        content: '# Just content with BOM',
        data: {},
      });
    });

    it('should handle windows line endings', () => {
      const content = '---\r\ntitle: windows line ending\r\n---\r\n# Content with windows line endings\r\n';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Content with windows line endings\n',
        data: { title: 'windows line ending' },
      });
    });

    it('should handle partial header with windows line endings', () => {
      const content = '---\r\ntitle: windows line ending\r\n';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '',
        data: { title: 'windows line ending' },
      });
    });

    it('should handle empty frontmatter', () => {
      const content = '---\n\n---\n# Content';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Content',
        data: {},
      });
    });

    it('should handle empty frontmatter with adjacent fences', () => {
      // No blank line between opening and closing ---
      const content = '---\n---\n# Content';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Content',
        data: {},
      });
    });

    it('should keep body content that appears before a later --- after empty adjacent fences', () => {
      // Regression: the old regex missed `---\n---`, treated the body as YAML, then
      // used a later `---` as the closing fence and dropped everything before it.
      const content = '---\n---\n# Intro\n\n---\n\nMore content';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Intro\n\n---\n\nMore content',
        data: {},
      });
    });

    it('should allow trailing spaces and tabs on fence lines', () => {
      const content = '--- \ntitle: spaced\n---\t\n# Content';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Content',
        data: { title: 'spaced' },
      });
    });

    it('should allow trailing whitespace on adjacent empty fences', () => {
      const content = '--- \n---\t\n# Content';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Content',
        data: {},
      });
    });

    it('should keep quoted --- inside YAML values when fences are adjacent-safe', () => {
      const content = '---\ntitle: "---"\n---\n# Content';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Content',
        data: { title: '---' },
      });
    });

    it('should handle mixed line endings', () => {
      const content = '---\r\ntitle: Mixed\nexcerpt: Unix here\r\n---\n# Content';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Content',
        data: { title: 'Mixed', excerpt: 'Unix here' },
      });
    });

    it('should handle frontmatter without a closing delimiter', () => {
      const content = '---\ntitle: Test\nexcerpt: No closing delimiter';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '',
        data: {
          title: 'Test',
          excerpt: 'No closing delimiter',
        },
      });
    });

    it('should handle frontmatter without closing delimiter and with body content', () => {
      // This is a bit ambiguous - without a closing ---, everything after could be
      // considered part of the frontmatter. Our implementation treats everything
      // after the opening --- as frontmatter if there's no closing ---
      const content = '---\ntitle: Test\n';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '',
        data: {
          title: 'Test',
        },
      });
    });
  });

  describe('non-object YAML types', () => {
    it('should return empty object when frontmatter is a boolean', () => {
      const content = '---\ntrue\n---\n# Content';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Content',
        data: {},
      });
    });

    it('should return empty object when frontmatter is a string', () => {
      const content = '---\njust a string\n---\n# Content';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Content',
        data: {},
      });
    });

    it('should return empty object when frontmatter is a number', () => {
      const content = '---\n42\n---\n# Content';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Content',
        data: {},
      });
    });

    it('should return empty object when frontmatter is an array', () => {
      const content = '---\n- one\n- two\n---\n# Content';

      expect(parseFrontmatter(content)).toStrictEqual({
        content: '# Content',
        data: {},
      });
    });
  });
});

describe('#toFrontmatter()', () => {
  describe('given an empty object', () => {
    it('should not generate any frontmatter', () => {
      expect(toFrontmatter({})).toBe('');
    });
  });

  describe('given an object containing null values', () => {
    it('should remove them', () => {
      const data = {
        hidden: null,
        title: 'Getting Started',
        deprecated: null,
        excerpt: null,
        metadata: {
          description: null,
          image: null,
          keywords: null,
          robots: null,
          title: null,
        },
        next: {
          description: null,
          pages: null,
        },
        link: null,
        api: null,
      };

      expect(toFrontmatter(data)).toBe(`---
title: Getting Started
---`);
    });
  });

  describe('given a changelog author', () => {
    it('should serialize it', () => {
      expect(
        toFrontmatter({
          title: 'Launch week',
          author: 'Buster',
          published_at: '2026-08-07T00:00:00.000Z',
        }),
      ).toBe(`---
title: Launch week
author: Buster
published_at: '2026-08-07T00:00:00.000Z'
---`);
    });

    it('should drop the key entirely when null, which is how a byline is cleared', () => {
      expect(
        toFrontmatter({
          title: 'Launch week',
          author: null,
        }),
      ).toBe(`---
title: Launch week
---`);
    });
  });

  describe('given an object', () => {
    it('should generate valid frontmatter', () => {
      const data = {
        hidden: false,
        title: 'Getting Started',
        deprecated: true,
        excerpt: 'This is the excerpt',
        metadata: {
          description: 'This is the description',
          image: 'https://example.com/image.jpg',
          keywords: ['keyword1', 'keyword2'],
          robots: 'index',
          title: 'Getting Started',
        },
        next: {
          description: 'This is the next description',
          pages: [
            {
              slug: 'page1',
              title: 'Page 1',
              type: 'basic',
            },
            {
              slug: 'getPets',
              title: 'Get Pets',
              type: 'endpoint',
            },
            {
              title: 'External Link',
              type: 'link',
              url: 'https://example.com',
            },
          ],
        },
      };

      expect(toFrontmatter(data)).toBe(`---
title: Getting Started
excerpt: This is the excerpt
deprecated: true
hidden: false
metadata:
  title: Getting Started
  description: This is the description
  image: https://example.com/image.jpg
  keywords:
    - keyword1
    - keyword2
  robots: index
next:
  description: This is the next description
  pages:
    - slug: page1
      title: Page 1
      type: basic
    - slug: getPets
      title: Get Pets
      type: endpoint
    - title: External Link
      type: link
      url: https://example.com
---`);
    });

    it('should be ordered properly', () => {
      // Order should be title, description/excerpt, type, {..alphabetical}
      const data = {
        hidden: false,
        deprecated: true,
        excerpt: 'This is the excerpt',
        metadata: {
          description: 'This is the description',
          image: 'https://example.com/image.jpg',
          keywords: ['keyword1', 'keyword2'],
          robots: 'index',
          title: 'Getting Started',
        },
        title: 'Getting Started',
        next: {
          description: 'This is the next description',
          pages: [
            {
              slug: 'page1',
              title: 'Page 1',
              type: 'basic',
            },
            {
              slug: 'getPets',
              title: 'Get Pets',
              type: 'endpoint',
            },
            {
              title: 'External Link',
              type: 'link',
              url: 'https://example.com',
            },
          ],
        },
      };

      expect(toFrontmatter(data)).toBe(`---
title: Getting Started
excerpt: This is the excerpt
deprecated: true
hidden: false
metadata:
  title: Getting Started
  description: This is the description
  image: https://example.com/image.jpg
  keywords:
    - keyword1
    - keyword2
  robots: index
next:
  description: This is the next description
  pages:
    - slug: page1
      title: Page 1
      type: basic
    - slug: getPets
      title: Get Pets
      type: endpoint
    - title: External Link
      type: link
      url: https://example.com
---`);
    });

    it('should keep unknown top-level and metadata keys', () => {
      const data = {
        title: 'test5',
        anotherCustomValue: 'anotherCustomValue',
        deprecated: true,
        metadata: {
          description: 'string',
          customField: 'customValue',
          keywords: ['string'],
          robots: 'index',
        },
      };

      expect(toFrontmatter(data)).toBe(`---
title: test5
anotherCustomValue: anotherCustomValue
deprecated: true
metadata:
  description: string
  customField: customValue
  keywords:
    - string
  robots: index
---`);
    });
  });
});
