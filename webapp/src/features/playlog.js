// Play behaviour log: what a player actually did on each puzzle, kept on this device only (nothing is sent anywhere).
// It is the objective label the hand ratings cannot give: how long the puzzle took for its size, and how many cells
// were drawn and then taken back ("wasted" moves). tools/playlog-eval.mjs correlates the grading metrics with it, so
// the grade can be tuned on real play instead of on a few dozen opinions.
//
// A trace counts, per puzzle: pushes (cells drawn), undone (cells taken back by the one-step undo, a cut back to an
// earlier cell, or the reset), backtracks (separate take-back actions; a run of one-step undos is one), maxUndone (the
// most cells taken back in one action: how deep the worst wrong turn went before the player noticed) and resets.
// pushes - undone = the cells on the board at the end, so on a solved puzzle undone / T is the wasted fraction.
import { serialize } from '../core/format.js';

export const PLAYLOG_KEY = 'zip_playlog_v1', PLAYLOG_MAX = 500; // 500 puzzles of up to ~0.5 KB each stay far below the localStorage quota

// hiddenMs: time the tab was hidden during the game (the timer keeps running then); the behaviour upload skips a game with much of it.
export const newTrace = () => ({ pushes: 0, undone: 0, maxUndone: 0, backtracks: 0, resets: 0, run: 0, hiddenMs: 0 });

// kind = what rules.step() returned ('push' | 'pop' | 'trunc' | 'reset' | null); before / after = path length around the move.
export function traceStep(tr, kind, before, after) {
  if (!kind) return;
  if (kind === 'push') { tr.pushes++; tr.run = 0; return; }
  if (kind === 'pop') { // one-step undo: consecutive pops are one take-back action
    if (tr.run === 0) tr.backtracks++;
    tr.run++; tr.undone++; tr.maxUndone = Math.max(tr.maxUndone, tr.run);
    return;
  }
  tr.run = 0;
  if (kind === 'reset') { tr.resets++; tr.backtracks++; tr.undone += before; tr.pushes++; tr.maxUndone = Math.max(tr.maxUndone, before); return; } // the whole path goes, the start cell is drawn again
  const removed = Math.max(0, before - after); // 'trunc'
  tr.backtracks++; tr.undone += removed; tr.maxUndone = Math.max(tr.maxUndone, removed);
}
// The "reset path" button: everything drawn is taken back.
export function traceClear(tr, before) {
  if (before <= 0) return;
  tr.run = 0; tr.resets++; tr.backtracks++; tr.undone += before; tr.maxUndone = Math.max(tr.maxUndone, before);
}

// One log record. opts: { ms (raw time on the puzzle, before any hint penalty), solved, hints, mode: 'local'|'gotd'|'replay', at }
export function buildRecord(puzzle, tr, opts) {
  return {
    v: 1, key: serialize(puzzle), n: puzzle.n, ms: Math.round(opts.ms), solved: !!opts.solved, hints: opts.hints || 0, mode: opts.mode || 'local',
    pushes: tr.pushes, undone: tr.undone, maxUndone: tr.maxUndone, backtracks: tr.backtracks, resets: tr.resets, at: opts.at ?? Date.now(),
  };
}

// Persistent list of records (oldest dropped past `max`). `storage` = the platform port: async get(key) -> {value}|null, set(key, value).
export function createPlayLog(storage, max = PLAYLOG_MAX) {
  let list = null, loading = null;
  const load = () => loading || (loading = (async () => {
    try { const r = await storage.get(PLAYLOG_KEY), v = r ? JSON.parse(r.value) : []; list = Array.isArray(v) ? v : []; } catch { list = []; }
    return list;
  })());
  return {
    async add(rec) {
      const l = await load(); l.push(rec);
      if (l.length > max) l.splice(0, l.length - max);
      try { await storage.set(PLAYLOG_KEY, JSON.stringify(l)); } catch { /* quota / disabled: the log is best effort */ }
    },
    async all() { return [...await load()]; },
    async exportJson() { return JSON.stringify(await load()); },
  };
}
