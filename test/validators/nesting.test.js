import { expect, test } from 'vitest';

import { validateAll } from '../../src/validators/nesting.js';

test('pages up to 5 levels under a category are not flagged', () => {
  const files = [
    'docs/Category/one.md',
    'docs/Category/one/index.md',
    'docs/Category/one/two/three.md',
    'docs/Category/one/two/three/four.md',
    'docs/Category/one/two/three/four/five.md',
    'reference/Category/one/two/three/four/five.md',
  ];
  expect(validateAll(files)).toBeNull();
});

test('a sixth level under a category is flagged once per folder', () => {
  const res = validateAll([
    'docs/Category/one/two/three/four/five/six.md',
    'docs/Category/one/two/three/four/five/six-b.md',
    'reference/Category/one/two/three/four/five/six.md',
  ]);
  expect(res).toHaveLength(2);
  expect(res[0]).toMatchObject({
    file: 'docs/Category/one/two/three/four/five',
    rule: 'nesting',
    severity: 'warning',
  });
  expect(res[0].message).toBe(
    'Too deeply nested: "docs/Category/one/two/three/four/five" is 6 levels deep (only 5 will render in the sidebar)',
  );
  expect(res[1].file).toBe('reference/Category/one/two/three/four/five');
});

test('folders are still rejected in flat directories', () => {
  const res = validateAll(['recipes/nested/recipe.md']);
  expect(res).toHaveLength(1);
  expect(res[0].message).toContain('Folders not supported');
});
