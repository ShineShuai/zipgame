// Play log: one small record per puzzle, kept on this device only. The behaviour upload (platform/behaviour.js) carries the full
// trace; what stays here is what the app itself reads back: the skill bucket (solved, hints, ms, n of the last games) and the
// streak bootstrap (solved, at).
//
// A trace counts, per puzzle: pushes (cells drawn), undone (cells taken back by the one-step undo, a cut back to an
// earlier cell, or the reset), backtracks (separate take-back actions; a run of one-step undos is one), maxUndone (the
// most cells taken back in one action: how deep the worst wrong turn went before the player noticed) and resets.
// pushes - undone = the cells on the board at the end, so on a solved puzzle undone / T is the wasted fraction.
import { migrateKey } from '../platform/storage.js';

export const PLAYLOG_KEY = 'zip_playlog_v2', PLAYLOG_LEGACY_KEY = 'zip_playlog_v1', PLAYLOG_MAX = 500; // 500 records of ~25 B

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

// One log record: { n, ms (raw time on the puzzle, before any hint penalty), solved, hints, mode: 'local'|'gotd'|'replay', at }.
export const buildRecord = (puzzle, opts) => ({
  n: puzzle.n, ms: Math.round(opts.ms), solved: !!opts.solved, hints: opts.hints || 0, mode: opts.mode || 'local', at: opts.at ?? Date.now(),
});

// Stored as tuples [n, ms, flags, at in minutes]; flags = solved | any hint << 1 | mode index << 2. Only "any hint" is kept: nothing reads the count.
const MODES = ['local', 'gotd', 'replay'];
const pack = r => [r.n, r.ms, (r.solved ? 1 : 0) | (r.hints ? 2 : 0) | (Math.max(0, MODES.indexOf(r.mode)) << 2), Math.floor(r.at / 60000)];
const unpack = a => ({ n: a[0], ms: a[1], solved: !!(a[2] & 1), hints: (a[2] >> 1) & 1, mode: MODES[a[2] >> 2] || 'local', at: a[3] * 60000 });
const valid = a => Array.isArray(a) && a.length === 4 && a.every(Number.isFinite);
const encode = tuples => JSON.stringify({ v: 2, r: tuples });

// A v1 value (an array of full records, puzzle text and trace counts included) -> v2 text.
export const convertLegacy = text => {
  const list = JSON.parse(text);
  return Array.isArray(list) ? encode(list.filter(r => r && Number.isFinite(r.n) && Number.isFinite(r.ms) && Number.isFinite(r.at)).map(pack).slice(-PLAYLOG_MAX)) : null;
};

// Persistent list of records (oldest dropped past `max`). `storage` = the platform port (platform/storage.js).
export function createPlayLog(storage, max = PLAYLOG_MAX) {
  let list = null, loading = null;
  const load = () => loading || (loading = (async () => {
    try {
      await migrateKey(storage, PLAYLOG_LEGACY_KEY, PLAYLOG_KEY, convertLegacy);
      const r = await storage.get(PLAYLOG_KEY), v = r ? JSON.parse(r.value) : null;
      list = v && v.v === 2 && Array.isArray(v.r) ? v.r.filter(valid) : [];
    } catch { list = []; }
    return list;
  })());
  return {
    async add(rec) {
      const l = await load(); l.push(pack(rec));
      if (l.length > max) l.splice(0, l.length - max);
      await storage.set(PLAYLOG_KEY, encode(l)); // best effort: a refused write only loses this log
    },
    async all() { return (await load()).map(unpack); },
  };
}
