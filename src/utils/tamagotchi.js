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

const ALL_TRICKS = ['wave', 'spin', 'roll over', 'bow', 'high five', 'peek-a-boo', 'dance', 'wink'];

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
    tricks: [],   // learned trick names
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
  if (petState.energy <= 1) return `${petState.name} is too tired for pets...`;
  petState.sleeping = false;
  petState.happiness = Math.min(MAX_STAT, petState.happiness + 2);
  return `${petState.name} loves the attention!`;
}

function teach(pet) {
  pet.sleeping = false;
  if (pet.energy <= 1) return 'Too tired to learn right now...';

  const known = pet.tricks || [];
  const unknown = ALL_TRICKS.filter(t => !known.includes(t));

  pet.energy = Math.max(0, pet.energy - 1);
  pet.hunger = Math.max(0, pet.hunger - 1);

  if (unknown.length === 0) {
    // Already knows everything — perform a random trick
    const trick = known[Math.floor(Math.random() * known.length)];
    pet.happiness = Math.min(MAX_STAT, pet.happiness + 1);
    return `${pet.name} does a ${trick}! Knows all ${known.length} tricks!`;
  }

  // Chance to learn based on happiness (happier = easier to teach)
  const learnChance = 0.3 + (pet.happiness / MAX_STAT) * 0.4; // 30%-70%
  if (Math.random() < learnChance) {
    const trick = unknown[Math.floor(Math.random() * unknown.length)];
    pet.tricks = [...known, trick];
    pet.happiness = Math.min(MAX_STAT, pet.happiness + 2);
    return `${pet.name} learned ${trick}! (${pet.tricks.length}/${ALL_TRICKS.length} tricks)`;
  }

  // Didn't learn this time
  const reactions = [
    `${pet.name} tilts their head... not quite`,
    `${pet.name} got distracted. Try again!`,
    `Almost! ${pet.name} is getting the hang of it`,
    `${pet.name} tries their best but needs more practice`,
  ];
  pet.happiness = Math.min(MAX_STAT, pet.happiness + 1);
  return reactions[Math.floor(Math.random() * reactions.length)];
}

// ── Expression based on mood ────────────────────────────

function getMood(pet) {
  if (pet.sleeping) return 'sleeping';
  if (pet.energy <= 1) return 'tired';
  if (pet.hunger <= 1) return 'sad';
  if (pet.happiness >= 8 && pet.hunger >= 6) return 'happy';
  if (pet.happiness <= 2) return 'sad';
  return 'normal';
}

