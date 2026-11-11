import fs from 'node:fs';
import path from 'node:path';

/**
 * A path that would leave `baseDir`, including by following a symlink. `target` is the refused
 * path under `baseDir` (the symlink itself when that is what was hit). It is not that path's
 * realpath: `baseDir` may sit behind a symlink such as `/var` → `/private/var`, and callers
 * use `path.relative(baseDir, target)`.
 */
export class PathEscapeError extends Error {
  constructor(target, reason) {
    super(`${target}: ${reason}`);
    this.name = 'PathEscapeError';
    this.target = target;
  }
}

/**
 * Guard for "this path stays inside `baseDir`" that does not trust the lexical path.
 *
 * `path.relative` only compares strings. A directory symlink committed under the base (git records
 * it as mode 120000, so a clone recreates it) still looks inside the base, and `mkdir`,
 * `writeFile`, `rename`, `unlink`, and `rm` all follow it. Walk each segment with `lstat` so a
 * symlink is refused even when its target is also inside the base, and `realpath` the nearest
 * existing ancestor so a link that points out of the base cannot hide behind a not-yet-created
 * child.
 *
 * Paths that do not exist yet are allowed when that ancestor is a real directory inside the base —
 * callers are about to create them.
 *
 * @param {string} baseDir Existing directory that bounds every path.
 * @param {{ label?: string }} [opts] Noun used in the error (`reference directory`).
 * @returns {(target: string) => void}
 */
export function makeContainment(baseDir, { label = 'reference directory' } = {}) {
  const baseReal = fs.realpathSync(baseDir);
  const baseResolved = path.resolve(baseDir);

  return function assertContained(target) {
    const resolved = path.resolve(target);
    const rel = path.relative(baseResolved, resolved);

    // '' is the base itself. Callers pass a child, so deleting or writing the base is not a
    // contained operation.
    if (rel === '' || escapes(rel)) {
      throw new PathEscapeError(resolved, `path escapes the ${label}`);
    }

    let cursor = baseReal;
    const walked = [];
    for (const segment of rel.split(path.sep)) {
      if (segment === '' || segment === '.' || segment === '..') {
        throw new PathEscapeError(resolved, `path escapes the ${label}`);
      }

      walked.push(segment);
      cursor = path.join(cursor, segment);
      // `cursor` follows the realpath of the base. The error names the same segment under the
      // base the caller passed, so path.relative(baseDir, target) stays inside it.
      const lexical = path.join(baseResolved, ...walked);

      let st;
      try {
        st = fs.lstatSync(cursor);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;

        // `cursor` is the first missing segment. Its parent is either the base (relative path '')
        // or a segment just lstat'd as a real directory. realpath it anyway so a link above the
        // base cannot hide behind a not-yet-created child.
        const parentRel = path.relative(baseReal, fs.realpathSync(path.dirname(cursor)));
        if (escapes(parentRel)) {
          throw new PathEscapeError(resolved, `path escapes the ${label}`);
        }

        return;
      }

      if (st.isSymbolicLink()) {
        throw new PathEscapeError(lexical, `symbolic links inside the ${label} are not followed`);
      }
    }

    const realRel = path.relative(baseReal, fs.realpathSync(cursor));
    if (realRel === '' || escapes(realRel)) {
      throw new PathEscapeError(resolved, `path escapes the ${label}`);
    }
  };
}

/** True when `path.relative(base, candidate)` climbed out of `base`. '' did not. */
function escapes(rel) {
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}
