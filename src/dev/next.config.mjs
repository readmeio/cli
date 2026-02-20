import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ['gray-matter', 'js-yaml', 'marked'],
};
