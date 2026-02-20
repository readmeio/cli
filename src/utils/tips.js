import * as styles from './styles.js';

const tips = [
  {
    condition: (ctx) => !ctx.isRunningInClaude && ctx.workflowOutdated,
    render() {
      console.log(`  💡 ${styles.bold('Tip:')} Your GitHub Action is out of date!`);
      console.log(`     ${styles.dim('⎿')}  ${styles.orange(`${styles.binName()} setup:github`)}`);
      console.log();
    },
  },
  {
    condition: (ctx) => !ctx.isRunningInClaude && ctx.hasClaude,
    render() {
      console.log(`  💡 ${styles.bold('Tip:')} Claude can fix these issues for you easily!`);
      console.log(`     ${styles.dim('⎿')}  ${styles.orange(`claude "run '${styles.binName()} lint' and fix the issues"`)}`);
      console.log();
    },
  },
  {
    condition: (ctx) => !ctx.isRunningInClaude && !ctx.hasClaude,
    render() {
      console.log(`  💡 ${styles.bold('Tip:')} Install Claude to automatically fix these issues!`);
      console.log(`     ${styles.dim('⎿')}  ${styles.dim('https://claude.ai/download')}`);
      console.log();
    },
  },
  {
    condition: (ctx) => !ctx.isRunningInClaude && ctx.hasGithubRemote && !ctx.hasGithubWorkflow,
    render() {
      console.log(`  💡 ${styles.bold('Tip:')} Set up GitHub Actions to lint your docs on every PR!`);
      console.log(`     ${styles.dim('⎿')}  ${styles.orange(`${styles.binName()} setup:github`)}`);
      console.log();
    },
  },
];

export function getRandomTip(context) {
  const eligible = tips.filter((t) => t.condition(context));
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}
