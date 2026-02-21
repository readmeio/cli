import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  outputFileTracingRoot: __dirname,
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
