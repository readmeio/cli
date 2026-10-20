import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, toFrontmatter } from '../../src/utils/markdown.js';

describe('#parseFrontmatter()', () => {
  test('should parse and extract metadata from a piece fully populated content', () => {
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

    assert.deepEqual(parseFrontmatter(content), {
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
      }
    });
  });

  test('should extract unknown top-level and metadata keys', () => {
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

    assert.deepEqual(parseFrontmatter(content), {
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

  test('should parse an unquoted value that contains a colon', () => {
    const content = `---
title: Upsert a contact from a CRM
description: GET → 404 ? POST : PATCH — the canonical sync pattern for any CRM integration.
hidden: false
recipe:
  color: '#018FF4'
  icon: 🔄
---
# Body`;

    assert.deepEqual(parseFrontmatter(content), {
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

  test('should parse several unquoted colon values, including apostrophes and nested keys', () => {
    const content = `---
title: Sync
excerpt: say "hello": world
metadata:
  description: it's the : pattern
---
# Body`;

    assert.deepEqual(parseFrontmatter(content), {
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

  test('should leave block scalar text alone when a sibling value contains a colon', () => {
    const content = `---
title: ok
body: |
  keep: this : text
folded: >
  also: keep this : text
description: POST : PATCH
---
# Body`;

    assert.deepEqual(parseFrontmatter(content), {
      content: '# Body',
      data: {
        title: 'ok',
        body: 'keep: this : text\n',
        folded: 'also: keep this : text\n',
        description: 'POST : PATCH',
      },
    });
  });

  test('should parse an unquoted colon value that uses a tab, and drop a trailing comment', () => {
    const content = `---
description: POST :\tPATCH # note
---
# Body`;

    assert.deepEqual(parseFrontmatter(content), {
      content: '# Body',
      data: {
        description: 'POST :\tPATCH',
      },
    });
  });

  test('should keep a non-breaking space before a hash inside the value', () => {
    const content = `---
description: POST : PATCH\u00a0#tag
---
# Body`;

    assert.deepEqual(parseFrontmatter(content), {
      content: '# Body',
      data: {
        description: 'POST : PATCH\u00a0#tag',
      },
    });
  });

  test('should repair nine unquoted colon values within the parse attempt cap', () => {
    const fields = Array.from({ length: 9 }, (_, index) => `field${index}: value : ${index}`).join('\n');
    const content = `---\n${fields}\n---\n# Body`;

    assert.deepEqual(parseFrontmatter(content), {
      content: '# Body',
      data: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`field${index}`, `value : ${index}`])),
    });
  });

  test('should give up when unquoted colon values need more than ten parses', () => {
    const fields = Array.from({ length: 10 }, (_, index) => `field${index}: value : ${index}`).join('\n');
    const content = `---\n${fields}\n---\n# Body`;

    assert.deepEqual(parseFrontmatter(content), {
      content: '# Body',
      data: {},
    });
  });

 test('should leave frontmatter empty when a mapping is mis-indented', () => {
    const content = `---
a: 1
  b: 2
---
# Body`;

    assert.deepEqual(parseFrontmatter(content), {
      content: '# Body',
      data: {},
    });
  });

   test('should parse and extract metadata from a piece sparsely-populated content', () => {
    const content = `---
title: Hello world!
---
`;

    assert.deepEqual(parseFrontmatter(content), {
      content: '',
      data: {
        title: 'Hello world!',
      },
    });
  });

  describe('quirks', () => {
    test('should be able to handle frontmatter that is preceded with linebreaks', () => {
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

      assert.deepEqual(parseFrontmatter(content), {
        content: '# Hello world',
        data: {
          deprecated: true,
          hidden: true,
          link: { new_tab: true, url: 'http://example.com' },
          title: 'title',
        },
      });
    });

    test('should preserve leading newline in body when present after closing ---', () => {
      // This matches gray-matter behavior: when there's a blank line after ---,
      // preserve it in the body
      const content = '---\nname: test\n---\n\n# Content';

      assert.deepEqual(parseFrontmatter(content), {
        content: '\n# Content',
        data: {
          name: 'test',
        },
      });
    });

    test('should not add leading newline in body when not present after closing ---', () => {
      // This matches gray-matter behavior: when there's no blank line after ---,
      // body starts immediately without leading newline
      const content = '---\nname: test\n---\n# Content';

      assert.deepEqual(parseFrontmatter(content), {
        content: '# Content',
        data: {
          name: 'test',
        },
      });
    });

    test('should strip BOM (Byte Order Mark) from content', () => {
      // Add BOM character (U+FEFF) to the beginning of content
      const contentWithBOM = '\uFEFF---\ntitle: Hello BOM!\n---\n# Content with BOM';

      assert.deepEqual(parseFrontmatter(contentWithBOM), {
        content: '# Content with BOM',
        data: {
          title: 'Hello BOM!',
        },
      });
    });

    test('should strip BOM even when there is no frontmatter', () => {
      const contentWithBOM = '\uFEFF# Just content with BOM';

      assert.deepEqual(parseFrontmatter(contentWithBOM), {
        content: '# Just content with BOM',
        data: {},
      });
    });

    test('should handle windows line endings', () => {
      const content = '---\r\ntitle: windows line ending\r\n---\r\n# Content with windows line endings\r\n';

      assert.deepEqual(parseFrontmatter(content), {
        content: '# Content with windows line endings\n',
        data: { title: 'windows line ending' },
      });
    });

    test('should handle partial header with windows line endings', () => {
      const content = '---\r\ntitle: windows line ending\r\n';

      assert.deepEqual(parseFrontmatter(content), {
        content: '',
        data: { title: 'windows line ending' },
      });
    });

    test('should handle empty frontmatter', () => {
      const content = '---\n\n---\n# Content';

      assert.deepEqual(parseFrontmatter(content), {
        content: '# Content',
        data: {},
      });
    });

    test('should handle mixed line endings', () => {
      const content = '---\r\ntitle: Mixed\nexcerpt: Unix here\r\n---\n# Content';

      assert.deepEqual(parseFrontmatter(content), {
        content: '# Content',
        data: { title: 'Mixed', excerpt: 'Unix here' },
      });
    });

    test('should handle frontmatter without a closing delimiter', () => {
      const content = '---\ntitle: Test\nexcerpt: No closing delimiter';

      assert.deepEqual(parseFrontmatter(content), {
        content: '',
        data: {
          title: 'Test',
          excerpt: 'No closing delimiter',
        },
      });
    });

    test('should handle frontmatter without closing delimiter and with body content', () => {
      // This is a bit ambiguous - without a closing ---, everything after could be
      // considered part of the frontmatter. Our implementation treats everything
      // after the opening --- as frontmatter if there's no closing ---
      const content = '---\ntitle: Test\n';

      assert.deepEqual(parseFrontmatter(content), {
        content: '',
        data: {
          title: 'Test',
        },
      });
    });
  });

  describe('non-object YAML types', () => {
    test('should return empty object when frontmatter is a boolean', () => {
      const content = '---\ntrue\n---\n# Content';

      assert.deepEqual(parseFrontmatter(content), {
        content: '# Content',
        data: {},
      });
    });

    test('should return empty object when frontmatter is a string', () => {
      const content = '---\njust a string\n---\n# Content';

      assert.deepEqual(parseFrontmatter(content), {
        content: '# Content',
        data: {},
      });
    });

    test('should return empty object when frontmatter is a number', () => {
      const content = '---\n42\n---\n# Content';

      assert.deepEqual(parseFrontmatter(content), {
        content: '# Content',
        data: {},
      });
    });

    test('should return empty object when frontmatter is an array', () => {
      const content = '---\n- one\n- two\n---\n# Content';

      assert.deepEqual(parseFrontmatter(content), {
        content: '# Content',
        data: {},
      });
    });
  });
});


describe('#toFrontmatter()', () => {
  describe('given an empty object', () => {
    test('should not generate any frontmatter', () => {
      assert.equal(toFrontmatter({}), '');
    });
  });

  describe('given an object containing null values', () => {
    test('should remove them', () => {
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

      assert.equal(
        toFrontmatter(data),
        `---
title: Getting Started
---`,
      );
    });
  });

  describe('given a changelog author', () => {
    test('should serialize it', () => {
      assert.equal(
        toFrontmatter({
          title: 'Launch week',
          author: 'Buster',
          published_at: '2026-08-07T00:00:00.000Z',
        }),
        `---
title: Launch week
author: Buster
published_at: '2026-08-07T00:00:00.000Z'
---`,
      );
    });

    test('should drop the key entirely when null, which is how a byline is cleared', () => {
      assert.equal(
        toFrontmatter({
          title: 'Launch week',
          author: null,
        }),
        `---
title: Launch week
---`,
      );
    });
  });

  describe('given an object', () => {
    test('should generate valid frontmatter', () => {
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

      assert.equal(
        toFrontmatter(data),
        `---
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
---`,
      );
    });

    test('should be ordered properly', () => {
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

      assert.equal(
        toFrontmatter(data),
        `---
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
---`,
      );
    });

    test('should keep unknown top-level and metadata keys', () => {
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

      assert.equal(
        toFrontmatter(data),
        `---
title: test5
anotherCustomValue: anotherCustomValue
deprecated: true
metadata:
  description: string
  customField: customValue
  keywords:
    - string
  robots: index
---`,
      );
    });
  });
});
