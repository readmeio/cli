import { createRequire } from 'node:module';

import { printEyes, animate, expressions, animations } from '../utils/eyes.js';
import { binName } from '../utils/styles.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

export const command = 'eyes [variant]';
export const hidden = true;
export const skipBootstrap = true;

export async function run(variant) {
  if (!variant) {
    console.log('');
    const ctrl = animate('all', { indent: '  ', version: pkg.version, binName: binName() });
    process.on('SIGINT', () => {
      ctrl.stop();
      process.exit();
    });
    return;
  }

  if (expressions[variant]) {
    console.log('');
    printEyes(variant, '  ');
    console.log('');
  } else if (animations[variant]) {
    console.log('');
    const ctrl = animate(variant, { indent: '  ', version: pkg.version, binName: binName() });
    process.on('SIGINT', () => {
      ctrl.stop();
      process.exit();
    });
  } else {
    console.error(
      `Unknown: "${variant}". Try: ${[...Object.keys(expressions), ...Object.keys(animations)].join(', ')}`,
    );
    process.exit(1);
  }
}
