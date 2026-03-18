import chalk from 'chalk';

const _ = null;

// ── Palettes ────────────────────────────────────────────

export const palettes = {
  blue: { name: 'Blue', body: '#018EF5', page: '#FFF5E6', pupil: '#003580', lid: '#63D2FF' },
  green: { name: 'Green', body: '#2D9F3F', page: '#F0FFE6', pupil: '#0A4D1A', lid: '#7FE08A' },
  purple: { name: 'Purple', body: '#8B5CF6', page: '#F3EEFF', pupil: '#3B1A8B', lid: '#C4A8FF' },
  orange: { name: 'Orange', body: '#F97316', page: '#FFF5EB', pupil: '#7C2D12', lid: '#FDBA74' },
  pink: { name: 'Pink', body: '#EC4899', page: '#FFF0F6', pupil: '#831843', lid: '#F9A8D4' },
  red: { name: 'Red', body: '#EF4444', page: '#FFF5F5', pupil: '#7F1D1D', lid: '#FCA5A5' },
  teal: { name: 'Teal', body: '#14B8A6', page: '#F0FFFE', pupil: '#134E4A', lid: '#5EEAD4' },
  yellow: { name: 'Yellow', body: '#EAB308', page: '#FEFCE8', pupil: '#713F12', lid: '#FDE047' },
  owl: { name: 'Owl', body: '#8B5A2B', page: '#FFF8EE', pupil: '#2A1000', lid: '#C4923A', nose: '#FFD700', hidden: true },
};

let currentPalette = palettes.blue;

export function setPalette(name) {
  if (palettes[name]) {
    currentPalette = palettes[name];
    rebuildExpressions();
  }
}

function cell(top, bot) {
  if (top === bot) return top === null ? '  ' : chalk.hex(top)('██');
  if (top === null) return chalk.hex(bot)('▄▄');
  if (bot === null) return chalk.hex(top)('▀▀');
  return chalk.hex(top).bgHex(bot)('▀▀');
}

function render(px) {
  const lines = [];
  for (let r = 0; r < px.length; r += 2) {
    let line = '';
    for (let c = 0; c < px[0].length; c++) {
      line += cell(px[r][c], px[r + 1]?.[c] ?? null);
    }
    lines.push(line);
  }
  return lines;
}

// ── Pixel grids ─────────────────────────────────────────

function applyLid(eye, lid, L) {
  // lid: 0 = open, 1 = half, 2 = squint, 3 = closed
  const count = lid === 3 ? 2 : lid;
  for (let i = 0; i < count && i < 2; i++) {
    eye[i][0] = L;
    eye[i][1] = L;
  }
}

function makeFrame(eyeL, eyeR, lidL = 0, lidR = lidL) {
  const { body: B, page: W, pupil: D, lid: L, nose: N = B } = currentPalette;
  // eyeL/eyeR: [row, col] of pupil within the 2x2 page area
  //   row 0 = top, 1 = bottom; col 0 = left, 1 = right
  // lidL/lidR: 0 = open, 1 = half, 2 = squint (most), 3 = closed
  const page = [
    [W, W],
    [W, W],
  ];

  // Place pupils
  const left = page.map(r => [...r]);
  const right = page.map(r => [...r]);
  left[eyeL[0]][eyeL[1]] = D;
  right[eyeR[0]][eyeR[1]] = D;

  // Apply eyelids per eye
  applyLid(left, lidL, L);
  applyLid(right, lidR, L);

  return [
    [B, B, B, _, B, B, B],
    [B, left[0][0], left[0][1], B, right[0][0], right[0][1], B],
    [B, left[1][0], left[1][1], B, right[1][0], right[1][1], B],
    [B, left[1][0], left[1][1], B, right[1][0], right[1][1], B],
    [B, B, B, N, B, B, B],
    [_, _, _, N, _, _, _],
    [_, _, _, _, _, _, _],
  ];
}

// Bounce-up: prepend empty row to shift pixel pairing
function makeBounceUp(px) {
  const empty = new Array(px[0].length).fill(_);
  return [empty, ...px];
}

// ── Static expressions ──────────────────────────────────

