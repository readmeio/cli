import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { createRequire } from 'node:module';
import updateNotifier from 'update-notifier';
import bootstrap from './bootstrap.js';
import * as styles from './utils/styles.js';
import { header, setPalette, isAgenticCli } from './utils/eyes.js';
import { loadPet, applyDecay, getPetHeader } from './utils/tamagotchi.js';
import { getRandomTip } from './utils/tips.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const isRunningInClaude = isAgenticCli();

export async function main() {
  if (!isRunningInClaude) {
    updateNotifier({ pkg }).notify({ defer: true, isGlobal: true });
  }

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
  const commandsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'commands');
  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

  // Load all modules, then sort by order (default 0)
  const mods = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(commandsDir, file)).href);
    mods.push(mod);
  }
  mods.sort((a, b) => (a.order || 0) - (b.order || 0));

  // Map of registered primary commands to their category, for the categorized
  // help renderer below.
  const commandCategories = new Map();

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

    if (mod.category) commandCategories.set(cmd, mod.category);
  }

  // Suppress commander's auto-generated Commands: section — we render our own
  // categorized version below via addHelpText('after').
  program.configureHelp({ visibleCommands: () => [] });

  program.addHelpText('after', () => {
    // Group registered commands by category. The built-in `help` command
    // doesn't go through the loop above, so we add it manually.
    const groups = { 'Linting': [], 'OAS Tooling': [], 'Other': [] };
    for (const [cmd, category] of commandCategories.entries()) {
      if (cmd._hidden) continue;
      if (!groups[category]) groups[category] = [];
      groups[category].push(cmd);
    }
    // Commander's built-in help command isn't in program.commands — fetch via private getter.
    const helpCmd = program._getHelpCommand && program._getHelpCommand();
    if (helpCmd) groups['Other'].push(helpCmd);

    const allCmds = Object.values(groups).flat();
    if (allCmds.length === 0) return '';
    const nameWidth = Math.max(...allCmds.map((c) => c.name().length));

    // Map cmd → its source module so we can pull optional helpHint.
    const cmdToMod = new Map();
    for (const mod of mods) {
      const cmd = program.commands.find((c) => c.name() === mod.command);
      if (cmd) cmdToMod.set(cmd, mod);
    }

    const lines = [''];
    for (const [category, cmds] of Object.entries(groups)) {
      if (cmds.length === 0) continue;
      lines.push(`${styles.bold(`${category} Commands:`)}`);
      for (const cmd of cmds) {
        const name = cmd.name().padEnd(nameWidth);
        const desc = cmd.description() || '';
        lines.push(`  ${name}  ${desc}`);
        const hint = cmdToMod.get(cmd)?.helpHint;
        if (hint) {
          for (const hintLine of hint.split('\n')) {
            lines.push(`  ${' '.repeat(nameWidth)}  ${styles.dim(hintLine)}`);
          }
        }
      }
      lines.push('');
    }
    return lines.join('\n').trimEnd();
  });

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

  // Support colon syntax (e.g. "eyes:right" → "eyes right"). Find the first
  // non-flag positional so global options like --no-check don't bypass the rewrite.
  const argv = [...process.argv];
  let cmdIdx = 2;
  while (cmdIdx < argv.length && argv[cmdIdx].startsWith('-')) cmdIdx++;
  const cmdArg = argv[cmdIdx];
  if (cmdArg && cmdArg.includes(':') && !program.commands.some((c) => c.name() === cmdArg)) {
    const [base, ...rest] = cmdArg.split(':');
    argv.splice(cmdIdx, 1, base, rest.join(':'));
  }

  await program.parseAsync(argv);
}
