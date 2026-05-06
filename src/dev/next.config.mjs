import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  outputFileTracingRoot: __dirname,
  // When installed via `npx`, this directory lives inside `node_modules`, and
  // Next's SWC loader excludes `node_modules` from JSX transformation by
  // default. Marking our own package as a transpile target bypasses that.
  transpilePackages: ['@readme/cli'],
  serverExternalPackages: ['gray-matter', 'js-yaml', '@readme/markdown'],
  webpack: (config) => {
    // Suppress noisy cache serialization warnings from large @readme/markdown bundle
    config.infrastructureLogging = {
      ...config.infrastructureLogging,
      level: 'error',
    };
    return config;
  },
};
