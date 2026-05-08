import { createLogUpdate } from 'log-update';
import cliSpinners from 'cli-spinners';
import chalk from 'chalk';

/**
 * Multi-row spinner. Renders `rows` labeled lines, repainted in unison at the
 * spinner's tick interval. Cleared rows render as blank lines (the live region
 * keeps a fixed height). Falls back to no-op render + line-buffered `log()`
 * in non-TTY environments.
 */
export class MultiSpinner {
  constructor({ rows, color = 'blue', stream = process.stderr } = {}) {
    this.rows = Math.max(0, rows);
    this.color = color;
    this.stream = stream;
    this.isTTY = !!stream.isTTY;
    this.lines = new Array(this.rows).fill('');
    this.frame = 0;
    this.spinner = cliSpinners.dots;
    this.timer = null;
    this.update = null;
  }

  start() {
    if (!this.isTTY) return;
    this.update = createLogUpdate(this.stream);
    this._render();
    this.timer = setInterval(() => this._render(), this.spinner.interval);
  }

  setLine(rowIdx, text) {
    if (!this.isTTY) return;
    if (rowIdx < 0 || rowIdx >= this.rows) return;
    this.lines[rowIdx] = text;
  }

  clearLine(rowIdx) {
    this.setLine(rowIdx, '');
  }

  log(text) {
    if (this.isTTY && this.update) {
      this.update.persist(text);
    } else {
      this.stream.write(text + '\n');
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.update) {
      this.update.clear();
      this.update.done();
      this.update = null;
    }
  }

  _render() {
    if (!this.update) return;
    const glyph = this.spinner.frames[this.frame % this.spinner.frames.length];
    const colorize = chalk[this.color] ?? ((s) => s);
    const out = this.lines
      .map((text) => (text ? `${colorize(glyph)} ${text}` : ''))
      .join('\n');
    this.update(out);
    this.frame++;
  }
}