function buildExpressions() {
  return {
    right: makeFrame([1, 1], [1, 1]),
    left: makeFrame([1, 0], [1, 0]),
    'up-right': makeFrame([0, 1], [0, 1]),
    'up-left': makeFrame([0, 0], [0, 0]),
    'half-blink': makeFrame([1, 1], [1, 1], 1),
    'half-blink-left': makeFrame([1, 0], [1, 0], 1),
    'half-blink-right': makeFrame([1, 1], [1, 1], 1),
    squint: makeFrame([1, 1], [1, 1], 2),
    closed: makeFrame([1, 1], [1, 1], 3),
  };
}

export let expressions = buildExpressions();

function rebuildExpressions() {
  expressions = buildExpressions();
}

// ── Animations ──────────────────────────────────────────

export const animations = {
  blink: {
    frames: ['right', 'right', 'right', 'right', 'right', 'right', 'half-blink', 'squint', 'closed', 'closed', 'squint', 'half-blink', 'right'],
    durations: [1500, 100, 100, 100, 100, 100, 50, 50, 50, 80, 50, 50, 100],
  },

  bounce: {
    frames: ['right', 'right', 'right:up', 'right:up', 'right'],
    durations: [400, 200, 200, 200, 200],
  },

  lookaround: {
    frames: ['right', 'right', 'left', 'left', 'left', 'right', 'right', 'up-right', 'up-right', 'right', 'right', 'up-left', 'up-left', 'left', 'left', 'right'],
    durations: [600, 200, 120, 400, 200, 120, 400, 120, 400, 120, 200, 120, 400, 120, 200, 400],
  },

  'lookaround-blink': {
    frames: [
      'right', 'right', 'right',
      'left', 'left', 'left',
      'half-blink', 'squint', 'closed', 'closed', 'squint', 'half-blink',
      'left', 'right', 'right',
      'up-right', 'up-right', 'right',
      'right', 'right',
      'up-left', 'up-left', 'left', 'left',
      'half-blink', 'squint', 'closed', 'closed', 'squint', 'half-blink',
      'right', 'right',
    ],
    durations: [
      800, 200, 200,
      120, 400, 200,
      50, 50, 50, 80, 50, 50,
      200, 120, 400,
      120, 500, 120,
      200, 200,
      120, 500, 120, 200,
      50, 50, 50, 80, 50, 50,
      120, 600,
    ],
  },

  all: {
    frames: [
      // idle, look around
      'right', 'right', 'right',
      'left', 'left', 'left',
      'right', 'right',
      // blink
      'half-blink', 'squint', 'closed', 'closed', 'squint', 'half-blink',
      // look up + bounce
      'right', 'right',
      'up-right', 'up-right', 'right',
      'right:up', 'right:up', 'right', 'right:up', 'right:up', 'right',
      // look the other way
      'right', 'left', 'left',
      'up-left', 'up-left', 'left',
      // blink
      'half-blink', 'squint', 'closed', 'closed', 'squint', 'half-blink',
      // bounce
      'left', 'left:up', 'left:up', 'left', 'left:up', 'left:up', 'left',
      // settle back + bounce
      'right', 'right', 'right',
      'right:up', 'right:up', 'right',
      // blink
      'half-blink', 'squint', 'closed', 'closed', 'squint', 'half-blink',
      'right', 'right',
    ],
    durations: [
      // idle, look around
      800, 200, 200,
      120, 400, 200,
      120, 400,
      // blink
      50, 50, 50, 80, 50, 50,
      // look up + bounce
      200, 200,
      120, 500, 120,
      150, 150, 150, 150, 150, 200,
      // look the other way
      300, 120, 400,
      120, 500, 120,
      // blink
      50, 50, 50, 80, 50, 50,
      // bounce
      200, 150, 150, 150, 150, 150, 200,
      // settle back + bounce
      120, 200, 300,
      150, 150, 200,
      // blink
      50, 50, 50, 80, 50, 50,
      200, 800,
    ],
  },
};

// ── Public API ──────────────────────────────────────────

/**
 * Get rendered lines for a static expression.
 * @param {'right'|'left'|'up-right'|'up-left'|'half-blink'|'squint'|'closed'} name
 * @returns {string[]}
 */
export function eyes(name = 'right') {
  const px = expressions[name];
  if (!px) throw new Error(`Unknown expression: ${name}. Valid: ${Object.keys(expressions).join(', ')}`);
  return render(px);
}

