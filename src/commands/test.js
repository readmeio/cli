import * as styles from '../utils/styles.js';

export const command = 'test';
export const description = 'A simple test command';

export function run() {
  console.log();
  console.log(`  ${styles.logo()}  ${styles.success('hello!')}`);
  console.log();
}
