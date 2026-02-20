import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { createRequire } from 'node:module';
import bootstrap from './bootstrap.js';
import * as styles from './utils/styles.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export async function main() {
  const program = new Command();

  program
    .name('readme')
    .description(`${styles.logo()} — the ReadMe CLI`)
    .version(pkg.version, '-v, --version')
    .option('--no-check', 'Skip ReadMe project validation checks');

  // Auto-discover and register every command in src/commands/
  const commandsDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'commands');
  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(commandsDir, file)).href);
    const cmd = program.command(mod.command);

    if (mod.description) cmd.description(mod.description);
    if (mod.args) mod.args(cmd); // let the command define its own arguments/options

    cmd.action(async (...args) => {
      // Run bootstrap checks before every command
      const ctx = await bootstrap({ skipValidation: !program.opts().check });
      await mod.run(...args, ctx);
    });
  }

  // Friendly fallback for unknown commands
  program.on('command:*', ([cmd]) => {
    styles.error(`Unknown command: ${styles.bold(cmd)}`);
    styles.info('Run readme --help to see available commands.');
    process.exit(1);
  });

  // Show help if no command given
  if (process.argv.length <= 2) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(process.argv);
}
