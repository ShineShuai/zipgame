import { REPLAY_DAYS } from '../core/hist.js';
import { utcDayNumber, dateOfDay } from './daily.js';

// Replay of a missed Game of Day: a player who solves GAMES_PER_CHANCE Game-of-Day puzzles (the live one or a replay) earns one replay chance;
// one chance buys one missed date of the last REPLAY_DAYS days (today excluded). Local games and abandoned attempts earn nothing.
//   chances = floor(solved / GAMES_PER_CHANCE) - used
// Two counters instead of a chance count: changing GAMES_PER_CHANCE later re-prices every player consistently.
// "Missed" = no attempt record (stats-store attemptKey) for that date; begin() writes one, so a date can be replayed once.
export const GAMES_PER_CHANCE = 5;
export const BACKFILL_DAYS = 90; // first run: solved Game-of-Day records of the last 90 days (incl. today) count as already solved
const KEY = 'zip_gotd_credit'; // { solved, used }

export function createReplay(storage, store, now = () => new Date()) {
  let credit = null; // null until init(): no chances before that
  const save = async () => { try { await storage.set(KEY, JSON.stringify(credit)); } catch { /* ignore */ } };
  const valid = c => c && Number.isInteger(c.solved) && Number.isInteger(c.used) && c.solved >= 0 && c.used >= 0;
  const today = () => utcDayNumber(now());
  const replay = {
    // Loads the counters; the very first time (nothing stored) it counts the solves recorded before this feature existed.
    // Await it before any solve is recorded, or that solve would be counted twice (by this scan and by addSolved).
    async init() {
      try { const r = await storage.get(KEY), c = r && JSON.parse(r.value); if (valid(c)) { credit = { solved: c.solved, used: c.used }; return; } } catch { /* fall through */ }
      let solved = 0;
      for (let k = 0; k <= BACKFILL_DAYS; k++) { const a = await store.loadAttempt(dateOfDay(today() - k)); if (a && a.solved) solved++; }
      credit = { solved, used: 0 };
      await save();
    },
    chances: () => (credit ? Math.max(0, Math.floor(credit.solved / GAMES_PER_CHANCE) - credit.used) : 0),
    toNext: () => GAMES_PER_CHANCE - ((credit ? credit.solved : 0) % GAMES_PER_CHANCE), // solves still needed for the next chance (1..GAMES_PER_CHANCE)
    // The replay window, newest first: yesterday .. REPLAY_DAYS days back.
    dates: () => Array.from({ length: REPLAY_DAYS }, (_, i) => dateOfDay(today() - 1 - i)),
    // Every window date with its stored attempt record, newest first: null = missed, { solved: false } = abandoned, { solved: true, time, stats? } = played.
    // Read from local storage only; the stats inside a record are what the backend answered when the time was submitted.
    async days() { const out = []; for (const date of replay.dates()) out.push({ date, attempt: await store.loadAttempt(date) }); return out; },
    async missed() { return (await replay.days()).filter(x => !x.attempt).map(x => x.date); },
    // Today's and the window's solved attempts the averages backend has not acknowledged yet (sent === false): to be submitted again.
    async unsent() {
      const out = [];
      for (const d of [dateOfDay(today()), ...replay.dates()]) { const a = await store.loadAttempt(d); if (a && a.solved && a.sent === false) out.push({ date: d, time: a.time }); }
      return out;
    },
    // Call once the puzzle of `date` has loaded: spends a chance and marks the date as played (abandoning it keeps it spent, like the live game).
    // false = refused (no chance, outside the window, or already played): nothing changed.
    async begin(date) {
      if (!credit || replay.chances() < 1 || !replay.dates().includes(date) || await store.loadAttempt(date)) return false;
      await store.saveAttempt(date, { solved: false, time: null }); // the date first, so a failure in between loses nothing but the date
      credit.used++; await save();
      return true;
    },
    // Same as begin() for a Game of Day opened from a share link: the link is the ticket, so no chance is spent.
    // Same window and once-per-date rules; false = refused (outside the window, already played, or not initialised).
    async beginShared(date) {
      if (!credit || !replay.dates().includes(date) || await store.loadAttempt(date)) return false;
      await store.saveAttempt(date, { solved: false, time: null });
      return true;
    },
    // A Game of Day was solved for the first time (live or replay).
    async addSolved() { if (!credit) return; credit.solved++; await save(); },
  };
  return replay;
}
