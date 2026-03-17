import * as styles from './styles.js';
import { loadPet } from './tamagotchi.js';

const tips = [
  {
    weight: 1,
    commands: ['lint', 'oas:validate'],
    condition: (ctx) => !ctx.isRunningInClaude && ctx.workflowOutdated,
    render() {
      console.log(`  💡 ${styles.bold('Tip:')} Your GitHub Action is out of date!`);
      console.log(`     ${styles.dim('⎿')}  ${styles.orange(`${styles.binName()} setup:github`)}`);
      console.log();
    },
  },
  {
    weight: 1,
    commands: ['lint', 'oas:validate'],
    condition: (ctx) => !ctx.isRunningInClaude && ctx.hasClaude,
    render() {
      console.log(`  💡 ${styles.bold('Tip:')} Claude can fix these issues for you easily!`);
      console.log(`     ${styles.dim('⎿')}  ${styles.orange(`claude "run '${styles.binName()} lint' and fix the issues"`)}`);
      console.log();
    },
  },
  {
    weight: 1,
    commands: ['lint', 'oas:validate'],
    condition: (ctx) => !ctx.isRunningInClaude && !ctx.hasClaude,
    render() {
      console.log(`  💡 ${styles.bold('Tip:')} Install Claude to automatically fix these issues!`);
      console.log(`     ${styles.dim('⎿')}  ${styles.dim('https://claude.ai/download')}`);
      console.log();
    },
  },
  {
    weight: 1,
    commands: ['lint', 'oas:validate'],
    condition: (ctx) => !ctx.isRunningInClaude && ctx.hasGithubRemote && !ctx.hasGithubWorkflow,
    render() {
      console.log(`  💡 ${styles.bold('Tip:')} Set up GitHub Actions to lint your docs on every PR!`);
      console.log(`     ${styles.dim('⎿')}  ${styles.orange(`${styles.binName()} setup:github`)}`);
      console.log();
    },
  },
  {
    weight: 0.1,
    condition: () => !loadPet(),
    render() {
      console.log(`  💡 ${styles.bold('Tip:')} Want a little friend? Run ${styles.orange(`${styles.binName()} play`)} to hatch one!`);
      console.log();
    },
  },
  {
    weight: 0.3,
    condition: () => !!loadPet(),
    render() {
      const pet = loadPet();
      console.log(`  💡 ${styles.bold('Tip:')} ${pet.name} misses you! Run ${styles.orange(`${styles.binName()} play`)} to check in.`);
      console.log();
    },
  },
];

/**
 * Get a random tip, optionally filtered by command name.
 * @param {object} context
 * @param {string} [context.command] - current command name (e.g. 'lint', 'help')
 */
export function getRandomTip(context) {
  const cmd = context.command;
  const eligible = tips.filter((t) => {
    // Filter by command if tip has a commands array
    if (t.commands && cmd && !t.commands.includes(cmd)) return false;
    // Tips without commands array show everywhere
    return t.condition(context);
  });
  if (eligible.length === 0) return null;

  // Weighted random selection
  const totalWeight = eligible.reduce((sum, t) => sum + (t.weight || 1), 0);
  let rand = Math.random() * totalWeight;
  for (const tip of eligible) {
    rand -= tip.weight || 1;
    if (rand <= 0) return tip;
  }
  return eligible[eligible.length - 1];
}
