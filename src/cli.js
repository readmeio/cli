import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { createRequire } from 'node:module';
import bootstrap from './bootstrap.js';
import * as styles from './utils/styles.js';
import { header, setPalette } from './utils/eyes.js';
import { loadPet, applyDecay, getPetHeader } from './utils/tamagotchi.js';
import { getRandomTip } from './utils/tips.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const isRunningInClaude = !!process.env.CLAUDECODE;

export async function main() {
  const program = new Command();

  // Load tamagotchi state if it exists for personalized header
  let petGreeting, petExpression;
  let hasPet = false;
  if (!isRunningInClaude) {
    try {
      const pet = loadPet();
      if (pet) {
        hasPet = true;
        if (pet.color) setPalette(pet.color);
        const updated = applyDecay(pet);
        ({ greeting: petGreeting, expression: petExpression } = getPetHeader(updated));
      }
    } catch {
      // No pet yet, use defaults
    }
  }

  program
    .name(styles.binName())
    .version(pkg.version, '-v, --version')
    .option('--no-check', 'Skip ReadMe project validation checks');

  if (!isRunningInClaude) {
    program.addHelpText('beforeAll', () => {
      return '\n' + header({
        version: pkg.version,
        binName: styles.binName(),
        greeting: petGreeting,
        expression: petExpression,
      }).map(l => '  ' + l).join('\n') + '\n';
    });
  }

  // Auto-discover and register every command in src/commands/
  const commandsDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'commands');
  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'));

  // Load all modules, then sort by order (default 0)
  const mods = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(commandsDir, file)).href);
    mods.push(mod);
  }
  mods.sort((a, b) => (a.order || 0) - (b.order || 0));

  for (const mod of mods) {
    const isPlay = mod.command === 'play';
    const hidePlay = isPlay && (!hasPet || isRunningInClaude);
    const cmd = program.command(mod.command, { hidden: !!((mod.hidden && !isPlay) || hidePlay) });

    if (mod.description) {
      const desc = mod.beta ? `${mod.description} ${styles.brand('[beta]')}` : mod.description;
      cmd.description(desc);
    }
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
      if (mod.skipBootstrap) {
        await mod.run(...args);
      } else {
        const ctx = await bootstrap({ skipValidation: !program.opts().check });
        await mod.run(...args, ctx);
      }
    });
  }

  // Show a random tip after help
  program.addHelpText('afterAll', () => {
    const tip = getRandomTip({ command: 'help' });
    if (tip) {
      let output = '';
      const origLog = console.log;
      console.log = (...args) => { output += args.join(' ') + '\n'; };
      tip.render();
      console.log = origLog;
      return '\n' + output;
    }
    return '';
  });

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

  // Support colon syntax (e.g. "eyes:right" → "eyes right")
  const argv = [...process.argv];
  const cmdArg = argv[2];
  if (cmdArg && cmdArg.includes(':') && !program.commands.some((c) => c.name() === cmdArg)) {
    const [base, ...rest] = cmdArg.split(':');
    argv.splice(2, 1, base, rest.join(':'));
  }

  await program.parseAsync(argv);
}
