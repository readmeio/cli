import path from 'node:path';
import { createRequire } from 'node:module';
import chalk from 'chalk';

/** Returns the CLI name depending on how it was invoked (e.g. "readme", "readme_", or "npx @readme/cli-beta"). */
export function binName() {
  const base = path.basename(process.argv[1] || 'readme');

  // When run via npx, npm sets npm_command=exec. Use our own package.json name
  // (not npm_package_name, which refers to the CWD project, not the CLI).
  if (process.env.npm_command === 'exec') {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json');
    return `npx ${pkg.name}`;
  }

  return base;
}

export const brand = chalk.hex('#018ef5'); // ReadMe blue
export const success = chalk.green;
export const warn = chalk.yellow;
export const err = chalk.red;
export const orange = chalk.hex('#63D2FF');
export const dim = chalk.dim;
export const bold = chalk.bold;

export function logo() {
  return brand('🦉 readme');
}

export function heading(text) {
  return bold(brand(text));
}

export function info(message) {
  console.log(`${dim('›')} ${message}`);
}

export function error(message) {
  console.error(`${err('✘')} ${message}`);
}

export function ok(message) {
  console.log(`${success('✔')} ${message}`);
}

export function warning(message) {
  console.log(`${warn('⚠')} ${message}`);
}
