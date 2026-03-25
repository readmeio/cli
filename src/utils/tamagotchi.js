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

const ALL_TRICKS = ['hide and seek', 'spin', 'fetch', 'bow', 'chameleon', 'dance', 'owl impression', 'writes an OAS file'];

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

// Returns "does a spin" vs "writes an OAS file" depending on the trick name
function trickPhrase(trick) {
  // Tricks with custom phrasing
  const custom = { 'writes an OAS file': 'writes an OAS file', 'hide and seek': 'plays hide and seek' };
  if (custom[trick]) return custom[trick];
  const vowels = 'aeiou';
  const article = vowels.includes(trick[0].toLowerCase()) ? 'an' : 'a';
  return `does ${article} ${trick}`;
}

const ok = (message, extra = {}) => ({ message, ok: true, ...extra });
const fail = (message) => ({ message, ok: false });

function feed(pet) {
  if (pet.hunger >= MAX_STAT) return fail('Already full!');
  pet.sleeping = false;
  pet.hunger = Math.min(MAX_STAT, pet.hunger + 3);
  pet.energy = Math.min(MAX_STAT, pet.energy + 1);
  return ok(`${pet.name} munches happily!`);
}

function play(pet) {
  if (pet.energy <= 0) return fail('Too tired to play...');
  pet.sleeping = false;
  pet.happiness = Math.min(MAX_STAT, pet.happiness + 3);
  pet.hunger = Math.max(0, pet.hunger - 1);
  pet.energy = Math.max(0, pet.energy - 2);
  return ok(`${pet.name} bounces around!`);
}

function nap(pet) {
  if (pet.sleeping) {
    pet.sleeping = false;
    return ok(`${pet.name} wakes up! Good morning!`);
  }
  if (pet.energy >= MAX_STAT) return fail('Not sleepy!');
  pet.sleeping = true;
  pet.energy = Math.min(MAX_STAT, pet.energy + 4);
  pet.happiness = Math.min(MAX_STAT, pet.happiness + 1);
  return ok(`${pet.name} curls up for a nap... zzz`);
}

function petAction(pet) {
  if (pet.energy <= 1) return fail(`${pet.name} is too tired for pets...`);
  pet.sleeping = false;
  pet.happiness = Math.min(MAX_STAT, pet.happiness + 2);
  return ok(`${pet.name} loves the attention!`);
}

function teach(pet) {
  if (pet.energy <= 1) return fail('Too tired to learn right now...');
  pet.sleeping = false;

  const known = (pet.tricks || []).filter(t => ALL_TRICKS.includes(t));
  pet.tricks = known; // prune stale tricks from old saves
  const unknown = ALL_TRICKS.filter(t => !known.includes(t));

  pet.energy = Math.max(0, pet.energy - 1);
  pet.hunger = Math.max(0, pet.hunger - 1);

  if (unknown.length === 0) {
    const trick = known[Math.floor(Math.random() * known.length)];
    pet.happiness = Math.min(MAX_STAT, pet.happiness + 1);
    return ok(`${pet.name} ${trickPhrase(trick)}!`, { trick });
  }

  const learnChance = 0.3 + (pet.happiness / MAX_STAT) * 0.4;
  if (Math.random() < learnChance) {
    const trick = unknown[Math.floor(Math.random() * unknown.length)];
    pet.tricks = [...known, trick];
    pet.happiness = Math.min(MAX_STAT, pet.happiness + 2);
    return ok(`${pet.name} learned ${trick}! (${pet.tricks.length}/${ALL_TRICKS.length} tricks)`, { trick });
  }

  const reactions = [
    `${pet.name} tilts their head... not quite`,
    `${pet.name} got distracted. Try again!`,
    `Almost! ${pet.name} is getting the hang of it`,
    `${pet.name} tries their best but needs more practice`,
  ];
  pet.happiness = Math.min(MAX_STAT, pet.happiness + 1);
  return ok(reactions[Math.floor(Math.random() * reactions.length)]);
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
  const name = pet.name;

  if (pet.sleeping) {
    return { greeting: `${name} is sleeping... zzz`, expression: 'closed' };
  }

  const expression = Math.random() < 0.5 ? 'left' : 'right';
  return { greeting: null, expression };
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
      ` ${chalk.dim('tricks:')} ${(pet.tricks || []).filter(t => ALL_TRICKS.includes(t)).length}/${ALL_TRICKS.length}`,
      ` ${chalk.hex('#6bcb77')('energy')}  ${statBar(pet.energy, MAX_STAT, chalk.hex('#6bcb77'))}   ${String(pet.energy).padStart(2)}/${MAX_STAT}`,
    ),
  ];
  return lines;
}

