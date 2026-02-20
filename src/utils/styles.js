import path from 'node:path';
import chalk from 'chalk';

/** Returns the CLI name depending on how it was invoked (e.g. "readme", "readme_", or "npx @readmeio/cli-beta"). */
export function binName() {
  const base = path.basename(process.argv[1] || 'readme');

  // When run via npx, the binary name is a temp path — use the package name instead
  if (process.env.npm_execpath && !['readme', 'readme_'].includes(base)) {
    const pkg = process.env.npm_package_name;
    if (pkg) return `npx ${pkg}`;
    return 'npx @readmeio/cli-beta';
  }

  return base;
}

export const brand = chalk.hex('#018ef5'); // ReadMe blue
export const success = chalk.green;
export const warn = chalk.yellow;
export const err = chalk.red;
export const orange = chalk.hex('#ff9540');
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