/**
 * Print a static expression to stdout.
 * @param {'right'|'left'|'up-right'|'up-left'|'half-blink'|'squint'|'closed'} name
 * @param {string} [indent='']
 */
export function printEyes(name = 'right', indent = '') {
  for (const line of eyes(name)) {
    console.log(indent + line);
  }
}

/**
 * Get rendered lines for the header: eyes + "The ReadMe CLI" / version.
 * @param {object} [opts]
 * @param {string} [opts.expression='right']
 * @param {string} [opts.version]
 * @returns {string[]}
 */
export function header(opts = {}) {
  const { expression = 'right', version, binName, greeting } = opts;
  const icon = eyes(expression);
  const gap = '  ';

  const title = chalk.bold.hex(currentPalette.body)('The ReadMe CLI') + (version ? ' ' + chalk.dim(`v${version}`) : '');
  const bin = binName ? chalk.white(binName) : '';
  const greetLine = greeting ? chalk.dim(greeting) : '';

  return icon.map((line, i) => {
    if (i === 0) return line + gap + title;
    if (i === 1) return line + gap + bin;
    if (i === 2 && greetLine) return line + gap + greetLine;
    return line;
  });
}

/**
 * Print the header to stdout.
 * @param {object} [opts]
 * @param {string} [opts.expression='right']
 * @param {string} [opts.version]
 * @param {string} [opts.indent='']
 */
export function printHeader(opts = {}) {
  const { indent = '', ...rest } = opts;
  for (const line of header(rest)) {
    console.log(indent + line);
  }
}

/**
 * Run an animation loop. Returns an abort function.
 * @param {'blink'|'bounce'|'lookaround'|'lookaround-blink'} name
 * @param {object} [opts]
 * @param {string} [opts.indent='']
 * @param {boolean} [opts.loop=true]
 * @returns {{ stop: () => void }}
 */
export function animate(name, opts = {}) {
  const { indent = '', loop = true, version, binName: bin } = opts;
  const anim = animations[name];
  if (!anim) throw new Error(`Unknown animation: ${name}. Valid: ${Object.keys(animations).join(', ')}`);

  // Build static header text lines (appended to the right of each frame row)
  const headerLines = [];
  if (version || bin) {
    const gap = '  ';
    headerLines[0] = gap + chalk.bold.hex(currentPalette.body)('The ReadMe CLI') + (version ? ' ' + chalk.dim(`v${version}`) : '');
    headerLines[1] = gap + (bin ? chalk.white(bin) : '');
  }

  let stopped = false;
  let firstDraw = true;

  // Resolve a frame name (possibly with :up suffix) to rendered lines
  function resolveFrame(frameName) {
    const isUp = frameName.endsWith(':up');
    const expr = isUp ? frameName.slice(0, -3) : frameName;
    let px = expressions[expr];
    if (isUp) px = makeBounceUp(px);
    return render(px);
  }

  // Pre-calculate the max height across all frames
  const maxRows = Math.max(...anim.frames.map(f => resolveFrame(f).length));

  async function run() {
    // Hide cursor
    process.stdout.write('\x1b[?25l');

    let i = 0;
    while (!stopped) {
      const frameName = anim.frames[i % anim.frames.length];
      const lines = resolveFrame(frameName);

      // Pad to max height
      while (lines.length < maxRows) lines.push('  '.repeat(7));

      // Append header text if provided
      if (headerLines.length) {
        for (let j = 0; j < lines.length; j++) {
          if (headerLines[j]) lines[j] += headerLines[j];
        }
      }

      // Move cursor up to overwrite previous frame
      if (!firstDraw) process.stdout.write(`\x1b[${maxRows}A`);
      firstDraw = false;

      for (const line of lines) {
        process.stdout.write(indent + line + '\n');
      }

      const duration = anim.durations[i % anim.durations.length];
      await new Promise(r => setTimeout(r, duration));

      i++;
      if (!loop && i >= anim.frames.length) break;
    }

    // Show cursor
    process.stdout.write('\x1b[?25h');
  }

  run();

  return {
    stop() {
      stopped = true;
      process.stdout.write('\x1b[?25h');
    },
  };
}
