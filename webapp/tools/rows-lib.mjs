// Reading the rows of a behaviour export (tools/behaviour.mjs export) for the tools that need the
// puzzles behind them (step-fit.mjs, apply-points.mjs).
import fs from 'node:fs';
import { parse } from '../src/core/format.js';
import { packPuzzle, toB64u } from '../src/core/behaviour.js';

const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

// The rows of the export with their puzzle text in `key`: a Game-of-Day row has none in the export
// unless it was made with --gotd-dir; with `gotdDir` it is read from DIR/<date>.txt.
export function readRows(file, { gotdDir } = {}) {
  const { rows } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return rows.map(r => ({
    ...r, key: r.key || (gotdDir && r.kind !== 'local' ? read(`${gotdDir}/${r.date}.txt`) : null),
  }));
}

// A game that is neither abandoned (its time is cut off) nor played with a hint (not comparable).
export const isPlain = r => !r.abandoned && !r.hint;

// The canonical id of a puzzle: its packed form, whatever its comments say (null if it cannot be).
export function idOf(text) {
  try { return toB64u(packPuzzle(parse(text))); } catch { return null; }
}
