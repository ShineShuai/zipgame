import { utcDayNumber } from './daily.js';

// Play streak: consecutive UTC days with at least one solved puzzle (local, Game of Day or replay alike).
// Every FREEZE_EVERY-th streak day earns one freeze (at most FREEZE_MAX are kept) and, in the app, one replay chance (replay.addBonus). A freeze covers one missed day,
// so the streak survives a gap of up to `freezes` days; a longer gap restarts it at 1 and keeps the freezes.
// State: { last: UTC day number of the last solve | null, streak, best, freezes }.
export const FREEZE_EVERY = 7, FREEZE_MAX = 2;
const KEY = 'zip_streak';

export const fresh = () => ({ last: null, streak: 0, best: 0, freezes: 0 });

// State after a solve on UTC day `day` (pure; the same state back when that day is already counted).
export function play(s, day) {
  if (s.last !== null && day <= s.last) return s;
  const gap = s.last === null ? Infinity : day - s.last - 1; // missed days in between
  let { streak, freezes } = s;
  if (gap === 0) streak++;
  else if (gap <= freezes) { streak++; freezes -= gap; }
  else streak = 1;
  if (streak % FREEZE_EVERY === 0) freezes = Math.min(FREEZE_MAX, freezes + 1);
  return { last: day, streak, best: Math.max(s.best, streak), freezes };
}

// The streak as shown on `today`: 0 once the gap since the last solve is too long for the freezes left.
export const current = (s, today) => (s.last !== null && today - s.last - 1 <= s.freezes ? s.streak : 0);

const valid = c => c && [c.streak, c.best, c.freezes].every(x => Number.isInteger(x) && x >= 0) && (c.last === null || Number.isInteger(c.last));

export function createStreak(storage, playlog, now = () => new Date()) {
  let s = null; // null until init()
  const save = async () => { try { await storage.set(KEY, JSON.stringify(s)); } catch { /* ignore */ } };
  return {
    // Loads the state; the very first time (nothing stored) it replays the solved days of the play log, so existing players keep their streak.
    async init() {
      try { const r = await storage.get(KEY), c = r && JSON.parse(r.value); if (valid(c)) { s = c; return; } } catch { /* fall through */ }
      const days = [...new Set((await playlog.all()).filter(r => r.solved).map(r => Math.floor(r.at / 86400000)))].sort((a, b) => a - b);
      s = days.reduce(play, fresh());
      await save();
    },
    // Call on every solve. true = the streak just reached a multiple of FREEZE_EVERY (the day's first solve only).
    async record() { if (!s) return false; const n = play(s, utcDayNumber(now())); if (n === s) return false; s = n; await save(); return n.streak % FREEZE_EVERY === 0; },
    view() { const today = utcDayNumber(now()); return s && { streak: current(s, today), best: s.best, freezes: s.freezes, today: s.last === today }; },
  };
}