function getExpression(mood) {
  switch (mood) {
    case 'sleeping': return 'closed';
    case 'tired': return 'squint';
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
      return {
        frames: ['closed', 'closed', 'closed', 'closed', 'squint', 'closed', 'closed', 'closed', 'squint', 'closed'],
        durations: [2000, 1000, 2000, 500, 100, 800, 1500, 500, 100, 1000],
      };
    case 'tired':
      return {
        frames: ['half-blink', 'half-blink', 'half-blink-left', 'half-blink', 'half-blink', 'half-blink-right', 'squint', 'half-blink', 'half-blink-left', 'half-blink', 'half-blink', 'half-blink-right', 'closed', 'half-blink', 'half-blink'],
        durations: [800, 600, 500, 1000, 400, 500, 150, 800, 500, 600, 800, 500, 200, 300, 1200],
      };
    case 'sad':
      return {
        frames: ['left', 'left', 'right', 'right', 'left', 'half-blink', 'squint', 'half-blink', 'left', 'left', 'right', 'left'],
        durations: [800, 400, 200, 800, 600, 80, 400, 80, 600, 400, 300, 800],
      };
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

const BOX_WIDTH = 53;

function boxVisLen(s) {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
  let len = 0;
  for (const ch of stripped) {
    const code = ch.codePointAt(0);
    len += code >= 0x1F000 ? 2 : 1;
  }
  return len;
}

function boxLine(content = '', bg = null) {
  const inner = BOX_WIDTH - 2;
  const padding = Math.max(0, inner - boxVisLen(content));
  const filled = content + ' '.repeat(padding);
  return chalk.dim('│') + (bg ? chalk.bgHex(bg)(filled) : filled) + chalk.dim('│');
}

function boxTop() {
  return chalk.dim('┌' + '─'.repeat(BOX_WIDTH - 2) + '┐');
}

function boxBottom() {
  return chalk.dim('└' + '─'.repeat(BOX_WIDTH - 2) + '┘');
}

function boxDivider() {
  return chalk.dim('├' + '─'.repeat(BOX_WIDTH - 2) + '┤');
}

const STATUS_LEFT = 22; // inner width of left column
const STATUS_RIGHT = BOX_WIDTH - 2 - STATUS_LEFT - 1; // -2 borders, -1 middle divider

function statusRow(leftContent, rightContent) {
  const lVis = boxVisLen(leftContent);
  const rVis = boxVisLen(rightContent);
  const lPad = Math.max(0, STATUS_LEFT - lVis);
  const rPad = Math.max(0, STATUS_RIGHT - rVis);
  return leftContent + ' '.repeat(lPad) + chalk.dim('│') + rightContent + ' '.repeat(rPad);
}

function statusDivider() {
  return chalk.dim('─'.repeat(STATUS_LEFT) + '┼' + '─'.repeat(STATUS_RIGHT));
}

function renderStatus(pet) {
  const mood = getMood(pet);
  const moodEmoji = { sleeping: 'sleeping', tired: 'tired', sad: 'lonely', happy: 'happy!', normal: 'content' }[mood];

  const lines = [
    statusRow(
      ` ${chalk.bold(pet.name)}`,
      ` ${chalk.dim('vitals')}`,
    ),
    statusRow(
      ` ${chalk.dim('age:')} ${formatAge(pet.age)}`,
      ` ${chalk.hex('#ff6b6b')('hunger')}  ${statBar(pet.hunger, MAX_STAT, chalk.hex('#ff6b6b'))}   ${String(pet.hunger).padStart(2)}/${MAX_STAT}`,
    ),
    statusRow(
      ` ${chalk.dim('mood:')} ${moodEmoji}`,
      ` ${chalk.hex('#ffd93d')('happy')}   ${statBar(pet.happiness, MAX_STAT, chalk.hex('#ffd93d'))}   ${String(pet.happiness).padStart(2)}/${MAX_STAT}`,
    ),
    statusRow(
      ` ${chalk.dim('tricks:')} ${(pet.tricks || []).length}/${ALL_TRICKS.length}`,
      ` ${chalk.hex('#6bcb77')('energy')}  ${statBar(pet.energy, MAX_STAT, chalk.hex('#6bcb77'))}   ${String(pet.energy).padStart(2)}/${MAX_STAT}`,
    ),
  ];
  return lines;
}

function renderActions(pet, activeKey = null) {
  const items = [
    { key: 'f', label: 'feed' },
    { key: 'p', label: 'play' },
    { key: pet.sleeping ? 'w' : 's', label: pet.sleeping ? 'wake' : 'sleep' },
    { key: 'h', label: 'pet' },
    { key: 't', label: 'teach' },
  ];
  const parts = items.map(({ key, label }) => {
    const text = `[${key}] ${label}`;
    return key === activeKey ? chalk.hex('#63D2FF')(text) : chalk.white(text);
  });
  return [` ${parts.join('  ')}`];
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
  let activeAction = null;
  let stopped = false;
  let animFrame = 0;
  let currentAnim = getAnimFrames(getMood(petState));

  function resolveFrame(frameName) {
    const isUp = frameName.endsWith(':up');
    const isDown = frameName.endsWith(':down');
    const expr = isUp ? frameName.slice(0, -3) : isDown ? frameName.slice(0, -5) : frameName;
    const px = expressions[expr];
    if (!px) return eyes('right');
    const normal = eyes(expr);
    const empty = '  '.repeat(7);
    if (isUp) {
      // Shift down: empty top, trim bottom
      return [empty, ...normal.slice(0, -1)];
    }
    if (isDown) {
      // Shift up: trim top, empty bottom
      return [...normal.slice(1), empty];
    }
    return normal;
  }

  const INNER = BOX_WIDTH - 2;
  const ICON_WIDTH = 14; // 7 pixels × 2 chars
  const PAD_LEFT = Math.floor((INNER - ICON_WIDTH) / 2);
  const PAD_RIGHT = INNER - ICON_WIDTH - PAD_LEFT;

  // Measure visible length of an ANSI string (accounts for double-width emoji)
  function visLen(s) {
    const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
    let len = 0;
    for (const ch of stripped) {
      const code = ch.codePointAt(0);
      // Emoji (surrogate pairs / high codepoints) are 2 cols, most symbols are 1
      len += code >= 0x1F000 ? 2 : 1;
    }
    return len;
  }

  // Pad a string (possibly with ANSI) to a fixed visible width
  function padRight(s, width) {
    const diff = width - visLen(s);
    return diff > 0 ? s + ' '.repeat(diff) : s;
  }

  function draw() {
    const mood = getMood(petState);
    currentAnim = getAnimFrames(mood);
    const frameName = frameOverride || currentAnim.frames[animFrame % currentAnim.frames.length];
    const iconLines = resolveFrame(frameName);

    process.stdout.write('\x1b[H\x1b[J');

    // Gather overlays
    const foodLines = getFoodLines();
    const isSleeping = petState.sleeping;
    const sleepStars = isSleeping ? getSleepScene(animFrame) : null;
    const hearts = getHeartOverlay();
    const sparkles = getPlayOverlay();

    // Build scene rows: [left area] [icon centered] [right area]
    const sceneRows = iconLines.map((iconLine, r) => {
      let leftStr = ' '.repeat(PAD_LEFT);
      let rightStr = ' '.repeat(PAD_RIGHT);

      // Pick the active overlay (only one can be active at a time)
      if (heartFrame >= 0 && hearts.left) {
        leftStr = padRight(hearts.left[r] || '', PAD_LEFT);
        rightStr = padRight(hearts.right[r] || '', PAD_RIGHT);
      } else if (playFrame >= 0 && sparkles.left) {
        leftStr = padRight(sparkles.left[r] || '', PAD_LEFT);
        rightStr = padRight(sparkles.right[r] || '', PAD_RIGHT);
      } else if (feedFrame >= 0 && foodLines && r < foodLines.length) {
        rightStr = padRight(foodLines[r] || '', PAD_RIGHT);
      } else if (sleepStars && sleepStars.left && r < sleepStars.left.length) {
        leftStr = padRight(sleepStars.left[r] || '', PAD_LEFT);
        rightStr = padRight(sleepStars.right[r] || '', PAD_RIGHT);
      }

      return leftStr + iconLine + rightStr;
    });

    // Status + actions
    const statusLines = renderStatus(petState);
    const actionLines = renderActions(petState, activeAction);

    // Petting hand overlay — two rows: palm + fingers, swaying
    function getPetHand() {
      if (petFrame < 0) return [];
      const offsets = [0, 1, 2, 3, 2, 1, 0, -1, -2, -1, 0, 1, 2];
      const offset = offsets[petFrame % offsets.length];
      const pos = PAD_LEFT + 2 + offset;
      const pad = ' '.repeat(Math.max(0, pos));
      const skin = chalk.hex('#FFCC88');
      return [
        pad + skin(' ╷╷╷╷'),
        pad + skin('╭┴┴┴┴╮'),
      ];
    }

    // Render with box border
    const footer = chalk.dim('[r] reset  [q] quit');
    const footerVis = '[r] reset  [q] quit'.length;
    console.log('');
    console.log('  ' + ' '.repeat(BOX_WIDTH - 2 - footerVis + 1) + footer);
    console.log('  ' + boxTop());
    const sceneBg = petState.sleeping ? '#05051a' : null;
    const handLines = getPetHand();
    if (handLines.length) {
      // Hand takes 2 rows, so skip the empty top row and trim the last scene row
      console.log('  ' + boxLine(handLines[0], sceneBg));
      console.log('  ' + boxLine(handLines[1], sceneBg));
      for (let i = 0; i < sceneRows.length - 1; i++) {
        console.log('  ' + boxLine(sceneRows[i], sceneBg));
      }
    } else {
      console.log('  ' + boxLine('', sceneBg));
      for (const row of sceneRows) {
        console.log('  ' + boxLine(row, sceneBg));
      }
    }
    // Message centered between scene and vitals
    const inner = BOX_WIDTH - 2;
    const msgVis = boxVisLen(message || '');
    const msgPadL = Math.floor((inner - msgVis) / 2);
    const msgPadR = inner - msgVis - msgPadL;
    console.log('  ' + boxDivider());
    console.log('  ' + chalk.dim('│') + ' '.repeat(msgPadL) + (message || '') + ' '.repeat(msgPadR) + chalk.dim('│'));
    console.log('  ' + chalk.dim('├' + '─'.repeat(STATUS_LEFT) + '┬' + '─'.repeat(STATUS_RIGHT) + '┤'));
    for (const line of statusLines) {
      console.log('  ' + boxLine(line));
    }
    console.log('  ' + chalk.dim('├' + '─'.repeat(STATUS_LEFT) + '┴' + '─'.repeat(STATUS_RIGHT) + '┤'));
    for (const line of actionLines) {
      console.log('  ' + boxLine(line));
    }
    console.log('  ' + boxBottom());
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
    // Stars on both sides of the centered icon
    function starChar(seed) {
      const t = (frame + seed) % 6;
      if (t < 2) return chalk.hex('#FFD700')('·');
      if (t < 4) return chalk.hex('#FFF8DC')('*');
      return chalk.dim('·');
    }

    const leftGrid = [
      [{ col: 3, seed: 0 }, { col: PAD_LEFT - 4, seed: 8 }],
      [{ col: 7, seed: 5 }],
      [{ col: 2, seed: 2 }, { col: PAD_LEFT - 3, seed: 9 }],
    ];

    const rightGrid = [
      [{ col: 2, seed: 3 }, { col: Math.min(10, PAD_RIGHT - 3), seed: 6 }],
      [{ col: 5, seed: 1 }, { col: Math.min(12, PAD_RIGHT - 4), seed: 10 }],
      [{ col: 1, seed: 7 }, { col: Math.min(8, PAD_RIGHT - 2), seed: 4 }],
    ];

    const leftLines = leftGrid.map(row => {
      const cells = new Array(PAD_LEFT).fill(' ');
      for (const star of row) {
        if (star.col >= 0 && star.col < PAD_LEFT) cells[star.col] = starChar(star.seed);
      }
      return cells.join('');
    });

    const rightLines = rightGrid.map((row, ri) => {
      const cells = new Array(PAD_RIGHT).fill(' ');
      for (const star of row) {
        if (star.col >= 0 && star.col < PAD_RIGHT) cells[star.col] = starChar(star.seed);
      }
      // Moon on first row, right side (emoji is 2 chars wide, so use col and blank the next)
      if (ri === 0) {
        const moonCol = Math.min(PAD_RIGHT - 3, 13);
        cells[moonCol] = '🌙';
        if (moonCol + 1 < PAD_RIGHT) cells[moonCol + 1] = '';
      }
      return cells.join('');
    });

    return { left: leftLines, right: rightLines };
  }

  let feedAnimating = false;
  let feedFrame = -1;
  const allFood = ['🍕', '🌮', '🍎', '🧀', '🍪', '🥐', '🍣', '🍩', '🍔', '🌯', '🥨', '🍇', '🥕', '🍰'];
  let feedEmojis = [];

  function getFoodLines() {
    if (feedFrame < 0) return null;
    // 3 food items scrolling right-to-left across the full right area
    const maxPos = PAD_RIGHT;
    const lines = [];
    for (let row = 0; row < 3; row++) {
      const stagger = row * 3;
      const pos = feedFrame - stagger;
      if (pos >= 0 && pos < maxPos) {
        const spaces = Math.max(0, maxPos - pos - 2);
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
    const totalFrames = PAD_RIGHT + 8; // enough for last food to cross fully
    for (feedFrame = 0; feedFrame <= totalFrames; feedFrame++) {
      draw();
      await new Promise(r => setTimeout(r, 100));
    }
    feedFrame = -1;
    draw();
    feedAnimating = false;
  }

  let petAnimating = false;
  let petFrame = -1;
  let heartFrame = -1;

  // Hearts float upward: 3 hearts at staggered positions
  function getHeartOverlay() {
    if (heartFrame < 0) return { left: null, right: null };
    const hearts = [
      { startFrame: 0, side: 'right', startRow: 2, offset: 2 },
      { startFrame: 2, side: 'left', startRow: 2, offset: 3 },
      { startFrame: 4, side: 'right', startRow: 2, offset: 6 },
      { startFrame: 5, side: 'left', startRow: 1, offset: 5 },
      { startFrame: 7, side: 'right', startRow: 2, offset: 10 },
    ];
    const leftLines = ['', '', '', ''];
    const rightLines = ['', '', '', ''];
    for (const h of hearts) {
      const age = heartFrame - h.startFrame;
      if (age < 0 || age > 4) continue;
      const row = h.startRow - age;
      if (row < 0 || row > 3) continue;
      const heart = age < 2 ? chalk.hex('#ff6b9d')('♥') : chalk.hex('#ff6b9d').dim('♥');
      if (h.side === 'left') {
        leftLines[row] = ' '.repeat(Math.max(0, PAD_LEFT - h.offset - 1)) + heart + ' '.repeat(h.offset);
      } else {
        rightLines[row] = ' '.repeat(h.offset) + heart;
      }
    }
    return { left: leftLines, right: rightLines };
  }

  async function animatePet() {
    petAnimating = true;
    // Phase 1: petting hand sways
    for (petFrame = 0; petFrame <= 10; petFrame++) {
      draw();
      await new Promise(r => setTimeout(r, 120));
    }
    petFrame = -1;
    // Phase 2: hearts float up
    for (heartFrame = 0; heartFrame <= 12; heartFrame++) {
      draw();
      await new Promise(r => setTimeout(r, 120));
    }
    heartFrame = -1;
    draw();
    petAnimating = false;
  }

  let playAnimating = false;
  let playFrame = -1;
  const confettiColors = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF6BD6', '#63D2FF'];

  function getPlayOverlay() {
    if (playFrame < 0) return { left: null, right: null };
    // Build cell arrays for left and right, then render with chalk
    const leftCells = Array.from({ length: 4 }, () => new Array(PAD_LEFT).fill(null));
    const rightCells = Array.from({ length: 4 }, () => new Array(PAD_RIGHT).fill(null));
    const spots = [
      { r: 0, side: 'left', seed: 0, col: 3 },
      { r: 0, side: 'right', seed: 2, col: 4 },
      { r: 0, side: 'left', seed: 7, col: 12 },
      { r: 0, side: 'right', seed: 8, col: 12 },
      { r: 1, side: 'left', seed: 1, col: 5 },
      { r: 1, side: 'right', seed: 4, col: 7 },
      { r: 1, side: 'left', seed: 6, col: 14 },
      { r: 1, side: 'right', seed: 9, col: 14 },
      { r: 2, side: 'left', seed: 3, col: 2 },
      { r: 2, side: 'right', seed: 5, col: 3 },
      { r: 2, side: 'right', seed: 10, col: 10 },
    ];
    for (const s of spots) {
      const visible = (playFrame + s.seed) % 3 !== 0;
      if (!visible) continue;
      const color = confettiColors[(playFrame + s.seed) % confettiColors.length];
      const ch = (playFrame + s.seed) % 2 === 0 ? '✦' : '·';
      const cells = s.side === 'left' ? leftCells[s.r] : rightCells[s.r];
      if (s.col < cells.length) cells[s.col] = chalk.hex(color)(ch);
    }
    const toStr = (cells) => cells.map(c => c || ' ').join('');
    return {
      left: leftCells.map(toStr),
      right: rightCells.map(toStr),
    };
  }

  async function animatePlay() {
    playAnimating = true;
    const bounceFrames = ['right:up', 'right:up', 'right', 'right', 'right:up', 'right:up', 'right', 'right', 'right:up', 'right:up', 'right', 'right', 'right'];
    for (playFrame = 0; playFrame <= 12; playFrame++) {
      frameOverride = bounceFrames[playFrame % bounceFrames.length];
      draw();
      await new Promise(r => setTimeout(r, 180));
    }
    playFrame = -1;
    frameOverride = null;
    draw();
    playAnimating = false;
  }

  let teachAnimating = false;

  async function animateTeach(learned) {
    teachAnimating = true;
    // Thinking phase: look around
    const thinkFrames = ['right', 'up-left', 'up-right', 'up-left', 'right'];
    for (const expr of thinkFrames) {
      frameOverride = expr;
      draw();
      await new Promise(r => setTimeout(r, 300));
    }
    frameOverride = null;

    if (learned) {
      // Success: excited bounce
      const bounceFrames = ['right:up', 'right', 'right:up', 'right'];
      for (const f of bounceFrames) {
        frameOverride = f;
        draw();
        await new Promise(r => setTimeout(r, 150));
      }
      frameOverride = null;
    } else {
      // Didn't learn: squint then back to normal
      frameOverride = 'squint';
      draw();
      await new Promise(r => setTimeout(r, 400));
      frameOverride = null;
    }
    draw();
    teachAnimating = false;
  }

  let frameOverride = null;

  async function animateSleep(falling) {
    // falling = true: eyes close. false: eyes open.
    const sequence = falling
      ? ['right', 'half-blink', 'squint', 'closed']
      : ['closed', 'squint', 'half-blink', 'right'];
    for (const expr of sequence) {
      frameOverride = expr;
      draw();
      await new Promise(r => setTimeout(r, 120));
    }
    frameOverride = null;
  }

  const actionKeyMap = new Map([[feed, 'f'], [play, 'p'], [petAction, 'h'], [teach, 't']]);
  function getnapKey() { return petState.sleeping ? 'w' : 's'; }

  function doAction(actionFn) {
    if (actionBusy) return;
    const tricksBefore = (petState.tricks || []).length;
    const statsBefore = { hunger: petState.hunger, happiness: petState.happiness, energy: petState.energy, sleeping: petState.sleeping };
    message = actionFn(petState);
    const statsChanged = petState.hunger !== statsBefore.hunger || petState.happiness !== statsBefore.happiness || petState.energy !== statsBefore.energy || petState.sleeping !== statsBefore.sleeping;
    petState.lastVisit = Date.now();
    savePet(petState);
    animFrame = 0;
    actionBusy = true;
    activeAction = actionFn === nap ? getnapKey() : (actionKeyMap.get(actionFn) || null);

    function done() {
      activeAction = null;
      actionBusy = false;
      clearMessage();
    }

    if (!statsChanged) {
      message = chalk.hex('#ff9540')(message);
      draw();
      clearMessage();
      done();
    } else if (actionFn === nap) {
      // Only nap/wake gets the eye open/close animation
      animateSleep(petState.sleeping).then(() => { draw(); done(); });
    } else if (actionFn === feed) {
      animateFeed().then(done);
    } else if (actionFn === petAction) {
      animatePet().then(done);
    } else if (actionFn === play) {
      animatePlay().then(done);
    } else if (actionFn === teach) {
      const learned = (petState.tricks || []).length > tricksBefore;
      animateTeach(learned).then(done);
    } else {
      draw();
      done();
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

    if (confirmingReset) {
      if (key === 'y' || key === 'Y') {
        cleanup();
        const savePath = getSavePath();
        try { fs.unlinkSync(savePath); } catch {}
        console.log('');
        console.log(`  ${chalk.dim('Save data cleared. A new friend will hatch next time!')}`);
        console.log('');
        process.exit();
      } else {
        confirmingReset = false;
        message = chalk.dim('Reset cancelled.');
        draw();
        clearMessage();
      }
      return;
    }

    switch (key) {
      case 'f':
        doAction(feed);
        break;
      case 'p':
        doAction(play);
        break;
      case 's':
      case 'w':
        doAction(nap);
        break;
      case 'h':
        doAction(petAction);
        break;
      case 't':
        doAction(teach);
        break;
      case 'r':
        confirmingReset = true;
        message = chalk.hex('#ff6b6b')(`Are you sure you want to reset? ${petState.name} will be gone forever! [y/n]`);
        draw();
        break;
      case 'q':
      case '\u0003': // Ctrl+C
        message = chalk.dim(`${petState.name} waves goodbye!`);
        draw();
        cleanup();
        process.exit();
        break;
      default:
        break;
    }
  });

  let confirmingReset = false;
  let actionBusy = false;

  // Animation + decay loop
  async function gameLoop() {
    while (!stopped) {
      if (!actionBusy) {
        draw();
        const duration = currentAnim.durations[animFrame % currentAnim.durations.length];
        await new Promise(r => setTimeout(r, duration));
        animFrame++;
      } else {
        await new Promise(r => setTimeout(r, 100));
      }

      // Apply passive decay every loop cycle
      const now = Date.now();
      const elapsed = now - petState.lastVisit;
      if (elapsed >= DECAY_INTERVAL_MS) {
        const moodBefore = getMood(petState);
        petState = applyDecay(petState);
        savePet(petState);
        const moodAfter = getMood(petState);
        if (moodBefore !== moodAfter) {
          if (moodAfter === 'tired') message = chalk.hex('#63D2FF')(`${petState.name} is getting sleepy...`);
          else if (moodAfter === 'sad' && petState.hunger <= 1) message = chalk.hex('#ff6b6b')(`${petState.name} is hungry!`);
        }
      }
    }
  }


  await gameLoop();
}
