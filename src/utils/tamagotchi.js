import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import chalk from 'chalk';
import { eyes, expressions, palettes, setPalette } from './eyes.js';

// ── Data directory (XDG spec) ───────────────────────────

function getDataDir() {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'readme');
}

function getSavePath() {
  return path.join(getDataDir(), 'eyes.json');
}

// ── State management ────────────────────────────────────

const MAX_STAT = 10;
const DECAY_INTERVAL_MS = 1000 * 60 * 5; // stats decay every 5 minutes of real time

function newPet(name = 'Eyes', color = 'blue') {
  return {
    name,
    color,
    born: Date.now(),
    lastVisit: Date.now(),
    hunger: 8,    // 0 = starving, 10 = full
    happiness: 8, // 0 = miserable, 10 = ecstatic
    energy: 8,    // 0 = exhausted, 10 = wide awake
    sleeping: false,
    age: 0,       // total real-time minutes alive
  };
}

export function loadPet() {
  try {
    const data = JSON.parse(fs.readFileSync(getSavePath(), 'utf8'));
    return data;
  } catch {
    return null;
  }
}

function savePet(pet) {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getSavePath(), JSON.stringify(pet, null, 2));
}

export function applyDecay(pet) {
  const now = Date.now();
  const elapsed = now - pet.lastVisit;
  const ticks = Math.floor(elapsed / DECAY_INTERVAL_MS);

  if (ticks > 0) {
    pet.hunger = Math.max(0, pet.hunger - ticks);
    pet.happiness = Math.max(0, pet.happiness - Math.floor(ticks * 0.7));
    pet.energy = Math.min(MAX_STAT, pet.energy + Math.floor(ticks * 0.3)); // rests while you're away
    pet.lastVisit = now;
  }

  // Update age in minutes
  pet.age = Math.floor((now - pet.born) / 60000);
  return pet;
}

// ── Actions ─────────────────────────────────────────────

function feed(pet) {
  pet.sleeping = false;
  if (pet.hunger >= MAX_STAT) return 'Already full!';
  pet.hunger = Math.min(MAX_STAT, pet.hunger + 3);
  pet.energy = Math.min(MAX_STAT, pet.energy + 1);
  return `${pet.name} munches happily!`;
}

function play(pet) {
  pet.sleeping = false;
  if (pet.energy <= 0) return 'Too tired to play...';
  pet.happiness = Math.min(MAX_STAT, pet.happiness + 3);
  pet.hunger = Math.max(0, pet.hunger - 1);
  pet.energy = Math.max(0, pet.energy - 2);
  return `${pet.name} bounces around!`;
}

function nap(pet) {
  if (pet.sleeping) {
    pet.sleeping = false;
    return `${pet.name} wakes up! Good morning!`;
  }
  if (pet.energy >= MAX_STAT) return 'Not sleepy!';
  pet.sleeping = true;
  pet.energy = Math.min(MAX_STAT, pet.energy + 4);
  pet.happiness = Math.min(MAX_STAT, pet.happiness + 1);
  return `${pet.name} curls up for a nap... zzz`;
}

function petAction(petState) {
  petState.sleeping = false;
  petState.happiness = Math.min(MAX_STAT, petState.happiness + 2);
  return `${petState.name} loves the attention!`;
}

// ── Expression based on mood ────────────────────────────

function getMood(pet) {
  if (pet.sleeping) return 'sleeping';
  if (pet.energy <= 1) return 'sleeping';
  if (pet.hunger <= 1) return 'sad';
  if (pet.happiness >= 8 && pet.hunger >= 6) return 'happy';
  if (pet.happiness <= 2) return 'sad';
  return 'normal';
}

function getExpression(mood) {
  switch (mood) {
    case 'sleeping': return 'closed';
    case 'sad': return 'squint';
    case 'happy': return 'right';
    default: return 'right';
  }
}

/**
 * Get a greeting message and expression for the CLI header.
 * Returns { greeting, expression } based on current pet state.
 */
