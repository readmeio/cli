import oxfmtConfig from '@readme/oxlint-config/oxfmt';
import { defineConfig } from 'oxfmt';

export default defineConfig(
  Object.assign(structuredClone(oxfmtConfig), {
    sortImports: {
      ...oxfmtConfig.sortImports,
    },
    ignorePatterns: [
      'coverage/',
      'dist/',
      'dist-gha/',
      'vendor/git-format/CLAUDE.md', // This file is vendored, don't worry about it.
    ],
  }),
);
