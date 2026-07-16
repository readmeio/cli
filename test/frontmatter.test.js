import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/validators/frontmatter.js';

function messages(result) {
  if (!result) return [];
  return (Array.isArray(result) ? result : [result]).map((r) => r.message);
}

test('reference page with api but no title is not flagged for missing title', () => {
  const content = '---\napi:\n  file: pets.json\n  operationId: listPets\n---\n';
  const result = validate({
    content,
    relativePath: 'reference/Pets/Other/listPets.md',
    filePath: '/tmp/listPets.md',
  });
  assert.ok(
    !messages(result).some((m) => m.includes("must have required property 'title'")),
    'missing-title error should be suppressed for api-backed reference pages',
  );
});

test('reference page WITHOUT api still requires title', () => {
  const content = '---\nexcerpt: just an excerpt\n---\n';
  const result = validate({
    content,
    relativePath: 'reference/loose.md',
    filePath: '/tmp/loose.md',
  });
  assert.ok(
    messages(result).some((m) => m.includes("must have required property 'title'")),
    'non-api reference pages should still require a title',
  );
});

test('docs page without title is still flagged', () => {
  const content = '---\nexcerpt: just an excerpt\n---\n';
  const result = validate({
    content,
    relativePath: 'docs/some-page.md',
    filePath: '/tmp/some-page.md',
  });
  assert.ok(
    messages(result).some((m) => m.includes("must have required property 'title'")),
    'docs pages should still require a title',
  );
});