export function getPetHeader(pet) {
  const mood = getMood(pet);
  const expression = getExpression(mood);
  const name = pet.name;

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  let greeting;
  if (pet.sleeping) {
    greeting = pick([
      `${name} is sleeping... zzz`,
      `Shh... ${name} is napping`,
      `${name} is dreaming peacefully`,
    ]);
  } else if (pet.hunger <= 2) {
    greeting = pick([
      `${name} is really hungry!`,
      `${name} could use a snack...`,
      `${name}'s tummy is growling!`,
      `Feed me! says ${name}`,
    ]);
  } else if (pet.happiness <= 2) {
    greeting = pick([
      `${name} is feeling lonely`,
      `${name} could use some attention`,
      `${name} looks a bit sad`,
      `${name} misses you!`,
    ]);
  } else if (pet.energy <= 2) {
    greeting = pick([
      `${name} is exhausted...`,
      `${name} needs a nap`,
      `${name} can barely keep their eyes open`,
    ]);
  } else if (pet.happiness >= 8 && pet.hunger >= 6) {
    greeting = pick([
      `${name} says hi!`,
      `${name} is feeling great!`,
      `${name} is happy to see you!`,
      `${name} waves hello!`,
      `${name} is in a great mood!`,
      `${name} bounces excitedly!`,
    ]);
  } else {
    greeting = pick([
      `${name} says hi!`,
      `${name} is hanging out`,
      `${name} waves hello`,
      `${name} is doing alright`,
      `${name} is keeping busy`,
      `${name} looks your way`,
    ]);
  }

  return { greeting, expression };
}

// Animated expression sequence based on mood
function getAnimFrames(mood) {
  switch (mood) {
    case 'sleeping':
      return { frames: ['closed', 'closed', 'closed', 'squint', 'closed'], durations: [2000, 500, 2000, 300, 500] };
    case 'sad':
      return { frames: ['squint', 'squint', 'left', 'squint', 'squint', 'right', 'squint'], durations: [1000, 500, 800, 500, 500, 800, 500] };
    case 'happy':
      return {
        frames: ['right', 'right', 'right:up', 'right:up', 'right', 'left', 'right', 'half-blink', 'squint', 'closed', 'squint', 'half-blink', 'right', 'right'],
        durations: [600, 300, 150, 150, 300, 400, 400, 50, 50, 50, 50, 50, 300, 800],
      };
    default:
      return {
        frames: ['right', 'right', 'right', 'left', 'left', 'right', 'half-blink', 'squint', 'closed', 'squint', 'half-blink', 'right', 'right'],
        durations: [1200, 200, 400, 120, 600, 120, 50, 50, 50, 50, 50, 200, 1000],
      };
  }
}

// ── Rendering ───────────────────────────────────────────

