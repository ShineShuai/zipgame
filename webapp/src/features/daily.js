import { dailySeed } from '../core/rng.js';
import { parse } from '../core/format.js';
import { validate, ALGO_VERSION } from '../core/model.js';

export const utcDayNumber = d => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
export const utcDateString = d => '' + d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');

// Per-size game counter for the current UTC day. Game #k of a size = generate(n, dailySeed(day, n, k-1)).
// Counters are independent per size, so what you play in other sizes never shifts this size's sequence.
// Record (same storage key as the old app): { day, index, solved }.
//   open(n)  -> the game "Play local" starts: the current one, or the next one if the current one was solved.
//   skip(n)  -> "New puzzle": always the next one.
//   peek(n)  -> what open(n) would return, without changing anything.
export function createDaily(storage, now = () => new Date()) {
  const key = n => 'zip_daily_index_' + n;
  const read = async n => {
    const day = utcDayNumber(now());
    try { const r = await storage.get(key(n)); const v = r && JSON.parse(r.value); if (v && v.day === day) return { day, index: v.index | 0, solved: !!v.solved }; } catch { /* fall through */ }
    return { day, index: 0, solved: false };
  };
  const write = async (n, rec) => { try { await storage.set(key(n), JSON.stringify(rec)); } catch { /* ignore */ } };
  const game = (day, n, index) => ({ index, seed: dailySeed(day, n, index, ALGO_VERSION) }); // versioned: a new ALGO_VERSION never reuses seeds of the old puzzles
  return {
    async peek(n) { const r = await read(n); return game(r.day, n, r.solved ? r.index + 1 : r.index); },
    async open(n) { const r = await read(n), index = r.solved ? r.index + 1 : r.index; await write(n, { day: r.day, index, solved: false }); return game(r.day, n, index); },
    async skip(n) { const r = await read(n), index = r.index + 1; await write(n, { day: r.day, index, solved: false }); return game(r.day, n, index); },
    async markSolved(n, index) { const r = await read(n); if (r.index === index) await write(n, { day: r.day, index, solved: true }); },
  };
}

// Game of Day: GameOfDay/YYYYMMDD.txt in the shared plain-text format. Returns a puzzle or null.
export async function fetchGameOfDay(now = () => new Date()) {
  const date = utcDateString(now());
  try {
    const res = await fetch('../demo/GameOfDay/' + date + '.txt', { cache: 'no-store' });
    if (!res.ok) return null;
    const p = parse(await res.text());
    if (!validate(p).ok) return null;
    p.gotdDate = date;
    return p;
  } catch (e) { console.warn('fetchGameOfDay failed:', e); return null; }
}
