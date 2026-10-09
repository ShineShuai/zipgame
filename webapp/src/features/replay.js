import { REPLAY_DAYS } from '../core/hist.js';
import { utcDayNumber, dateOfDay } from './daily.js';
import { dayOfDate } from './share.js';

// Replay of a Game of Day: a player earns replay chances by solving Game-of-Day puzzles (the live one or a replay) and by every 7th streak day; one chance buys one date of the last
// REPLAY_DAYS days (today excluded). Local games and abandoned attempts earn nothing.
// Chances come at a rising price: the 1st after 1 solve, the 2nd after 2 more, the 3rd after 3 more, then one every CHANCE_STEP (5) more.
//   chances = earned(solved) + bonus - used      (bonus: chances from streak milestones, features/streak.js)
// Two counters instead of a chance count: changing the schedule later re-prices every player consistently.
// The picker (pick) offers up to REPLAY_SHOW dates that have a puzzle file: the newest missed ones (no attempt record; begin() writes one); the rest is filled with
// repeats: solved dates older than REPEAT_MIN_AGE days, slowest first, then oldest first. Only when no missed date is left, the newest abandoned date comes
// first (at most one). A repeat is practice: it keeps its record and counts nowhere. An abandoned date solved later counts like a first solve.
export const CHANCE_STEPS = [1, 2, 3], CHANCE_STEP = 5, REPLAY_SHOW = 8, REPEAT_MIN_AGE = 30;
const CUM = CHANCE_STEPS.reduce((a, x) => [...a, (a.at(-1) || 0) + x], []); // solves at which the first chances are earned: [1, 3, 6]
export const earned = solved => { const head = CUM.filter(c => c <= solved).length; return head < CUM.length ? head : CUM.length + Math.floor((solved - CUM.at(-1)) / CHANCE_STEP); };
export const thresholdOf = k => (k < 1 ? 0 : k <= CUM.length ? CUM[k - 1] : CUM.at(-1) + (k - CUM.length) * CHANCE_STEP); // total solves at which the k-th chance is earned
export const solvesToNext = solved => thresholdOf(earned(solved) + 1) - solved; // 1..CHANCE_STEP
export const stepOf = solved => { const e = earned(solved); return { done: solved - thresholdOf(e), total: thresholdOf(e + 1) - thresholdOf(e) }; }; // progress inside the current price step
export const BACKFILL_DAYS = 90; // first run: solved Game-of-Day records of the last 90 days (incl. today) count as already solved
const KEY = 'zip_gotd_credit'; // { solved, used, bonus }

export function createReplay(storage, store, now = () => new Date()) {
  let credit = null; // null until init(): no chances before that
  const save = async () => { try { await storage.set(KEY, JSON.stringify(credit)); } catch { /* ignore */ } };
  const valid = c => c && Number.isInteger(c.solved) && Number.isInteger(c.used) && c.solved >= 0 && c.used >= 0 && (c.bonus === undefined || (Number.isInteger(c.bonus) && c.bonus >= 0));
  const today = () => utcDayNumber(now());
  const repeatsOf = days => days.filter(x => x.attempt && x.attempt.solved && today() - dayOfDate(x.date) > REPEAT_MIN_AGE)
    .sort((a, b) => b.attempt.time - a.attempt.time || (a.date < b.date ? -1 : 1)); // longest time first, the older date first on a tie
  const replay = {
    // Loads the counters; the very first time (nothing stored) it counts the solves recorded before this feature existed.
    // Await it before any solve is recorded, or that solve would be counted twice (by this scan and by addSolved).
    async init() {
      try { const r = await storage.get(KEY), c = r && JSON.parse(r.value); if (valid(c)) { credit = { solved: c.solved, used: c.used, bonus: c.bonus || 0 }; return; } } catch { /* fall through */ }
      let solved = 0;
      for (let k = 0; k <= BACKFILL_DAYS; k++) { const a = await store.loadAttempt(dateOfDay(today() - k)); if (a && a.solved) solved++; }
      credit = { solved, used: 0, bonus: 0 };
      await save();
    },
    chances: () => (credit ? Math.max(0, earned(credit.solved) + credit.bonus - credit.used) : 0),
    toNext: () => solvesToNext(credit ? credit.solved : 0), // solves still needed for the next chance
    step: () => stepOf(credit ? credit.solved : 0),        // { done, total }: solves made / needed in the current step (for the progress dots)
    // The replay window, newest first: yesterday .. REPLAY_DAYS days back.
    dates: () => Array.from({ length: REPLAY_DAYS }, (_, i) => dateOfDay(today() - 1 - i)),
    // Every window date with its stored attempt record, newest first: null = missed, { solved: false } = abandoned, { solved: true, time, stats? } = played.
    // Read from local storage only; the stats inside a record are what the backend answered when the time was submitted.
    async days() { return Promise.all(replay.dates().map(async date => ({ date, attempt: await store.loadAttempt(date) }))); },
    async missed() { return (await replay.days()).filter(x => !x.attempt).map(x => x.date); },
    // Solved window dates old enough to repeat, in the order they are offered.
    async repeats() { return repeatsOf(await replay.days()); },
    // The picker's list: [{ date, attempt }] (attempt null = missed), at most REPLAY_SHOW. hasFile: async date -> whether that day's puzzle file exists.
    async pick(hasFile) {
      const days = await replay.days();
      const take = async (list, max) => { // the first `max` of list with a file; files are checked in parallel batches of the number still needed
        const out = []; let i = 0;
        while (out.length < max && i < list.length) {
          const batch = list.slice(i, i + max - out.length); i += batch.length;
          const has = await Promise.all(batch.map(d => hasFile(d.date)));
          batch.forEach((d, k) => { if (has[k]) out.push(d); });
        }
        return out;
      };
      const missed = await take(days.filter(d => !d.attempt), REPLAY_SHOW);
      const abandoned = missed.length ? [] : await take(days.filter(d => d.attempt && !d.attempt.solved), 1);
      return [...missed, ...abandoned, ...await take(repeatsOf(days), REPLAY_SHOW - missed.length - abandoned.length)];
    },
    // Today's and the window's solved attempts the averages backend has not acknowledged yet (sent === false): to be submitted again.
    async unsent() {
      const out = [];
      for (const d of [dateOfDay(today()), ...replay.dates()]) { const a = await store.loadAttempt(d); if (a && a.solved && a.sent === false) out.push({ date: d, time: a.time }); }
      return out;
    },
    // Call once the puzzle of `date` has loaded: spends a chance and marks a missed date as played (abandoning it keeps it spent, like the live game).
    // An abandoned date may be played again, and a solved date older than REPEAT_MIN_AGE days repeated: their records stay as they are.
    // false = refused (no chance, outside the window, or already played): nothing changed.
    async begin(date) {
      if (!credit || replay.chances() < 1 || !replay.dates().includes(date)) return false;
      const a = await store.loadAttempt(date);
      if (!a) await store.saveAttempt(date, { solved: false, time: null }); // the date first, so a failure in between loses nothing but the date
      else if (a.solved && !(today() - dayOfDate(date) > REPEAT_MIN_AGE)) return false;
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
    // A streak milestone (every 7th streak day) earns one more chance.
    async addBonus() { if (!credit) return; credit.bonus++; await save(); },
    // A Game of Day was solved for the first time (live or replay).
    async addSolved() { if (!credit) return; credit.solved++; await save(); },
  };
  return replay;
}