function statBar(value, max, color) {
  const filled = Math.round((value / max) * 10);
  const empty = 10 - filled;
  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

function formatAge(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function renderStatus(pet) {
  const mood = getMood(pet);
  const moodEmoji = { sleeping: 'sleeping', sad: 'lonely', happy: 'happy!', normal: 'content' }[mood];

  const lines = [
    '',
    `  ${chalk.bold(pet.name)}  ${chalk.dim('age: ' + formatAge(pet.age))}  ${chalk.dim('mood: ')}${moodEmoji}`,
    '',
    `  ${chalk.hex('#ff6b6b')('hunger')}     ${statBar(pet.hunger, MAX_STAT, chalk.hex('#ff6b6b'))}  ${pet.hunger}/${MAX_STAT}`,
    `  ${chalk.hex('#ffd93d')('happiness')}  ${statBar(pet.happiness, MAX_STAT, chalk.hex('#ffd93d'))}  ${pet.happiness}/${MAX_STAT}`,
    `  ${chalk.hex('#6bcb77')('energy')}     ${statBar(pet.energy, MAX_STAT, chalk.hex('#6bcb77'))}  ${pet.energy}/${MAX_STAT}`,
    '',
    `  ${chalk.dim(`[f] feed  [p] play  [s] ${pet.sleeping ? 'wake' : 'sleep'}  [h] pet  [q] quit`)}`,
  ];
  return lines;
}

// ── Reset ───────────────────────────────────────────────

export function resetPet() {
  const savePath = getSavePath();
  try {
    fs.unlinkSync(savePath);
    console.log(chalk.dim('  Save data cleared. A new friend will hatch next time!'));
  } catch {
    console.log(chalk.dim('  No save data found.'));
  }
}

// ── Game loop ───────────────────────────────────────────

async function askSetup() {
  const { printEyes } = await import('./eyes.js');

  // Show the default eyes
  console.log('');
  printEyes('right', '  ');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => {
    rl.question(q, (answer) => resolve(answer.trim()));
  });

  // Ask name
  const name = (await ask(chalk.hex('#63D2FF')('  A new friend hatched! What will you name them? '))) || 'Eyes';

  // Show color options
  console.log('');
  const colorKeys = Object.keys(palettes);
  for (let i = 0; i < colorKeys.length; i++) {
    const p = palettes[colorKeys[i]];
    console.log(`  ${chalk.hex(p.body)('██')} ${chalk.bold(`${i + 1}.`)} ${p.name}`);
  }
  console.log('');

  const colorChoice = await ask(chalk.hex('#63D2FF')('  Pick a color (1-4): '));
  const colorIndex = parseInt(colorChoice, 10) - 1;
  const color = colorKeys[colorIndex] || 'blue';

  rl.close();
  return { name, color };
}

export async function startGame() {
  let petState = loadPet();
  let isNew = false;

  if (!petState) {
    isNew = true;
    const { name, color } = await askSetup();
    petState = newPet(name, color);
    savePet(petState);
  }

  // Apply saved color palette
  if (petState.color) setPalette(petState.color);

  petState = applyDecay(petState);
  savePet(petState);

  // Set up raw stdin for keypresses
  if (!process.stdin.isTTY) {
    console.log('Tamagotchi requires an interactive terminal.');
    return;
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  // Hide cursor
  process.stdout.write('\x1b[?25l');

  let message = isNew
    ? chalk.hex('#63D2FF')(`${petState.name} hatched! Take good care of them.`)
    : chalk.hex('#63D2FF')(`Welcome back! ${petState.name} missed you.`);
  let messageTimeout = null;
  let stopped = false;
  let animFrame = 0;
  let currentAnim = getAnimFrames(getMood(petState));

  function resolveFrame(frameName) {
    const isUp = frameName.endsWith(':up');
    const expr = isUp ? frameName.slice(0, -3) : frameName;
    const px = expressions[expr];
    if (!px) return eyes('right');
    // For bounce-up, we need the raw pixel data... just use normal for now
    // and handle :up by accessing the internal makeBounceUp
    if (isUp) {
      // Shift the rendered lines: add empty line at start, remove last
      const normal = eyes(expr);
      const empty = '  '.repeat(7);
      return [empty, ...normal.slice(0, -1)];
    }
    return eyes(expr);
  }

  function draw() {
    const mood = getMood(petState);
    currentAnim = getAnimFrames(mood);
    const frameName = expressionOverride || currentAnim.frames[animFrame % currentAnim.frames.length];
    const iconLines = resolveFrame(frameName);

    // Clear screen area
    process.stdout.write('\x1b[H\x1b[J');

    // Side effects: food animation, sleep scene, hearts, or play confetti
    const foodLines = getFoodLines();
    const isSleeping = petState.sleeping || petState.energy <= 1;
    const sleepStars = isSleeping ? getSleepScene(animFrame) : null;
    const hearts = getHeartOverlay();
    const sparkles = getPlayOverlay();

    console.log('');
    for (let r = 0; r < iconLines.length; r++) {
      let prefix = '    '; // 4 spaces = room for left-side effects
      let suffix = '';

      // Left side: hearts or sparkles
      if (hearts.left && hearts.left[r]) {
        prefix = '  ' + hearts.left[r];
      } else if (sparkles.left && sparkles.left[r]) {
        prefix = '  ' + sparkles.left[r];
      }

      // Right side: food, sleep stars, hearts, or sparkles
      if (foodLines && r < 3) {
        suffix = '  ' + foodLines[r];
      } else if (sleepStars && r < sleepStars.length) {
        suffix = sleepStars[r];
      } else if (hearts.right && hearts.right[r]) {
        suffix = hearts.right[r];
      } else if (sparkles.right && sparkles.right[r]) {
        suffix = sparkles.right[r];
      }

      console.log(prefix + iconLines[r] + suffix);
    }

    // Draw status
    const statusLines = renderStatus(petState);
    for (const line of statusLines) {
      console.log(line);
    }

    // Message line
    console.log('');
    console.log('  ' + (message || ''));
  }

  function clearMessage(delay = 3000) {
    if (messageTimeout) clearTimeout(messageTimeout);
    messageTimeout = setTimeout(() => {
      message = '';
      draw();
    }, delay);
  }

  // ── Sleep scene ──────────────────────────────────────
  function getSleepScene(frame) {
    // Stars at fixed grid positions, twinkling based on frame
    const grid = [
      //  each row is an array of { col, seed }
      [{ col: 4, seed: 0 }, { col: 12, seed: 3 }],
      [{ col: 8, seed: 5 }],
      [{ col: 3, seed: 2 }, { col: 14, seed: 7 }],
    ];

    function starChar(seed) {
      const t = (frame + seed) % 6;
      if (t < 2) return chalk.hex('#FFD700')('·');
      if (t < 4) return chalk.hex('#FFF8DC')('*');
      return chalk.dim('·');
    }

    const lines = grid.map(row => {
      // Build each row by placing stars at their column positions
      const cells = new Array(18).fill(' ');
      for (const star of row) {
        cells[star.col] = null; // placeholder
      }
      let out = '';
      for (let c = 0; c < cells.length; c++) {
        const star = row.find(s => s.col === c);
        out += star ? starChar(star.seed) : ' ';
      }
      return out;
    });

    // Add moon to first line
    lines[0] += ' 🌙';

    return lines.map(l => '  ' + l);
  }

  let feedAnimating = false;
  let feedFrame = -1;
  const allFood = ['🍕', '🌮', '🍎', '🧀', '🍪', '🥐', '🍣', '🍩', '🍔', '🌯', '🥨', '🍇', '🥕', '🍰'];
  let feedEmojis = [];

  function getFoodLines() {
    if (feedFrame < 0) return null;
    // 3 food items on separate rows, each at a staggered position,
    // scrolling right-to-left until they go "behind" the eyes (col 0)
    const lines = [];
    const iconWidth = 14; // 7 pixels * 2 chars each
    for (let row = 0; row < 3; row++) {
      const stagger = row * 3; // stagger each row by 3 frames
      const pos = feedFrame - stagger;
      if (pos >= 0 && pos < 12) {
        // pos 0 = right edge, pos 11 = behind the icon
        const spaces = Math.max(0, 11 - pos);
        lines.push(' '.repeat(spaces) + feedEmojis[row]);
      } else {
        lines.push('');
      }
    }
    return lines;
  }

  async function animateFeed() {
    feedAnimating = true;
    // Pick 3 random foods
    feedEmojis = [];
    const pool = [...allFood];
    for (let i = 0; i < 3; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      feedEmojis.push(pool.splice(idx, 1)[0]);
    }
    for (feedFrame = 0; feedFrame <= 16; feedFrame++) {
      draw();
      await new Promise(r => setTimeout(r, 100));
    }
    feedFrame = -1;
    feedAnimating = false;
  }

  let petAnimating = false;
  let petFrame = -1;

  // Hearts float upward: 3 hearts at staggered positions
  // Each heart has a row it appears on, drifting up over frames
  function getHeartOverlay() {
    if (petFrame < 0) return { left: null, right: null };
    const hearts = [
      { startFrame: 0, col: 'right', startRow: 2 },
      { startFrame: 3, col: 'left', startRow: 2 },
      { startFrame: 6, col: 'right', startRow: 1 },
    ];
    const leftLines = ['', '', '', ''];
    const rightLines = ['', '', '', ''];
    for (const h of hearts) {
      const age = petFrame - h.startFrame;
      if (age < 0 || age > 4) continue;
      const row = h.startRow - age;
      if (row < 0 || row > 3) continue;
      const heart = age < 2 ? chalk.hex('#ff6b9d')('♥') : chalk.hex('#ff6b9d').dim('♥');
      if (h.col === 'left') {
        leftLines[row] = heart + ' ';
      } else {
        rightLines[row] = ' ' + heart;
      }
    }
    return { left: leftLines, right: rightLines };
  }

  async function animatePet() {
    petAnimating = true;
    for (petFrame = 0; petFrame <= 12; petFrame++) {
      draw();
      await new Promise(r => setTimeout(r, 120));
    }
    petFrame = -1;
    petAnimating = false;
  }

  let playAnimating = false;
  let playFrame = -1;
  const confettiColors = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF6BD6', '#63D2FF'];

  function getPlayOverlay() {
    if (playFrame < 0) return { left: null, right: null };
    const leftLines = ['', '', '', ''];
    const rightLines = ['', '', '', ''];
    const spots = [
      { r: 0, side: 'left', seed: 0 },
      { r: 0, side: 'right', seed: 2 },
      { r: 1, side: 'left', seed: 1 },
      { r: 1, side: 'right', seed: 4 },
      { r: 2, side: 'left', seed: 3 },
      { r: 2, side: 'right', seed: 5 },
    ];
    for (const s of spots) {
      const visible = (playFrame + s.seed) % 3 !== 0;
      if (!visible) continue;
      const color = confettiColors[(playFrame + s.seed) % confettiColors.length];
      const ch = (playFrame + s.seed) % 2 === 0 ? '✦' : '·';
      const styled = chalk.hex(color)(ch);
      if (s.side === 'left') {
        leftLines[s.r] = styled + ' ';
      } else {
        rightLines[s.r] = ' ' + styled;
      }
    }
    return { left: leftLines, right: rightLines };
  }

  async function animatePlay() {
    playAnimating = true;
    for (playFrame = 0; playFrame <= 14; playFrame++) {
      draw();
      await new Promise(r => setTimeout(r, 100));
    }
    playFrame = -1;
    playAnimating = false;
  }

  let expressionOverride = null;

  async function animateSleep(falling) {
    // falling = true: eyes close. false: eyes open.
    const sequence = falling
      ? ['right', 'half-blink', 'squint', 'closed']
      : ['closed', 'squint', 'half-blink', 'right'];
    for (const expr of sequence) {
      expressionOverride = expr;
      draw();
      await new Promise(r => setTimeout(r, 120));
    }
    expressionOverride = null;
  }

  function doAction(actionFn) {
    if (actionBusy) return;
    const wasSleeping = petState.sleeping;
    message = actionFn(petState);
    petState.lastVisit = Date.now();
    savePet(petState);
    animFrame = 0;
    actionBusy = true;

    function done() {
      actionBusy = false;
      clearMessage();
    }

    if (actionFn === nap) {
      // Falling asleep or waking up
      animateSleep(petState.sleeping).then(() => { draw(); done(); });
    } else if (actionFn === feed) {
      const run = wasSleeping
        ? animateSleep(false).then(() => animateFeed())
        : animateFeed();
      run.then(done);
    } else if (actionFn === petAction) {
      const run = wasSleeping
        ? animateSleep(false).then(() => animatePet())
        : animatePet();
      run.then(done);
    } else if (actionFn === play) {
      const run = wasSleeping
        ? animateSleep(false).then(() => animatePlay())
        : animatePlay();
      run.then(done);
    } else {
      if (wasSleeping && !petState.sleeping) {
        animateSleep(false).then(() => { draw(); done(); });
      } else {
        draw();
        done();
      }
    }
  }

  function cleanup() {
    stopped = true;
    process.stdout.write('\x1b[?25h'); // show cursor
    process.stdin.setRawMode(false);
    process.stdin.pause();
    savePet(petState);
  }

  // Input handler
  process.stdin.on('data', (key) => {
    if (stopped) return;

    switch (key) {
      case 'f':
        doAction(feed);
        break;
      case 'p':
        doAction(play);
        break;
      case 's':
        doAction(nap);
        break;
      case 'h':
        doAction(petAction);
        break;
      case 'q':
      case '\u0003': // Ctrl+C
        cleanup();
        console.log('');
        console.log(`  ${chalk.dim(`${petState.name} waves goodbye!`)}`);
        console.log('');
        process.exit();
        break;
      default:
        break;
    }
  });

  let actionBusy = false;

  // Animation + decay loop
  async function gameLoop() {
    while (!stopped) {
      if (!actionBusy) {
        draw();
        animFrame++;
      }
      const duration = currentAnim.durations[animFrame % currentAnim.durations.length];
      await new Promise(r => setTimeout(r, duration));

      // Apply passive decay every loop cycle
      const now = Date.now();
      const elapsed = now - petState.lastVisit;
      if (elapsed >= DECAY_INTERVAL_MS) {
        petState = applyDecay(petState);
        savePet(petState);
      }
    }
  }

  if (isNew) {
    clearMessage(5000);
  } else {
    clearMessage();
  }

  await gameLoop();
}
