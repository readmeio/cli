import path from 'node:path';
import chalk from 'chalk';

/** Returns "readme" or "readme_" depending on how the CLI was invoked. */
export function binName() {
  return path.basename(process.argv[1] || 'readme');
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
