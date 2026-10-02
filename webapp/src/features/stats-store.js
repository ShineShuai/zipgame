import { newStat, updateStat } from '../core/stats.js';

// Persistent per-size stats (all-time "total" and per-UTC-day "today"), Game-of-Day best time and once-per-day attempt flag.
// Total keys are unchanged from the old app; today's stats live under zip_today_stats_<n> = { day, stat }.
// One attempt record per Game-of-Day date: { solved, time, sent?, stats? }. A date with no record is a date the player never played, i.e. one a replay may offer.
export const attemptKey = date => 'zip_gotd_attempt_' + date;
export function createStore(storage, sizes) {
  const total = {}, today = {}, best = {}, attempts = {}; let attemptDate = null; // attempts: date -> record|null, every date loaded so far (today and replays)
  const get = async k => { try { const r = await storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; } };
  const set = async (k, v) => { try { await storage.set(k, JSON.stringify(v)); } catch { /* ignore */ } };
  const store = {
    async hydrate(dateStr) {
      await Promise.all(sizes.map(async n => {
        total[n] = (await get('zip_local_stats_' + n)) || newStat(); today[n] = await get('zip_today_stats_' + n); best[n] = await get('zip_gotd_best_' + n);
      }));
      await store.hydrateAttempt(dateStr);
    },
    total: n => total[n] || newStat(),
    today: (n, day) => (today[n] && today[n].day === day ? today[n].stat : newStat()),
    async recordSolve(n, day, time) {
      total[n] = updateStat(total[n] || newStat(), time);
      today[n] = { day, stat: updateStat(store.today(n, day), time) };
      await Promise.all([set('zip_local_stats_' + n, total[n]), set('zip_today_stats_' + n, today[n])]);
    },
    gotdBest: n => best[n] || null,
    // pending: also submit to the averages backend (sent:false until it answers).
    // replay: the date is a past one; the per-size Game-of-Day time (zip_gotd_best_<n>, shown in the menu table) belongs to the live game and stays as it is.
    async recordGotd(n, date, time, pending = false, replay = false) {
      if (!replay) { const prev = best[n]; if (!prev || prev.date !== date || prev.time > time) { best[n] = { date, time }; await set('zip_gotd_best_' + n, best[n]); } }
      await store.saveAttempt(date, pending ? { solved: true, time, sent: false } : { solved: true, time });
    },
    attempt: () => attempts[attemptDate] || null, attemptDate: () => attemptDate, // today's record (as of the last hydrateAttempt)
    attemptOn: date => attempts[date] || null,                                     // any loaded date's record
    async loadAttempt(date) { attempts[date] = await get(attemptKey(date)); return attempts[date]; },
    async hydrateAttempt(date) { await store.loadAttempt(date); attemptDate = date; },
    async saveAttempt(date, a) { attempts[date] = a; await set(attemptKey(date), a); },
  };
  return store;
}