function renderActions(pet, activeKey = null) {
  const knownTricks = (pet.tricks || []).filter(t => ALL_TRICKS.includes(t));
  const allLearned = knownTricks.length >= ALL_TRICKS.length;
  const items = [
    { key: 'f', label: 'feed' },
    { key: 'p', label: 'play' },
    { key: pet.sleeping ? 'w' : 's', label: pet.sleeping ? 'wake' : 'sleep' },
    { key: 'h', label: 'pet' },
    { key: 't', label: allLearned ? 'trick' : 'teach' },
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
  const colorKeys = Object.keys(palettes).filter(k => !palettes[k].hidden);
  for (let i = 0; i < colorKeys.length; i++) {
    const p = palettes[colorKeys[i]];
    console.log(`  ${chalk.hex(p.body)('██')} ${chalk.bold(`${i + 1}.`)} ${p.name}`);
  }
  console.log('');

  const colorChoice = await ask(chalk.hex('#63D2FF')(`  Pick a color (1-${colorKeys.length}): `));
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
    let iconLines = iconFlipped ? resolveFrame(frameName).slice().reverse() : resolveFrame(frameName);
    if (iconShift > 0) {
      const emptyLine = ' '.repeat(ICON_WIDTH);
      for (let i = 0; i < iconShift; i++) iconLines = [emptyLine, ...iconLines.slice(0, -1)];
    }

    process.stdout.write('\x1b[H\x1b[J');

    // Gather overlays
    const foodLines = getFoodLines();
    const isSleeping = petState.sleeping;
    const sleepStars = isSleeping ? getSleepScene(animFrame) : null;
    const hearts = getHeartOverlay();
    const sparkles = getPlayOverlay();

    // Build scene rows: [left area] [icon centered] [right area]
    const effLeft = PAD_LEFT + iconHShift;
    const effRight = PAD_RIGHT - iconHShift;
    const sceneRows = iconLines.map((iconLine, r) => {
      let leftStr = ' '.repeat(effLeft);
      let rightStr = ' '.repeat(effRight);

      // Pick the active overlay (only one can be active at a time)
      if (heartFrame >= 0 && hearts.left) {
        leftStr = padRight(hearts.left[r] || '', PAD_LEFT);
        rightStr = padRight(hearts.right[r] || '', PAD_RIGHT);
      } else if (playFrame >= 0 && sparkles.left) {
        leftStr = padRight(sparkles.left[r] || '', PAD_LEFT);
        rightStr = padRight(sparkles.right[r] || '', PAD_RIGHT);
      } else if (feedFrame >= 0 && foodLines && r < foodLines.length) {
        rightStr = padRight(foodLines[r] || '', effRight);
      } else if (sleepStars && sleepStars.left && r < sleepStars.left.length) {
        leftStr = padRight(sleepStars.left[r] || '', PAD_LEFT);
        rightStr = padRight(sleepStars.right[r] || '', PAD_RIGHT);
      } else if (trickSceneOverlay && (trickSceneOverlay.right || trickSceneOverlay[r])) {
        if (trickSceneOverlay.left) leftStr = padRight(trickSceneOverlay.left[r] || '', effLeft);
        if (trickSceneOverlay.right) rightStr = padRight(trickSceneOverlay.right[r] || '', effRight);
        if (!trickSceneOverlay.left && !trickSceneOverlay.right) rightStr = padRight(' ' + (trickSceneOverlay[r] || ''), effRight);
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
    let displayMsg = message || '';
    if (boxVisLen(displayMsg) > inner) {
      // Strip ANSI, truncate, re-apply no color (plain truncation)
      const plain = displayMsg.replace(/\x1b\[[0-9;]*m/g, '');
      displayMsg = plain.slice(0, inner - 1) + '…';
    }
    const msgVis = boxVisLen(displayMsg);
    const msgPadL = Math.max(0, Math.floor((inner - msgVis) / 2));
    const msgPadR = Math.max(0, inner - msgVis - msgPadL);
    console.log('  ' + boxDivider());
    console.log('  ' + chalk.dim('│') + ' '.repeat(msgPadL) + displayMsg + ' '.repeat(msgPadR) + chalk.dim('│'));
    console.log('  ' + chalk.dim('├' + '─'.repeat(STATUS_LEFT) + '┬' + '─'.repeat(STATUS_RIGHT) + '┤'));
    for (const line of statusLines) {
      console.log('  ' + boxLine(line));
    }
    console.log('  ' + chalk.dim('├' + '─'.repeat(STATUS_LEFT) + '┴' + '─'.repeat(STATUS_RIGHT) + '┤'));
    for (const line of actionLines) {
      console.log('  ' + boxLine(line));
    }
    console.log('  ' + boxBottom());
    if (confirmingReset) {
      console.log('');
      console.log('  ' + chalk.hex('#ff6b6b')(`Reset ${petState.name}? They'll be gone forever!`) + chalk.dim('  [y] yes  [n] no'));
    } else {
      console.log('');
    }
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
      { startFrame: 1, side: 'left',  startRow: 2, offset: 2 },
      { startFrame: 3, side: 'right', startRow: 2, offset: 6 },
      { startFrame: 4, side: 'left',  startRow: 1, offset: 5 },
      { startFrame: 6, side: 'right', startRow: 2, offset: 10 },
      { startFrame: 7, side: 'left',  startRow: 2, offset: 9 },
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

  async function animateTrick(name) {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const setFrame = async (f, ms) => { frameOverride = f; draw(); await wait(ms); };

    switch (name) {
      case 'hide and seek': {
        // sink down progressively
        for (const shift of [0, 1, 2, 3]) {
          iconShift = shift;
          await setFrame('right', 180);
        }
        // peek — bob up slightly then back down
        iconShift = 2; await setFrame('right', 200);
        iconShift = 3; await setFrame('right', 300);
        iconShift = 2; await setFrame('right', 150);
        iconShift = 3; await setFrame('right', 400);
        // come back up
        for (const shift of [2, 1, 0]) {
          iconShift = shift;
          await setFrame('right', 180);
        }
        break;
      }
      case 'spin': {
        for (const f of ['left', 'up-left', 'up-right', 'right', 'up-right', 'up-left', 'left', 'up-left', 'right'])
          await setFrame(f, 110);
        break;
      }
      case 'fetch': {
        iconHShift = -8;
        const method = chalk.hex('#63D2FF')('POST');
        const pending = chalk.dim('○') + ' ' + method + ' /api/pets';
        const d = chalk.dim;
        const json = [
          d('  "id": 1,'),
          d('  "name": "Max",'),
          d('  "type": "dog",'),
          d('  "breed": "husky",'),
          d('  "age": 3,'),
          d('  "tag": "friendly"'),
        ];

        // show request
        trickSceneOverlay = [pending, '', '', ''];
        await setFrame('up-right', 300);

        // loading dots
        for (const dots of ['  ·', '  · ·', '  · · ·', '  · · · ·', '  · · ·', '  · ·', '  · · ·', '  · · · ·']) {
          trickSceneOverlay = [pending, chalk.dim(dots), '', ''];
          await setFrame('up-right', 180);
        }

        // json scrolls in line by line (pending pinned at top, 3 visible body rows)
        const body = [d('{'), ...json, d('}')];
        for (let i = 0; i < body.length; i++) {
          const win = body.slice(Math.max(0, i - 2), i + 1);
          while (win.length < 3) win.push('');
          trickSceneOverlay = [pending, win[0], win[1], win[2]];
          const expr = i % 2 === 0 ? 'up-left' : 'up-right';
          await setFrame(expr, 200);
        }

        // 200 OK — hold on last 3 body lines
        const tail = body.slice(-3);
        trickSceneOverlay = [chalk.hex('#6bcb77')('● 200 OK'), tail[0], tail[1], tail[2]];
        await setFrame('right', 700);

        trickSceneOverlay = null;
        break;
      }
      case 'bow': {
        for (const [f, ms] of [['right', 200], ['right:up', 300], ['right:up', 300], ['squint', 500], ['right:up', 300], ['right', 200]])
          await setFrame(f, ms);
        break;
      }
      case 'chameleon': {
        const colorKeys = Object.keys(palettes).filter(k => !palettes[k].hidden);
        for (const color of [...colorKeys, ...colorKeys, petState.color]) {
          setPalette(color);
          await setFrame('right', 200);
        }
        break;
      }
      case 'dance': {
        const notes = ['♩', '♪', '♫', '♬'];
        const nc = chalk.hex('#ffd93d');
        const place = (width, col, note) => ' '.repeat(Math.min(col, width - 1)) + nc(note) + ' '.repeat(Math.max(0, width - col - 1));
        // Each frame: scattered note positions on left and right, shifting each beat
        const frames = ['left:up', 'left', 'right:up', 'right', 'left:up', 'left', 'right:up', 'right', 'right:up', 'right'];
        const spots = [
          { lr: [14, 3], ll: [2, 11], rr: [4, 15], rl: [8, 1] },
          { lr: [6, 16], ll: [9, 4],  rr: [12, 2], rl: [14, 7] },
        ];
        for (let i = 0; i < frames.length; i++) {
          const s = spots[i % 2];
          const ni = (k) => notes[(i + k) % notes.length];
          trickSceneOverlay = {
            left:  [place(PAD_LEFT, s.ll[0], ni(0)), place(PAD_LEFT, s.ll[1], ni(2)), place(PAD_LEFT, s.lr[0], ni(1)), place(PAD_LEFT, s.lr[1], ni(3))],
            right: [place(PAD_RIGHT, s.rr[0], ni(2)), place(PAD_RIGHT, s.rl[0], ni(0)), place(PAD_RIGHT, s.rr[1], ni(3)), place(PAD_RIGHT, s.rl[1], ni(1))],
          };
          await setFrame(frames[i], 130);
        }
        trickSceneOverlay = null;
        break;
      }
      case 'owl impression': {
        setPalette('owl');
        const hoot = chalk.hex('#ffd93d');
        for (const [f, ms] of [['left', 200], ['right', 200], ['left', 200], ['right', 200]])
          await setFrame(f, ms);
        const rpad = () => ' '.repeat(2 + Math.floor(Math.random() * 8));
        trickSceneOverlay = { right: [rpad() + hoot('hoot!'), '', '', ''] };
        await setFrame('up-right', 500);
        trickSceneOverlay = { right: [rpad() + hoot('hoot!'), rpad() + hoot('hoot!'), '', ''] };
        await setFrame('up-left', 600);
        trickSceneOverlay = null;
        await setFrame('right', 300);
        setPalette(petState.color);
        break;
      }
      case 'writes an OAS file': {
        iconHShift = -8;
        const c = chalk.dim;
        const groups = [
          [c('openapi: 3.0.0'), c('info:'), c('  title: Petstore'), c('  version: 1.0.0')],
          [c('  contact:'), c('    name: Petstore'), c('    url: petstore'), c('  license: MIT')],
          [c('paths:'), c('  /pets:'), c('    get: listPets'), c('    post: createPet')],
          [c('  /pets/{petId}:'), c('    get: getPetById'), c('    put: updatePet'), c('    delete: delPet')],
          [c('components:'), c('  schemas:'), c('    Pet:'), c('      type: object')],
          [c('    properties:'), c('      id: integer'), c('      name: string'), c('      tag: string')],
        ];
        const exprs = ['up-right', 'up-left', 'up-right', 'up-left', 'up-right', 'up-left'];
        for (let i = 0; i < groups.length; i++) {
          trickSceneOverlay = groups[i];
          await setFrame(exprs[i], 450);
        }
        trickSceneOverlay = null;
        break;
      }
      default: {
        for (const f of ['right:up', 'right', 'right:up', 'right'])
          await setFrame(f, 150);
      }
    }
    frameOverride = null;
    iconFlipped = false;
    iconShift = 0;
    iconHShift = 0;
    trickSceneOverlay = null;
  }

  async function animateTeach(trickName) {
    teachAnimating = true;
    // Thinking phase
    for (const expr of ['right', 'up-left', 'up-right', 'up-left', 'right']) {
      frameOverride = expr;
      draw();
      await new Promise(r => setTimeout(r, 300));
    }
    frameOverride = null;

    if (trickName) {
      await animateTrick(trickName);
    } else {
      // Didn't learn: squint then back
      frameOverride = 'squint';
      draw();
      await new Promise(r => setTimeout(r, 400));
      frameOverride = null;
    }
    draw();
    teachAnimating = false;
  }

  let frameOverride = null;
  let iconFlipped = false;
  let iconShift = 0; // rows to shift icon downward (for hiding)
  let iconHShift = 0; // columns to shift icon left (negative = left, increases right area)
  let trickSceneOverlay = null; // array of strings per scene row (right side)

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

  function doPerformTrick(name) {
    if (actionBusy) return;
    message = `${petState.name} ${trickPhrase(name)}!`;
    actionBusy = true;
    animateTrick(name).then(() => {
      draw();
      actionBusy = false;
      clearMessage();
    });
  }

  const actionKeyMap = new Map([[feed, 'f'], [play, 'p'], [petAction, 'h'], [teach, 't']]);
  function getnapKey() { return petState.sleeping ? 'w' : 's'; }

  function doAction(actionFn) {
    if (actionBusy) return;
    const tricksBefore = (petState.tricks || []).length;
    const result = actionFn(petState);
    message = result.ok ? result.message : chalk.hex('#ff9540')(result.message);
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

    if (!result.ok) {
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
      const tricksAfter = (petState.tricks || []).length;
      const learnedTrick = tricksAfter > tricksBefore
        ? petState.tricks[petState.tricks.length - 1]
        : (result.trick || null);
      const learned = tricksAfter > tricksBefore;
      animateTeach(learnedTrick).then(() => {
        activeAction = null;
        actionBusy = false;
        clearMessage(learned ? 6000 : 3000);
      });
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
      case '1': case '2': case '3': case '4':
      case '5': case '6': case '7': case '8': {
        const idx = parseInt(key) - 1;
        const trickName = ALL_TRICKS[idx];
        const known = (petState.tricks || []).filter(t => ALL_TRICKS.includes(t));
        if (trickName && known.includes(trickName)) {
          doPerformTrick(trickName);
        } else if (trickName) {
          message = chalk.dim(`${petState.name} hasn't learned ${trickName} yet`);
          draw();
          clearMessage();
        }
        break;
      }
      case 'r':
        confirmingReset = true;
        message = '';
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
