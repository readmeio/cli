import oxlintConfig from '@readme/oxlint-config';
import oxlintConfigVitest from '@readme/oxlint-config/testing/vitest';
import oxlintConfigTS from '@readme/oxlint-config/typescript';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [oxlintConfig, oxlintConfigTS],
  options: {
    reportUnusedDisableDirectives: 'error',
  },
  ignorePatterns: ['coverage/', 'dist/', 'dist-gha/'],
  categories: {
    suspicious: 'error',
  },
  env: {
    // commonjs: true,
    es2022: true,
    node: true,
  },
  rules: {
    'no-console': 'off',
    'no-continue': 'off',
    'no-underscore-dangle': 'off',
    'unicorn/catch-error-name': [
      'error',
      {
        ignore: ['^(error|err|e)$', 'bundleErr', 'validateErr'],
      },
    ],

    /** @fixme */
    'array-callback-return': 'off',
    'default-param-last': 'off',
    'import/no-mutable-exports': 'off',
    'no-await-in-loop': 'off',
    'no-control-regex': 'off',
    'no-empty': 'off',
    'no-loop-func': 'off',
    'no-lonely-if': 'off',
    'no-param-reassign': 'off',
    'no-plusplus': 'off',
    'no-promise-executor-return': 'off',
    'no-script-url': 'off',
    'no-shadow': 'off',
    'no-unused-vars': 'off',
    'no-unmodified-loop-condition': 'off',
    'no-use-before-define': 'off',
    'prefer-regex-literals': 'off',
    radix: 'off',
    'readme/json-parse-try-catch': 'off',
    'unicorn/consistent-function-scoping': 'off',
    'unicorn/new-for-builtins': 'off',
    'unicorn/no-array-sort': 'off',
    'unicorn/no-array-reverse': 'off',
    'unicorn/no-new-array': 'off',
    'unicorn/prefer-array-find': 'off',
  },
  overrides: [
    {
      files: ['src/dev/app/**'],
      rules: {
        'import/no-unassigned-import': ['error', { allow: ['**/*.css'] }],
      },
    },
    {
      files: ['test/**/*.test.{js,ts}'],
      ...oxlintConfigVitest,
      rules: oxlintConfigVitest.rules,
    },
  ],
});
