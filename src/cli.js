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
    .name(styles.binName())
    .description(`${styles.logo()} — the ReadMe CLI`)
    .version(pkg.version, '-v, --version')
    .option('--no-check', 'Skip ReadMe project validation checks');

  // Auto-discover and register every command in src/commands/
  const commandsDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'commands');
  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'));

  const betaCommands = [];

  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(commandsDir, file)).href);
    const cmd = program.command(mod.command, { hidden: !!mod.beta });

    if (mod.beta) {
      betaCommands.push({ name: mod.command, description: mod.description || '' });
    }

    if (mod.description) cmd.description(mod.description);
    if (mod.aliases) {
      for (const alias of mod.aliases) {
        const hidden = program.command(alias, { hidden: true });
        if (mod.args) mod.args(hidden);
        hidden.action(async (...args) => {
          const ctx = await bootstrap({ skipValidation: !program.opts().check });
          await mod.run(...args, ctx);
        });
      }
    }
    if (mod.args) mod.args(cmd); // let the command define its own arguments/options

    cmd.action(async (...args) => {
      // Run bootstrap checks before every command
      const ctx = await bootstrap({ skipValidation: !program.opts().check });
      await mod.run(...args, ctx);
    });
  }

  // Add beta commands section to help output
  if (betaCommands.length > 0) {
    program.addHelpText('after', () => {
      const padWidth = Math.max(...betaCommands.map((c) => c.name.length)) + 2;
      const lines = betaCommands.map(
        (c) => `  ${styles.dim(`${c.name.padEnd(padWidth)}${c.description} (beta)`)}`,
      );
      return `\n${styles.dim('Beta Commands:')}\n${lines.join('\n')}\n`;
    });
  }

  // Friendly fallback for unknown commands
  program.on('command:*', ([cmd]) => {
    styles.error(`Unknown command: ${styles.bold(cmd)}`);
    styles.info(`Run ${styles.binName()} --help to see available commands.`);
    process.exit(1);
  });

  // Show help if no command given
  if (process.argv.length <= 2) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(process.argv);
}
